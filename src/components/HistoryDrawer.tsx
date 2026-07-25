import React from 'react';
import { ScanSession } from '../types';
import { History, X, Eye, ArrowRight, Trash2 } from 'lucide-react';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  history: ScanSession[];
  onSelectSession: (session: ScanSession) => void;
  onClearHistory: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  history,
  onSelectSession,
  onClearHistory,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="bg-white text-slate-900 w-full max-w-md h-full p-6 space-y-6 shadow-2xl flex flex-col justify-between overflow-y-auto">
        <div className="space-y-6">
          <div className="flex justify-between items-center border-b border-slate-100 pb-4">
            <div className="flex items-center space-x-2">
              <History className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold text-lg font-display text-slate-900">Saved Vision Scans</h3>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {history.length === 0 ? (
            <div className="text-center py-12 text-slate-500 space-y-2">
              <Eye className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-medium">No saved scans found.</p>
              <p className="text-xs text-slate-400">Complete a 6-step screening to log session results.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    onSelectSession(s);
                    onClose();
                  }}
                  className="p-4 rounded-2xl border border-slate-200/80 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group space-y-2 bg-slate-50/50"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-900 text-sm group-hover:text-blue-600 transition-colors">
                      {s.patient.patientName}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        s.riskResult.riskCategory === 'HIGH'
                          ? 'bg-rose-100 text-rose-700'
                          : s.riskResult.riskCategory === 'ELEVATED'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {s.riskResult.overallRiskPercent}% Risk
                    </span>
                  </div>

                  <div className="text-xs text-slate-500 flex justify-between items-center font-mono text-[11px]">
                    <span>{s.photorefraction.sphericalEquivalentDiopters} D</span>
                    <span>Acc. Lag: +{s.accommodative.accommodativeLagDiopters} D</span>
                    <span>BCEA: {s.microsaccade.bceaDeg2}</span>
                  </div>

                  <div className="text-[10px] text-slate-400 flex justify-between items-center pt-1 border-t border-slate-200/60">
                    <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                    <span className="text-blue-600 font-semibold group-hover:translate-x-1 transition-transform flex items-center">
                      View Report <ArrowRight className="w-3 h-3 ml-0.5" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {history.length > 0 && (
          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={onClearHistory}
              className="w-full py-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold flex items-center justify-center space-x-2 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear Scan History</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
