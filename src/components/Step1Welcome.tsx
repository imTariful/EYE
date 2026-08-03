import React from 'react';
import {
  Eye,
  Camera,
  Target,
  BrainCircuit,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Check,
} from 'lucide-react';

interface Step1WelcomeProps {
  onStart: () => void;
}

export const Step1Welcome: React.FC<Step1WelcomeProps> = ({ onStart }) => {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Hero Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white p-8 sm:p-10 shadow-2xl border border-slate-700/50">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-6">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 text-blue-300 text-xs font-semibold backdrop-blur-md">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span>Research Screening Prototype • Smartphone Photorefraction</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white font-display leading-tight">
            Early Refractive Screening & <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-300">Myopia Risk Engine</span>
          </h1>

          <p className="text-slate-300 text-base sm:text-lg leading-relaxed font-normal max-w-2xl">
            OcuRisk is a research screening prototype that uses a consumer camera to analyze pupillary red-reflex crescents and fixation signals, then combines them with questionnaire and manual inputs to estimate myopia risk.
          </p>

          <div className="pt-2 flex flex-wrap gap-4 items-center">
            <button
              onClick={onStart}
              className="inline-flex items-center space-x-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-500 hover:to-indigo-500 text-white font-bold px-7 py-3.5 rounded-2xl shadow-xl shadow-blue-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer text-sm sm:text-base"
            >
              <span>Begin Guided 6-Step Scan</span>
              <ArrowRight className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-800/80 px-4 py-3 rounded-2xl border border-slate-700/60">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Non-invasive • Local Camera CV • Optional Gemini Features</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4 Core Technology Pillars */}
      <div>
        <div className="text-center max-w-xl mx-auto mb-8 space-y-2">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight font-display">
            Multi-Modal Ophthalmic Architecture
          </h2>
          <p className="text-sm text-slate-600">
            Browser computer vision and prototype Bayesian risk modeling
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Pillar 1 */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all space-y-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Camera className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-base">1. AI Photorefraction</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Analyzes pupil red reflex and crescent height patterns under LED flash to estimate spherical equivalent refractive error in Diopters (D).
            </p>
            <div className="pt-2 flex items-center text-[11px] font-semibold text-blue-700 space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Crescent Geometry Analysis</span>
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all space-y-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-600">
              <Target className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-base">2. Accommodative Testing</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Measures pupil micro-fluctuation and fixation signals while keeping NPC and accommodative lag as clearly labelled manual inputs. A camera vergence trend may be shown only as a non-clinical proxy.
            </p>
            <div className="pt-2 flex items-center text-[11px] font-semibold text-cyan-700 space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Dynamic Pupillary Tracking</span>
            </div>
          </div>

          {/* Pillar 3 */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all space-y-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <Eye className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-base">3. Microsaccade BCEA</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Computes Bivariate Contour Ellipse Area (BCEA in deg²) and an event-frequency estimate from short video fixations as screening indicators of fixation stability.
            </p>
            <div className="pt-2 flex items-center text-[11px] font-semibold text-indigo-700 space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Fixational Stability Ellipse</span>
            </div>
          </div>

          {/* Pillar 4 */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all space-y-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900 text-base">4. Bayesian Fusion Engine</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Synthesizes physical scans with genetic factors and daily screen/outdoor habits into a 12-month Myopia Progression Probability curve.
            </p>
            <div className="pt-2 flex items-center text-[11px] font-semibold text-purple-700 space-x-1">
              <Check className="w-3.5 h-3.5" />
              <span>Beta-Bernoulli Conjugate Risk</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
