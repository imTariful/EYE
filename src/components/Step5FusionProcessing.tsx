import React, { useState, useEffect } from 'react';
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
import { Cpu, ArrowRight, ArrowLeft, CheckCircle2, Sparkles, Activity } from 'lucide-react';

interface Step5FusionProcessingProps {
  patient: PatientProfile;
  photorefraction: PhotorefractionData;
  accommodative: AccommodativeData;
  microsaccade: MicrosaccadeData;
  onCalculated: (result: RiskScoreResult) => void;
  onNext: () => void;
  onBack: () => void;
}

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

  useEffect(() => {
    // Run Bayesian fusion calculations
    const result = calculateMultiModalRisk(patient, photorefraction, accommodative, microsaccade);
    setRiskResult(result);
    onCalculated(result);

    // Animate calculation steps
    const timer = setInterval(() => {
      setCalculationStep((prev) => {
        if (prev >= 4) {
          clearInterval(timer);
          return 4;
        }
        return prev + 1;
      });
    }, 600);

    return () => clearInterval(timer);
  }, []);

  const STAGES = [
    { title: 'Establishing Prior Risk', desc: `Age (${patient.age}), Genetic Load (${patient.parentsWithMyopia} myopic parents), Outdoor vs Screen ratio.` },
    { title: 'Integrating Photorefraction', desc: `Spherical Equivalent: ${photorefraction.sphericalEquivalentDiopters} D (${photorefraction.classification}).` },
    { title: 'Evaluating Accommodative Strain', desc: `Accommodative Lag (+${accommodative.accommodativeLagDiopters} D), NPC (${accommodative.npcCm} cm).` },
    { title: 'Processing Microsaccade BCEA', desc: `Fixational stability ellipse (${microsaccade.bceaDeg2} deg²).` },
    { title: 'Bayesian Beta Distribution Convergence', desc: 'Posterior probability density computed successfully.' },
  ];

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
          Updating prior behavioral probabilities with likelihood evidence from physical optical, accommodative, and fixational scan parameters.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Column: Calculation Stages */}
        <div className="md:col-span-5 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
          <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider text-slate-500 pb-2 border-b border-slate-100">
            Bayesian Evidence Integration Pipeline
          </h3>

          <div className="space-y-3">
            {STAGES.map((stage, idx) => {
              const isDone = calculationStep >= idx;
              const isCurrent = calculationStep === idx;

              return (
                <div
                  key={idx}
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

            {/* Recharts Area Chart */}
            {riskResult && (
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
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '11px' }}
                      formatter={(val: any, name: any) => [`${val}%`, name === 'posteriorProbability' ? 'Posterior Density' : 'Prior Density']}
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

            <button
              onClick={onNext}
              disabled={calculationStep < 4}
              className={`inline-flex items-center space-x-2 px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm shadow-lg transition-all cursor-pointer ${
                calculationStep >= 4
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-500/20'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <span>View Complete Clinical Dashboard & AI Agent</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
