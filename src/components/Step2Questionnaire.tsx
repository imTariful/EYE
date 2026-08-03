import React from 'react';
import { PatientProfile } from '../types';
import { calculateThibosPowerVectors } from '../utils/opticsEngine';
import {
  User,
  Clock,
  Sun,
  Glasses,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';

interface Step2QuestionnaireProps {
  patient: PatientProfile;
  onChange: (updated: PatientProfile) => void;
  onNext: () => void;
  onBack: () => void;
}

type AcuityDirection = '↑' | '↓' | '←' | '→';

const ACUITY_LINES = [
  { denominator: '200', logMAR: 1.0, fontPx: 144 },
  { denominator: '100', logMAR: 0.7, fontPx: 112 },
  { denominator: '80', logMAR: 0.6, fontPx: 92 },
  { denominator: '70', logMAR: 0.54, fontPx: 80 },
  { denominator: '60', logMAR: 0.48, fontPx: 70 },
  { denominator: '50', logMAR: 0.4, fontPx: 60 },
  { denominator: '40', logMAR: 0.3, fontPx: 50 },
  { denominator: '30', logMAR: 0.18, fontPx: 40 },
  { denominator: '25', logMAR: 0.1, fontPx: 32 },
  { denominator: '20', logMAR: 0.0, fontPx: 26 },
] as const;

function acuityRotationDegrees(direction: AcuityDirection): number {
  // A normal capital E opens to the right.
  if (direction === '→') return 0;
  if (direction === '↓') return 90;
  if (direction === '←') return 180;
  return -90;
}

function randomAcuityDirection(): AcuityDirection {
  const directions: AcuityDirection[] = ['↑', '↓', '←', '→'];
  return directions[Math.floor(Math.random() * directions.length)];
}

export const Step2Questionnaire: React.FC<Step2QuestionnaireProps> = ({
  patient,
  onChange,
  onNext,
  onBack,
}) => {
  const [acuityLine, setAcuityLine] = React.useState(0);
  // Generate the E orientation once per displayed line. It must not change
  // merely because another questionnaire control caused a re-render.
  const [acuityDirection, setAcuityDirection] = React.useState<AcuityDirection>(() => randomAcuityDirection());

  const handleSymptomToggle = (key: keyof PatientProfile['symptoms']) => {
    onChange({
      ...patient,
      symptoms: {
        ...patient.symptoms,
        [key]: !patient.symptoms[key],
      },
    });
  };

  const handleAcuityResponse = (direction: AcuityDirection | 'TOO_BLURRY') => {
    const finishAcuityTest = (lineIndex: number, response: 'IDENTIFIED' | 'TOO_BLURRY' | 'INCORRECT') => {
      const line = ACUITY_LINES[lineIndex];
      onChange({
        ...patient,
        visualAcuity: {
          logMAR: line.logMAR,
          snellen: `20/${line.denominator}`,
          tested: true,
          response,
        },
      });
      setAcuityLine(0);
      setAcuityDirection(randomAcuityDirection());
    };

    if (direction === 'TOO_BLURRY') {
      // The previous line is the smallest one identified confidently. At the
      // first line, 20/200 is retained as this exercise's display limit.
      finishAcuityTest(Math.max(0, acuityLine - 1), 'TOO_BLURRY');
    } else if (direction === currentEDirection) {
      // Advance from large/easy symbols toward smaller/more difficult symbols.
      if (acuityLine < ACUITY_LINES.length - 1) {
        setAcuityLine(acuityLine + 1);
        setAcuityDirection(randomAcuityDirection());
      } else {
        finishAcuityTest(acuityLine, 'IDENTIFIED');
      }
    } else {
      finishAcuityTest(Math.max(0, acuityLine - 1), 'INCORRECT');
    }
  };

  const currentEDirection = acuityDirection;
  const prescription = patient.currentPrescription ?? {
    sphere: patient.currentDiopters ?? 0,
    cylinder: 0,
    axis: 0,
  };

  const updatePrescription = (field: 'sphere' | 'cylinder' | 'axis', value: number) => {
    const nextPrescription = {
      ...prescription,
      [field]: Number.isFinite(value) ? value : 0,
    };
    const powerVectors = calculateThibosPowerVectors(
      nextPrescription.sphere,
      nextPrescription.cylinder,
      nextPrescription.axis,
    );
    onChange({
      ...patient,
      currentDiopters: nextPrescription.sphere,
      currentPrescription: nextPrescription,
      currentPrescriptionPowerVectors: powerVectors,
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
        <div className="flex items-center space-x-2 text-blue-600 font-bold text-xs uppercase tracking-wider">
          <Sparkles className="w-4 h-4" />
          <span>Step 2 of 6 • Patient Profile & Behavioral Baseline</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 font-display">
          Demographics & Myopia Risk Questionnaire
        </h2>
        <p className="text-sm text-slate-600">
          Prior behavioral and genetic parameters establish the Bayesian baseline probability for our multi-modal fusion engine.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onNext();
        }}
        className="space-y-6"
      >
        {/* Section 1: Demographics & Genetics */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
          <h3 className="font-bold text-slate-900 text-lg font-display flex items-center space-x-2 border-b border-slate-100 pb-3">
            <User className="w-5 h-5 text-blue-600" />
            <span>Patient Demographics & Hereditary Factors</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Patient Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Patient Name / Identifier
              </label>
              <input
                type="text"
                value={patient.patientName}
                onChange={(e) => onChange({ ...patient, patientName: e.target.value })}
                placeholder="e.g. Alex Morgan"
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all"
              />
            </div>

            {/* Age */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Age (Years)
              </label>
              <input
                type="number"
                min={3}
                max={99}
                value={patient.age}
                onChange={(e) => onChange({ ...patient, age: parseInt(e.target.value) || 10 })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all"
              />
              <p className="text-[11px] text-slate-500 mt-1">Children &lt;12 have higher progression velocity.</p>
            </div>

            {/* Biological Gender */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Gender
              </label>
              <select
                value={patient.gender}
                onChange={(e) => onChange({ ...patient, gender: e.target.value as any })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all"
              >
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other / Unspecified</option>
              </select>
            </div>

            {/* Parents with Myopia */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-2">
                Biological Parents with Myopia (Nearsightedness)
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 0, label: 'Neither Parent (0)', desc: 'Low genetic susceptibility' },
                  { value: 1, label: 'One Parent (1)', desc: '2x increased risk' },
                  { value: 2, label: 'Both Parents (2)', desc: '5x increased risk' },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => onChange({ ...patient, parentsWithMyopia: opt.value as any })}
                    className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                      patient.parentsWithMyopia === opt.value
                        ? 'border-blue-600 bg-blue-50/70 text-blue-900 ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100/80 text-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs">{opt.label}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Behavioral Habits */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-6">
          <h3 className="font-bold text-slate-900 text-lg font-display flex items-center space-x-2 border-b border-slate-100 pb-3">
            <Clock className="w-5 h-5 text-indigo-600" />
            <span>Daily Visual Habits & Environmental Exposure</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Daily Screen Hours */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-700">
                <span>Daily Screen Hours (Smartphone/PC/Tablet)</span>
                <span className="font-bold text-indigo-600 text-sm">{patient.dailyScreenHours} hrs/day</span>
              </div>
              <input
                type="range"
                min={0}
                max={14}
                step={0.5}
                value={patient.dailyScreenHours}
                onChange={(e) => onChange({ ...patient, dailyScreenHours: parseFloat(e.target.value) })}
                className="w-full accent-indigo-600 cursor-pointer"
              />
              <p className="text-[11px] text-slate-500">Continuous near-work &gt; 4 hours increases accommodative strain.</p>
            </div>

            {/* Daily Outdoor Hours */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60 space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-slate-700">
                <span className="flex items-center space-x-1">
                  <Sun className="w-4 h-4 text-amber-500" />
                  <span>Daily Outdoor Daylight Exposure</span>
                </span>
                <span className="font-bold text-amber-600 text-sm">{patient.dailyOutdoorHours} hrs/day</span>
              </div>
              <input
                type="range"
                min={0}
                max={8}
                step={0.5}
                value={patient.dailyOutdoorHours}
                onChange={(e) => onChange({ ...patient, dailyOutdoorHours: parseFloat(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-500">2+ hours of outdoor daylight stimulates retinal dopamine, slowing eye elongation.</p>
            </div>

            {/* Reading Distance */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Typical Reading/Viewing Distance (cm)
              </label>
              <input
                type="number"
                min={10}
                max={60}
                value={patient.readingDistanceCm}
                onChange={(e) => onChange({ ...patient, readingDistanceCm: parseInt(e.target.value) || 30 })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all"
              />
              <p className="text-[11px] text-slate-500 mt-1">Recommended working distance is &gt; 30 cm.</p>
            </div>

            {/* Current Optical Wear */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Current Eyewear Correction
              </label>
              <select
                value={patient.currentGlasses}
                onChange={(e) => {
                  const currentGlasses = e.target.value as PatientProfile['currentGlasses'];
                  onChange({
                    ...patient,
                    currentGlasses,
                    ...(currentGlasses === 'NONE'
                      ? {
                          currentDiopters: undefined,
                          currentPrescription: undefined,
                          currentPrescriptionPowerVectors: undefined,
                        }
                      : {}),
                  });
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all"
              >
                <option value="NONE">None (Uncorrected)</option>
                <option value="MYOPIA">Glasses for Distance (Myopia)</option>
                <option value="HYPEROPIA">Glasses for Reading / Hyperopia</option>
              </select>
            </div>

            {patient.currentGlasses !== 'NONE' && (
              <div className="sm:col-span-2 bg-purple-50 p-4 rounded-2xl border border-purple-200/70 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-purple-950">Current Prescription (Optional)</div>
                  <p className="text-[11px] text-purple-700">
                    Enter values from an existing prescription. These are self-reported, not camera-measured.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="text-[11px] font-semibold text-slate-700">
                    Sphere (D)
                    <input
                      type="number"
                      step="0.25"
                      value={prescription.sphere}
                      onChange={(e) => updatePrescription('sphere', e.target.valueAsNumber)}
                      className="mt-1 w-full px-3 py-2 rounded-xl border border-purple-200 bg-white text-sm"
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700">
                    Cylinder (D)
                    <input
                      type="number"
                      step="0.25"
                      value={prescription.cylinder}
                      onChange={(e) => updatePrescription('cylinder', e.target.valueAsNumber)}
                      className="mt-1 w-full px-3 py-2 rounded-xl border border-purple-200 bg-white text-sm"
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700">
                    Axis (0-180°)
                    <input
                      type="number"
                      min="0"
                      max="180"
                      step="1"
                      value={prescription.axis}
                      onChange={(e) => updatePrescription('axis', Math.max(0, Math.min(180, e.target.valueAsNumber)))}
                      className="mt-1 w-full px-3 py-2 rounded-xl border border-purple-200 bg-white text-sm"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-mono text-purple-900">
                  <span className="px-2 py-1 rounded-lg bg-white border border-purple-200">M: {(patient.currentPrescriptionPowerVectors?.M ?? calculateThibosPowerVectors(prescription.sphere, prescription.cylinder, prescription.axis).M).toFixed(2)} D</span>
                  <span className="px-2 py-1 rounded-lg bg-white border border-purple-200">J0: {(patient.currentPrescriptionPowerVectors?.J0 ?? calculateThibosPowerVectors(prescription.sphere, prescription.cylinder, prescription.axis).J0).toFixed(2)} D</span>
                  <span className="px-2 py-1 rounded-lg bg-white border border-purple-200">J45: {(patient.currentPrescriptionPowerVectors?.J45 ?? calculateThibosPowerVectors(prescription.sphere, prescription.cylinder, prescription.axis).J45).toFixed(2)} D</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Visual Acuity Test (Snellen/LogMAR) */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
          <h3 className="font-bold text-slate-900 text-lg font-display flex items-center space-x-2 border-b border-slate-100 pb-3">
            <Glasses className="w-5 h-5 text-purple-600" />
            <span>Visual Acuity Test (Optional)</span>
          </h3>
          <p className="text-xs text-slate-600">
             This is an approximate visual-acuity screening exercise, not a clinical eye test. Stand about 6 feet (2 meters) from your screen and identify the direction of the "E" only when you are confident. If it looks blurred, choose “Too blurry”.
          </p>

          {!patient.visualAcuity?.tested ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Current Line Size:</span>
                <span className="text-xs font-bold text-purple-600">20/{ACUITY_LINES[acuityLine].denominator}</span>
              </div>
              
              <div className="bg-slate-900 rounded-2xl p-8 flex items-center justify-center min-h-[200px]">
                <div
                  className="text-white font-bold leading-none transform transition-all duration-300"
                  style={{
                    fontSize: `${ACUITY_LINES[acuityLine].fontPx}px`,
                    transform: `rotate(${acuityRotationDegrees(currentEDirection)}deg)`,
                  }}
                  aria-label={`Tumbling E, ${currentEDirection === '↑' ? 'up' : currentEDirection === '↓' ? 'down' : currentEDirection === '←' ? 'left' : 'right'}`}
                >
                  E
                </div>
              </div>

               <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { dir: '↑', label: 'Up' },
                  { dir: '↓', label: 'Down' },
                  { dir: '←', label: 'Left' },
                  { dir: '→', label: 'Right' },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.dir}
                    onClick={() => handleAcuityResponse(opt.dir as any)}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-purple-50 hover:border-purple-300 text-sm font-semibold transition-all cursor-pointer"
                  >
                    {opt.label}
                  </button>
                ))}
               </div>
               <button
                 type="button"
                 onClick={() => handleAcuityResponse('TOO_BLURRY')}
                 className="w-full p-3 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-sm font-semibold transition-all cursor-pointer"
               >
                 Too blurry / I can’t identify the E
               </button>
               <p className="text-[11px] text-slate-500 text-center">The exercise moves through 10 lines and reports an approximate screening result.</p>
            </div>
          ) : (
            <div className="bg-purple-50 p-4 rounded-2xl border border-purple-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-purple-900">Visual Acuity Recorded</div>
                  <div className="text-sm font-bold text-purple-700 mt-1">
                     Approx. {patient.visualAcuity.snellen} (LogMAR: {patient.visualAcuity.logMAR})
                     {patient.visualAcuity.response === 'TOO_BLURRY' && ' - stopped when the next line was too blurry'}
                     {patient.visualAcuity.response === 'INCORRECT' && ' - stopped after an incorrect direction'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onChange({
                      ...patient,
                      visualAcuity: undefined,
                    });
                    setAcuityLine(0);
                    setAcuityDirection(randomAcuityDirection());
                  }}
                  className="text-xs text-purple-600 hover:text-purple-800 underline cursor-pointer"
                >
                  Retest
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Reported Symptoms Checklist */}
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
          <h3 className="font-bold text-slate-900 text-lg font-display flex items-center space-x-2 border-b border-slate-100 pb-3">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <span>Reported Ocular Symptoms</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { key: 'eyeStrain', label: 'Eye Strain / Fatigue' },
              { key: 'frequentHeadaches', label: 'Frequent Headaches' },
              { key: 'distanceBlur', label: 'Distance Blurring' },
              { key: 'squintingToSee', label: 'Squinting to See Far' },
              { key: 'dryEyes', label: 'Dry / Irritated Eyes' },
            ].map((symptom) => {
              const isChecked = patient.symptoms[symptom.key as keyof PatientProfile['symptoms']];
              return (
                <button
                  type="button"
                  key={symptom.key}
                  onClick={() => handleSymptomToggle(symptom.key as keyof PatientProfile['symptoms'])}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-center space-x-3 ${
                    isChecked
                      ? 'border-amber-500 bg-amber-50/80 text-amber-950 font-semibold ring-1 ring-amber-400'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                      isChecked ? 'bg-amber-600 border-amber-600 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isChecked && <span className="text-[10px]">✓</span>}
                  </div>
                  <span className="text-xs">{symptom.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form Controls */}
        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <button
            type="submit"
            className="inline-flex items-center space-x-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm shadow-md shadow-blue-500/20 transition-all cursor-pointer"
          >
            <span>Proceed to Step 3: Vision Scan</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
};
