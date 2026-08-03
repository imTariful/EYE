import React, { useEffect, useRef, useState } from 'react';
import {
  PatientProfile,
  PhotorefractionData,
  AccommodativeData,
  MicrosaccadeData,
  RiskScoreResult,
} from '../types';
import { calculateMultiModalRisk } from '../utils/opticsEngine';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Cpu,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

interface Step5FusionProcessingProps {
  patient: PatientProfile;
  photorefraction: PhotorefractionData;
  accommodative: AccommodativeData;
  microsaccade: MicrosaccadeData;
  onCalculated: (result: RiskScoreResult) => void;
  onNext: () => void;
  onBack: () => void;
}

const STAGE_INTERVAL_MS = 600;

export const Step5FusionProcessing: React.FC<Step5FusionProcessingProps> = ({
  patient,
  photorefraction,
  accommodative,
  microsaccade,
  onCalculated,
  onNext,
  onBack,
}) => {
  const [calculationStep, setCalculationStep] = useState(0);
  const [riskResult, setRiskResult] = useState<RiskScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest onCalculated without forcing the effect to re-run
  // just because the parent passed a new function reference.
  const onCalculatedRef = useRef(onCalculated);
  onCalculatedRef.current = onCalculated;

  const STAGES = [
    {
      title: 'Establishing Prior Risk',
      desc: `Age (${patient.age}), Genetic Load (${patient.parentsWithMyopia} myopic parents), Outdoor vs Screen ratio.`,
    },
    {
      title: 'Integrating Photorefraction',
      desc: `Spherical Equivalent: ${photorefraction.sphericalEquivalentDiopters} D (${photorefraction.classification}).`,
    },
    {
      title: 'Evaluating Accommodative Strain',
      desc: `Accommodative Lag (+${accommodative.accommodativeLagDiopters} D), NPC (${accommodative.npcCm} cm).`,
    },
    {
      title: 'Processing Microsaccade BCEA',
      desc: `Fixational stability ellipse (${microsaccade.bceaDeg2} deg²).`,
    },
    {
      title: 'Bayesian Beta Distribution Convergence',
      desc: 'Prototype risk-index density computed successfully; this is not a calibrated clinical probability.',
    },
  ];
  const FINAL_STAGE = STAGES.length - 1;

  useEffect(() => {
    setError(null);
    setCalculationStep(0);
    setRiskResult(null);

    let result: RiskScoreResult;
    try {
      result = calculateMultiModalRisk(patient, photorefraction, accommodative, microsaccade);
    } catch (err) {
      console.error('Multi-modal risk calculation failed:', err);
      setError(
        'We could not compute a risk score from the collected data. Please go back and check the previous steps.'
      );
      return;
    }

    setRiskResult(result);
    onCalculatedRef.current(result);

    const timer = setInterval(() => {
      setCalculationStep((prev) => {
        if (prev >= FINAL_STAGE) {
          clearInterval(timer);
          return FINAL_STAGE;
        }
        return prev + 1;
      });
    }, STAGE_INTERVAL_MS);

    return () => clearInterval(timer);
    // Re-run whenever the underlying clinical inputs change, e.g. if the
    // user navigates back and edits a prior step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient, photorefraction, accommodative, microsaccade]);

  const isComplete = calculationStep >= FINAL_STAGE && !!riskResult;

  const handleFastForward = () => {
    if (!error) setCalculationStep(FINAL_STAGE);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
        <div className="flex items-center space-x-2 text-purple-600 font-bold text-xs uppercase tracking-wider">
          <Cpu className="w-4 h-4" />
          <span>Step 5 of 6 • Multi-Modal Fusion Engine</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 font-display">
          Bayesian Probabilistic Progression Analysis
        </h2>
        <p className="text-sm text-slate-600">
          Updating prior behavioral probabilities with likelihood evidence from physical optical,
          accommodative, and fixational scan parameters.
        </p>
      </div>

      {error ? (
        <div className="bg-white p-6 sm:p-8 rounded-3xl border border-red-200 shadow-xs space-y-4">
          <div className="flex items-start space-x-3 text-red-700">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <div className="font-bold text-sm">Calculation failed</div>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
          <button
            onClick={onBack}
            className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go back and review inputs</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left Column: Calculation Stages */}
          <div className="md:col-span-5 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider text-slate-500 pb-2 border-b border-slate-100">
              Bayesian Evidence Integration Pipeline
            </h3>

            <div
              className="space-y-3"
              aria-live="polite"
              role="list"
              aria-label="Calculation progress"
            >
              {STAGES.map((stage, idx) => {
                const isDone = calculationStep >= idx;
                const isCurrent = calculationStep === idx && !isComplete;

                return (
                  <div
                    key={stage.title}
                    role="listitem"
                    aria-current={isCurrent ? 'step' : undefined}
                    className={`p-3.5 rounded-2xl border transition-all flex items-start space-x-3 ${
                      isCurrent
                        ? 'border-purple-500 bg-purple-50/80 shadow-xs ring-1 ring-purple-400'
                        : isDone
                        ? 'border-slate-200 bg-slate-50/60'
                        : 'border-slate-100 bg-slate-50/30 opacity-50'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-purple-600" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-slate-300" />
                      )}
                    </div>

                    <div className="space-y-0.5">
                      <div className="font-bold text-xs text-slate-900">{stage.title}</div>
                      <div className="text-[11px] text-slate-500">{stage.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {!isComplete && (
              <button
                onClick={handleFastForward}
                className="w-full text-center text-[11px] font-semibold text-slate-400 hover:text-purple-600 transition-colors cursor-pointer pt-1"
              >
                Skip animation
              </button>
            )}
          </div>

          {/* Right Column: Probability Distribution Chart */}
          <div className="md:col-span-7 bg-slate-900 text-white p-6 rounded-3xl border border-slate-800 shadow-xl space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-purple-300 font-semibold uppercase tracking-wider flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>BETA PROBABILITY DENSITY CURVE</span>
                </span>

                {riskResult && (
                  <span className="text-xs font-bold text-purple-300 bg-purple-950/80 px-2.5 py-1 rounded-lg border border-purple-800">
                    Risk: {riskResult.overallRiskPercent}% ({riskResult.riskCategory})
                  </span>
                )}
              </div>

              {riskResult ? (
                <div className="w-full h-56 pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={riskResult.densityPoints}>
                      <defs>
                        <linearGradient id="colorPost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="colorPrior" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#64748b" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#64748b" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="riskPercent" stroke="#64748b" fontSize={10} unit="%" />
                      <YAxis stroke="#64748b" fontSize={10} hide />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          fontSize: '11px',
                        }}
                        formatter={(val: number, name: string) => [
                          `${val}%`,
                          name === 'posteriorProbability' ? 'Posterior Density' : 'Prior Density',
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="priorProbability"
                        stroke="#64748b"
                        strokeDasharray="3 3"
                        fillOpacity={1}
                        fill="url(#colorPrior)"
                      />
                      <Area
                        type="monotone"
                        dataKey="posteriorProbability"
                        stroke="#c084fc"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorPost)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="w-full h-56 flex items-center justify-center text-slate-500 text-xs">
                  Computing posterior distribution…
                </div>
              )}

              <div className="flex items-center justify-center space-x-6 text-xs text-slate-400">
                <div className="flex items-center space-x-2">
                  <span className="w-3 h-0.5 bg-slate-400 border border-dashed" />
                  <span>Behavioral Prior</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-3 h-1 bg-purple-400 rounded-full" />
                  <span>Multi-Modal Posterior Score</span>
                </div>
              </div>
            </div>

            {/* Navigation Controls */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <button
                onClick={onBack}
                className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl border border-slate-700 text-slate-300 font-semibold text-xs hover:bg-slate-800 transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <div className="flex flex-col items-end space-y-1">
                <button
                  onClick={onNext}
                  disabled={!isComplete}
                  aria-disabled={!isComplete}
                  title={!isComplete ? 'Finalizing analysis…' : undefined}
                  className={`inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-lg transition-all cursor-pointer ${
                    isComplete
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-500/20'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <span>View Complete Clinical Dashboard & AI Agent</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                {!isComplete && (
                  <span className="text-[10px] text-slate-500">Finalizing analysis…</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
