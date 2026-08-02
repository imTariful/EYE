import React, { useEffect, useRef, useState } from 'react';
import { ScanSession, ChatMessage } from '../types';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Eye,
  Target,
  Sparkles,
  Send,
  Printer,
  BrainCircuit,
  TrendingDown,
  Activity,
  RotateCcw,
  Bot,
  FileText,
  X,
} from 'lucide-react';

interface Step6ResultsReportProps {
  session: ScanSession;
  onResetScan: () => void;
}

const FALLBACK_CHAT_REPLY =
  'Sorry, I could not reach the AI assistant just now. Please try again in a moment, or consult your optometrist directly with your scan results.';

// Resolves a per-eye value with a sensible fallback to the combined reading,
// so the four duplicated `x?.y || z` chains collapse into one place.
function eyeValue<T>(eye: { [k: string]: T } | undefined, key: string, fallback: T): T {
  return (eye && (eye as any)[key] !== undefined ? (eye as any)[key] : fallback) as T;
}

export const Step6ResultsReport: React.FC<Step6ResultsReportProps> = ({
  session,
  onResetScan,
}) => {
  // AI Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-1',
      sender: 'assistant',
      text: `Hello ${session.patient.patientName}! I am OcuRisk AI, your personal Eye-Health Assistant. I've analyzed your multi-modal photorefraction, accommodative lag (+${session.accommodative.accommodativeLagDiopters.toFixed(
        2
      )}D), and fixational microsaccade scan. Your estimated 12-month myopia progression risk score is ${session.riskResult.overallRiskPercent}% (${session.riskResult.riskCategory} Risk). How can I help clarify your results today?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      suggestedQuestions: [
        `What does my ${session.photorefraction.sphericalEquivalentDiopters}D diopter rating mean?`,
        'How can I slow my myopia progression?',
        'Explain Accommodative Lag and BCEA.',
        'What questions should I ask my optometrist?',
      ],
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // AI Generated Report Summary State
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(session.aiNotes || null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Interactive Eye Cards State
  const [selectedEye, setSelectedEye] = useState<'combined' | 'od' | 'os'>('combined');

  // Auto-scroll chat to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isTyping]);

  // Close modal on Escape, cancel in-flight chat request on unmount
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowReportModal(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      abortRef.current?.abort();
    };
  }, []);

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputQuery;
    if (!query.trim() || isTyping) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setIsTyping(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/llm-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          session,
          conversationHistory: messages.slice(-4),
        }),
        signal: controller.signal,
      });

      const data = await res.json();
      const aiReply: string | undefined = data.reply || data.fallbackReply;
      if (!aiReply) throw new Error(`Chat API returned ${res.status} without a fallback reply`);

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'assistant',
          text: aiReply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      console.error('AI chat error:', err);
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          sender: 'assistant',
          text: FALLBACK_CHAT_REPLY,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleGenerateReport = async () => {
    setIsGeneratingReport(true);
    setReportError(null);
    try {
      const res = await fetch('/api/llm-agent/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      const data = await res.json();
      if (!data.reportMarkdown) throw new Error(`Report API returned ${res.status} without a fallback report`);
      setReportMarkdown(data.reportMarkdown);
      setShowReportModal(true);
    } catch (err) {
      console.error('Report error:', err);
      setReportError('We could not generate the AI health note. The key scan metrics below are still accurate — try again shortly.');
      setShowReportModal(true);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Per-eye display values, resolved once instead of four times per card.
  const odValue = eyeValue(session.photorefraction.od, 'sphericalEquivalentDiopters', session.photorefraction.sphericalEquivalentDiopters);
  const osValue = eyeValue(session.photorefraction.os, 'sphericalEquivalentDiopters', session.photorefraction.sphericalEquivalentDiopters);
  const odClass = eyeValue(session.photorefraction.od, 'classification', session.photorefraction.classification);
  const osClass = eyeValue(session.photorefraction.os, 'classification', session.photorefraction.classification);
  const odPupil = eyeValue(session.photorefraction.od, 'pupilDiameterMm', session.photorefraction.pupilDiameterMm);
  const osPupil = eyeValue(session.photorefraction.os, 'pupilDiameterMm', session.photorefraction.pupilDiameterMm);
  const odReflex = eyeValue(session.photorefraction.od, 'redReflexIntensityRatio', session.photorefraction.redReflexIntensityRatio);
  const osReflex = eyeValue(session.photorefraction.os, 'redReflexIntensityRatio', session.photorefraction.redReflexIntensityRatio);

  const anisometropiaDelta =
    session.photorefraction.anisometropiaDelta ?? Math.abs(odValue - osValue);
  const anisometropiaRisk =
    session.photorefraction.anisometropiaRisk ??
    (anisometropiaDelta >= 2.0 ? 'HIGH' : anisometropiaDelta >= 0.75 ? 'MODERATE' : 'LOW');
  const anisometropiaFlagged = anisometropiaRisk === 'MODERATE' || anisometropiaRisk === 'HIGH';

  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-7xl mx-auto">
      {/* Top Banner & Exporter Controls */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-emerald-600 font-bold text-xs uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            <span>Step 6 of 6 • Screening Complete</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-display">
            Personal Ophthalmic Health Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            Patient: <span className="font-semibold text-slate-900">{session.patient.patientName}</span> (Age {session.patient.age}) • Scan ID: {session.id}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleGenerateReport}
            disabled={isGeneratingReport}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold text-xs flex items-center space-x-2 shadow-md shadow-blue-500/20 transition-all cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>{isGeneratingReport ? 'Generating AI Note...' : 'Export AI Health Note'}</span>
          </button>

          <button
            onClick={onResetScan}
            className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center space-x-2 transition-all cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 text-slate-500" />
            <span>New Patient Scan</span>
          </button>
        </div>
      </div>

      {/* Eye Selector Toggle */}
      <div className="flex items-center justify-center space-x-2 mb-6" role="tablist" aria-label="Select eye view">
        <button
          role="tab"
          aria-selected={selectedEye === 'combined'}
          onClick={() => setSelectedEye('combined')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            selectedEye === 'combined'
              ? 'bg-slate-900 text-white shadow-md'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Combined View
        </button>
        <button
          role="tab"
          aria-selected={selectedEye === 'od'}
          onClick={() => setSelectedEye('od')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            selectedEye === 'od'
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
          }`}
        >
          OD (Right)
        </button>
        <button
          role="tab"
          aria-selected={selectedEye === 'os'}
          onClick={() => setSelectedEye('os')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            selectedEye === 'os'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
          }`}
        >
          OS (Left)
        </button>
      </div>

      {/* Grid: Key Diagnostic Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Card 1: OD (Right Eye) Photorefraction */}
        <div
          className={`bg-white p-6 rounded-3xl border shadow-xs space-y-3 transition-all ${
            selectedEye === 'od' ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200/80'
          } ${selectedEye === 'os' ? 'opacity-50' : ''}`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>OD (Right Eye)</span>
            <Eye className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-display">
            {odValue > 0 ? '+' : ''}
            {odValue.toFixed(2)} D
          </div>
          <div className="inline-block px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-bold text-xs border border-blue-200/60">
            {odClass.replace('_', ' ')}
          </div>
          <div className="text-[11px] text-slate-500 space-y-0.5">
            <p>Pupil: <span className="font-semibold text-slate-700">{odPupil} mm</span></p>
            <p>Reflex: <span className="font-semibold text-slate-700">{(odReflex * 100).toFixed(0)}%</span></p>
            {session.microsaccade.od && (
              <p>BCEA: <span className="font-semibold text-slate-700">{session.microsaccade.od.bceaDeg2.toFixed(2)} deg²</span></p>
            )}
          </div>
        </div>

        {/* Card 2: OS (Left Eye) Photorefraction */}
        <div
          className={`bg-white p-6 rounded-3xl border shadow-xs space-y-3 transition-all ${
            selectedEye === 'os' ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-slate-200/80'
          } ${selectedEye === 'od' ? 'opacity-50' : ''}`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>OS (Left Eye)</span>
            <Eye className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-display">
            {osValue > 0 ? '+' : ''}
            {osValue.toFixed(2)} D
          </div>
          <div className="inline-block px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-xs border border-emerald-200/60">
            {osClass.replace('_', ' ')}
          </div>
          <div className="text-[11px] text-slate-500 space-y-0.5">
            <p>Pupil: <span className="font-semibold text-slate-700">{osPupil} mm</span></p>
            <p>Reflex: <span className="font-semibold text-slate-700">{(osReflex * 100).toFixed(0)}%</span></p>
            {session.microsaccade.os && (
              <p>BCEA: <span className="font-semibold text-slate-700">{session.microsaccade.os.bceaDeg2.toFixed(2)} deg²</span></p>
            )}
          </div>
        </div>

        {/* Card 3: Anisometropia Detection */}
        <div
          className={`bg-white p-6 rounded-3xl border shadow-xs space-y-3 transition-all ${
            anisometropiaFlagged ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200/80'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Anisometropia</span>
            <Activity className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-display">
            {anisometropiaDelta.toFixed(2)} D
          </div>
          <div
            className={`inline-block px-2.5 py-1 rounded-lg font-bold text-xs border ${
              anisometropiaRisk === 'HIGH'
                ? 'bg-rose-100 text-rose-800 border-rose-300'
                : anisometropiaRisk === 'MODERATE'
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            {anisometropiaRisk} Risk
          </div>
          <p className="text-[11px] text-slate-500">Difference between eyes</p>
          {anisometropiaFlagged && (
            <div className="mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-[10px] text-amber-800 font-semibold">
                ⚠️ Asymmetry detected - Clinical follow-up recommended
              </p>
            </div>
          )}
        </div>

        {/* Card 4: Combined Refractive Error */}
        <div
          className={`bg-white p-6 rounded-3xl border shadow-xs space-y-3 transition-all ${
            selectedEye === 'combined' ? 'border-purple-500 ring-2 ring-purple-200' : 'border-slate-200/80'
          } ${selectedEye !== 'combined' ? 'opacity-50' : ''}`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Combined SE</span>
            <Target className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-display">
            {session.photorefraction.sphericalEquivalentDiopters > 0 ? '+' : ''}
            {session.photorefraction.sphericalEquivalentDiopters.toFixed(2)} D
          </div>
          <div className="inline-block px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 font-bold text-xs border border-purple-200/60">
            {session.photorefraction.classification.replace('_', ' ')}
          </div>
          <div className="text-[11px] text-slate-500 space-y-0.5">
            <p>Luminance Slope: <span className="font-semibold text-slate-700">{session.photorefraction.luminanceSlope ?? 2.4}</span></p>
            {session.photorefraction.rotationalAstigmatism && (
              <p>Astigmatism: <span className="font-semibold text-slate-700">{session.photorefraction.rotationalAstigmatism.cylinderDiopters}D @ {session.photorefraction.rotationalAstigmatism.axisDegrees}°</span></p>
            )}
          </div>
        </div>
      </div>

      {/* Secondary Row: Clinical Models */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>12-Mo Myopia Shift (Li 2024)</span>
            <BrainCircuit className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-3xl font-extrabold text-purple-700 font-display flex items-baseline space-x-1.5">
            <span>{session.riskResult.li2024MyopiaProgression12M?.predictedChange12M ?? -0.48} D</span>
            <span className="text-xs font-normal text-slate-500">/yr</span>
          </div>
          <div className="inline-block px-2.5 py-1 rounded-lg bg-purple-50 text-purple-800 font-bold text-xs border border-purple-200/60">
            Li et al. Model (AUC 0.99, MAE 0.119D)
          </div>
          <p className="text-[11px] text-slate-500">
            Projected 12M SE: <span className="font-bold text-slate-800">{session.riskResult.li2024MyopiaProgression12M?.projectedDiopters12M} D</span>
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>5-Yr High Myopia Risk (Foo 2023)</span>
            <Target className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-display">
            {session.riskResult.foo2023FiveYearHighMyopiaRisk?.riskPercent5Y ?? 35}%
          </div>
          <div className="inline-block px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-bold text-xs border border-indigo-200/60">
            Foo et al. DLS (AUC 0.97)
          </div>
          <p className="text-[11px] text-slate-500">
            5-Year Category: <span className="font-bold text-slate-800">{session.riskResult.foo2023FiveYearHighMyopiaRisk?.riskCategory5Y ?? 'MODERATE'}</span>
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>CRADLE Leukocoria & BCEA</span>
            <Activity className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-display">
            {session.microsaccade.bceaDeg2} <span className="text-sm font-normal text-slate-500">deg²</span>
          </div>
          <div
            className={`inline-block px-2.5 py-1 rounded-lg font-bold text-xs border ${
              session.riskResult.cradleLeukocoria?.isPositive
                ? 'bg-rose-100 text-rose-800 border-rose-300'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}
          >
            CRADLE: {session.riskResult.cradleLeukocoria?.isPositive ? 'LEUKOCORIA SUSPECT' : 'NORMAL REFLEX'}
          </div>
          <p className="text-[11px] text-slate-500">
            Kalman Smoothed Fixation (Raw: {session.microsaccade.rawBceaDeg2 ?? session.microsaccade.bceaDeg2} deg²)
          </p>
        </div>
      </div>

      {/* Main Content Area: Charts & AI Chat Agent */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Trajectory Forecast & Feature Contributions */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base font-display flex items-center space-x-2">
                  <TrendingDown className="w-5 h-5 text-blue-600" />
                  <span>5-Year Forecasted Progression Trajectory</span>
                </h3>
                <p className="text-xs text-slate-500">Estimated diopter shift if unmanaged vs intervention controls.</p>
              </div>
            </div>

            <div className="w-full h-64 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={session.riskResult.trajectory}>
                  <XAxis dataKey="label" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} unit="D" domain={['dataMin - 1', 'dataMax + 0.5']} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '11px' }}
                    formatter={(val: number) => [`${val} D`]}
                  />
                  <Line type="monotone" dataKey="estimatedDiopters" stroke="#2563eb" strokeWidth={3} name="Estimated Path" />
                  <Line type="monotone" dataKey="highRiskDiopters" stroke="#e11d48" strokeWidth={2} strokeDasharray="4 4" name="Unmanaged Path" />
                  <Line type="monotone" dataKey="lowRiskDiopters" stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" name="Managed Path" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-center space-x-6 text-xs text-slate-600 pt-2">
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-1 bg-blue-600 rounded-full" />
                <span>Baseline Curve</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-0.5 bg-rose-500 border border-dashed" />
                <span>High Progression Risk</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-0.5 bg-emerald-500 border border-dashed" />
                <span>With Early Intervention</span>
              </div>
            </div>
          </div>

          {/* Feature Contribution list */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-base font-display">
              Multi-Modal Risk Factor Weightings
            </h3>

            <div className="space-y-3">
              {session.riskResult.featureContributions.map((fc) => {
                const positive = fc.impactScore >= 0;
                return (
                  <div key={fc.feature} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-800">{fc.feature}</span>
                      <span className={`font-mono font-bold ${positive ? 'text-blue-600' : 'text-green-600'}`}>
                        {positive ? `+${fc.impactScore.toFixed(1)}` : fc.impactScore.toFixed(1)} Impact
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">{fc.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Conversational LLM Eye-Health Agent */}
        <div className="lg:col-span-5 bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-xl p-6 flex flex-col justify-between h-[650px]">
          <div className="flex items-center space-x-3 pb-4 border-b border-slate-800 shrink-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/30">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="font-bold text-sm font-display text-white flex items-center space-x-2">
                <span>OcuRisk AI Assistant</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <p className="text-[11px] text-slate-400">
                Grounded in your actual scan metrics & optical research
              </p>
            </div>
          </div>

          {/* Message List */}
          <div
            className="flex-1 overflow-y-auto my-4 space-y-4 pr-1 text-xs no-scrollbar"
            role="log"
            aria-live="polite"
            aria-label="Conversation with OcuRisk AI"
          >
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[88%] p-3.5 rounded-2xl leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white font-medium rounded-br-xs'
                      : 'bg-slate-800 text-slate-200 border border-slate-700/80 rounded-bl-xs space-y-2'
                  }`}
                >
                  <p className="whitespace-pre-line">{msg.text}</p>

                  {msg.suggestedQuestions && (
                    <div className="pt-2 flex flex-wrap gap-1.5 border-t border-slate-700/60 mt-2">
                      {msg.suggestedQuestions.map((q) => (
                        <button
                          key={q}
                          onClick={() => handleSendMessage(q)}
                          disabled={isTyping}
                          className="text-[10px] bg-slate-700/80 hover:bg-blue-600 disabled:opacity-50 text-cyan-200 hover:text-white px-2.5 py-1 rounded-lg transition-colors border border-slate-600/60 text-left cursor-pointer"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center space-x-2 text-slate-400 bg-slate-800/80 p-3 rounded-2xl w-fit">
                <Sparkles className="w-4 h-4 text-cyan-400 animate-spin" />
                <span className="text-xs font-mono">AI is analyzing optics data...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="pt-3 border-t border-slate-800 flex items-center space-x-2 shrink-0"
          >
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Ask about your scan results..."
              disabled={isTyping}
              maxLength={500}
              aria-label="Ask the OcuRisk AI assistant a question"
              className="flex-1 bg-slate-950 border border-slate-700 text-white rounded-xl px-3.5 py-2.5 text-xs focus:outline-hidden focus:border-blue-500 transition-colors disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!inputQuery.trim() || isTyping}
              aria-label="Send message"
              className="p-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-xl transition-all cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* AI Health Note Export Modal */}
      {showReportModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowReportModal(false);
          }}
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-report-title"
            className="bg-white text-slate-900 rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto animate-in fade-in duration-200"
          >
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <div>
                <h3 id="ai-report-title" className="text-xl font-bold font-display text-slate-900">
                  OcuRisk AI Eye-Health Summary Report
                </h3>
                <p className="text-xs text-slate-500">
                  Patient: {session.patient.patientName} • Date: {new Date().toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                aria-label="Close report"
                className="text-slate-400 hover:text-slate-600 font-bold p-1 text-sm cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="prose prose-slate prose-sm max-w-none text-xs leading-relaxed space-y-4">
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 font-mono text-[11px] space-y-1">
                <div>Refractive Error: {session.photorefraction.sphericalEquivalentDiopters} D</div>
                <div>12-Mo Progression Risk: {session.riskResult.overallRiskPercent}% ({session.riskResult.riskCategory})</div>
                <div>Accommodative Lag: +{session.accommodative.accommodativeLagDiopters.toFixed(2)} D</div>
                <div>Microsaccade BCEA: {session.microsaccade.bceaDeg2} deg²</div>
              </div>

              {reportError ? (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-[11px] font-medium">
                  {reportError}
                </div>
              ) : (
                <div className="whitespace-pre-line leading-relaxed text-slate-700 font-normal">
                  {reportMarkdown}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-slate-100">
              <button
                onClick={() => window.print()}
                disabled={!reportMarkdown}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center space-x-2 hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Print Report</span>
              </button>
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
