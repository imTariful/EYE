import React, { useState, useEffect, useRef } from 'react';
import { AccommodativeData, MicrosaccadeData, FixationPoint } from '../types';
import {
  analyzeHighFrequencyMicroFluctuations,
  calculateBCEA,
  detectEngbertKlieglMicrosaccades,
  detectNPCBreak,
} from '../utils/opticsEngine';
import {
  DEFAULT_ACCOMMODATIVE_LAG_D,
  DEFAULT_NPC_CM,
  resolveManualAccommodativeInputs,
} from '../utils/accommodativeInputs';
import { EyeTrackerEngine, PupilFrameResult } from '../utils/eyeTracker';
import { QualityPanel } from './QualityIndicator';
import {
  Target,
  Video,
  VideoOff,
  Play,
  RotateCcw,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Activity,
  Zap,
  Info,
  Sliders,
  Camera,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

interface Step3AccommodativeScanProps {
  accommodative: AccommodativeData;
  microsaccade: MicrosaccadeData;
  onSave: (accomm: AccommodativeData, micro: MicrosaccadeData) => void;
  onNext: () => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Calibration / tuning constants
// Pulled out of inline JSX/logic so they're easy to find and adjust in one
// place instead of hunting through render code and effect callbacks.
// ---------------------------------------------------------------------------
const SCAN_DURATION_STEPS = 50; // total ticks in the scan
const SCAN_TICK_MS = 100; // ms per tick -> 5s total scan by default
const MIN_STABLE_FRAMES_REQUIRED = 30;
const MIN_CONFIDENCE_TO_PROCEED = 70;
const MIN_BLUR_VARIANCE_TO_PROCEED = 50;

const PIXEL_TO_DEGREE_SCALE = 22.0; // divisor converting eye-pixel offset -> approx degrees
const SCATTER_PLOT_PIXELS_PER_DEGREE = 28; // scatter dot placement scale
const SCATTER_PLOT_CLAMP_PX = 85; // max +/- offset for a scatter dot
const BCEA_ELLIPSE_WIDTH_SCALE = 90;
const BCEA_ELLIPSE_HEIGHT_SCALE = 70;
const BCEA_ELLIPSE_MAX_WIDTH = 180;
const BCEA_ELLIPSE_MAX_HEIGHT = 140;

const NPC_TARGET_START_CM = 35;
const NPC_TARGET_END_CM = 5;
const NPC_NORMAL_THRESHOLD_CM = 10.0;
const ACCOMMODATIVE_LAG_NORMAL_THRESHOLD_D = 0.75;
const BCEA_CLAMP_MIN = 0.15;
const BCEA_CLAMP_MAX = 2.5;

// ---------------------------------------------------------------------------
// Pure helpers (kept local since they're specific to this scan step; if
// another step ends up needing the same stability gate, promote this into
// eyeTracker.ts so both consumers share one definition).
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

function amblyopiaRiskFromBcea(bcea: number): 'HIGH' | 'MODERATE' | 'LOW' {
  if (bcea > 1.2) return 'HIGH';
  if (bcea > 0.6) return 'MODERATE';
  return 'LOW';
}

function clampBcea(value: number, fallback: number): number {
  return Math.max(BCEA_CLAMP_MIN, Math.min(BCEA_CLAMP_MAX, value || fallback));
}

export const Step3AccommodativeScan: React.FC<Step3AccommodativeScanProps> = ({
  accommodative,
  microsaccade,
  onSave,
  onNext,
  onBack,
}) => {
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0); // 0 to 100%
  const [targetDistanceCm, setTargetDistanceCm] = useState(30); // 30cm moving down to 5cm
  const [livePoints, setLivePoints] = useState<FixationPoint[]>(() => microsaccade.fixationPoints ?? []);
  const [scanCompleted, setScanCompleted] = useState(false);

  // Navigation Guard State
  const [stableFrameCount, setStableFrameCount] = useState(0);
  const [canProceed, setCanProceed] = useState(false);

  // Camera State
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Live Pupil Tracker Metrics from CV Engine
  const [liveMetrics, setLiveMetrics] = useState<PupilFrameResult>({
    detected: false,
    leftEye: null,
    rightEye: null,
    pupilDiameterMm: 4.2,
    redReflexIntensity: 0.78,
    crescentRatio: 0.28,
    fps: 0,
    confidenceScore: 0,
  });

  const eyeTrackerRef = useRef<EyeTrackerEngine | null>(null);
  if (eyeTrackerRef.current === null) {
    eyeTrackerRef.current = new EyeTrackerEngine();
  }
  const animFrameRef = useRef<number | null>(null);

  // Temporary local scan state
  const initialManualInputs = resolveManualAccommodativeInputs(
    accommodative.npcCm,
    accommodative.accommodativeLagDiopters,
  );
  const [currentNpc, setCurrentNpc] = useState(initialManualInputs.npcCm);
  const [currentLag, setCurrentLag] = useState(initialManualInputs.accommodativeLagDiopters);
  const [currentFatigue, setCurrentFatigue] = useState(
    Number.isFinite(accommodative.fatigueIndex) && microsaccade.fixationPoints.length > 0
      ? accommodative.fatigueIndex
      : 50,
  );
  const [currentBcea, setCurrentBcea] = useState(microsaccade.bceaDeg2 || 0.75);

  // ---------------------------------------------------------------------
  // Refs mirroring the accumulating point arrays.
  //
  // WHY: the scan's setInterval closure is created once, at the moment
  // startScan() runs. If it reads `livePoints`/`odLivePoints`/`osLivePoints`
  // directly from component state, it captures whatever those arrays were
  // at *that* render -- not the values React accumulates afterwards via
  // setLivePoints inside the separate CV frame loop. That was the source of
  // calculateBCEA() effectively running on stale (often empty) data at the
  // end of the scan. Refs sidestep this: the interval reads
  // `livePointsRef.current`, which the frame loop keeps up to date on every
  // tick regardless of when the closure was created.
  // ---------------------------------------------------------------------
  const livePointsRef = useRef<FixationPoint[]>(livePoints);
  const odLivePointsRef = useRef<FixationPoint[]>([]);
  const osLivePointsRef = useRef<FixationPoint[]>([]);
  const [odLivePoints, setOdLivePointsState] = useState<FixationPoint[]>([]);
  const [osLivePoints, setOsLivePointsState] = useState<FixationPoint[]>([]);

  // The webcam cannot directly measure vergence break (NPC) or accommodation
  // (lag). These values are explicit user/self-reported inputs, not camera
  // measurements. Keep them deterministic when no value has been supplied.
  const pupilDiameterHistoryRef = useRef<number[]>([]);
  const interpupillaryDistanceHistoryRef = useRef<number[]>([]);
  const targetDistanceMmHistoryRef = useRef<number[]>([]);
  const [cameraNpcProxyCm, setCameraNpcProxyCm] = useState<number | null>(
    Number.isFinite(accommodative.cameraNpcProxyCm) ? accommodative.cameraNpcProxyCm! : null,
  );

  const setLivePointsSynced = (updater: (prev: FixationPoint[]) => FixationPoint[]) => {
    setLivePoints((prev) => {
      const next = updater(prev);
      livePointsRef.current = next;
      return next;
    });
  };
  const setOdLivePoints = (updater: (prev: FixationPoint[]) => FixationPoint[]) => {
    setOdLivePointsState((prev) => {
      const next = updater(prev);
      odLivePointsRef.current = next;
      return next;
    });
  };
  const setOsLivePoints = (updater: (prev: FixationPoint[]) => FixationPoint[]) => {
    setOsLivePointsState((prev) => {
      const next = updater(prev);
      osLivePointsRef.current = next;
      return next;
    });
  };

  // Interval handle for the scan loop -- stored in a ref (not a local
  // `const interval`) so it can be cleared from the unmount cleanup effect
  // too, not just from its own completion branch. Without this, navigating
  // away mid-scan leaves the interval running and calling setState on an
  // unmounted component.
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load available camera devices on mount
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

  // Toggle or start camera stream
  const startCamera = async (deviceId?: string) => {
    setCameraError(null);
    try {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err: unknown) {
      console.error('Camera access error:', err);
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Enable it in your browser settings to run the fixation scan.'
          : 'Camera access unavailable or blocked. A live camera is required for fixation measurements.';
      setCameraError(message);
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  // Computer Vision Frame Loop
  const latestMetricsRef = useRef<PupilFrameResult | null>(null);

  useEffect(() => {
    if (!isCameraActive || !videoRef.current || !overlayCanvasRef.current) return;

    const processLoop = () => {
      if (videoRef.current && overlayCanvasRef.current && isCameraActive) {
        const tracker = eyeTrackerRef.current!;
        const result = tracker.processFrame(
          videoRef.current,
          overlayCanvasRef.current,
          { drawMesh: true }
        );
        setLiveMetrics(result);
        latestMetricsRef.current = result;

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

        // If scanning, continuously accumulate gaze drift points from live camera eyes (only when eyes open)
        if (isScanning && result.leftEye && result.rightEye && !result.isBlinking && !result.isObscured) {
          const frameCenterX = (videoRef.current.videoWidth || 640) / 2;
          const frameCenterY = (videoRef.current.videoHeight || 480) / 2;

          const eyeMidX = (result.leftEye.x + result.rightEye.x) / 2;
          const eyeMidY = (result.leftEye.y + result.rightEye.y) / 2;
          const dx = (eyeMidX - frameCenterX) / PIXEL_TO_DEGREE_SCALE;
          const dy = (eyeMidY - frameCenterY) / PIXEL_TO_DEGREE_SCALE;
          setLivePointsSynced((prev) => [...prev.slice(-40), { x: dx, y: dy }]);

          const odDx = (result.rightEye.x - frameCenterX) / PIXEL_TO_DEGREE_SCALE;
          const odDy = (result.rightEye.y - frameCenterY) / PIXEL_TO_DEGREE_SCALE;
          setOdLivePoints((prev) => [...prev.slice(-40), { x: odDx, y: odDy }]);

          const osDx = (result.leftEye.x - frameCenterX) / PIXEL_TO_DEGREE_SCALE;
          const osDy = (result.leftEye.y - frameCenterY) / PIXEL_TO_DEGREE_SCALE;
          setOsLivePoints((prev) => [...prev.slice(-40), { x: osDx, y: osDy }]);

        }
      }
      animFrameRef.current = requestAnimationFrame(processLoop);
    };

    animFrameRef.current = requestAnimationFrame(processLoop);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraActive, isScanning, targetDistanceCm, canProceed]);

  // Clean up on unmount: stop camera, cancel any in-flight animation frame,
  // AND clear the scan interval if the user navigates away mid-scan.
  useEffect(() => {
    return () => {
      stopCamera();
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    };
  }, []);

  // Start Automated Accommodative & Fixation Tracking Loop
  const startScan = async () => {
    if (!isCameraActive) {
      await startCamera(selectedDeviceId);
    }

    if (!videoRef.current?.srcObject || !canProceed) {
      setCameraError('Wait for stable, focused eye tracking before starting the measurement scan.');
      return;
    }

    setIsScanning(true);
    setScanProgress(0);
    setScanCompleted(false);
    setLivePointsSynced(() => []);
    setOdLivePoints(() => []);
    setOsLivePoints(() => []);
    pupilDiameterHistoryRef.current = [];
    interpupillaryDistanceHistoryRef.current = [];
    targetDistanceMmHistoryRef.current = [];
    setCameraNpcProxyCm(null);

    // Guard against a second scan being started while one is already
    // running (e.g. a rapid double-click on the button).
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    let step = 0;
    scanIntervalRef.current = setInterval(() => {
      // Pause scan data collection during blink or eyelid obscuration
      if (latestMetricsRef.current && (latestMetricsRef.current.isBlinking || latestMetricsRef.current.isObscured)) {
        return;
      }

      step += 1;
      const progress = Math.min(100, Math.round((step / SCAN_DURATION_STEPS) * 100));
      setScanProgress(progress);

      // Target moves closer from NPC_TARGET_START_CM down to NPC_TARGET_END_CM
      const span = NPC_TARGET_START_CM - NPC_TARGET_END_CM;
      const dist = Math.max(NPC_TARGET_END_CM, NPC_TARGET_START_CM - (step / SCAN_DURATION_STEPS) * span);
      setTargetDistanceCm(Math.round(dist * 10) / 10);

      const metrics = latestMetricsRef.current;
      if (metrics?.leftEye && metrics.rightEye && metrics.detected) {
        interpupillaryDistanceHistoryRef.current = [
          ...interpupillaryDistanceHistoryRef.current.slice(-59),
          Math.abs(metrics.rightEye.x - metrics.leftEye.x),
        ];
        targetDistanceMmHistoryRef.current = [
          ...targetDistanceMmHistoryRef.current.slice(-59),
          dist * 10,
        ];
      }

      // Sample the measurable pupil signal once per scan step. This history is
      // used only for the fatigue estimate; it is not used to infer NPC or lag.
      const pupilDiameter = latestMetricsRef.current?.pupilDiameterMm;
      if (Number.isFinite(pupilDiameter) && latestMetricsRef.current?.detected) {
        pupilDiameterHistoryRef.current = [
          ...pupilDiameterHistoryRef.current.slice(-59),
          pupilDiameter as number,
        ];
      }

      if (step >= SCAN_DURATION_STEPS) {
        if (scanIntervalRef.current) {
          clearInterval(scanIntervalRef.current);
          scanIntervalRef.current = null;
        }
        setIsScanning(false);
        setScanCompleted(true);

        // Read from refs, not state -- guaranteed to hold everything
        // accumulated during the scan, unlike the closed-over state values.
        const finalPoints = livePointsRef.current;
        const finalOdPoints = odLivePointsRef.current;
        const finalOsPoints = osLivePointsRef.current;

        const bceaCalc = calculateBCEA(finalPoints);
        const finalBcea = clampBcea(bceaCalc.bceaDeg2, currentBcea);

        const odBceaCalc = calculateBCEA(finalOdPoints);
        const osBceaCalc = calculateBCEA(finalOsPoints);
        const odBcea = clampBcea(odBceaCalc.bceaDeg2, finalBcea);
        const osBcea = clampBcea(osBceaCalc.bceaDeg2, finalBcea);

        const effectiveSamplingHz = Math.max(1, latestMetricsRef.current?.fps || 1000 / SCAN_TICK_MS);
        const scanDurationSec = (SCAN_DURATION_STEPS * SCAN_TICK_MS) / 1000;
        const combinedMicro = detectEngbertKlieglMicrosaccades(finalPoints, effectiveSamplingHz);
        const odMicro = detectEngbertKlieglMicrosaccades(finalOdPoints, effectiveSamplingHz);
        const osMicro = detectEngbertKlieglMicrosaccades(finalOsPoints, effectiveSamplingHz);
        const frequencyFrom = (
          count: number,
          pointCount: number,
          cameraDerived: boolean,
        ): { frequencyHz: number; confidence: 'MEASURED' | 'LOW' } =>
          cameraDerived && pointCount >= 4 && count > 0
            ? { frequencyHz: Math.round((count / scanDurationSec) * 100) / 100, confidence: 'MEASURED' }
            : { frequencyHz: 1.5, confidence: 'LOW' };
        const hasPerEyeCameraPoints = finalOdPoints.length >= 4 && finalOsPoints.length >= 4;
        const combinedFrequency = frequencyFrom(combinedMicro.count, finalPoints.length, hasPerEyeCameraPoints);
        const odFrequency = frequencyFrom(odMicro.count, finalOdPoints.length, finalOdPoints.length >= 4);
        const osFrequency = frequencyFrom(osMicro.count, finalOsPoints.length, finalOsPoints.length >= 4);

        const npcProxy = detectNPCBreak(
          interpupillaryDistanceHistoryRef.current,
          targetDistanceMmHistoryRef.current,
        );
        const hasCameraNpcProxy = npcProxy.breakFrameIndex !== null && Number.isFinite(npcProxy.npcBreakMm);
        const resolvedCameraNpcProxyCm = hasCameraNpcProxy ? npcProxy.npcBreakMm! / 10 : null;
        setCameraNpcProxyCm(resolvedCameraNpcProxyCm);

        // NPC and accommodative lag are not directly measurable from this
        // webcam workflow. Preserve the deterministic values entered by the
        // user instead of presenting a camera-derived or random estimate.
        const manualInputs = resolveManualAccommodativeInputs(currentNpc, currentLag);
        const finalNpc = manualInputs.npcCm;
        const finalLag = manualInputs.accommodativeLagDiopters;

        const fatigueAnalysis = analyzeHighFrequencyMicroFluctuations(
          pupilDiameterHistoryRef.current,
          30,
        );
        // A short/insufficient pupil history cannot support an HFF estimate;
        // use a neutral value rather than inventing a measurement.
        const fatigueIndex = pupilDiameterHistoryRef.current.length >= 10
          ? fatigueAnalysis.fatigueIndex
          : 50;

        setCurrentBcea(finalBcea);
        setCurrentNpc(finalNpc);
        setCurrentLag(finalLag);
        setCurrentFatigue(fatigueIndex);

        const updatedAccomm: AccommodativeData = {
          ...accommodative,
          npcCm: finalNpc,
          accommodativeLagDiopters: finalLag,
          fatigueIndex,
          od: {
            npcCm: finalNpc,
            accommodativeLagDiopters: finalLag,
            fatigueIndex,
            constrictionVelocityMmSec: 4.5,
            responseLatencyMs: 320,
          },
          os: {
            npcCm: finalNpc,
            accommodativeLagDiopters: finalLag,
            fatigueIndex,
            constrictionVelocityMmSec: 4.5,
            responseLatencyMs: 320,
          },
          cameraNpcProxyCm: resolvedCameraNpcProxyCm ?? undefined,
          cameraNpcProxyConfidence: hasCameraNpcProxy ? 'MODERATE' : undefined,
          cameraNpcProxyVergenceAngleDeg: hasCameraNpcProxy ? npcProxy.vergenceAngleDeg : undefined,
        };

        const updatedMicro: MicrosaccadeData = {
          ...microsaccade,
          bceaDeg2: finalBcea,
          fixationStabilityScore: Math.max(40, Math.min(98, Math.round(100 - finalBcea * 30))),
          fixationPoints: finalPoints,
          amblyopiaRisk: amblyopiaRiskFromBcea(finalBcea),
          odFixationPoints: finalOdPoints,
          osFixationPoints: finalOsPoints,
          odBceaDeg2: odBcea,
          osBceaDeg2: osBcea,
          od: {
            bceaDeg2: odBcea,
            fixationStabilityScore: Math.max(40, Math.min(98, Math.round(100 - odBcea * 30))),
            fixationPoints: finalOdPoints,
            microsaccadeFrequencyHz: odFrequency.frequencyHz,
            microsaccadeFrequencyConfidence: odFrequency.confidence,
            amblyopiaRisk: amblyopiaRiskFromBcea(odBcea),
          },
          os: {
            bceaDeg2: osBcea,
            fixationStabilityScore: Math.max(40, Math.min(98, Math.round(100 - osBcea * 30))),
            fixationPoints: finalOsPoints,
            microsaccadeFrequencyHz: osFrequency.frequencyHz,
            microsaccadeFrequencyConfidence: osFrequency.confidence,
            amblyopiaRisk: amblyopiaRiskFromBcea(osBcea),
          },
          microsaccadeFrequencyHz: combinedFrequency.frequencyHz,
          microsaccadeFrequencyConfidence: combinedFrequency.confidence,
        };

        onSave(updatedAccomm, updatedMicro);
      }
    }, SCAN_TICK_MS);
  };

  const framesRemainingForStability = Math.max(0, MIN_STABLE_FRAMES_REQUIRED - stableFrameCount);

  const saveManualMetrics = () => {
    onSave(
      {
        ...accommodative,
        npcCm: currentNpc,
        accommodativeLagDiopters: currentLag,
        od: accommodative.od
          ? { ...accommodative.od, npcCm: currentNpc, accommodativeLagDiopters: currentLag }
          : undefined,
        os: accommodative.os
          ? { ...accommodative.os, npcCm: currentNpc, accommodativeLagDiopters: currentLag }
          : undefined,
      },
      microsaccade,
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
        <div className="flex items-center space-x-2 text-cyan-600 font-bold text-xs uppercase tracking-wider">
          <Target className="w-4 h-4" />
          <span>Step 3 of 6 • Live Webcam Pupil & Fixation Tracking</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 font-display">
          Real-Time Camera Pupil & Microsaccade BCEA Analyzer
        </h2>
        <p className="text-sm text-slate-600">
          Uses live camera computer vision to measure pupil micro-fluctuations and fixational stability. NPC and accommodative lag are entered separately because a standard webcam cannot measure them directly.
        </p>
      </div>

      {/* Camera Device Controls Header */}
      <div className="bg-slate-900 text-white p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${isCameraActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
            {isCameraActive ? `LIVE CAMERA TRACKING (${liveMetrics.fps} FPS)` : 'CAMERA INACTIVE'}
          </span>
          {isCameraActive && (
            <span className="text-[10px] bg-cyan-950 text-cyan-300 px-2.5 py-0.5 rounded-full border border-cyan-800 font-mono">
              Confidence: {liveMetrics.confidenceScore}%
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
              className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center space-x-2 transition-colors shadow-md shadow-cyan-600/30 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Enable Live Camera</span>
            </button>
          )}
        </div>
      </div>

      {cameraError && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-center space-x-3 text-amber-800 text-xs">
          <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
          <span>{cameraError}</span>
        </div>
      )}

      {/* Quality Indicators Panel */}
      {isCameraActive && (
        <QualityPanel
          lighting={liveMetrics.redReflexIntensity}
          fixation={currentBcea}
          focus={liveMetrics.blurVariance || 80}
          pupilTracking={liveMetrics.confidenceScore}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Live Video Feed & Computer Vision HUD */}
        <div className="lg:col-span-7 bg-slate-900 text-white p-6 rounded-3xl border border-slate-800 shadow-xl space-y-6 flex flex-col justify-between">
          {/* Interactive Target Canvas / Video Feed Container */}
          <div className="relative w-full h-72 sm:h-96 bg-black rounded-2xl border border-slate-800 flex items-center justify-center overflow-hidden">
            {/* Live Video Element */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover rounded-2xl scale-x-[-1] ${
                isCameraActive ? 'block' : 'hidden'
              }`}
            />

            {/* Live Computer Vision Overlay Canvas */}
            <canvas
              ref={overlayCanvasRef}
              className={`absolute inset-0 w-full h-full object-cover pointer-events-none scale-x-[-1] ${
                isCameraActive ? 'block' : 'hidden'
              }`}
            />

            {/* Fallback Simulator Screen if Camera Off */}
            {!isCameraActive && (
              <div className="absolute inset-0 bg-radial from-slate-900 via-slate-950 to-black flex flex-col items-center justify-center p-6 text-center space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-cyan-950/80 border border-cyan-800 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-500/10">
                  <Camera className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-base font-display">Live Webcam Eye Tracker</h4>
                  <p className="text-xs text-slate-400 max-w-sm mt-1">
                    Click "Enable Live Camera" above to perform real-time computer vision pupil detection and fixational jitter tracking.
                  </p>
                </div>
                <button
                  onClick={() => startCamera(selectedDeviceId)}
                  className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center space-x-2 shadow-lg shadow-cyan-600/30 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Turn On Camera Tracker</span>
                </button>
              </div>
            )}

            {/* Animated target overlay for the fixation exercise */}
            {isScanning && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div
                  className="transition-all duration-100 flex items-center justify-center rounded-full border-2 border-cyan-400 bg-cyan-500/20 shadow-2xl shadow-cyan-400/40"
                  style={{
                    width: `${Math.max(36, (40 - targetDistanceCm) * 7)}px`,
                    height: `${Math.max(36, (40 - targetDistanceCm) * 7)}px`,
                  }}
                >
                  <div className="w-4 h-4 rounded-full bg-cyan-300 animate-ping" />
                  <div className="absolute inset-0 border border-dashed border-cyan-200 rounded-full animate-spin duration-700" />
                </div>
              </div>
            )}

            {/* Scanning Overlay HUD */}
            <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">
              <div className="flex justify-between items-start text-[11px] font-mono text-cyan-300">
                <div className="bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800">
                  Distance: <span className="font-bold text-white">{targetDistanceCm} cm</span>
                </div>
                <div className="bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 flex items-center space-x-1.5">
                  <span>EAR:</span>
                  <span className="font-bold text-white">{liveMetrics.ear ? liveMetrics.ear.toFixed(2) : '0.28'}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                    liveMetrics.isBlinking
                      ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50 animate-pulse'
                      : liveMetrics.isObscured
                      ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                      : 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                  }`}>
                    {liveMetrics.isBlinking ? 'Blink' : liveMetrics.isObscured ? 'Obscured' : 'Open'}
                  </span>
                </div>
                <div className="bg-slate-900/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800">
                  Pupil: <span className="font-bold text-white">{liveMetrics.pupilDiameterMm} mm</span>
                </div>
              </div>

              {/* Progress Bar */}
              {isScanning && (
                <div className="w-full bg-slate-900/90 rounded-full h-2.5 overflow-hidden border border-slate-700 backdrop-blur-md">
                  <div
                    className="bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 h-full transition-all duration-100"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Action Trigger Button */}
          <button
            onClick={startScan}
            disabled={isScanning || !canProceed}
            className={`w-full py-3.5 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 transition-all shadow-xl cursor-pointer ${
              isScanning || !canProceed
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white hover:brightness-110 shadow-blue-500/20'
            }`}
          >
            {isScanning ? (
              <>
                <Activity className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Tracking Live Pupil & Fixation ({scanProgress}%)...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>{scanCompleted ? 'Re-run Live Camera Scan' : 'Execute Camera Pupil & Fixation Scan'}</span>
              </>
            )}
          </button>
        </div>

        {/* Right Column: Real-time Fixational Microsaccade Scatter & Metrics */}
        <div className="lg:col-span-5 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <h3 className="font-bold text-slate-900 text-base font-display flex items-center justify-between border-b border-slate-100 pb-2">
              <span>Fixational BCEA Ellipse Plot</span>
              <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-bold">
                Camera CV Stream
              </span>
            </h3>

            {/* Scatter Box */}
            <div className="relative w-full h-48 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-center overflow-hidden">
              {/* Axes */}
              <div className="absolute w-full h-px bg-slate-800" />
              <div className="absolute h-full w-px bg-slate-800" />

              {/* 95% Confidence Ellipse overlay visualization */}
              <div
                className="absolute border-2 border-indigo-500/60 bg-indigo-500/10 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(BCEA_ELLIPSE_MAX_WIDTH, Math.max(30, currentBcea * BCEA_ELLIPSE_WIDTH_SCALE))}px`,
                  height: `${Math.min(BCEA_ELLIPSE_MAX_HEIGHT, Math.max(24, currentBcea * BCEA_ELLIPSE_HEIGHT_SCALE))}px`,
                  transform: 'rotate(-12deg)',
                }}
              />

              {/* Scatter Points */}
              {livePoints.map((pt, i) => (
                <div
                  key={i}
                  className="absolute w-2 h-2 rounded-full bg-cyan-400 opacity-90 border border-cyan-200/60 shadow-xs shadow-cyan-400/50"
                  style={{
                    left: `calc(50% + ${Math.max(-SCATTER_PLOT_CLAMP_PX, Math.min(SCATTER_PLOT_CLAMP_PX, pt.x * SCATTER_PLOT_PIXELS_PER_DEGREE))}px)`,
                    top: `calc(50% + ${Math.max(-SCATTER_PLOT_CLAMP_PX, Math.min(SCATTER_PLOT_CLAMP_PX, pt.y * SCATTER_PLOT_PIXELS_PER_DEGREE))}px)`,
                  }}
                />
              ))}

              <div className="absolute bottom-2 right-2 text-[10px] font-mono text-slate-400">
                BCEA = {currentBcea.toFixed(2)} deg²
              </div>
            </div>

            {/* Extracted Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold text-slate-500">NPC (Convergence)</div>
                  <span
                    title="A standard webcam cannot directly measure vergence break or near point of convergence. Enter a self-reported value or one measured with a pen/push-up test."
                    className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full"
                  >
                    <Info className="w-3 h-3" /> Self-reported / not camera-measured
                  </span>
                </div>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="40"
                    step="0.5"
                    aria-label="Self-reported NPC in centimeters"
                    value={currentNpc}
                    onChange={(e) => {
                      const value = e.target.valueAsNumber;
                      setCurrentNpc(resolveManualAccommodativeInputs(value, currentLag).npcCm);
                    }}
                    className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-bold text-slate-900"
                  />
                  <span className="text-xs font-semibold text-slate-500">cm</span>
                </label>
                <div className={`text-[10px] font-bold mt-0.5 ${currentNpc <= NPC_NORMAL_THRESHOLD_CM ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {currentNpc <= NPC_NORMAL_THRESHOLD_CM ? `✓ Normal Convergence (≤${NPC_NORMAL_THRESHOLD_CM}cm)` : `⚠️ Insufficiency (>${NPC_NORMAL_THRESHOLD_CM}cm)`}
                </div>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold text-slate-500">Accommodative Lag</div>
                  <span
                    title="A standard webcam cannot directly measure accommodative response or lag. Enter a value only when supplied by an eye-care measurement; otherwise keep the neutral default."
                    className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full"
                  >
                    <Info className="w-3 h-3" /> Self-reported / not camera-measured
                  </span>
                </div>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="3"
                    step="0.05"
                    aria-label="Self-reported accommodative lag in diopters"
                    value={currentLag}
                    onChange={(e) => {
                      const value = e.target.valueAsNumber;
                      setCurrentLag(resolveManualAccommodativeInputs(currentNpc, value).accommodativeLagDiopters);
                    }}
                    className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-bold text-slate-900"
                  />
                  <span className="text-xs font-semibold text-slate-500">D</span>
                </label>
                <div className={`text-[10px] font-bold mt-0.5 ${currentLag <= ACCOMMODATIVE_LAG_NORMAL_THRESHOLD_D ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {currentLag <= ACCOMMODATIVE_LAG_NORMAL_THRESHOLD_D ? `✓ Normal Lag (≤+${ACCOMMODATIVE_LAG_NORMAL_THRESHOLD_D}D)` : `⚠️ Elevated Lag (>+${ACCOMMODATIVE_LAG_NORMAL_THRESHOLD_D}D)`}
                </div>
              </div>

              <div className="sm:col-span-2 bg-cyan-50 p-3.5 rounded-2xl border border-cyan-200/80 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold text-cyan-800">Pupil Micro-Fluctuation Fatigue</div>
                  <div className="text-[10px] text-cyan-700 mt-0.5">
                    Camera-derived HFF estimate from pupil-diameter variation during the scan.
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-cyan-950">{currentFatigue}/100</div>
                  <div className="text-[9px] font-semibold text-cyan-700">
                    {scanCompleted ? 'Measured this scan' : 'Previous / neutral value'}
                  </div>
                </div>
              </div>

              <div className="bg-indigo-50 p-3.5 rounded-2xl border border-indigo-200/80">
                <div className="text-[11px] font-semibold text-indigo-800">Microsaccade Frequency</div>
                <div className="mt-1 text-lg font-bold text-indigo-950">
                  {microsaccade.microsaccadeFrequencyHz.toFixed(2)} Hz
                </div>
                <div className="text-[9px] font-semibold text-indigo-700">
                  {microsaccade.microsaccadeFrequencyConfidence === 'MEASURED'
                    ? 'Engbert-Kliegl events from this scan'
                    : 'Low-confidence neutral fallback'}
                </div>
              </div>

              <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-200/80">
                <div className="text-[11px] font-semibold text-amber-800">Camera Vergence Proxy</div>
                <div className="mt-1 text-lg font-bold text-amber-950">
                  {cameraNpcProxyCm !== null ? `${cameraNpcProxyCm.toFixed(1)} cm` : 'No break detected'}
                </div>
                <div
                  className="text-[9px] font-semibold text-amber-700"
                  title="Estimated from change in the pixel distance between the eyes as the target approaches. This is not a clinical NPC measurement and does not replace the manual value above."
                >
                  Webcam convergence trend only; not clinical NPC
                </div>
              </div>
            </div>
          </div>

          {/* Nav Controls */}
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
                  saveManualMetrics();
                  onNext();
                }}
                disabled={!scanCompleted}
                className={`inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all cursor-pointer ${
                  scanCompleted
                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <span>Next: Photorefraction Scan</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          {!scanCompleted && (
            <p className="text-right text-[10px] font-medium text-amber-700">
              Complete a stable live-camera fixation scan before continuing. No simulated fixation points are used.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
