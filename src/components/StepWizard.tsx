import React from 'react';
import { Step } from '../types';
import {
  Sparkles,
  ClipboardList,
  Target,
  Camera,
  Cpu,
  FileCheck2,
  CheckCircle2,
} from 'lucide-react';

interface StepWizardProps {
  currentStep: Step;
  onStepClick: (step: Step) => void;
  completedSteps: Set<number>;
}

const STEPS: { number: Step; title: string; subtitle: string; icon: React.FC<{ className?: string }> }[] = [
  { number: 1, title: 'Welcome', subtitle: 'Overview', icon: Sparkles },
  { number: 2, title: 'Questionnaire', subtitle: 'Behavior & History', icon: ClipboardList },
  { number: 3, title: 'Vision Scan', subtitle: 'Accommodative & BCEA', icon: Target },
  { number: 4, title: 'Photorefraction', subtitle: 'Pupil & Reflex', icon: Camera },
  { number: 5, title: 'Fusion Engine', subtitle: 'Bayesian Update', icon: Cpu },
  { number: 6, title: 'Results', subtitle: 'Report & AI Agent', icon: FileCheck2 },
];

export const StepWizard: React.FC<StepWizardProps> = ({
  currentStep,
  onStepClick,
  completedSteps,
}) => {
  return (
    <nav className="bg-slate-900 text-white py-4 px-4 sm:px-6 border-b border-slate-800 shadow-inner">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between overflow-x-auto no-scrollbar space-x-2 sm:space-x-4 py-1">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = currentStep === step.number;
            const isCompleted = completedSteps.has(step.number);
            const isClickable = isCompleted || step.number <= currentStep;

            return (
              <React.Fragment key={step.number}>
                <button
                  onClick={() => isClickable && onStepClick(step.number)}
                  disabled={!isClickable}
                  className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl text-left transition-all shrink-0 ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30 font-semibold ring-2 ring-blue-400/50'
                      : isCompleted
                      ? 'bg-slate-800/80 hover:bg-slate-800 text-slate-200 cursor-pointer'
                      : 'bg-slate-950/40 text-slate-500 cursor-not-allowed opacity-60'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-white text-blue-600'
                        : isCompleted
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isCompleted && !isActive ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>

                  <div className="text-left hidden md:block">
                    <div className="text-xs font-semibold leading-none">{step.title}</div>
                    <div
                      className={`text-[10px] mt-1 leading-none ${
                        isActive ? 'text-blue-100' : 'text-slate-400'
                      }`}
                    >
                      {step.subtitle}
                    </div>
                  </div>
                </button>

                {/* Arrow connector */}
                {idx < STEPS.length - 1 && (
                  <div className="hidden lg:block w-4 h-0.5 bg-slate-800 shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
