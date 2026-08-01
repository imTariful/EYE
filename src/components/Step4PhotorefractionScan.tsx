import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Camera,
  Zap,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Eye,
  Sliders,
  Info,
  Video,
  VideoOff,
  AlertCircle,
  Upload,
} from 'lucide-react';
import { calculatePhotorefraction, calculateEyePhotorefraction, calculateAnisometropia } from '../utils/opticsEngine';
import { BLINK_EAR_THRESHOLD } from '../utils/eyeTracker';
import type { PhotorefractionData } from '../types';
import { EyeTrackerEngine, PupilFrameResult } from '../utils/eyeTracker';
import { QualityPanel } from './QualityIndicator';

interface Step4PhotorefractionScanProps {
  photorefraction: PhotorefractionData;
  onSave: (data: PhotorefractionData) => void;
  onNext: () => void;
  onBack: () => void;
}

type CrescentOrientation = 'TOP' | 'BOTTOM' | 'SYMMETRIC';

// ---------------------------------------------------------------------------
// Calibration / tuning constants
// Same naming convention as Step3AccommodativeScan so the two steps stay
// consistent if someone tunes the stability gate later.
// ---------------------------------------------------------------------------
const MIN_STABLE_FRAMES_REQUIRED = 30;
const MIN_CONFIDENCE_TO_PROCEED = 70;
const MIN_BLUR_VARIANCE_TO_PROCEED = 50;
const MIN_DETECTION_CONFIDENCE_TO_TRUST_EYE = 50;
const MIN_TRUSTED_WORKING_DISTANCE_CM = 20;

const OPTICAL_CONSTANT_K = 6.0; // published coaxial-flash Howland constant
const DEFAULT_REFLEX_RATIO = 0.88;

const PUPIL_RENDER_PX_PER_MM = 22; // simulated pupil circle sizing

const BLUR_VARIANCE_EXCELLENT = 100;
const BLUR_VARIANCE_GOOD = 60;
const BLUR_VARIANCE_ACCEPTABLE = 30;

const VIDEO_SAMPLE_FPS = 5;
const VIDEO_SAMPLE_MAX_FRAMES = 30;

// ---------------------------------------------------------------------------
// Pure helpers -- identical contract to Step3AccommodativeScan's local copy.
// If a third step ends up needing the same stability gate, this is the
// signal to promote it into eyeTracker.ts so every step shares one
// definition instead of three copies quietly drifting apart.
// ---------------------------------------------------------------------------
function isFrameStable(result: PupilFrameResult): boolean {
  return (
    result.detected &&
    !result.isBlinking &&
    !result.isObscured &&
    result.confidenceScore >= MIN_CONFIDENCE_TO_PROCEED &&
    (result.blurVariance || 0) >= MIN_BLUR_VARIANCE_TO_PROCEED
  );
}

function grayscaleAt(data: Uint8ClampedArray, width: number, px: number, py: number): number {
  const idx = (py * width + px) * 4;
  return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
}

export const Step4PhotorefractionScan: React.FC<Step4PhotorefractionScanProps> = ({
  photorefraction,
  onSave,
  onNext,
  onBack,
}) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const [flashEffect, setFlashEffect] = useState(false);
  const [crescentRatio, setCrescentRatio] = useState(photorefraction.crescentHeightRatio || 0.28);
  const [orientation, setOrientation] = useState<CrescentOrientation>(
    photorefraction.crescentOrientation || 'TOP'
  );
  const [pupilDiameter, setPupilDiameter] = useState(photorefraction.pupilDiameterMm || 5.8);

  // Calibration parameters (Advanced panel)
  const [workingDistanceCm, setWorkingDistanceCm] = useState(100);
  const [flashEccentricityMm, setFlashEccentricityMm] = useState(12);
  const [advancedCalibrationOpen, setAdvancedCalibrationOpen] = useState(false);

  // Camera State
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [uploadQualityScore, setUploadQualityScore] = useState<number | null>(null);
  const [uploadQualityMessage, setUploadQualityMessage] = useState<string>('');

  // Navigation Guard State
  const [stableFrameCount, setStableFrameCount] = useState(0);
  const [canProceed, setCanProceed] = useState(false);

  // Live Pupil Tracker Metrics
  const [liveMetrics, setLiveMetrics] = useState<PupilFrameResult>({
    detected: false,
    leftEye: null,
    rightEye: null,
    pupilDiameterMm: pupilDiameter,
    redReflexIntensity: DEFAULT_REFLEX_RATIO,
    crescentRatio: crescentRatio,
    fps: 0,
    confidenceScore: 0,
  });

  // ---------------------------------------------------------------------
  // Refs mirroring the values handleFlashCapture reads at the moment of
  // capture.
  //
  // WHY: handleFlashCapture is called in two places -- (1) synchronously
  // from a button click, where React state is reasonably fresh, and (2)
  // programmatically at the end of the uploaded-video frame-sampling loop,
  // fired from inside a setTimeout chain rather than a React event. In
  // that second case, the setLiveMetrics()/setPupilDiameter()/
  // setCrescentRatio() calls from the *final* processed frame have not
  // necessarily committed yet when handleFlashCapture reads `liveMetrics`,
  // `crescentRatio`, etc. from their closures -- the same stale-closure
  // class of bug fixed in Step3AccommodativeScan's scan loop. Refs are
  // updated synchronously alongside the state setters, so
  // handleFlashCapture can read the ref value and be guaranteed it reflects
  // the very last processed frame.
  // ---------------------------------------------------------------------
  const latestMetricsRef = useRef<PupilFrameResult>(liveMetrics);
  const latestPupilDiameterRef = useRef(pupilDiameter);
  const latestCrescentRatioRef = useRef(crescentRatio);

  const updateLiveMetrics = (result: PupilFrameResult) => {
    latestMetricsRef.current = result;
    setLiveMetrics(result);
    if (result.pupilDiameterMm) {
      latestPupilDiameterRef.current = result.pupilDiameterMm;
      setPupilDiameter(result.pupilDiameterMm);
    }
    if (result.crescentRatio) {
      latestCrescentRatioRef.current = result.crescentRatio;
      setCrescentRatio(result.crescentRatio);
    }
  };

  const eyeTrackerRef = useRef<EyeTrackerEngine>(new EyeTrackerEngine());
  const animFrameRef = useRef<number | null>(null);

  // Cancellation flag for the uploaded-video frame-sampling loop. It's a
  // recursive setTimeout chain, not a React effect, so nothing stops it
  // automatically on unmount or if the user starts a new upload mid-way.
  // Every recursive call checks this ref before continuing/touching state.
  const videoProcessingCancelledRef = useRef(false);

  // Eye detection guard - prevents diopter calculation when no eye is present
  const eyeDetected = isCameraActive && liveMetrics.detected && (liveMetrics.confidenceScore >= MIN_DETECTION_CONFIDENCE_TO_TRUST_EYE);

  // Determine which values to use: measured (camera on) or manual (camera off)
  const useMeasuredPupil = isCameraActive && liveMetrics.detected;
  const useMeasuredDistance = isCameraActive && !!liveMetrics.zDistanceCm && liveMetrics.zDistanceCm > MIN_TRUSTED_WORKING_DISTANCE_CM;

  const effectivePupilDiameter = useMeasuredPupil ? liveMetrics.pupilDiameterMm : pupilDiameter;
  const effectiveWorkingDistance = useMeasuredDistance ? (liveMetrics.zDistanceCm as number) : workingDistanceCm;
  const effectiveCrescentRatio = useMeasuredPupil && liveMetrics.crescentRatio > 0 ? liveMetrics.crescentRatio : crescentRatio;
  const effectiveReflexRatio = useMeasuredPupil ? liveMetrics.redReflexIntensity : DEFAULT_REFLEX_RATIO;

  // Calculate optical parameters (memoized to prevent recalculation every frame)
  const currentPhotoData = useMemo(() => {
    if (!eyeDetected && isCameraActive) {
      // Return default/empty data when camera on but no eye detected
      return calculatePhotorefraction(crescentRatio, orientation, pupilDiameter, 0);
    }
    return calculatePhotorefraction(
      effectiveCrescentRatio,
      orientation,
      effectivePupilDiameter,
      effectiveReflexRatio,
      effectiveWorkingDistance,
      flashEccentricityMm,
      OPTICAL_CONSTANT_K
    );
  }, [effectiveCrescentRatio, orientation, effectivePupilDiameter, effectiveReflexRatio, effectiveWorkingDistance, flashEccentricityMm, eyeDetected, isCameraActive, crescentRatio, pupilDiameter]);

  // Load available camera devices
  useEffect(() => {
    async function getDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setCameraDevices(videoInputs);
        if (videoInputs.length > 0) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (err) {
        console.warn('Could not enumerate media devices:', err);
      }
    }
    getDevices();
  }, []);

  // Start Camera
  const startCamera = async (deviceId?: string) => {
    setCameraError(null);
    // A fresh camera session supersedes any in-flight uploaded-video
    // analysis; stop that loop so it doesn't keep firing setState calls
    // and racing with the live feed for videoRef.
    videoProcessingCancelledRef.current = true;
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (videoRef.current) {
        // Clear any leftover `src` from a prior uploaded-video analysis
        // before switching the element back to a live MediaStream.
        videoRef.current.removeAttribute('src');
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
        setUploadedImage(null);
      }
    } catch (err: unknown) {
      console.error('Camera error:', err);
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Enable it in your browser settings, or upload a photo instead.'
          : 'Camera access unavailable. You can upload an eye photo or use the interactive calibrator.';
      setCameraError(message);
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  // Computer vision frame loop (live camera only)
  useEffect(() => {
    if (!isCameraActive || !videoRef.current || !overlayCanvasRef.current) return;

    const processLoop = () => {
      if (videoRef.current && overlayCanvasRef.current && isCameraActive) {
        const result = eyeTrackerRef.current.processFrame(
          videoRef.current,
          overlayCanvasRef.current,
          { drawMesh: true, flashActive: flashEffect }
        );
        updateLiveMetrics(result);

        const stable = isFrameStable(result);

        if (stable) {
          setStableFrameCount((prev) => {
            const newCount = prev + 1;
            if (newCount >= MIN_STABLE_FRAMES_REQUIRED && !canProceed) {
              setCanProceed(true);
            }
            return newCount;
          });
        } else {
          setStableFrameCount(0);
          setCanProceed(false);
        }
      }
      animFrameRef.current = requestAnimationFrame(processLoop);
    };

    animFrameRef.current = requestAnimationFrame(processLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraActive, flashEffect, canProceed]);

  // Unmount cleanup: stop camera and cancel any in-flight uploaded-video
  // frame-sampling loop, so its setTimeout chain can't call setState after
  // this component is gone.
  useEffect(() => {
    return () => {
      stopCamera();
      videoProcessingCancelledRef.current = true;
    };
  }, []);

  // Trigger Flash Capture Simulation
  const handleFlashCapture = () => {
    const metrics = latestMetricsRef.current;

    if (isCameraActive && (metrics.isBlinking || metrics.isObscured)) {
      setCameraError(`Scan paused: Eyes are closed or obscured (EAR < ${BLINK_EAR_THRESHOLD}). Please open your eyes wide toward the camera to execute the scan.`);
      return;
    }
    setCameraError(null);
    setIsCapturing(true);
    setFlashEffect(true);

    setTimeout(() => {
      setFlashEffect(false);
    }, 350);

    setTimeout(() => {
      setIsCapturing(false);

      const fallbackCrescentRatio = latestCrescentRatioRef.current;
      const fallbackPupilDiameter = latestPupilDiameterRef.current;

      // Calculate individual eye photorefraction. Reads from the ref
      // snapshot taken at capture time (see latestMetricsRef comment
      // above) rather than the possibly-stale `liveMetrics` state closure.
      const odData = calculateEyePhotorefraction({
        crescentRatio: metrics.rightEye?.crescentRatio || fallbackCrescentRatio,
        orientation: metrics.rightEye?.crescentOrientation || orientation,
        pupilDiameterMm: metrics.rightEye?.pupilDiameterMm || fallbackPupilDiameter,
        reflexRatio: metrics.rightEye?.redReflexIntensity || metrics.redReflexIntensity || DEFAULT_REFLEX_RATIO,
      });

      const osData = calculateEyePhotorefraction({
        crescentRatio: metrics.leftEye?.crescentRatio || fallbackCrescentRatio,
        orientation: metrics.leftEye?.crescentOrientation || orientation,
        pupilDiameterMm: metrics.leftEye?.pupilDiameterMm || fallbackPupilDiameter,
        reflexRatio: metrics.leftEye?.redReflexIntensity || metrics.redReflexIntensity || DEFAULT_REFLEX_RATIO,
      });

      const anisometropiaResult = calculateAnisometropia(
        odData.sphericalEquivalentDiopters,
        osData.sphericalEquivalentDiopters
      );

      const updatedPhotoData: PhotorefractionData = {
        ...currentPhotoData,
        od: odData,
        os: osData,
        anisometropiaDelta: anisometropiaResult.delta,
        anisometropiaRisk: anisometropiaResult.risk,
      };

      onSave(updatedPhotoData);
    }, 1200);
  };

  // Blur detection using Laplacian variance
  const checkImageQuality = (imgData: ImageData): { score: number; message: string; isAcceptable: boolean } => {
    const data = imgData.data;
    const width = imgData.width;
    const values: number[] = [];

    const endY = imgData.height - 1;
    const endX = width - 1;

    for (let y = 1; y < endY; y += 3) {
      for (let x = 1; x < endX; x += 3) {
        const center = grayscaleAt(data, width, x, y);
        const top = grayscaleAt(data, width, x, y - 1);
        const bottom = grayscaleAt(data, width, x, y + 1);
        const left = grayscaleAt(data, width, x - 1, y);
        const right = grayscaleAt(data, width, x + 1, y);

        const laplacian = top + bottom + left + right - 4 * center;
        values.push(laplacian);
      }
    }

    if (values.length === 0) return { score: 0, message: 'Unable to analyze', isAcceptable: false };

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const varSum = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
    const variance = varSum / values.length;

    if (variance >= BLUR_VARIANCE_EXCELLENT) {
      return { score: Math.round(variance), message: 'Excellent focus quality', isAcceptable: true };
    } else if (variance >= BLUR_VARIANCE_GOOD) {
      return { score: Math.round(variance), message: 'Good focus quality', isAcceptable: true };
    } else if (variance >= BLUR_VARIANCE_ACCEPTABLE) {
      return { score: Math.round(variance), message: 'Acceptable focus quality', isAcceptable: true };
    } else {
      return { score: Math.round(variance), message: 'Image too blurry - please use a sharper photo', isAcceptable: false };
    }
  };

  // Process uploaded image with quality check
  const processUploadedImage = (imageSrc: string) => {
    setIsProcessingUpload(true);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setIsProcessingUpload(false);
        setUploadQualityMessage('Failed to process image');
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const quality = checkImageQuality(imgData);

      setUploadQualityScore(quality.score);
      setUploadQualityMessage(quality.message);

      if (quality.isAcceptable) {
        const { photo, metrics } = eyeTrackerRef.current.processImage(img);

        if (photo && metrics.detected) {
          setUploadedImage(imageSrc);
          setPupilDiameter(metrics.pupilDiameterMm);
          setCrescentRatio(metrics.crescentRatio);
          setOrientation(photo.crescentOrientation);
          latestPupilDiameterRef.current = metrics.pupilDiameterMm;
          latestCrescentRatioRef.current = metrics.crescentRatio;

          const calculatedPhoto = calculatePhotorefraction(
            photo.crescentHeightRatio,
            photo.crescentOrientation,
            photo.pupilDiameterMm,
            photo.redReflexIntensityRatio,
            workingDistanceCm,
            flashEccentricityMm,
            OPTICAL_CONSTANT_K
          );

          onSave(calculatedPhoto);
          setIsProcessingUpload(false);
        } else {
          setUploadQualityMessage('No eye detected in photo. Please upload a clear photo of an eye.');
          setIsProcessingUpload(false);
        }
      } else {
        setIsProcessingUpload(false);
      }
    };
    img.onerror = () => {
      setIsProcessingUpload(false);
      setUploadQualityMessage('Failed to load image');
    };
    img.src = imageSrc;
  };

  // Process uploaded video with frame sampling.
  //
  // Rewritten from the original, which re-set `videoRef.current.src =
  // videoSrc` on *every* sampled frame -- reloading the whole video element
  // repeatedly (visible flicker, wasted decode work), then immediately
  // setting `currentTime` with no guarantee the browser had finished
  // seeking before processFrame read the canvas. Here the src is set once;
  // each sample point waits for the browser's `seeked` event before the CV
  // engine reads that frame, so what gets analyzed is actually the frame at
  // the requested timestamp.
  const processUploadedVideo = (videoSrc: string) => {
    videoProcessingCancelledRef.current = false;
    setIsProcessingUpload(true);

    const previewVideo = videoRef.current;
    if (!previewVideo || !overlayCanvasRef.current) {
      setIsProcessingUpload(false);
      setUploadQualityMessage('Video preview unavailable.');
      return;
    }

    previewVideo.srcObject = null;
    previewVideo.src = videoSrc;
    previewVideo.muted = true;
    previewVideo.playsInline = true;

    const seekTo = (time: number) =>
      new Promise<void>((resolve) => {
        const onSeeked = () => {
          previewVideo.removeEventListener('seeked', onSeeked);
          resolve();
        };
        previewVideo.addEventListener('seeked', onSeeked);
        previewVideo.currentTime = time;
      });

    previewVideo.onloadedmetadata = async () => {
      const frameIntervalSec = 1 / VIDEO_SAMPLE_FPS;
      const duration = previewVideo.duration || 0;
      let frameCount = 0;
      let t = 0;

      while (
        !videoProcessingCancelledRef.current &&
        frameCount < VIDEO_SAMPLE_MAX_FRAMES &&
        t < duration
      ) {
        // eslint-disable-next-line no-await-in-loop
        await seekTo(t);
        if (videoProcessingCancelledRef.current) return;

        if (overlayCanvasRef.current) {
          const result = eyeTrackerRef.current.processFrame(
            previewVideo,
            overlayCanvasRef.current,
            { drawMesh: true, flashActive: false }
          );
          updateLiveMetrics(result);
        }

        frameCount += 1;
        t += frameIntervalSec;
      }

      if (videoProcessingCancelledRef.current) return;

      setIsProcessingUpload(false);
      handleFlashCapture();
    };

    previewVideo.onerror = () => {
      if (videoProcessingCancelledRef.current) return;
      setIsProcessingUpload(false);
      setUploadQualityMessage('Failed to load video');
    };
  };

  // Upload image handler
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      videoProcessingCancelledRef.current = true;
      stopCamera();
      setUploadedImage(null);

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          processUploadedImage(event.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else if (file.type.startsWith('video/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          processUploadedVideo(event.target?.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setUploadQualityMessage('Unsupported file type. Please upload an image or video.');
      }
    }
  };

  const framesRemainingForStability = Math.max(0, MIN_STABLE_FRAMES_REQUIRED - stableFrameCount);

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
        <div className="flex items-center space-x-2 text-blue-600 font-bold text-xs uppercase tracking-wider">
          <Camera className="w-4 h-4" />
          <span>Step 4 of 6 • Smartphone AI Photorefraction Scan</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 font-display">
          Pupil Red Reflex & Retinoscopic Crescent Analysis
        </h2>
        <p className="text-sm text-slate-600">
          Captures real-time red reflex illumination from camera video or uploaded eye photos to isolate the retinoscopic crescent and compute spherical equivalent diopters.
        </p>
      </div>

      {/* Top Controls Bar */}
      <div className="bg-slate-900 text-white p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${isCameraActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
            {isCameraActive ? `LIVE STREAM SCAN (${liveMetrics.fps} FPS)` : uploadedImage ? 'IMAGE ANALYSIS MODE' : 'CAMERA STANDBY'}
          </span>
          {isCameraActive && (
            <span className="text-[10px] bg-blue-950 text-blue-300 px-2.5 py-0.5 rounded-full border border-blue-800 font-mono">
              Pupil Tracked ({liveMetrics.confidenceScore}%)
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {cameraDevices.length > 0 && (
            <select
              value={selectedDeviceId}
              onChange={(e) => {
                setSelectedDeviceId(e.target.value);
                if (isCameraActive) startCamera(e.target.value);
              }}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-1.5 focus:outline-hidden"
            >
              {cameraDevices.map((d, idx) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${idx + 1}`}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-1.5 rounded-xl transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Photo/Video</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleImageUpload}
            className="hidden"
          />

          {isCameraActive ? (
            <button
              onClick={stopCamera}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold flex items-center space-x-2 transition-colors cursor-pointer"
            >
              <VideoOff className="w-3.5 h-3.5" />
              <span>Stop Camera</span>
            </button>
          ) : (
            <button
              onClick={() => startCamera(selectedDeviceId)}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center space-x-2 transition-colors shadow-md shadow-blue-600/30 cursor-pointer"
            >
              <Video className="w-3.5 h-3.5" />
              <span>Enable Live Camera</span>
            </button>
          )}
        </div>
      </div>

      {isProcessingUpload && (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl flex items-center space-x-3 text-blue-800 text-xs">
          <RefreshCw className="w-5 h-5 shrink-0 text-blue-600 animate-spin" />
          <span>Processing uploaded media...</span>
        </div>
      )}

      {uploadQualityMessage && (
        <div className={`p-4 rounded-2xl flex items-center space-x-3 text-xs ${
          uploadQualityScore !== null && uploadQualityScore >= BLUR_VARIANCE_ACCEPTABLE
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border border-amber-200 text-amber-800'
        }`}>
          {uploadQualityScore !== null && uploadQualityScore >= BLUR_VARIANCE_ACCEPTABLE ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
          )}
          <span>{uploadQualityMessage} {uploadQualityScore !== null && `(Score: ${uploadQualityScore})`}</span>
        </div>
      )}

      {cameraError && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center space-x-3 text-amber-800 text-xs">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
          <span>{cameraError}</span>
        </div>
      )}

      {/* Quality Indicators Panel */}
      {(isCameraActive || uploadedImage) && (
        <QualityPanel
          lighting={liveMetrics.redReflexIntensity}
          fixation={0.82}
          focus={liveMetrics.blurVariance || 80}
          pupilTracking={liveMetrics.confidenceScore}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Photorefraction Camera View & Crescent Isolation */}
        <div className="lg:col-span-7 bg-slate-900 text-white p-6 rounded-3xl border border-slate-800 shadow-xl space-y-6 flex flex-col justify-between relative overflow-hidden">
          {/* Flash Effect Screen Flash */}
          {flashEffect && <div className="absolute inset-0 bg-white z-50 animate-out fade-out duration-300 pointer-events-none" />}

          {/* Pupil Crescent Box */}
          <div className="relative w-full h-72 sm:h-96 bg-black rounded-2xl border border-slate-800 flex items-center justify-center overflow-hidden">
            {/* Live Camera Feed */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover rounded-2xl scale-x-[-1] ${
                isCameraActive ? 'block' : 'hidden'
              }`}
            />

            {/* Live Overlay Canvas */}
            <canvas
              ref={overlayCanvasRef}
              className={`absolute inset-0 w-full h-full object-cover pointer-events-none scale-x-[-1] ${
                isCameraActive ? 'block' : 'hidden'
              }`}
            />

            {/* Uploaded Image or Simulated Pupil Rendering if Camera Off */}
            {!isCameraActive && (
              uploadedImage ? (
                <img src={uploadedImage} alt="Uploaded Eye" className="w-full h-full object-cover rounded-2xl" />
              ) : (
                /* Simulated Eye & Pupil Crescent Rendering */
                <div className="relative w-64 h-64 bg-amber-900/30 rounded-full border-4 border-amber-900/50 flex items-center justify-center shadow-2xl">
                  {/* Iris Background */}
                  <div className="w-48 h-48 rounded-full bg-gradient-to-tr from-amber-950 via-amber-800 to-amber-900 flex items-center justify-center relative overflow-hidden border border-amber-700/50">
                    {/* Pupil Boundary */}
                    <div
                      className="relative rounded-full bg-slate-950 flex items-center justify-center overflow-hidden border-2 border-cyan-400 shadow-inner"
                      style={{
                        width: `${pupilDiameter * PUPIL_RENDER_PX_PER_MM}px`,
                        height: `${pupilDiameter * PUPIL_RENDER_PX_PER_MM}px`,
                      }}
                    >
                      {/* Red Reflex Base */}
                      <div className="absolute inset-0 bg-red-600/40" />

                      {/* Retinoscopic Crescent Highlight */}
                      {orientation === 'TOP' && (
                        <div
                          className="absolute top-0 w-full bg-gradient-to-b from-amber-200 via-amber-300 to-transparent opacity-90 transition-all duration-300"
                          style={{ height: `${crescentRatio * 100}%` }}
                        />
                      )}
                      {orientation === 'BOTTOM' && (
                        <div
                          className="absolute bottom-0 w-full bg-gradient-to-t from-amber-200 via-amber-300 to-transparent opacity-90 transition-all duration-300"
                          style={{ height: `${crescentRatio * 100}%` }}
                        />
                      )}
                      {orientation === 'SYMMETRIC' && (
                        <div className="absolute inset-0 bg-amber-200/30 rounded-full" />
                      )}

                      {/* Pupil Crosshairs */}
                      <div className="absolute w-full h-px bg-cyan-400/40" />
                      <div className="absolute h-full w-px bg-cyan-400/40" />
                    </div>
                  </div>

                  {/* Corneal Glint Reflection */}
                  <div className="absolute top-16 right-20 w-3 h-3 bg-white rounded-full blur-[1px] opacity-90" />
                </div>
              )
            )}

            {/* Analysis Overlay HUD */}
            <div className="absolute bottom-3 left-3 right-3 bg-slate-900/85 backdrop-blur-md p-3 rounded-xl border border-slate-800 flex justify-between items-center text-[11px] font-mono text-cyan-300">
              <div>
                Pupil: <span className="font-bold text-white">{pupilDiameter.toFixed(1)} mm</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span>EAR:</span>
                <span className="font-bold text-white">{liveMetrics.ear ? liveMetrics.ear.toFixed(2) : '0.28'}</span>
                {isCameraActive && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                    liveMetrics.isBlinking
                      ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50 animate-pulse'
                      : liveMetrics.isObscured
                      ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                      : 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                  }`}>
                    {liveMetrics.isBlinking ? 'Blink' : liveMetrics.isObscured ? 'Obscured' : 'Open'}
                  </span>
                )}
              </div>
              <div>
                Crescent: <span className="font-bold text-amber-300">{Math.round(crescentRatio * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Interactive Parameters Adjuster */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
              <Sliders className="w-4 h-4 text-blue-400" />
              <span>Crescent & Optics Calibrator</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Crescent Height Ratio</label>
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.02}
                  value={crescentRatio}
                  onChange={(e) => setCrescentRatio(parseFloat(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Reflex Crescent Pattern</label>
                <select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as CrescentOrientation)}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-1.5 text-xs"
                >
                  <option value="TOP">Top Crescent (Myopia)</option>
                  <option value="BOTTOM">Bottom Crescent (Hyperopia)</option>
                  <option value="SYMMETRIC">Symmetric / Minimal (Emmetropia)</option>
                </select>
              </div>
            </div>

            {/* Advanced Calibration (Research) - Collapsible */}
            <div className="pt-2 border-t border-slate-800">
              <button
                onClick={() => setAdvancedCalibrationOpen(!advancedCalibrationOpen)}
                className="flex items-center space-x-2 text-[10px] text-slate-400 hover:text-slate-300 transition-colors"
              >
                <Info className="w-3 h-3" />
                <span>Advanced Calibration (Research)</span>
                <span className="text-slate-500">{advancedCalibrationOpen ? '▼' : '▶'}</span>
              </button>

              {advancedCalibrationOpen && (
                <div className="mt-3 space-y-3 pt-3 border-t border-slate-800">
                  <div>
                    <label className="text-slate-400 block mb-1 text-[10px]">
                      Working Distance (cm)
                      <span className="text-slate-500 ml-1">- Manual override (auto-measured from face when camera on)</span>
                    </label>
                    <input
                      type="range"
                      min={30}
                      max={150}
                      step={5}
                      value={workingDistanceCm}
                      onChange={(e) => setWorkingDistanceCm(parseInt(e.target.value))}
                      className="w-full accent-blue-500 cursor-pointer"
                    />
                    <div className="text-right text-[10px] text-slate-400 mt-1">{workingDistanceCm} cm</div>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1 text-[10px]">Flash Eccentricity (mm)</label>
                    <input
                      type="range"
                      min={4}
                      max={30}
                      step={1}
                      value={flashEccentricityMm}
                      onChange={(e) => setFlashEccentricityMm(parseInt(e.target.value))}
                      className="w-full accent-blue-500 cursor-pointer"
                    />
                    <div className="text-right text-[10px] text-slate-400 mt-1">{flashEccentricityMm} mm</div>
                  </div>

                  <div className="text-[9px] text-slate-500 italic pt-1">
                    Research defaults — k=6 is a published coaxial-flash constant; per-device clinical calibration is future work.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Capture Trigger */}
          <button
            onClick={handleFlashCapture}
            disabled={isCapturing || !eyeDetected}
            className={`w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shadow-xl shadow-blue-600/30 hover:scale-[1.01] transition-all cursor-pointer ${
              (!eyeDetected || isCapturing) ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {isCapturing ? (
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Zap className="w-4 h-4 text-amber-400 fill-current" />
            )}
            <span>
              {isCapturing
                ? 'Processing Retinoscopic Reflex...'
                : !eyeDetected
                  ? 'No eye detected'
                  : 'Execute Flash Photorefraction Scan'}
            </span>
          </button>
        </div>

        {/* Right Column: Refractive Error Diagnostics Card */}
        <div className="lg:col-span-5 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <h3 className="font-bold text-slate-900 text-base font-display flex items-center space-x-2 border-b border-slate-100 pb-2">
              <Eye className="w-5 h-5 text-blue-600" />
              <span>Extracted Photorefraction Metrics</span>
            </h3>

            {/* Diopters Card */}
            <div className="bg-gradient-to-br from-blue-900 via-slate-900 to-indigo-950 text-white p-6 rounded-3xl shadow-lg space-y-3">
              <div className="flex justify-between items-center text-xs text-blue-200">
                <span className="font-medium">Spherical Equivalent</span>
                <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full text-[10px] font-bold border border-blue-400/30">
                  {currentPhotoData.confidenceScore}% Confidence
                </span>
              </div>

              <div className={`text-4xl font-extrabold font-display tracking-tight ${eyeDetected ? 'text-white' : 'text-slate-500'}`}>
                {eyeDetected ? (
                  <>
                    {currentPhotoData.sphericalEquivalentDiopters > 0 ? '+' : ''}
                    {currentPhotoData.sphericalEquivalentDiopters.toFixed(2)} D
                  </>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </div>

              {!eyeDetected && (
                <div className="text-xs text-slate-400 italic mt-1">
                  Position your eye in frame
                </div>
              )}

              <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-300 font-semibold">Refractive State:</span>
                <span className="font-bold text-cyan-400 bg-cyan-950/60 px-2.5 py-1 rounded-lg border border-cyan-800">
                  {currentPhotoData.classification.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Live Equation Box */}
            <div className="bg-slate-900 text-cyan-300 p-4 rounded-2xl border border-slate-700 space-y-2">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Howland Equation (Live)</div>
              <code className="text-xs font-mono block leading-relaxed">
                SE = {orientation === 'TOP' ? '-1' : orientation === 'BOTTOM' ? '+1' : '0'} · {OPTICAL_CONSTANT_K.toFixed(1)} · ({effectiveCrescentRatio.toFixed(2)} · {effectiveWorkingDistance.toFixed(0)}) / ({flashEccentricityMm.toFixed(0)} · {effectivePupilDiameter.toFixed(1)}) = {currentPhotoData.sphericalEquivalentDiopters > 0 ? '+' : ''}{currentPhotoData.sphericalEquivalentDiopters.toFixed(2)} D
              </code>
            </div>

            {/* Metrics Grid */}
            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                <span className="text-slate-600 font-medium">Estimated Astigmatism:</span>
                <span className="font-bold text-slate-900">{currentPhotoData.astigmatismCylinderDiopters} Cyl</span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                <span className="text-slate-600 font-medium">Pupil Diameter:</span>
                <span className="font-bold text-slate-900">{currentPhotoData.pupilDiameterMm} mm</span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex justify-between items-center">
                <span className="text-slate-600 font-medium">Red Reflex Intensity:</span>
                <span className="font-bold text-slate-900">{Math.round(currentPhotoData.redReflexIntensityRatio * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              onClick={onBack}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <div className="flex items-center space-x-3">
              {isCameraActive && !canProceed && (
                <span className="text-[10px] text-slate-500 font-medium">
                  Hold steady — {framesRemainingForStability} more stable frame{framesRemainingForStability === 1 ? '' : 's'} needed
                </span>
              )}
              <button
                onClick={() => {
                  onSave(currentPhotoData);
                  onNext();
                }}
                disabled={!canProceed && isCameraActive}
                className={`inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all cursor-pointer ${
                  canProceed || !isCameraActive
                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <span>Next: Multi-Modal Fusion Engine</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};