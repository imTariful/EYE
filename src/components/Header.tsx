import React from 'react';
import { Eye, ShieldAlert, History, RefreshCw } from 'lucide-react';

interface HeaderProps {
  currentStep: number;
  onOpenHistory: () => void;
  onOpenDisclaimer: () => void;
  onResetScan: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentStep,
  onOpenHistory,
  onOpenDisclaimer,
  onResetScan,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center space-x-3 cursor-pointer" onClick={onResetScan}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
            <Eye className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-xl tracking-tight text-slate-900 font-display">
                Ocu<span className="text-blue-600">Risk</span>
              </span>
              <span className="px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase bg-blue-50 text-blue-700 rounded-full border border-blue-200/60">
                AI Screening
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden sm:block">
              Multi-Modal Photorefraction & Myopia Engine
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* New Scan Reset */}
          <button
            onClick={onResetScan}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors border border-slate-200/80"
            title="Start New Scan"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden lg:inline">New Scan</span>
          </button>

          {/* Saved History */}
          <button
            onClick={onOpenHistory}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors border border-slate-200"
          >
            <History className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline">History</span>
          </button>

          {/* Medical Disclaimer Modal trigger */}
          <button
            onClick={onOpenDisclaimer}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors border border-amber-200/80"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            <span className="hidden sm:inline">Disclaimer</span>
          </button>
        </div>
      </div>
    </header>
  );
};
