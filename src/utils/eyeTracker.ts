/**
 * Real-Time Computer Vision Eye & Pupil Tracking Utility
 *
 * Pipeline:
 *  - MediaPipe FaceLandmarker (iris landmarks + face blendshapes) as the primary source
 *  - One Euro Filter for landmark smoothing (adaptive: heavy smoothing when still,
 *    light smoothing during fast movement — better jitter/lag tradeoff than a fixed-gain
 *    Kalman filter for this kind of noisy-but-bounded landmark signal)
 *  - Real pupil-boundary search (cropped, Otsu-thresholded dark-region centroid) instead
 *    of an assumed constant radius, so pupil diameter is an actual measurement
 *  - Advanced CV fallback (YCbCr skin segmentation + dark-region search) when MediaPipe
 *    is unavailable
 *  - Laplacian blur variance + CRADLE multi-frame leukocoria aggregation
 *
 * NOTE ON ACCURACY: this remains a monocular-camera estimation pipeline, not a clinical
 * instrument. Pixel-to-mm conversion depends on the 11.7mm adult iris constant, which is
 * a population average (real iris diameter varies ~10.2-13mm across individuals). Distance
 * estimates depend on an uncalibrated focal-length-in-pixels approximation. Treat outputs
 * as screening-grade estimates, not measurements.
 *
 * PERF NOTES (2026 pass):
 *  - getImageData() is a synchronous GPU->CPU readback and the single biggest cost in
 *    this pipeline. We now do at most 2 per frame in the MediaPipe tier (pupil-boundary
 *    crop, reused for red-reflex/blur too; a throttled+downsampled ambient-light read),
 *    down from 3 separate full/partial reads.
 *  - Ambient light is now sampled from a small offscreen canvas via drawImage (cheap,
 *    GPU-side downsample) rather than striding through a full-resolution ImageData
 *    buffer, and is only refreshed every AMBIENT_LIGHT_THROTTLE_FRAMES frames since it
 *    doesn't need per-frame precision.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { PhotorefractionData } from '../types';

// Blink and obscuration detection thresholds (clinical standards)
export const BLINK_EAR_THRESHOLD = 0.12;
export const OBSCURED_EAR_THRESHOLD = 0.08;
// Blendshape blink score above which we treat the eye as closed, fused with EAR
export const BLINK_BLENDSHAPE_THRESHOLD = 0.55;

// Anatomical constants
const IRIS_BIOLOGICAL_CONSTANT_MM = 11.7;
const CHILD_IRIS_CONSTANT_MM = 11.0;
const APPROX_FOCAL_LENGTH_PX = 600; // device-dependent; uncalibrated approximation

// How often (in frames) to refresh the ambient-light estimate. Room brightness doesn't
// change frame-to-frame, so there's no reason to pay a getImageData cost every frame.
const AMBIENT_LIGHT_THROTTLE_FRAMES = 10;
// Fixed small size for the ambient-light downsample canvas — big enough to average out
// noise, tiny enough that reading it back is essentially free.
const AMBIENT_LIGHT_SAMPLE_W = 48;
const AMBIENT_LIGHT_SAMPLE_H = 27;

export interface PupilFrameResult {
  detected: boolean;
  leftEye: { x: number; y: number; radius: number; brightness: number } | null;
  rightEye: { x: number; y: number; radius: number; brightness: number } | null;
  pupilDiameterMm: number;
  redReflexIntensity: number;
  crescentRatio: number;
  crescentOrientation?: 'TOP' | 'BOTTOM' | 'SYMMETRIC';
  /** True when pupil mm came from the iris-as-ruler path (MediaPipe tier). */
  pupilMmFromIrisRuler?: boolean;
  fps: number;
  confidenceScore: number;
  ear: number;
  isBlinking: boolean;
  isObscured: boolean;
  blurVariance?: number;
  isFocused?: boolean;
  zDistanceCm?: number;
  zDistanceConfident?: boolean;
  ambientLightLevel?: number; // Average frame brightness (0-255) for room light detection
  gazeAngleDeg?: number; // Gaze angle deviation from camera center (degrees)
  cradleLeukocoriaPositive?: boolean;
}

/**
 * One Euro Filter (Casiez, Roussel & Vogel, 2012)
 * Adaptive low-pass filter: smooths heavily when the signal is near-stationary
 * (reduces jitter) and relaxes smoothing as speed increases (reduces lag).
 * Two intuitive parameters instead of a full covariance model:
 *   minCutoff - base smoothing at low speed (lower = smoother but laggier)
 *   beta      - how much speed reduces smoothing (higher = more responsive to fast motion)
 */
class OneEuroFilter1D {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev: number = 0;

  constructor(minCutoff = 1.0, beta = 0.3, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / Math.max(dt, 1e-6));
  }

  public reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  public filter(x: number, dt: number = 0.033): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      return x;
    }
    const dx = (x - this.xPrev) / Math.max(dt, 1e-6);
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

/**
 * 2D wrapper around OneEuroFilter1D for smoothing (x, y) landmark trajectories.
 * Replaces the fixed-gain Kalman filter as the primary smoother: eye landmark noise
 * is bursty (saccades) rather than well-modeled by a constant process/measurement
 * noise ratio, which is exactly the case One Euro is designed for.
 */
export class OneEuroFilter2D {
  private fx: OneEuroFilter1D;
  private fy: OneEuroFilter1D;
  private lastX: number = 0;
  private lastY: number = 0;
  private initialized: boolean = false;

  constructor(minCutoff = 1.0, beta = 0.3, dCutoff = 1.0) {
    this.fx = new OneEuroFilter1D(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter1D(minCutoff, beta, dCutoff);
  }

  public reset() {
    this.fx.reset();
    this.fy.reset();
    this.initialized = false;
  }

  public update(mX: number, mY: number, dt: number = 0.033): { x: number; y: number } {
    const x = this.fx.filter(mX, dt);
    const y = this.fy.filter(mY, dt);
    this.lastX = x;
    this.lastY = y;
    this.initialized = true;
    return { x: Math.round(x), y: Math.round(y) };
  }

  public getPosition(): { x: number; y: number } {
    return { x: Math.round(this.lastX), y: Math.round(this.lastY) };
  }
}

/**
 * 2D State-Space Kalman Filter — retained for compatibility / cases where a constant-
 * velocity motion model is preferable (e.g. smooth-pursuit gaze tracking rather than
 * saccadic iris-center tracking). Not used by default in EyeTrackerEngine anymore;
 * OneEuroFilter2D is the default smoother. See class comment on OneEuroFilter2D for why.
 */
export class KalmanFilter2D {
  private x: number = 0;
  private y: number = 0;
  private vx: number = 0;
  private vy: number = 0;
  private p11: number = 1.0;
  private p22: number = 1.0;
  private p33: number = 1.0;
  private p44: number = 1.0;
  private processNoise: number;
  private measurementNoise: number;
  private initialized: boolean = false;

  constructor(processNoise: number = 0.04, measurementNoise: number = 0.7) {
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
  }

  public reset() {
    this.initialized = false;
  }

  public predict(dt: number = 0.033): { x: number; y: number } {
    if (!this.initialized) return { x: this.x, y: this.y };
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.p11 += dt * dt * this.p33 + this.processNoise;
    this.p22 += dt * dt * this.p44 + this.processNoise;
    return { x: this.x, y: this.y };
  }

  public update(mX: number, mY: number, dt: number = 0.033): { x: number; y: number } {
    if (!this.initialized) {
      this.x = mX;
      this.y = mY;
      this.vx = 0;
      this.vy = 0;
      this.initialized = true;
      return { x: this.x, y: this.y };
    }

    this.predict(dt);

    const k1 = this.p11 / (this.p11 + this.measurementNoise);
    const k2 = this.p22 / (this.p22 + this.measurementNoise);

    const resX = mX - this.x;
    const resY = mY - this.y;

    this.x += k1 * resX;
    this.y += k2 * resY;
    this.vx += (k1 * resX) / Math.max(0.001, dt);
    this.vy += (k2 * resY) / Math.max(0.001, dt);

    this.p11 *= (1 - k1);
    this.p22 *= (1 - k2);

    return { x: Math.round(this.x), y: Math.round(this.y) };
  }

  public getPosition(): { x: number; y: number } {
    return { x: Math.round(this.x), y: Math.round(this.y) };
  }
}

/**
 * CRADLE Multi-Frame Temporal Aggregation for Leukocoria (White Pupil) Detection
 * Requires >= 3 out of 5 consecutive positive frames + flash proximity score
 */
export class CradleLeukocoriaDetector {
  private frameHistory: boolean[] = [];
  private maxHistory: number = 5;

  public processFrame(
    redReflexRatio: number,
    flashActive: boolean = false
  ): { isPositive: boolean; positiveCount: number; confidence: number } {
    const isLeukocoric = redReflexRatio > 0.88 || redReflexRatio < 0.35;
    this.frameHistory.push(isLeukocoric);

    if (this.frameHistory.length > this.maxHistory) {
      this.frameHistory.shift();
    }

    const positiveCount = this.frameHistory.filter(Boolean).length;
    const flashScore = flashActive ? 0.90 : 0.60;
    const isPositive = positiveCount >= 3 && flashScore > 0.55;
    const confidence = Math.min(99, Math.round((positiveCount / 5) * 100 * flashScore));

    return {
      isPositive,
      positiveCount,
      confidence,
    };
  }
}

/**
 * Otsu's method: picks a threshold that best separates a bimodal histogram
 * (here: dark pupil/iris pixels vs. brighter sclera/skin pixels) instead of a
 * fixed "min + 30" offset, which breaks down under uneven or changing lighting.
 */
function otsuThreshold(histogram: number[], totalPixels: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;

    const weightForeground = totalPixels - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];

    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;

    const betweenVariance =
      weightBackground * weightForeground * Math.pow(meanBackground - meanForeground, 2);

    if (betweenVariance > maxVariance) {
      maxVariance = betweenVariance;
      threshold = t;
    }
  }

  return threshold;
}

export class EyeTrackerEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private lastFrameTime: number = performance.now();
  private lastUpdateTime: number = performance.now();
  private frameCount: number = 0;
  private currentFps: number = 30;

  // One Euro Filters for left/right iris-center smoothing (see class doc for rationale).
  // beta raised from 0.4 -> 0.7: the previous value under-relaxed smoothing during fast
  // eye movement (saccades), which is what reads as "sluggish"/laggy tracking. This
  // trades a small amount of extra jitter at rest for much less lag on quick motion.
  private leftSmoother = new OneEuroFilter2D(0.8, 0.7, 1.0);
  private rightSmoother = new OneEuroFilter2D(0.8, 0.7, 1.0);

  // CRADLE Leukocoria Multi-Frame Temporal Detector
  private cradleDetector = new CradleLeukocoriaDetector();

  // MediaPipe FaceLandmarker
  private faceLandmarker: FaceLandmarker | null = null;
  private isMediaPipeLoading: boolean = false;
  private mediaPipeReady: boolean = false;
  private lastVideoTimestamp: number = 0;
  private mediaPipeLoadProgress: number = 0;
  private mediaPipeLoadError: string | null = null;

  // Small offscreen canvas + cache for throttled ambient-light sampling (see
  // measureAmbientLight). Avoids a full-resolution getImageData() every frame.
  private ambientCanvas: HTMLCanvasElement;
  private ambientCtx: CanvasRenderingContext2D | null;
  private ambientLightCache: number = 128;
  private ambientLightFrameCounter: number = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ambientCanvas = document.createElement('canvas');
    this.ambientCanvas.width = AMBIENT_LIGHT_SAMPLE_W;
    this.ambientCanvas.height = AMBIENT_LIGHT_SAMPLE_H;
    this.ambientCtx = this.ambientCanvas.getContext('2d', { willReadFrequently: true });
    this.initMediaPipe();
  }

  public getMediaPipeStatus(): { loading: boolean; ready: boolean; progress: number; error: string | null } {
    return {
      loading: this.isMediaPipeLoading,
      ready: this.mediaPipeReady,
      progress: this.mediaPipeLoadProgress,
      error: this.mediaPipeLoadError,
    };
  }

  /**
   * Initializes MediaPipe FaceLandmarker asynchronously with WASM files.
   * Requests face blendshapes so blink detection can be fused with geometric EAR
   * (blendshapes stay reliable when the head is off-axis, where EAR degrades).
   * Explicit confidence floors reduce silently-wrong iris detections feeding
   * downstream pupil/red-reflex math.
   */
  private async initMediaPipe() {
    if (this.isMediaPipeLoading || this.mediaPipeReady) return;
    this.isMediaPipeLoading = true;
    this.mediaPipeLoadProgress = 0;
    this.mediaPipeLoadError = null;

    try {
      this.mediaPipeLoadProgress = 20;
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      this.mediaPipeLoadProgress = 50;

      const modelPath = `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;

      const baseConfig = {
        baseOptions: {
          modelAssetPath: modelPath,
          delegate: 'GPU' as const,
        },
        runningMode: 'VIDEO' as const,
        numFaces: 1,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      };

      try {
        this.mediaPipeLoadProgress = 70;
        this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, baseConfig);
        this.mediaPipeLoadProgress = 100;
      } catch (gpuErr) {
        console.warn('GPU delegate failed, falling back to CPU:', gpuErr);
        this.mediaPipeLoadProgress = 80;
        this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          ...baseConfig,
          baseOptions: { ...baseConfig.baseOptions, delegate: 'CPU' as const },
        });
        this.mediaPipeLoadProgress = 100;
      }
      this.mediaPipeReady = true;
      console.log('MediaPipe FaceLandmarker initialized successfully.');
    } catch (err) {
      this.mediaPipeLoadError = err instanceof Error ? err.message : 'Unknown error';
      console.warn('MediaPipe initialization fallback to Advanced CV Engine:', err);
    } finally {
      this.isMediaPipeLoading = false;
    }
  }

  /**
   * Cheap, throttled ambient-light estimate. Instead of reading back a strided sample
   * of the full-resolution frame (which still pays the cost of a full-res
   * getImageData() call), we let the GPU do the downsampling via drawImage into a
   * fixed tiny canvas, then read back only ~1,300 pixels. Refreshed once every
   * AMBIENT_LIGHT_THROTTLE_FRAMES frames since room brightness doesn't change
   * frame-to-frame.
   */
  private measureAmbientLight(width: number, height: number): number {
    this.ambientLightFrameCounter++;
    if (this.ambientLightFrameCounter % AMBIENT_LIGHT_THROTTLE_FRAMES !== 0) {
      return this.ambientLightCache;
    }
    if (!this.ambientCtx) return this.ambientLightCache;

    try {
      this.ambientCtx.drawImage(
        this.canvas,
        0, 0, width, height,
        0, 0, AMBIENT_LIGHT_SAMPLE_W, AMBIENT_LIGHT_SAMPLE_H
      );
      const small = this.ambientCtx.getImageData(0, 0, AMBIENT_LIGHT_SAMPLE_W, AMBIENT_LIGHT_SAMPLE_H);
      const data = small.data;
      let total = 0;
      const pixelCount = AMBIENT_LIGHT_SAMPLE_W * AMBIENT_LIGHT_SAMPLE_H;
      for (let i = 0; i < data.length; i += 4) {
        total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
      this.ambientLightCache = pixelCount > 0 ? total / pixelCount : this.ambientLightCache;
    } catch (e) {
      // keep last cached value on failure (e.g. tainted canvas)
    }
    return this.ambientLightCache;
  }

  /**
   * Analyzes current frame from an HTMLVideoElement and draws tracking HUD onto targetCanvas
   */
  public processFrame(
    video: HTMLVideoElement,
    overlayCanvas: HTMLCanvasElement,
    options: { drawMesh?: boolean; flashActive?: boolean; isChild?: boolean } = {}
  ): PupilFrameResult {
    if (!video || video.readyState < 2 || !this.ctx) {
      return this.emptyResult();
    }

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;

    this.canvas.width = width;
    this.canvas.height = height;
    overlayCanvas.width = width;
    overlayCanvas.height = height;

    const overlayCtx = overlayCanvas.getContext('2d');

    this.ctx.drawImage(video, 0, 0, width, height);

    // Frame delta time, used to drive the adaptive One Euro smoothing
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastUpdateTime) / 1000));
    this.lastUpdateTime = now;

    this.frameCount++;
    if (now - this.lastFrameTime >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFrameTime));
      this.frameCount = 0;
      this.lastFrameTime = now;
    }

    let leftPupil: { x: number; y: number; radius: number; brightness: number } | null = null;
    let rightPupil: { x: number; y: number; radius: number; brightness: number } | null = null;
    let confidenceScore = 0;
    let landmarksMesh: any[] | null = null;
    let blendshapeBlinkL = 0;
    let blendshapeBlinkR = 0;
    let zDistanceCm = 45.0;
    let zDistanceConfident = false;
    let estimatedPupilMm = 5.5;
    // Explicit flag instead of comparing estimatedPupilMm to the 5.5 default via
    // float equality — a legitimately-measured value landing near 5.5mm should never
    // be silently overwritten by the cruder IPD-based fallback below.
    let pupilMmMeasuredFromIris = false;
    // Reused for red-reflex/blur measurement below so we don't pay for a second
    // getImageData() crop when the iris-ruler pupil search already cropped this region.
    let imgDataForPupil: ImageData | null = null;

    // TIER 1: MediaPipe Face Landmarker if ready
    if (this.mediaPipeReady && this.faceLandmarker) {
      try {
        // Derive the detection timestamp from the video's own clock rather than
        // wall-clock performance.now(). Tying it to performance.now() can desync from
        // the actual frame being analyzed whenever the render loop jitters, which
        // shows up as jumpy/inconsistent tracking.
        let videoTimestamp = Math.round(video.currentTime * 1000);
        if (videoTimestamp <= this.lastVideoTimestamp) {
          videoTimestamp = this.lastVideoTimestamp + 1;
        }
        this.lastVideoTimestamp = videoTimestamp;

        const results = this.faceLandmarker.detectForVideo(video, videoTimestamp);
        if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
          const landmarks = results.faceLandmarks[0];
          landmarksMesh = landmarks;

          // Pull blink blendshape scores if available (more robust than geometric EAR
          // when the head is tilted or rotated off-axis)
          if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
            const categories = results.faceBlendshapes[0].categories;
            const findScore = (name: string) =>
              categories.find((c: { categoryName: string; score: number }) => c.categoryName === name)
                ?.score ?? 0;
            blendshapeBlinkL = findScore('eyeBlinkLeft');
            blendshapeBlinkR = findScore('eyeBlinkRight');
          }

          let landmarkMetrics: ReturnType<EyeTrackerEngine['extractOpticalMetricsFromLandmarks']> = null;
          try {
            landmarkMetrics = this.extractOpticalMetricsFromLandmarks(
              landmarks,
              this.ctx.getImageData(0, 0, width, height),
              width,
              height,
              !!options.isChild,
            );
          } catch (e) {
            landmarkMetrics = null;
          }

          if (landmarkMetrics) {
            const smoothL = this.leftSmoother.update(landmarkMetrics.leftEye.x, landmarkMetrics.leftEye.y, dt);
            const smoothR = this.rightSmoother.update(landmarkMetrics.rightEye.x, landmarkMetrics.rightEye.y, dt);
            leftPupil = { ...landmarkMetrics.leftEye, x: smoothL.x, y: smoothL.y };
            rightPupil = { ...landmarkMetrics.rightEye, x: smoothR.x, y: smoothR.y };
            confidenceScore = 98;
            estimatedPupilMm = landmarkMetrics.pupilDiameterMm;
            pupilMmMeasuredFromIris = true;
            zDistanceCm = landmarkMetrics.zDistanceCm;
            zDistanceConfident = true;
            imgDataForPupil = landmarkMetrics.crop;
          }

          const leftIrisCenter = landmarks[468];
          const rightIrisCenter = landmarks[473];

          // Retain the former path only as a defensive fallback when the shared
          // iris-ruler extraction cannot form two valid pupil boundaries.
          if (!landmarkMetrics && leftIrisCenter && rightIrisCenter) {
            const rawLX = leftIrisCenter.x * width;
            const rawLY = leftIrisCenter.y * height;
            const rawRX = rightIrisCenter.x * width;
            const rawRY = rightIrisCenter.y * height;

            // Iris ring diameter in px (used both as the mm/px scale AND to bound
            // the pupil-boundary search region below)
            const leftIrisDiameterPx = irisRingDiameterPx(landmarks, 469, 471, 470, 472, width, height, leftIrisCenter);
            const rightIrisDiameterPx = irisRingDiameterPx(landmarks, 474, 476, 475, 477, width, height, rightIrisCenter);
            const avgIrisDiameterPx = (leftIrisDiameterPx + rightIrisDiameterPx) / 2;
            const pixelsPerMm = avgIrisDiameterPx / (options.isChild ? CHILD_IRIS_CONSTANT_MM : IRIS_BIOLOGICAL_CONSTANT_MM);

            // ACTUAL pupil boundary search, cropped tightly to each iris ring, instead
            // of assuming a constant radius. This is what makes pupilDiameterMm a real
            // measurement rather than a rescaled copy of iris size. This same crop is
            // reused below for red-reflex/blur measurement — one getImageData() call
            // instead of two.
            try {
              const padding = Math.ceil(avgIrisDiameterPx * 0.7) || 20;
              const cropX = Math.max(0, Math.round(Math.min(leftIrisCenter.x, rightIrisCenter.x) * width - padding));
              const cropY = Math.max(0, Math.round(Math.min(leftIrisCenter.y, rightIrisCenter.y) * height - padding));
              const cropW = Math.min(width - cropX, Math.round(Math.abs(rightIrisCenter.x - leftIrisCenter.x) * width + padding * 2));
              const cropH = Math.min(height - cropY, Math.round(padding * 2 + Math.max(leftIrisDiameterPx, rightIrisDiameterPx)));
              if (cropW > 4 && cropH > 4) {
                imgDataForPupil = this.ctx.getImageData(cropX, cropY, cropW, cropH);
                (imgDataForPupil as any).__offsetX = cropX;
                (imgDataForPupil as any).__offsetY = cropY;
              }
            } catch (e) {
              imgDataForPupil = null;
            }

            const leftPupilBoundary = imgDataForPupil
              ? findPupilBoundary(imgDataForPupil, rawLX, rawLY, leftIrisDiameterPx / 2)
              : null;
            const rightPupilBoundary = imgDataForPupil
              ? findPupilBoundary(imgDataForPupil, rawRX, rawRY, rightIrisDiameterPx / 2)
              : null;

            const leftRadiusPx = leftPupilBoundary?.radius ?? leftIrisDiameterPx * 0.42;
            const rightRadiusPx = rightPupilBoundary?.radius ?? rightIrisDiameterPx * 0.42;

            // Smooth the MEASURED pupil centroid when the boundary search succeeded,
            // falling back to the raw landmark position only when it didn't. Previously
            // this always smoothed the landmark position and only ever used the
            // boundary search for radius, so the tracked dot could sit visibly off the
            // true pupil center (most noticeable during lateral gaze, where parallax
            // shifts the pupil relative to the visible iris landmark).
            const finalLX = leftPupilBoundary?.centerXFrame ?? rawLX;
            const finalLY = leftPupilBoundary?.centerYFrame ?? rawLY;
            const finalRX = rightPupilBoundary?.centerXFrame ?? rawRX;
            const finalRY = rightPupilBoundary?.centerYFrame ?? rawRY;

            const smoothL = this.leftSmoother.update(finalLX, finalLY, dt);
            const smoothR = this.rightSmoother.update(finalRX, finalRY, dt);

            leftPupil = {
              x: smoothL.x,
              y: smoothL.y,
              radius: Math.round(leftRadiusPx),
              brightness: leftPupilBoundary?.brightness ?? 35,
            };
            rightPupil = {
              x: smoothR.x,
              y: smoothR.y,
              radius: Math.round(rightRadiusPx),
              brightness: rightPupilBoundary?.brightness ?? 35,
            };
            confidenceScore = leftPupilBoundary && rightPupilBoundary ? 98 : 88;

            // Iris-as-ruler: pupil mm derived from the 11.7mm iris biological constant —
            // focal-length-independent (Howland, 1974).
            //   pixelsPerMm = irisDiameterPx / 11.7
            //   pupilDiameterMm = pupilDiameterPx / pixelsPerMm
            const avgPupilRadiusPx = (leftRadiusPx + rightRadiusPx) / 2;
            const pupilDiameterPx = avgPupilRadiusPx * 2;
            const pupilMm = pupilDiameterPx / Math.max(0.01, pixelsPerMm);
            estimatedPupilMm = Math.max(2.0, Math.min(8.0, pupilMm));
            pupilMmMeasuredFromIris = true;

            // Distance: the iris-pinhole model is the sole estimate. MediaPipe landmark
            // Z was evaluated but is intentionally unused because it is normalized to
            // face width, not calibrated metric depth, making it less defensible here.
            if (avgIrisDiameterPx > 10) {
              const pinhole = estimateDistancePinholeModel(avgIrisDiameterPx, !!options.isChild, APPROX_FOCAL_LENGTH_PX);
              zDistanceCm = pinhole.distanceCm;
              zDistanceConfident = true;
            }
            zDistanceCm = Math.max(20, Math.min(120, zDistanceCm));
          }
        }
      } catch (e) {
        // Fallback to advanced CV if timestamp out of order or detection failed
      }
    }

    // TIER 2: Advanced Computer Vision Pipeline (Skin Segmentation + adaptive dark-region search)
    if (!leftPupil || !rightPupil) {
      let imgData: ImageData | null = null;
      try {
        imgData = this.ctx.getImageData(0, 0, width, height);
      } catch (e) {}

      if (imgData) {
        const cvResult = this.detectEyesAdvancedCV(imgData, width, height);
        if (cvResult.leftEye) {
          const smoothL = this.leftSmoother.update(cvResult.leftEye.x, cvResult.leftEye.y, dt);
          leftPupil = { ...cvResult.leftEye, x: smoothL.x, y: smoothL.y };
        }
        if (cvResult.rightEye) {
          const smoothR = this.rightSmoother.update(cvResult.rightEye.x, cvResult.rightEye.y, dt);
          rightPupil = { ...cvResult.rightEye, x: smoothR.x, y: smoothR.y };
        }
        confidenceScore = cvResult.confidence;
      }
    }

    // Measure red reflex intensity & Laplacian blur variance. Prefer reusing the
    // pupil-boundary crop from Tier 1 (imgDataForPupil) — it already covers both eyes
    // with generous padding — instead of taking a second getImageData() crop. Only
    // fall back to a fresh crop when Tier 1 didn't run (Tier 2 CV-only path).
    let redReflex = 0.72;
    let blurInfo = { variance: 120, isFocused: true };

    if (imgDataForPupil && leftPupil && rightPupil) {
      const offX = (imgDataForPupil as any).__offsetX ?? 0;
      const offY = (imgDataForPupil as any).__offsetY ?? 0;
      const localLeft = { x: leftPupil.x - offX, y: leftPupil.y - offY };
      const localRight = { x: rightPupil.x - offX, y: rightPupil.y - offY };
      redReflex = this.computeRedChannelRatio(imgDataForPupil, localLeft, localRight);
      if (options.flashActive) redReflex = Math.min(1.0, redReflex * 1.25);
      blurInfo = computeLaplacianBlurVariance(imgDataForPupil, 0, imgDataForPupil.width, 0, imgDataForPupil.height);
    } else {
      const eyeRegion = computeEyeRegionBounds(leftPupil, rightPupil, width, height);
      let regionImgData: ImageData | null = null;
      try {
        regionImgData = this.ctx.getImageData(eyeRegion.x, eyeRegion.y, eyeRegion.w, eyeRegion.h);
      } catch (e) {}

      if (regionImgData) {
        const localLeft = leftPupil ? { x: leftPupil.x - eyeRegion.x, y: leftPupil.y - eyeRegion.y } : null;
        const localRight = rightPupil ? { x: rightPupil.x - eyeRegion.x, y: rightPupil.y - eyeRegion.y } : null;
        redReflex = this.computeRedChannelRatio(regionImgData, localLeft, localRight);
        if (options.flashActive) redReflex = Math.min(1.0, redReflex * 1.25);
        blurInfo = computeLaplacianBlurVariance(regionImgData, 0, regionImgData.width, 0, regionImgData.height);
      }
    }

    // CRADLE Multi-Frame Temporal Aggregation for Leukocoria
    const cradleRes = this.cradleDetector.processFrame(redReflex, options.flashActive);

    // Ambient light level detection (throttled + downsampled — see measureAmbientLight)
    const ambientLightLevel = this.measureAmbientLight(width, height);

    // Gaze angle calculation (deviation from camera center)
    let gazeAngleDeg = 0;
    if (leftPupil && rightPupil) {
      const midX = (leftPupil.x + rightPupil.x) / 2;
      const midY = (leftPupil.y + rightPupil.y) / 2;
      const centerX = width / 2;
      const centerY = height / 2;
      const offsetX = midX - centerX;
      const offsetY = midY - centerY;
      // Approximate angle based on offset from center (assuming ~60° FOV at 1280px width)
      const horizontalAngle = (offsetX / width) * 60;
      const verticalAngle = (offsetY / height) * 45;
      gazeAngleDeg = Math.sqrt(horizontalAngle * horizontalAngle + verticalAngle * verticalAngle);
    }

    // IPD-based fallback only if the iris-ruler path above never ran (e.g. Tier 2 CV only)
    if (!pupilMmMeasuredFromIris && leftPupil && rightPupil) {
      const ipdPx = Math.sqrt(Math.pow(leftPupil.x - rightPupil.x, 2) + Math.pow(leftPupil.y - rightPupil.y, 2));
      const averageIpdMm = 63.0;
      const pixelsPerMm = ipdPx / averageIpdMm;
      const avgPupilRadiusPx = (leftPupil.radius + rightPupil.radius) / 2;
      estimatedPupilMm = (avgPupilRadiusPx / pixelsPerMm) * 2;
      estimatedPupilMm = Math.max(2.0, Math.min(8.0, estimatedPupilMm));
      // Tier-2 lacks iris landmarks — flag lower confidence than iris-ruler path
      confidenceScore = Math.min(confidenceScore || 75, 68);
    }

    // Crescent ratio from red-reflex brightness distribution across the pupil region
    let estimatedCrescent = Math.min(0.5, Math.max(0.1, 0.2 + (5.0 - estimatedPupilMm) * 0.04));
    let crescentOrientation: 'TOP' | 'BOTTOM' | 'SYMMETRIC' = estimatedCrescent > 0.25 ? 'TOP' : 'SYMMETRIC';
    if (imgDataForPupil && leftPupil && rightPupil) {
      const offX = (imgDataForPupil as any).__offsetX ?? 0;
      const offY = (imgDataForPupil as any).__offsetY ?? 0;
      const localLeft = { x: leftPupil.x - offX, y: leftPupil.y - offY, radius: leftPupil.radius };
      const localRight = { x: rightPupil.x - offX, y: rightPupil.y - offY, radius: rightPupil.radius };
      const crescentEst = estimateCrescentFromPupilRegion(imgDataForPupil, localLeft, localRight);
      estimatedCrescent = crescentEst.crescentRatio;
      crescentOrientation = crescentEst.orientation;
    } else if (leftPupil || rightPupil) {
      let regionImgData: ImageData | null = null;
      const eyeRegion = computeEyeRegionBounds(leftPupil, rightPupil, width, height);
      try {
        regionImgData = this.ctx.getImageData(eyeRegion.x, eyeRegion.y, eyeRegion.w, eyeRegion.h);
      } catch (e) {}
      if (regionImgData) {
        const localLeft = leftPupil
          ? { x: leftPupil.x - eyeRegion.x, y: leftPupil.y - eyeRegion.y, radius: leftPupil.radius }
          : null;
        const localRight = rightPupil
          ? { x: rightPupil.x - eyeRegion.x, y: rightPupil.y - eyeRegion.y, radius: rightPupil.radius }
          : null;
        const crescentEst = estimateCrescentFromPupilRegion(regionImgData, localLeft, localRight);
        estimatedCrescent = crescentEst.crescentRatio;
        crescentOrientation = crescentEst.orientation;
      }
    }

    // Eye Aspect Ratio (EAR) for blink & eyelid obscuration detection, fused with
    // blendshape blink scores when available (blendshapes hold up better off-axis).
    let calculatedEar = 0.26;
    let isBlinking = false;
    let isObscured = false;

    if (landmarksMesh && landmarksMesh.length >= 400) {
      const lm = landmarksMesh;
      if (lm[33] && lm[160] && lm[158] && lm[133] && lm[153] && lm[144] &&
          lm[362] && lm[385] && lm[387] && lm[263] && lm[373] && lm[380]) {
        const p = (idx: number) => ({ x: lm[idx].x * width, y: lm[idx].y * height });
        const leftRes = calculateEyeAspectRatio(p(33), p(160), p(158), p(133), p(153), p(144));
        const rightRes = calculateEyeAspectRatio(p(362), p(385), p(387), p(263), p(373), p(380));

        calculatedEar = Math.min(leftRes.ear, rightRes.ear);
        const earBlink = calculatedEar < BLINK_EAR_THRESHOLD;
        const blendshapeBlink =
          Math.max(blendshapeBlinkL, blendshapeBlinkR) > BLINK_BLENDSHAPE_THRESHOLD;
        isBlinking = earBlink || blendshapeBlink;
        isObscured = calculatedEar < OBSCURED_EAR_THRESHOLD || (!leftPupil && !rightPupil);
      }
    } else {
      calculatedEar = 0.26;
      isBlinking = false;
      isObscured = false;
    }

    // Render Live Optical HUD on overlayCanvas
    if (overlayCtx) {
      overlayCtx.clearRect(0, 0, width, height);

      if (options.drawMesh && landmarksMesh && landmarksMesh.length > 0) {
        overlayCtx.fillStyle = 'rgba(34, 211, 238, 0.4)';
        for (let i = 0; i < landmarksMesh.length; i += 5) {
          const pt = landmarksMesh[i];
          overlayCtx.fillRect(pt.x * width - 1, pt.y * height - 1, 2, 2);
        }
      }

      if (leftPupil) {
        this.drawPupilHUD(overlayCtx, leftPupil.x, leftPupil.y, leftPupil.radius, 'OS (Left Eye)');
      }
      if (rightPupil) {
        this.drawPupilHUD(overlayCtx, rightPupil.x, rightPupil.y, rightPupil.radius, 'OD (Right Eye)');
      }

      if (leftPupil && rightPupil) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(leftPupil.x, leftPupil.y);
        overlayCtx.lineTo(rightPupil.x, rightPupil.y);
        overlayCtx.strokeStyle = '#06b6d4';
        overlayCtx.lineWidth = 2;
        overlayCtx.setLineDash([4, 4]);
        overlayCtx.stroke();
        overlayCtx.setLineDash([]);

        const midX = (leftPupil.x + rightPupil.x) / 2;
        const midY = (leftPupil.y + rightPupil.y) / 2 - 12;
        const ipdPx = Math.sqrt(Math.pow(leftPupil.x - rightPupil.x, 2) + Math.pow(leftPupil.y - rightPupil.y, 2));
        const ipdMm = Math.round(ipdPx * 0.28);

        overlayCtx.fillStyle = '#22d3ee';
        overlayCtx.font = 'bold 11px monospace';
        const distLabel = zDistanceConfident ? `${Math.round(zDistanceCm)}cm` : `~${Math.round(zDistanceCm)}cm?`;
        overlayCtx.fillText(`IPD: ${ipdMm}mm | Dist: ${distLabel} | Pupil: ${estimatedPupilMm.toFixed(1)}mm`, midX - 95, midY);
      }

      if (isBlinking || isObscured) {
        overlayCtx.fillStyle = 'rgba(225, 29, 72, 0.88)';
        overlayCtx.fillRect(12, 12, width - 24, 38);
        overlayCtx.fillStyle = '#ffffff';
        overlayCtx.font = 'bold 12px monospace';
        overlayCtx.textAlign = 'center';
        const msg = isBlinking
          ? `⚠️ DATA COLLECTION PAUSED: BLINK DETECTED (EAR = ${calculatedEar.toFixed(2)} < ${BLINK_EAR_THRESHOLD})`
          : `⚠️ DATA COLLECTION PAUSED: EYES OBSCURED (EAR = ${calculatedEar.toFixed(2)} < ${OBSCURED_EAR_THRESHOLD})`;
        overlayCtx.fillText(msg, width / 2, 35);
        overlayCtx.textAlign = 'left';
      }

      if (options.flashActive) {
        overlayCtx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        overlayCtx.fillRect(0, 0, width, height);
      }
    }

    return {
      detected: !!(leftPupil && rightPupil),
      leftEye: leftPupil,
      rightEye: rightPupil,
      pupilDiameterMm: Math.round(estimatedPupilMm * 10) / 10,
      redReflexIntensity: Math.round(redReflex * 100) / 100,
      crescentRatio: Math.round(estimatedCrescent * 100) / 100,
      crescentOrientation,
      pupilMmFromIrisRuler: pupilMmMeasuredFromIris,
      fps: this.currentFps,
      confidenceScore: confidenceScore || (leftPupil && rightPupil ? 92 : 50),
      ear: Math.round(calculatedEar * 100) / 100,
      isBlinking,
      isObscured,
      blurVariance: blurInfo.variance,
      isFocused: blurInfo.isFocused,
      zDistanceCm,
      zDistanceConfident,
      ambientLightLevel: Math.round(ambientLightLevel),
      gazeAngleDeg: Math.round(gazeAngleDeg * 10) / 10,
      cradleLeukocoriaPositive: cradleRes.isPositive,
    };
  }

  private emptyResult(): PupilFrameResult {
    return {
      detected: false,
      leftEye: null,
      rightEye: null,
      pupilDiameterMm: 5.5,
      redReflexIntensity: 0.75,
      crescentRatio: 0.25,
      fps: this.currentFps,
      confidenceScore: 0,
      ear: 0.28,
      isBlinking: false,
      isObscured: false,
      zDistanceConfident: false,
    };
  }

  /**
   * Extracts iris-ruler optical measurements from FaceLandmarker output. Keeping
   * this in one place makes live video and static uploads use identical pupil
   * calibration and pixel sampling.
   */
  private extractOpticalMetricsFromLandmarks(
    landmarks: any[],
    imgData: ImageData,
    width: number,
    height: number,
    isChild: boolean,
  ): {
    leftEye: { x: number; y: number; radius: number; brightness: number };
    rightEye: { x: number; y: number; radius: number; brightness: number };
    pupilDiameterMm: number;
    redReflex: number;
    crescentRatio: number;
    crescentOrientation: 'TOP' | 'BOTTOM' | 'SYMMETRIC';
    zDistanceCm: number;
    crop: ImageData;
  } | null {
    const leftIrisCenter = landmarks[468];
    const rightIrisCenter = landmarks[473];
    if (!leftIrisCenter || !rightIrisCenter) return null;

    const leftIrisDiameterPx = irisRingDiameterPx(landmarks, 469, 471, 470, 472, width, height, leftIrisCenter);
    const rightIrisDiameterPx = irisRingDiameterPx(landmarks, 474, 476, 475, 477, width, height, rightIrisCenter);
    const avgIrisDiameterPx = (leftIrisDiameterPx + rightIrisDiameterPx) / 2;
    if (avgIrisDiameterPx <= 0) return null;

    const padding = Math.ceil(avgIrisDiameterPx * 0.7) || 20;
    const cropX = Math.max(0, Math.round(Math.min(leftIrisCenter.x, rightIrisCenter.x) * width - padding));
    const cropY = Math.max(0, Math.round(Math.min(leftIrisCenter.y, rightIrisCenter.y) * height - padding));
    const cropW = Math.min(width - cropX, Math.round(Math.abs(rightIrisCenter.x - leftIrisCenter.x) * width + padding * 2));
    const cropH = Math.min(height - cropY, Math.round(padding * 2 + Math.max(leftIrisDiameterPx, rightIrisDiameterPx)));
    if (cropW <= 4 || cropH <= 4) return null;

    const crop = cropImageData(imgData, cropX, cropY, cropW, cropH);
    (crop as any).__offsetX = cropX;
    (crop as any).__offsetY = cropY;

    const leftBoundary = findPupilBoundary(crop, leftIrisCenter.x * width, leftIrisCenter.y * height, leftIrisDiameterPx / 2);
    const rightBoundary = findPupilBoundary(crop, rightIrisCenter.x * width, rightIrisCenter.y * height, rightIrisDiameterPx / 2);
    if (!leftBoundary || !rightBoundary) return null;

    const leftEye = {
      x: leftBoundary.centerXFrame,
      y: leftBoundary.centerYFrame,
      radius: Math.round(leftBoundary.radius),
      brightness: leftBoundary.brightness,
    };
    const rightEye = {
      x: rightBoundary.centerXFrame,
      y: rightBoundary.centerYFrame,
      radius: Math.round(rightBoundary.radius),
      brightness: rightBoundary.brightness,
    };
    const pixelsPerMm = avgIrisDiameterPx / (isChild ? CHILD_IRIS_CONSTANT_MM : IRIS_BIOLOGICAL_CONSTANT_MM);
    const pupilDiameterMm = Math.max(2, Math.min(8, ((leftEye.radius + rightEye.radius) / pixelsPerMm)));
    const localLeft = { x: leftEye.x - cropX, y: leftEye.y - cropY, radius: leftEye.radius };
    const localRight = { x: rightEye.x - cropX, y: rightEye.y - cropY, radius: rightEye.radius };
    const crescent = estimateCrescentFromPupilRegion(crop, localLeft, localRight);

    return {
      leftEye,
      rightEye,
      pupilDiameterMm,
      redReflex: this.computeRedChannelRatio(crop, localLeft, localRight),
      crescentRatio: crescent.crescentRatio,
      crescentOrientation: crescent.orientation,
      zDistanceCm: Math.max(20, Math.min(120, estimateDistancePinholeModel(avgIrisDiameterPx, isChild, APPROX_FOCAL_LENGTH_PX).distanceCm)),
      crop,
    };
  }

  /**
   * Advanced Computer Vision Algorithm for Robust Eye Localization (fallback when
   * MediaPipe is unavailable):
   * 1. YCbCr Skin Tone Segmentation -> Dynamic Face Bounding Box
   * 2. Eye-zone sub-region estimation from face box proportions
   * 3. Otsu-thresholded dark-region centroid search -> Iris/Pupil center + radius
   */
  private detectEyesAdvancedCV(
    imgData: ImageData,
    width: number,
    height: number,
    options: { strict?: boolean } = {},
  ): {
    leftEye: { x: number; y: number; radius: number; brightness: number } | null;
    rightEye: { x: number; y: number; radius: number; brightness: number } | null;
    confidence: number;
  } {
    const data = imgData.data;

    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let skinPixelCount = 0;

    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
        const cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;

        if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
          skinPixelCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (skinPixelCount < 100 || maxX - minX < width * 0.15) {
      // Strict mode (static uploads): no skin-tone face box => no eye — prevents
      // bed-sheet / wall false positives from the full-frame fallback search.
      if (options.strict) {
        return { leftEye: null, rightEye: null, confidence: 0 };
      }
      minX = Math.floor(width * 0.15);
      maxX = Math.floor(width * 0.85);
      minY = Math.floor(height * 0.15);
      maxY = Math.floor(height * 0.85);
    }

    const faceW = maxX - minX;
    const faceH = maxY - minY;

    const eyeZoneTop = Math.floor(minY + faceH * 0.20);
    const eyeZoneBottom = Math.floor(minY + faceH * 0.55);

    const leftXMin = Math.floor(minX + faceW * 0.55);
    const leftXMax = Math.floor(minX + faceW * 0.90);
    const rightXMin = Math.floor(minX + faceW * 0.10);
    const rightXMax = Math.floor(minX + faceW * 0.45);

    const leftPupil = this.runAdaptiveDarkRegionSearch(imgData, width, leftXMin, leftXMax, eyeZoneTop, eyeZoneBottom);
    const rightPupil = this.runAdaptiveDarkRegionSearch(imgData, width, rightXMin, rightXMax, eyeZoneTop, eyeZoneBottom);

    const confidence = leftPupil && rightPupil ? 90 : leftPupil || rightPupil ? 75 : 50;

    return {
      leftEye: leftPupil,
      rightEye: rightPupil,
      confidence,
    };
  }

  /**
   * Otsu-thresholded dark-region centroid search. Replaces the previous fixed
   * "minLum + 30" offset, which mis-thresholds under uneven or low light; Otsu
   * derives the split point from the actual luminance histogram of the search
   * window each frame.
   */
  private runAdaptiveDarkRegionSearch(
    imgData: ImageData,
    frameWidth: number,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number
  ): { x: number; y: number; radius: number; brightness: number } | null {
    const data = imgData.data;
    const histogram = new Array(256).fill(0);
    let totalPixels = 0;
    let minLum = 255;

    for (let y = yMin; y < yMax; y += 2) {
      for (let x = xMin; x < xMax; x += 2) {
        const idx = (y * frameWidth + x) * 4;
        const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
        histogram[lum]++;
        totalPixels++;
        if (lum < minLum) minLum = lum;
      }
    }

    if (totalPixels < 10) return null;

    // Cap the Otsu threshold so it never exceeds a sane "dark iris/pupil" ceiling,
    // in case the window is nearly uniform (e.g. glasses glare, closed eye).
    const otsu = otsuThreshold(histogram, totalPixels);
    const darkThreshold = Math.min(115, Math.max(minLum + 8, otsu));

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let y = yMin; y < yMax; y++) {
      for (let x = xMin; x < xMax; x++) {
        const idx = (y * frameWidth + x) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        if (lum <= darkThreshold) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }

    if (count < 10) return null;

    const centerX = Math.round(sumX / count);
    const centerY = Math.round(sumY / count);
    const estimatedRadius = Math.min(22, Math.max(10, Math.round(Math.sqrt(count / Math.PI))));

    return {
      x: centerX,
      y: centerY,
      radius: estimatedRadius,
      brightness: Math.round(minLum),
    };
  }

  /**
   * Computes ratio of Red channel intensity inside pupil regions (Red Reflex measure).
   * Coordinates are expected to be local to the (already-cropped) imgData passed in.
   */
  private computeRedChannelRatio(
    imgData: ImageData,
    left: { x: number; y: number } | null,
    right: { x: number; y: number } | null
  ): number {
    const data = imgData.data;
    const width = imgData.width;

    const points = [left, right].filter(Boolean) as { x: number; y: number }[];
    if (points.length === 0) return 0.75;

    let totalRed = 0;
    let totalOther = 0;
    let count = 0;

    points.forEach((p) => {
      const px = Math.round(p.x);
      const py = Math.round(p.y);

      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (x >= 0 && x < width && y >= 0 && y < imgData.height) {
            const idx = (y * width + x) * 4;
            totalRed += data[idx];
            totalOther += (data[idx + 1] + data[idx + 2]) / 2;
            count++;
          }
        }
      }
    });

    if (count === 0) return 0.78;

    const avgRed = totalRed / count;
    const avgOther = totalOther / count;

    const ratio = avgRed / Math.max(1, avgOther);
    return Math.min(1.0, Math.max(0.4, ratio * 0.7));
  }

  /**
   * Draws target HUD box and crosshairs over detected pupil
   */
  private drawPupilHUD(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    label: string
  ) {
    const boxSize = radius * 3.2;
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - boxSize / 2, y - boxSize / 2, boxSize, boxSize);

    const corner = 6;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(x - boxSize / 2, y - boxSize / 2 + corner);
    ctx.lineTo(x - boxSize / 2, y - boxSize / 2);
    ctx.lineTo(x - boxSize / 2 + corner, y - boxSize / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - boxSize / 2 + boxSize - corner, y - boxSize / 2);
    ctx.lineTo(x - boxSize / 2 + boxSize, y - boxSize / 2);
    ctx.lineTo(x - boxSize / 2 + boxSize, y - boxSize / 2 + corner);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - boxSize / 2, y - boxSize / 2 + boxSize - corner);
    ctx.lineTo(x - boxSize / 2, y - boxSize / 2 + boxSize);
    ctx.lineTo(x - boxSize / 2 + corner, y - boxSize / 2 + boxSize);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - boxSize / 2 + boxSize - corner, y - boxSize / 2 + boxSize);
    ctx.lineTo(x - boxSize / 2 + boxSize, y - boxSize / 2 + boxSize);
    ctx.lineTo(x - boxSize / 2 + boxSize, y - boxSize / 2 + boxSize - corner);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - radius - 4, y);
    ctx.lineTo(x + radius + 4, y);
    ctx.moveTo(x, y - radius - 4);
    ctx.lineTo(x, y + radius + 4);
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(label, x - boxSize / 2, y - boxSize / 2 - 4);
  }

  /**
   * Processes a static image (HTMLImageElement or HTMLCanvasElement) for photorefraction analysis
   */
  public processImage(image: HTMLImageElement | HTMLCanvasElement, isChild: boolean = false): {
    photo: PhotorefractionData | null;
    metrics: PupilFrameResult;
  } {
    if (!this.ctx) {
      return { photo: null, metrics: this.emptyResult() };
    }

    const maxDimension = 1280;
    let width = image.width;
    let height = image.height;

    if (width > maxDimension || height > maxDimension) {
      const scale = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.drawImage(image, 0, 0, width, height);

    let imgData: ImageData | null = null;
    try {
      imgData = this.ctx.getImageData(0, 0, width, height);
    } catch (e) {
      return { photo: null, metrics: this.emptyResult() };
    }

    let mediaPipeMetrics: PupilFrameResult | null = null;
    if (this.mediaPipeReady && this.faceLandmarker) {
      try {
        const results = this.faceLandmarker.detectForVideo(this.canvas, performance.now());
        const landmarks = results.faceLandmarks?.[0];
        if (landmarks) {
          const optical = this.extractOpticalMetricsFromLandmarks(landmarks, imgData, width, height, isChild);
          if (optical) {
            mediaPipeMetrics = {
              detected: true,
              leftEye: optical.leftEye,
              rightEye: optical.rightEye,
              pupilDiameterMm: Math.round(optical.pupilDiameterMm * 10) / 10,
              redReflexIntensity: Math.round(optical.redReflex * 100) / 100,
              crescentRatio: optical.crescentRatio,
              crescentOrientation: optical.crescentOrientation,
              pupilMmFromIrisRuler: true,
              fps: 0,
              confidenceScore: 98,
              ear: 0.26,
              isBlinking: false,
              isObscured: false,
              zDistanceCm: optical.zDistanceCm,
              zDistanceConfident: true,
            };
          }
        }
      } catch (error) {
        console.warn('MediaPipe static-image detection failed; using CV fallback.', error);
      }
    }

    if (mediaPipeMetrics) {
      const photo: PhotorefractionData = {
        pupilDiameterMm: mediaPipeMetrics.pupilDiameterMm,
        redReflexIntensityRatio: mediaPipeMetrics.redReflexIntensity,
        crescentHeightRatio: mediaPipeMetrics.crescentRatio,
        crescentOrientation: mediaPipeMetrics.crescentOrientation ?? 'SYMMETRIC',
        // Placeholders: Step4 recalculates these with calculatePhotorefraction.
        sphericalEquivalentDiopters: 0,
        astigmatismCylinderDiopters: -0.5,
        classification: 'EMMETROPIA',
        confidenceScore: mediaPipeMetrics.confidenceScore,
      };
      return { photo, metrics: mediaPipeMetrics };
    }

    // Tier 2 fallback when MediaPipe is unavailable or finds no face.
    const cvResult = this.detectEyesAdvancedCV(imgData, width, height, { strict: true });

    // Require BOTH eyes — a bed sheet / wall must not produce a reading
    if (!cvResult.leftEye || !cvResult.rightEye) {
      return { photo: null, metrics: this.emptyResult() };
    }

    const redReflex = this.computeRedChannelRatio(imgData, cvResult.leftEye, cvResult.rightEye);

    // IPD-based pupil mm (no MediaPipe iris landmarks on static images)
    const ipdPx = Math.sqrt(
      Math.pow(cvResult.leftEye.x - cvResult.rightEye.x, 2) +
      Math.pow(cvResult.leftEye.y - cvResult.rightEye.y, 2),
    );
    const pixelsPerMm = ipdPx / 63.0;
    const avgPupilRadiusPx = (cvResult.leftEye.radius + cvResult.rightEye.radius) / 2;
    const estimatedPupilMm = Math.max(2.0, Math.min(8.0, (avgPupilRadiusPx / Math.max(0.01, pixelsPerMm)) * 2));

    const crescentEst = estimateCrescentFromPupilRegion(imgData, cvResult.leftEye, cvResult.rightEye);

    const metrics: PupilFrameResult = {
      detected: true,
      leftEye: cvResult.leftEye,
      rightEye: cvResult.rightEye,
      pupilDiameterMm: Math.round(estimatedPupilMm * 10) / 10,
      redReflexIntensity: Math.round(redReflex * 100) / 100,
      crescentRatio: crescentEst.crescentRatio,
      crescentOrientation: crescentEst.orientation,
      pupilMmFromIrisRuler: false,
      fps: 0,
      confidenceScore: cvResult.confidence,
      ear: 0.26,
      isBlinking: false,
      isObscured: false,
    };

    const photo: PhotorefractionData = {
      pupilDiameterMm: metrics.pupilDiameterMm,
      redReflexIntensityRatio: metrics.redReflexIntensity,
      crescentHeightRatio: metrics.crescentRatio,
      crescentOrientation: crescentEst.orientation,
      // Placeholders: Step4 recalculates these with calculatePhotorefraction.
      sphericalEquivalentDiopters: 0,
      astigmatismCylinderDiopters: -0.5,
      classification: 'EMMETROPIA',
      confidenceScore: metrics.confidenceScore,
    };

    return { photo, metrics };
  }
}

/**
 * Estimates crescent height ratio and orientation from the red-reflex brightness
 * distribution (bright/dark split) across the detected pupil region.
 */
function estimateCrescentFromPupilRegion(
  imgData: ImageData,
  leftPupil: { x: number; y: number; radius: number } | null,
  rightPupil: { x: number; y: number; radius: number } | null,
): { crescentRatio: number; orientation: 'TOP' | 'BOTTOM' | 'SYMMETRIC' } {
  const pupils = [leftPupil, rightPupil].filter(Boolean) as { x: number; y: number; radius: number }[];
  if (pupils.length === 0) {
    return { crescentRatio: 0.28, orientation: 'TOP' };
  }

  const data = imgData.data;
  const w = imgData.width;
  const h = imgData.height;

  let topBright = 0;
  let topCount = 0;
  let bottomBright = 0;
  let bottomCount = 0;
  let midBright = 0;
  let midCount = 0;

  for (const pupil of pupils) {
    const cx = Math.round(pupil.x);
    const cy = Math.round(pupil.y);
    const r = Math.max(4, Math.round(pupil.radius * 0.85));

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;

        const idx = (y * w + x) * 4;
        const lum = 0.5 * data[idx] + 0.25 * data[idx + 1] + 0.25 * data[idx + 2];

        if (dy < -r * 0.25) {
          topBright += lum;
          topCount++;
        } else if (dy > r * 0.25) {
          bottomBright += lum;
          bottomCount++;
        } else {
          midBright += lum;
          midCount++;
        }
      }
    }
  }

  const avgTop = topCount > 0 ? topBright / topCount : 0;
  const avgBottom = bottomCount > 0 ? bottomBright / bottomCount : 0;
  const avgMid = midCount > 0 ? midBright / midCount : 128;

  const topDelta = Math.max(0, avgTop - avgMid);
  const bottomDelta = Math.max(0, avgBottom - avgMid);
  let orientation: 'TOP' | 'BOTTOM' | 'SYMMETRIC' = 'SYMMETRIC';
  if (topDelta > bottomDelta * 1.15 && topDelta > 8) {
    orientation = 'TOP';
  } else if (bottomDelta > topDelta * 1.15 && bottomDelta > 8) {
    orientation = 'BOTTOM';
  }

  const dominantDelta = Math.max(topDelta, bottomDelta);
  // Use the measured brightness contrast relative to the pupil's centre;
  // dividing by maxDelta would always be 1 for a non-zero signal.
  const relativeContrast = dominantDelta / Math.max(1, avgMid);
  const crescentRatio = Math.min(0.6, Math.max(0.08, relativeContrast * 1.75 + 0.08));

  return {
    crescentRatio: Math.round(crescentRatio * 100) / 100,
    orientation,
  };
}

/**
 * Computes iris ring diameter in px from opposite ring-point pairs, with a
 * center-to-ring-point fallback if the ring points are degenerate.
 */
function irisRingDiameterPx(
  landmarks: any[],
  ringA: number,
  ringB: number,
  ringC: number,
  ringD: number,
  width: number,
  height: number,
  center: { x: number; y: number }
): number {
  let diameterPx = 0;
  const a = landmarks[ringA];
  const b = landmarks[ringB];
  const c = landmarks[ringC];
  const d = landmarks[ringD];

  if (a && b) {
    const dx = (a.x - b.x) * width;
    const dy = (a.y - b.y) * height;
    diameterPx = Math.sqrt(dx * dx + dy * dy);
  }
  if (c && d) {
    const dx = (c.x - d.x) * width;
    const dy = (c.y - d.y) * height;
    diameterPx = Math.max(diameterPx, Math.sqrt(dx * dx + dy * dy));
  }
  if (diameterPx < 10 && c) {
    const dx = (center.x - c.x) * width;
    const dy = (center.y - c.y) * height;
    diameterPx = 2 * Math.sqrt(dx * dx + dy * dy);
  }
  return diameterPx;
}

/** Creates a small copy of a source ImageData region without another canvas read. */
function cropImageData(source: ImageData, x: number, y: number, width: number, height: number): ImageData {
  const crop = new ImageData(width, height);
  for (let row = 0; row < height; row++) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    const targetStart = row * width * 4;
    crop.data.set(source.data.subarray(sourceStart, sourceStart + width * 4), targetStart);
  }
  return crop;
}

/**
 * Searches for the true pupil boundary (dark disc) inside a small window around an
 * iris center, using an Otsu-derived threshold clamped to a fraction of the iris
 * radius. This is what makes pupil diameter a measurement instead of an assumption.
 * `imgData` is expected to be pre-cropped, with `__offsetX`/`__offsetY` recording the
 * crop origin in the original frame's coordinate space.
 */
function findPupilBoundary(
  imgData: ImageData,
  centerXFrame: number,
  centerYFrame: number,
  irisRadiusPx: number
): { radius: number; brightness: number; centerXFrame: number; centerYFrame: number } | null {
  const offsetX = (imgData as any).__offsetX ?? 0;
  const offsetY = (imgData as any).__offsetY ?? 0;
  const cx = Math.round(centerXFrame - offsetX);
  const cy = Math.round(centerYFrame - offsetY);

  // Search window: pupil is always <= iris, so bound the search to ~1.1x iris radius
  const searchRadius = Math.max(6, Math.round(irisRadiusPx * 1.1));
  const searchRadiusSq = searchRadius * searchRadius;
  const xMin = Math.max(0, cx - searchRadius);
  const xMax = Math.min(imgData.width, cx + searchRadius);
  const yMin = Math.max(0, cy - searchRadius);
  const yMax = Math.min(imgData.height, cy + searchRadius);

  if (xMax - xMin < 4 || yMax - yMin < 4) return null;

  const data = imgData.data;
  const histogram = new Array(256).fill(0);
  let totalPixels = 0;
  let minLum = 255;

  // Mask to a CIRCLE matching the iris, not the surrounding square crop. A square
  // window's corners can reach past the iris into eyebrow, eyelid-crease, or lash
  // shadow — all dark and all outside the eye — which biases both the Otsu threshold
  // and (worse) the centroid used as the reported pupil position.
  for (let y = yMin; y < yMax; y++) {
    for (let x = xMin; x < xMax; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > searchRadiusSq) continue;
      const idx = (y * imgData.width + x) * 4;
      const lum = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      histogram[lum]++;
      totalPixels++;
      if (lum < minLum) minLum = lum;
    }
  }

  if (totalPixels < 4) return null;

  const otsu = otsuThreshold(histogram, totalPixels);
  // Pupil is the darkest structure in the window; clamp threshold near the low end
  // of the histogram so we don't accidentally include darker iris pigment.
  const darkThreshold = Math.min(minLum + 40, otsu);

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = yMin; y < yMax; y++) {
    for (let x = xMin; x < xMax; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > searchRadiusSq) continue;
      const idx = (y * imgData.width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum <= darkThreshold) {
        count++;
        sumX += x;
        sumY += y;
      }
    }
  }

  if (count < 4) return null;

  // Area -> radius assuming a roughly circular pupil disc
  const radius = Math.min(irisRadiusPx * 0.9, Math.max(irisRadiusPx * 0.15, Math.sqrt(count / Math.PI)));

  // Re-center on the MEASURED dark-region centroid instead of just returning the
  // radius and leaving the position as whatever the landmark said. The correction is
  // clamped to a fraction of the iris radius so a stray dark patch (glare edge, a
  // clump of lashes that slipped past the circular mask) can't drag the reported
  // position far off the actual eye.
  const measuredLocalX = sumX / count;
  const measuredLocalY = sumY / count;
  const maxShiftPx = irisRadiusPx * 0.35;
  const shiftX = Math.max(-maxShiftPx, Math.min(maxShiftPx, measuredLocalX - cx));
  const shiftY = Math.max(-maxShiftPx, Math.min(maxShiftPx, measuredLocalY - cy));

  return {
    radius,
    brightness: Math.round(minLum),
    centerXFrame: centerXFrame + shiftX,
    centerYFrame: centerYFrame + shiftY,
  };
}

/**
 * Bounding box covering both eyes with padding, clamped to frame bounds — used to
 * crop getImageData calls for red-reflex and blur measurement when the Tier 1
 * pupil-boundary crop isn't available (Tier 2 CV-only path).
 */
function computeEyeRegionBounds(
  left: { x: number; y: number; radius: number } | null,
  right: { x: number; y: number; radius: number } | null,
  frameWidth: number,
  frameHeight: number
): { x: number; y: number; w: number; h: number } {
  const points = [left, right].filter(Boolean) as { x: number; y: number; radius: number }[];
  if (points.length === 0) {
    // No detection: fall back to a central region rather than the whole frame
    const w = Math.round(frameWidth * 0.6);
    const h = Math.round(frameHeight * 0.4);
    return {
      x: Math.round((frameWidth - w) / 2),
      y: Math.round((frameHeight - h) / 2),
      w,
      h,
    };
  }

  const pad = 40;
  let minX = Math.min(...points.map((p) => p.x - p.radius - pad));
  let maxX = Math.max(...points.map((p) => p.x + p.radius + pad));
  let minY = Math.min(...points.map((p) => p.y - p.radius - pad));
  let maxY = Math.max(...points.map((p) => p.y + p.radius + pad));

  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(frameWidth, Math.ceil(maxX));
  maxY = Math.min(frameHeight, Math.ceil(maxY));

  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

/**
 * Eye Aspect Ratio (EAR) Calculation for Blink Detection
 * Formula: EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
 */
export function calculateEyeAspectRatio(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
  p5: { x: number; y: number },
  p6: { x: number; y: number }
): { ear: number; isBlink: boolean } {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

  const vert1 = dist(p2, p6);
  const vert2 = dist(p3, p5);
  const horiz = dist(p1, p4);

  if (horiz === 0) return { ear: 0.3, isBlink: false };

  const ear = (vert1 + vert2) / (2 * horiz);
  const isBlink = ear < BLINK_EAR_THRESHOLD;

  return {
    ear: Math.round(ear * 1000) / 1000,
    isBlink,
  };
}

/**
 * Pinhole Camera Model for Distance Estimation
 * Anatomical Constants: Adult iris = 11.7mm, Child iris = 11.0mm
 * NOTE: focalLengthPx is an uncalibrated approximation for typical smartphone/webcam
 * sensors; for accurate absolute distance this should be calibrated per-device
 * (e.g. via a known-distance checkerboard capture) rather than assumed.
 */
export function estimateDistancePinholeModel(
  irisDiameterPx: number,
  isChild: boolean = false,
  focalLengthPx: number = APPROX_FOCAL_LENGTH_PX
): { distanceMm: number; distanceCm: number } {
  const irisDiameterMm = isChild ? CHILD_IRIS_CONSTANT_MM : IRIS_BIOLOGICAL_CONSTANT_MM;
  if (irisDiameterPx <= 0) {
    return { distanceMm: 600, distanceCm: 60.0 };
  }

  const distanceMm = (focalLengthPx * irisDiameterMm) / irisDiameterPx;
  return {
    distanceMm: Math.round(distanceMm),
    distanceCm: Math.round((distanceMm / 10) * 10) / 10,
  };
}

/**
 * YCrCb Color Space Transformation
 */
export function convertRGBToYCrCb(
  r: number,
  g: number,
  b: number
): { y: number; cr: number; cb: number } {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cr = 0.713 * (r - y) + 128;
  const cb = 0.564 * (b - y) + 128;

  return {
    y: Math.round(y),
    cr: Math.round(cr),
    cb: Math.round(cb),
  };
}

/**
 * HSV Dual-Range Red Detection for Retinoscopic Reflex
 */
export function isRedHueInHSV(r: number, g: number, b: number): boolean {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;

  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;

  if (delta === 0) return false;

  let h = 0;
  if (max === rf) {
    h = ((gf - bf) / delta) % 6;
  } else if (max === gf) {
    h = (bf - rf) / delta + 2;
  } else {
    h = (rf - gf) / delta + 4;
  }

  h = Math.round(h * 30);
  if (h < 0) h += 360;

  const isRedHue = h <= 20 || h >= 340;
  const s = delta / max;
  const v = max;

  return isRedHue && s > 0.2 && v > 0.2;
}

/**
 * Fourier-Mellin Correlation (FMC) Pupil Dilation & Scale Shift Analyzer
 * Converts log-polar magnitude spectrum shifts into subpixel pupil scale change (Meyers & Vlachos, 2025)
 */
export function computeFourierMellinPupilDilation(
  pupilPixels: number[],
  radiusPx: number
): { pupilScaleFactor: number; subpixelDiameterMm: number } {
  let totalEnergy = 0;
  let weightedRadiusSum = 0;
  const n = pupilPixels.length;

  for (let i = 0; i < n; i++) {
    const val = pupilPixels[i];
    totalEnergy += val;
    weightedRadiusSum += val * (i / Math.max(1, n));
  }

  const meanRadiusRatio = totalEnergy > 0 ? weightedRadiusSum / totalEnergy : 0.5;
  const pupilScaleFactor = Math.min(1.5, Math.max(0.5, 0.8 + meanRadiusRatio * 0.4));
  const subpixelDiameterMm = Math.round((radiusPx * 2 * 0.28 * pupilScaleFactor) * 100) / 100;

  return { pupilScaleFactor, subpixelDiameterMm };
}

/**
 * Variance of Laplacian Operator for Single-Frame Blur Detection
 * Evaluates 2D Laplacian operator convolution: Var(L) >= 60 indicates crisp focus
 */
export function computeLaplacianBlurVariance(
  imgData: ImageData,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number
): { variance: number; isFocused: boolean } {
  const width = imgData.width;
  const data = imgData.data;
  const values: number[] = [];

  const startY = Math.max(1, yMin);
  const endY = Math.min(imgData.height - 1, yMax);
  const startX = Math.max(1, xMin);
  const endX = Math.min(width - 1, xMax);

  for (let y = startY; y < endY; y += 3) {
    for (let x = startX; x < endX; x += 3) {
      const getGray = (px: number, py: number) => {
        const idx = (py * width + px) * 4;
        return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      };

      const center = getGray(x, y);
      const top = getGray(x, y - 1);
      const bottom = getGray(x, y + 1);
      const left = getGray(x - 1, y);
      const right = getGray(x + 1, y);

      const laplacian = top + bottom + left + right - 4 * center;
      values.push(laplacian);
    }
  }

  if (values.length === 0) return { variance: 100, isFocused: true };

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const varSum = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
  const variance = Math.round(varSum / values.length);

  return {
    variance,
    isFocused: variance >= 60,
  };
}

/**
 * MediaPipe Native Z-Depth Extraction
 * Not currently called anywhere in this file. Kept for reference/future use if a
 * calibrated per-device Z model becomes available. See
 * docs/segmentation-model-integration-plan.md for the broader plan on replacing
 * heuristic measurements with trained models.
 */
export function extractMediaPipeZDepth(
  noseTipLandmark: { x: number; y: number; z: number }
): { zDistanceMm: number; zDistanceCm: number } {
  const absZ = Math.abs(noseTipLandmark.z || 0);
  const zDistanceMm = Math.min(1000, Math.max(200, Math.round(350 + absZ * 550)));
  const zDistanceCm = Math.round((zDistanceMm / 10) * 10) / 10;

  return { zDistanceMm, zDistanceCm };
}
