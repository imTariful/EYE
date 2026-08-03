import React, { useState, useEffect, useRef } from 'react';
import {
  Step,
  PatientProfile,
  PhotorefractionData,
  AccommodativeData,
  MicrosaccadeData,
  RiskScoreResult,
  ScanSession,
} from './types';
import { calculatePhotorefraction, calculateMultiModalRisk } from './utils/opticsEngine';

import { Header } from './components/Header';
import { StepWizard } from './components/StepWizard';
import { Step1Welcome } from './components/Step1Welcome';
import { Step2Questionnaire } from './components/Step2Questionnaire';
import { Step3AccommodativeScan } from './components/Step3AccommodativeScan';
import { Step4PhotorefractionScan } from './components/Step4PhotorefractionScan';
import { Step5FusionProcessing } from './components/Step5FusionProcessing';
import { Step6ResultsReport } from './components/Step6ResultsReport';
import { HistoryDrawer } from './components/HistoryDrawer';
import { MedicalDisclaimerModal } from './components/MedicalDisclaimerModal';

const DEFAULT_PATIENT: PatientProfile = {
  patientName: 'Alex Morgan',
  age: 10,
  gender: 'MALE',
  parentsWithMyopia: 1,
  dailyScreenHours: 5.5,
  dailyOutdoorHours: 1.0,
  readingDistanceCm: 25,
  currentGlasses: 'NONE',
  symptoms: {
    eyeStrain: true,
    frequentHeadaches: false,
    distanceBlur: true,
    squintingToSee: true,
    dryEyes: false,
  },
};

const DEFAULT_PHOTOREFRACTION = calculatePhotorefraction(0.28, 'TOP', 5.5, 0.85);

const DEFAULT_ACCOMMODATIVE: AccommodativeData = {
  npcCm: 8.5,
  accommodativeLagDiopters: 1.15,
  fatigueIndex: 68,
  constrictionVelocityMmSec: 3.5,
  responseLatencyMs: 310,
};

const DEFAULT_MICROSACCADE: MicrosaccadeData = {
  bceaDeg2: 0.82,
  fixationStabilityScore: 72,
  microsaccadeFrequencyHz: 1.5,
  microsaccadeFrequencyConfidence: 'LOW',
  fixationPoints: [],
  amblyopiaRisk: 'MODERATE',
};

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set([1]));

  const [patient, setPatient] = useState<PatientProfile>(DEFAULT_PATIENT);
  const [photorefraction, setPhotorefraction] = useState<PhotorefractionData>(DEFAULT_PHOTOREFRACTION);
  const [accommodative, setAccommodative] = useState<AccommodativeData>(DEFAULT_ACCOMMODATIVE);
  const [microsaccade, setMicrosaccade] = useState<MicrosaccadeData>(DEFAULT_MICROSACCADE);
  const [riskResult, setRiskResult] = useState<RiskScoreResult>(() =>
    calculateMultiModalRisk(DEFAULT_PATIENT, DEFAULT_PHOTOREFRACTION, DEFAULT_ACCOMMODATIVE, DEFAULT_MICROSACCADE)
  );

  const [history, setHistory] = useState<ScanSession[]>(() => {
    try {
      const saved = localStorage.getItem('ocurisk_scan_history');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
    return [];
  });

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const restoringRef = useRef(false);

  // Save scan session to history when Step 6 is reached
  useEffect(() => {
    if (currentStep === 6 && !restoringRef.current) {
      const session: ScanSession = {
        id: `scan-${Date.now()}`,
        createdAt: new Date().toISOString(),
        patient,
        photorefraction,
        accommodative,
        microsaccade,
        riskResult,
      };

      setHistory((prev) => {
        const updated = [session, ...prev.filter((s) => s.id !== session.id)].slice(0, 20);
        try {
          localStorage.setItem('ocurisk_scan_history', JSON.stringify(updated));
        } catch (e) {
          console.warn('LocalStorage save error:', e);
        }
        return updated;
      });
    }
    // Reset the restoring flag after the effect runs
    if (restoringRef.current) {
      restoringRef.current = false;
    }
  }, [currentStep]);

  const handleResetScan = () => {
    setDemoMode(false);
    setPatient(DEFAULT_PATIENT);
    setPhotorefraction(calculatePhotorefraction(0.28, 'TOP', 5.8, 0.88));
    setAccommodative(DEFAULT_ACCOMMODATIVE);
    setMicrosaccade(DEFAULT_MICROSACCADE);
    setCompletedSteps(new Set([1]));
    setCurrentStep(1);
  };

  const handleLoadDemo = () => {
    const photo = calculatePhotorefraction(0.28, 'TOP', 5.5, 0.85);
    setDemoMode(true);
    setPatient(DEFAULT_PATIENT);
    setPhotorefraction(photo);
    setAccommodative(DEFAULT_ACCOMMODATIVE);
    setMicrosaccade(DEFAULT_MICROSACCADE);
    setRiskResult(calculateMultiModalRisk(DEFAULT_PATIENT, photo, DEFAULT_ACCOMMODATIVE, DEFAULT_MICROSACCADE));
    setCompletedSteps(new Set([1, 2, 3, 4, 5, 6]));
    setCurrentStep(6);
  };

  const handleSelectSession = (session: ScanSession) => {
    restoringRef.current = true;
    setDemoMode(session.demoMode ?? false);
    setPatient(session.patient);
    setPhotorefraction(session.photorefraction);
    setAccommodative(session.accommodative);
    setMicrosaccade(session.microsaccade);
    setRiskResult(session.riskResult);

    setCompletedSteps(new Set([1, 2, 3, 4, 5, 6]));
    setCurrentStep(6);
  };

  const handleStepChange = (targetStep: Step) => {
    setCurrentStep(targetStep);
  };

  const currentSession: ScanSession = {
    id: `scan-${patient.patientName.toLowerCase().replace(/\s+/g, '-')}`,
    createdAt: new Date().toISOString(),
    patient,
    photorefraction,
    accommodative,
    microsaccade,
    riskResult,
    demoMode,
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-500 selection:text-white flex flex-col justify-between">
      <div>
        {/* Top Header */}
        <Header
          currentStep={currentStep}
          onOpenHistory={() => setIsHistoryOpen(true)}
          onOpenDisclaimer={() => setIsDisclaimerOpen(true)}
          onResetScan={handleResetScan}
        />

        {/* Step Wizard Navigation Bar */}
        <StepWizard
          currentStep={currentStep}
          onStepClick={handleStepChange}
          completedSteps={completedSteps}
        />

        {/* Main Step Body Workspace */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {currentStep === 1 && (
            <Step1Welcome
              onStart={() => {
                setDemoMode(false);
                setCompletedSteps((prev) => new Set([...prev, 1, 2]));
                setCurrentStep(2);
              }}
              onLoadDemo={handleLoadDemo}
            />
          )}

          {currentStep === 2 && (
            <Step2Questionnaire
              patient={patient}
              onChange={setPatient}
              onNext={() => {
                setCompletedSteps((prev) => new Set([...prev, 2, 3]));
                setCurrentStep(3);
              }}
              onBack={() => setCurrentStep(1)}
            />
          )}

          {currentStep === 3 && (
            <Step3AccommodativeScan
              accommodative={accommodative}
              microsaccade={microsaccade}
              onSave={(acc, mic) => {
                setAccommodative(acc);
                setMicrosaccade(mic);
              }}
              onNext={() => {
                setCompletedSteps((prev) => new Set([...prev, 3, 4]));
                setCurrentStep(4);
              }}
              onBack={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 4 && (
            <Step4PhotorefractionScan
              patient={patient}
              photorefraction={photorefraction}
              onSave={setPhotorefraction}
              onNext={() => {
                setCompletedSteps((prev) => new Set([...prev, 4, 5]));
                setCurrentStep(5);
              }}
              onBack={() => setCurrentStep(3)}
            />
          )}

          {currentStep === 5 && (
            <Step5FusionProcessing
              patient={patient}
              photorefraction={photorefraction}
              accommodative={accommodative}
              microsaccade={microsaccade}
              onCalculated={setRiskResult}
              onNext={() => {
                setCompletedSteps((prev) => new Set([...prev, 5, 6]));
                setCurrentStep(6);
              }}
              onBack={() => setCurrentStep(4)}
            />
          )}

          {currentStep === 6 && (
            <Step6ResultsReport session={currentSession} onResetScan={handleResetScan} />
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <span className="font-bold text-slate-800 font-display">OcuRisk AI v2.5</span> • Smartphone Multi-Modal Ophthalmic Screening
          </div>
          <div className="flex items-center space-x-4 text-[11px]">
            <button onClick={() => setIsDisclaimerOpen(true)} className="hover:text-slate-800 underline cursor-pointer">
              Medical Disclaimer
            </button>
            <span>•</span>
            <span>Powered by MediaPipe + Browser Computer Vision</span>
          </div>
        </div>
      </footer>

      {/* Slide-over History Drawer */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onSelectSession={handleSelectSession}
        onClearHistory={() => {
          setHistory([]);
          localStorage.removeItem('ocurisk_scan_history');
        }}
      />

      {/* Medical Safety Disclaimer Modal */}
      <MedicalDisclaimerModal isOpen={isDisclaimerOpen} onClose={() => setIsDisclaimerOpen(false)} />
    </div>
  );
}
