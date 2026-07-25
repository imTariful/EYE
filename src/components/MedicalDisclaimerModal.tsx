import React from 'react';
import { ShieldAlert, X, CheckCircle } from 'lucide-react';

interface MedicalDisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MedicalDisclaimerModal: React.FC<MedicalDisclaimerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white text-slate-900 rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-slate-100">
        <div className="flex justify-between items-start border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg font-display text-slate-900">Medical Safety & Usage Notice</h3>
              <p className="text-xs text-slate-500">Clinical AI Screening Protocols</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-900">
            OcuRisk is an artificial intelligence research and vision screening tool designed to estimate refractive error and myopia progression risk.
          </p>

          <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-200/80 space-y-2 text-amber-900 text-[11px]">
            <div className="font-bold uppercase tracking-wider text-[10px] text-amber-700">
              Important Clinical Boundaries
            </div>
            <ul className="space-y-1.5 list-disc list-inside">
              <li>Not an FDA-cleared or CE-marked diagnostic medical device.</li>
              <li>Does not replace formal cycloplegic autorefraction or retinoscopy by an optometrist/ophthalmologist.</li>
              <li>Camera sensor variations, ambient lighting, and distance can affect photorefraction readings.</li>
            </ul>
          </div>

          <p>
            If you or your child experience sudden vision loss, persistent double vision, severe eye pain, or noticeable eye alignment deviation, seek immediate care from a licensed eye doctor or emergency clinic.
          </p>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center space-x-2"
          >
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span>I Understand & Accept Terms</span>
          </button>
        </div>
      </div>
    </div>
  );
};
