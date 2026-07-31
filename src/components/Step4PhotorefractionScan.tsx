import React, { useState, useEffect, useRef } from 'react';
import { PhotorefractionData } from '../types';
import { calculatePhotorefraction, calculateEyePhotorefraction, calculateAnisometropia } from '../utils/opticsEngine';
import { EyeTrackerEngine, PupilFrameResult } from '../utils/eyeTracker';
import { QualityPanel } from './QualityIndicator';
import {
  Camera,
  Zap,
  Sparkles,
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

interface Step4PhotorefractionScanProps {
  photorefraction: PhotorefractionData;
  onSave: (data: PhotorefractionData) => void;
  onNext: () => void;
  onBack: () => void;
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
  const [orientation, setOrientation] = useState<'TOP' | 'BOTTOM' | 'SYMMETRIC'>(
    photorefraction.crescentOrientation || 'TOP'
  );
  const [pupilDiameter, setPupilDiameter] = useState(photorefraction.pupilDiameterMm || 5.8);

  // Camera State
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedVideo, setUploadedVideo] = useState<string | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [uploadQualityScore, setUploadQualityScore] = useState<number | null>(null);
  const [uploadQualityMessage, setUploadQualityMessage] = useState<string>('');

  // Navigation Guard State
  const [stableFrameCount, setStableFrameCount] = useState(0);
  const [minFramesRequired] = useState(30);
  const [canProceed, setCanProceed] = useState(false);

  // Live Pupil Tracker Metrics
  const [liveMetrics, setLiveMetrics] = useState<PupilFrameResult>({
    detected: false,
    leftEye: null,
    rightEye: null,
    pupilDiameterMm: pupilDiameter,
    redReflexIntensity: 0.88,
    crescentRatio: crescentRatio,
    fps: 0,
    confidenceScore: 0,
  });

  const eyeTrackerRef = useRef<EyeTrackerEngine>(new EyeTrackerEngine());
  const animFrameRef = useRef<number | null>(null);

  // Calculate optical parameters
  const currentPhotoData = calculatePhotorefraction(
    crescentRatio,
    orientation,
    pupilDiameter,
    liveMetrics.redReflexIntensity || 0.88
  );

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
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
        setUploadedImage(null);
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      setCameraError('Camera access unavailable. You can upload an eye photo or use the interactive calibrator.');
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

  // Computer vision frame loop
  useEffect(() => {
    if (!isCameraActive || !videoRef.current || !overlayCanvasRef.current) return;

    const processLoop = () => {
      if (videoRef.current && overlayCanvasRef.current && isCameraActive) {
        const result = eyeTrackerRef.current.processFrame(
          videoRef.current,
          overlayCanvasRef.current,
          { drawMesh: true, flashActive: flashEffect }
        );
        setLiveMetrics(result);
        if (result.pupilDiameterMm) setPupilDiameter(result.pupilDiameterMm);
        if (result.crescentRatio) setCrescentRatio(result.crescentRatio);

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
      }
      animFrameRef.current = requestAnimationFrame(processLoop);
    };

    animFrameRef.current = requestAnimationFrame(processLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isCameraActive, flashEffect]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Trigger Flash Capture Simulation
  const handleFlashCapture = () => {
    if (isCameraActive && (liveMetrics.isBlinking || liveMetrics.isObscured)) {
      setCameraError('Scan paused: Eyes are closed or obscured (EAR < 0.13). Please open your eyes wide toward the camera to execute the scan.');
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
      
      // Calculate individual eye photorefraction
      const odData = calculateEyePhotorefraction({
        crescentRatio: liveMetrics.rightEye?.crescentRatio || crescentRatio,
        orientation: liveMetrics.rightEye?.crescentOrientation || orientation,
        pupilDiameterMm: liveMetrics.rightEye?.pupilDiameterMm || pupilDiameter,
        reflexRatio: liveMetrics.rightEye?.redReflexIntensity || liveMetrics.redReflexIntensity || 0.88,
      });

      const osData = calculateEyePhotorefraction({
        crescentRatio: liveMetrics.leftEye?.crescentRatio || crescentRatio,
        orientation: liveMetrics.leftEye?.crescentOrientation || orientation,
        pupilDiameterMm: liveMetrics.leftEye?.pupilDiameterMm || pupilDiameter,
        reflexRatio: liveMetrics.leftEye?.redReflexIntensity || liveMetrics.redReflexIntensity || 0.88,
      });

      // Calculate anisometropia
      const anisometropiaResult = calculateAnisometropia(
        odData.sphericalEquivalentDiopters,
        osData.sphericalEquivalentDiopters
      );

      // Update photorefraction data with individual eye metrics
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

    const startY = Math.max(1, 0);
    const endY = Math.min(imgData.height - 1, imgData.height);
    const startX = Math.max(1, 0);
    const endX = Math.min(width - 1, width);

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

    if (values.length === 0) return { score: 0, message: 'Unable to analyze', isAcceptable: false };

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const varSum = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0);
    const variance = varSum / values.length;

    // Quality thresholds based on Laplacian variance
    if (variance >= 100) {
      return { score: Math.round(variance), message: 'Excellent focus quality', isAcceptable: true };
    } else if (variance >= 60) {
      return { score: Math.round(variance), message: 'Good focus quality', isAcceptable: true };
    } else if (variance >= 30) {
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
        setUploadedImage(imageSrc);
        // Process through eye tracker for analysis
        if (videoRef.current) {
          videoRef.current.srcObject = null;
          videoRef.current.src = imageSrc;
          videoRef.current.loop = true;
          videoRef.current.play().then(() => {
            setIsCameraActive(true);
            setTimeout(() => {
              handleFlashCapture();
            }, 500);
          }).catch(() => {
            setIsProcessingUpload(false);
          });
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

  // Process uploaded video with frame sampling
  const processUploadedVideo = (videoSrc: string) => {
    setIsProcessingUpload(true);
    setUploadedVideo(videoSrc);
    
    const video = document.createElement('video');
    video.src = videoSrc;
    video.muted = true;
    video.playsInline = true;
    
    video.onloadedmetadata = () => {
      video.currentTime = 0;
      video.play();
      
      // Sample frames at 5 FPS for temporal aggregation
      const frameInterval = 1000 / 5;
      let frameCount = 0;
      const maxFrames = 30;
      
      const processFrame = () => {
        if (frameCount >= maxFrames || video.ended) {
          video.pause();
          setIsProcessingUpload(false);
          handleFlashCapture();
          return;
        }
        
        // Process current frame through eye tracker
        if (videoRef.current && overlayCanvasRef.current) {
          videoRef.current.srcObject = null;
          videoRef.current.src = videoSrc;
          videoRef.current.currentTime = video.currentTime;
          
          const result = eyeTrackerRef.current.processFrame(
            videoRef.current,
            overlayCanvasRef.current,
            { drawMesh: true, flashActive: false }
          );
          setLiveMetrics(result);
          if (result.pupilDiameterMm) setPupilDiameter(result.pupilDiameterMm);
          if (result.crescentRatio) setCrescentRatio(result.crescentRatio);
        }
        
        frameCount++;
        video.currentTime += frameInterval / 1000;
        setTimeout(processFrame, frameInterval);
      };
      
      processFrame();
    };
    
    video.onerror = () => {
      setIsProcessingUpload(false);
      setUploadQualityMessage('Failed to load video');
    };
  };

  // Upload image handler
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      stopCamera();
      setUploadedImage(null);
      setUploadedVideo(null);
      
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
          uploadQualityScore !== null && uploadQualityScore >= 30 
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' 
            : 'bg-amber-50 border border-amber-200 text-amber-800'
        }`}>
          {uploadQualityScore !== null && uploadQualityScore >= 30 ? (
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
                        width: `${pupilDiameter * 22}px`,
                        height: `${pupilDiameter * 22}px`,
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
                  onChange={(e) => setOrientation(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-1.5 text-xs"
                >
                  <option value="TOP">Top Crescent (Myopia)</option>
                  <option value="BOTTOM">Bottom Crescent (Hyperopia)</option>
                  <option value="SYMMETRIC">Symmetric / Minimal (Emmetropia)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Capture Trigger */}
          <button
            onClick={handleFlashCapture}
            disabled={isCapturing}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shadow-xl shadow-blue-600/30 hover:scale-[1.01] transition-all cursor-pointer"
          >
            {isCapturing ? (
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Zap className="w-4 h-4 text-amber-400 fill-current" />
            )}
            <span>{isCapturing ? 'Processing Retinoscopic Reflex...' : 'Execute Flash Photorefraction Scan'}</span>
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

              <div className="text-4xl font-extrabold font-display tracking-tight text-white">
                {currentPhotoData.sphericalEquivalentDiopters > 0 ? '+' : ''}
                {currentPhotoData.sphericalEquivalentDiopters.toFixed(2)} D
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-300 font-semibold">Refractive State:</span>
                <span className="font-bold text-cyan-400 bg-cyan-950/60 px-2.5 py-1 rounded-lg border border-cyan-800">
                  {currentPhotoData.classification.replace('_', ' ')}
                </span>
              </div>
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
  );
};
