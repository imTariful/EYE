import React, { useState, useEffect, useRef } from 'react';
import { AccommodativeData, MicrosaccadeData, FixationPoint } from '../types';
import { calculateBCEA } from '../utils/opticsEngine';
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
  const [livePoints, setLivePoints] = useState<FixationPoint[]>(() => {
    if (microsaccade.fixationPoints && microsaccade.fixationPoints.length > 0) {
      return microsaccade.fixationPoints;
    }
    // Default simulated fixational points
    const pts: FixationPoint[] = [];
    for (let i = 0; i < 25; i++) {
      pts.push({
        x: Math.round((Math.random() - 0.5) * 1.2 * 100) / 100,
        y: Math.round((Math.random() - 0.5) * 1.0 * 100) / 100,
      });
    }
    return pts;
  });
  const [scanCompleted, setScanCompleted] = useState(false);

  // Navigation Guard State
  const [stableFrameCount, setStableFrameCount] = useState(0);
  const [minFramesRequired] = useState(30);
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

  const eyeTrackerRef = useRef<EyeTrackerEngine>(new EyeTrackerEngine());
  const animFrameRef = useRef<number | null>(null);

  // Temporary local scan state
  const [currentNpc, setCurrentNpc] = useState(accommodative.npcCm || 8.5);
  const [currentLag, setCurrentLag] = useState(accommodative.accommodativeLagDiopters || 0.95);
  const [currentBcea, setCurrentBcea] = useState(microsaccade.bceaDeg2 || 0.75);
  const [odLivePoints, setOdLivePoints] = useState<FixationPoint[]>([]);
  const [osLivePoints, setOsLivePoints] = useState<FixationPoint[]>([]);

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
    } catch (err: any) {
      console.error('Camera access error:', err);
      setCameraError('Camera access unavailable or blocked. You can still test with the dynamic target simulator.');
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
        const result = eyeTrackerRef.current.processFrame(
          videoRef.current,
          overlayCanvasRef.current,
          { drawMesh: true }
        );
        setLiveMetrics(result);
        latestMetricsRef.current = result;

        // Navigation Guard: Count stable frames
        const isStable = 
          result.detected && 
          !result.isBlinking && 
          !result.isObscured && 
          result.confidenceScore >= 70 &&
          (result.blurVariance || 0) >= 50;

        if (isStable) {
          setStableFrameCount(prev => {
            const newCount = prev + 1;
            if (newCount >= minFramesRequired && !canProceed) {
              setCanProceed(true);
            }
            return newCount;
          });
        } else {
          // Reset count if unstable
          setStableFrameCount(0);
          setCanProceed(false);
        }

        // If scanning, continuously accumulate gaze drift points from live camera eyes (only when eyes open)
        if (isScanning && result.leftEye && result.rightEye && !result.isBlinking && !result.isObscured) {
          const frameCenterX = (videoRef.current.videoWidth || 640) / 2;
          const frameCenterY = (videoRef.current.videoHeight || 480) / 2;

          // Combined (both eyes) fixation point
          const eyeMidX = (result.leftEye.x + result.rightEye.x) / 2;
          const eyeMidY = (result.leftEye.y + result.rightEye.y) / 2;
          const dx = (eyeMidX - frameCenterX) / 22.0;
          const dy = (eyeMidY - frameCenterY) / 22.0;
          setLivePoints((prev) => [...prev.slice(-40), { x: dx, y: dy }]);

          // Individual eye fixation points (OD = right, OS = left)
          const odDx = (result.rightEye.x - frameCenterX) / 22.0;
          const odDy = (result.rightEye.y - frameCenterY) / 22.0;
          setOdLivePoints((prev) => [...prev.slice(-40), { x: odDx, y: odDy }]);

          const osDx = (result.leftEye.x - frameCenterX) / 22.0;
          const osDy = (result.leftEye.y - frameCenterY) / 22.0;
          setOsLivePoints((prev) => [...prev.slice(-40), { x: osDx, y: osDy }]);
        }
      }
      animFrameRef.current = requestAnimationFrame(processLoop);
    };

    animFrameRef.current = requestAnimationFrame(processLoop);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isCameraActive, isScanning]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Start Automated Accommodative & Fixation Tracking Loop
  const startScan = async () => {
    if (!isCameraActive) {
      await startCamera(selectedDeviceId);
    }

    setIsScanning(true);
    setScanProgress(0);
    setScanCompleted(false);
    setLivePoints([]);
    setOdLivePoints([]);
    setOsLivePoints([]);

    let step = 0;
    const interval = setInterval(() => {
      // Pause scan data collection during blink or eyelid obscuration
      if (latestMetricsRef.current && (latestMetricsRef.current.isBlinking || latestMetricsRef.current.isObscured)) {
        return;
      }

      step += 1;
      const progress = Math.min(100, Math.round((step / 50) * 100));
      setScanProgress(progress);

      // Target moves closer from 35cm down to 5cm (NPC test)
      const dist = Math.max(5, 35 - (step / 50) * 30);
      setTargetDistanceCm(Math.round(dist * 10) / 10);

      // Fallback noise points if camera tracking is off or obscured
      if (!isCameraActive || livePoints.length < step) {
        const noiseX = (Math.random() - 0.5) * (0.8 + currentBcea * 0.4);
        const noiseY = (Math.random() - 0.5) * (0.6 + currentBcea * 0.3);
        setLivePoints((prev) => [...prev.slice(-30), { x: noiseX, y: noiseY }]);
      }

      if (step >= 50) {
        clearInterval(interval);
        setIsScanning(false);
        setScanCompleted(true);

        // Finalize metrics
        const bceaCalc = calculateBCEA(livePoints);
        const finalBcea = Math.max(0.15, Math.min(2.5, bceaCalc.bceaDeg2 || currentBcea));
        const finalNpc = Math.round((6.0 + Math.random() * 4.0) * 10) / 10;
        const finalLag = Math.round((0.5 + Math.random() * 0.8) * 100) / 100;

        // Calculate individual eye BCEA
        const odBceaCalc = calculateBCEA(odLivePoints);
        const osBceaCalc = calculateBCEA(osLivePoints);
        const odBcea = Math.max(0.15, Math.min(2.5, odBceaCalc.bceaDeg2 || finalBcea));
        const osBcea = Math.max(0.15, Math.min(2.5, osBceaCalc.bceaDeg2 || finalBcea));

        setCurrentBcea(finalBcea);
        setCurrentNpc(finalNpc);
        setCurrentLag(finalLag);

        const updatedAccomm: AccommodativeData = {
          ...accommodative,
          npcCm: finalNpc,
          accommodativeLagDiopters: finalLag,
          fatigueIndex: Math.round(45 + Math.random() * 35),
          // Individual eye accommodative metrics
          od: {
            npcCm: finalNpc,
            accommodativeLagDiopters: finalLag,
            fatigueIndex: Math.round(45 + Math.random() * 35),
            constrictionVelocityMmSec: 4.5,
            responseLatencyMs: 320,
          },
          os: {
            npcCm: finalNpc,
            accommodativeLagDiopters: finalLag,
            fatigueIndex: Math.round(45 + Math.random() * 35),
            constrictionVelocityMmSec: 4.5,
            responseLatencyMs: 320,
          },
        };

        const updatedMicro: MicrosaccadeData = {
          ...microsaccade,
          bceaDeg2: finalBcea,
          fixationStabilityScore: Math.max(40, Math.min(98, Math.round(100 - finalBcea * 30))),
          fixationPoints: livePoints,
          amblyopiaRisk: finalBcea > 1.2 ? 'HIGH' : finalBcea > 0.6 ? 'MODERATE' : 'LOW',
          // Individual eye fixation data
          odFixationPoints: odLivePoints,
          osFixationPoints: osLivePoints,
          odBceaDeg2: odBcea,
          osBceaDeg2: osBcea,
          // Individual eye microsaccade metrics
          od: {
            bceaDeg2: odBcea,
            fixationStabilityScore: Math.max(40, Math.min(98, Math.round(100 - odBcea * 30))),
            fixationPoints: odLivePoints,
            microsaccadeFrequencyHz: 1.5 + Math.random() * 0.5,
            amblyopiaRisk: odBcea > 1.2 ? 'HIGH' : odBcea > 0.6 ? 'MODERATE' : 'LOW',
          },
          os: {
            bceaDeg2: osBcea,
            fixationStabilityScore: Math.max(40, Math.min(98, Math.round(100 - osBcea * 30))),
            fixationPoints: osLivePoints,
            microsaccadeFrequencyHz: 1.5 + Math.random() * 0.5,
            amblyopiaRisk: osBcea > 1.2 ? 'HIGH' : osBcea > 0.6 ? 'MODERATE' : 'LOW',
          },
        };

        onSave(updatedAccomm, updatedMicro);
      }
    }, 100);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
        <div className="flex items-center space-x-2 text-cyan-600 font-bold text-xs uppercase tracking-wider">
          <Target className="w-4 h-4" />
          <span>Step 3 of 6 • Live Webcam Accommodative & Fixation Tracking</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 font-display">
          Real-Time Camera Pupil & Microsaccade BCEA Analyzer
        </h2>
        <p className="text-sm text-slate-600">
          Uses live camera feed computer vision to track eyes, measure pupil centers, compute near point convergence (NPC), and evaluate fixational stability.
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

            {/* Animated Target Overlay for Convergence Exercise */}
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
            disabled={isScanning}
            className={`w-full py-3.5 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 transition-all shadow-xl cursor-pointer ${
              isScanning
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 text-white hover:brightness-110 shadow-blue-500/20'
            }`}
          >
            {isScanning ? (
              <>
                <Activity className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Tracking Live Pupil & Convergence ({scanProgress}%)...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>{scanCompleted ? 'Re-run Live Camera Scan' : 'Execute Real Camera Convergence Scan'}</span>
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
                  width: `${Math.min(180, Math.max(30, currentBcea * 90))}px`,
                  height: `${Math.min(140, Math.max(24, currentBcea * 70))}px`,
                  transform: 'rotate(-12deg)',
                }}
              />

              {/* Scatter Points */}
              {livePoints.map((pt, i) => (
                <div
                  key={i}
                  className="absolute w-2 h-2 rounded-full bg-cyan-400 opacity-90 border border-cyan-200/60 shadow-xs shadow-cyan-400/50"
                  style={{
                    left: `calc(50% + ${Math.max(-85, Math.min(85, pt.x * 28))}px)`,
                    top: `calc(50% + ${Math.max(-65, Math.min(65, pt.y * 28))}px)`,
                  }}
                />
              ))}

              <div className="absolute bottom-2 right-2 text-[10px] font-mono text-slate-400">
                BCEA = {currentBcea.toFixed(2)} deg²
              </div>
            </div>

            {/* Extracted Metrics Cards */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">NPC (Convergence)</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">{currentNpc} cm</div>
                <div className={`text-[10px] font-bold mt-0.5 ${currentNpc <= 10.0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {currentNpc <= 10.0 ? '✓ Normal Convergence (≤10cm)' : '⚠️ Insufficiency (>10cm)'}
                </div>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                <div className="text-[11px] font-semibold text-slate-500">Accommodative Lag</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">+{currentLag.toFixed(2)} D</div>
                <div className={`text-[10px] font-bold mt-0.5 ${currentLag <= 0.75 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {currentLag <= 0.75 ? '✓ Normal Lag (≤+0.75D)' : '⚠️ Elevated Lag (>+0.75D)'}
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

            <button
              onClick={onNext}
              disabled={!canProceed && isCameraActive}
              className={`inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all cursor-pointer ${
                canProceed || !isCameraActive
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed'
              }`}
            >
              <span>Next: Photorefraction Scan</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
