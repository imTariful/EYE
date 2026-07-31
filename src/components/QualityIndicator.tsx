import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

interface QualityIndicatorProps {
  label: string;
  value: number;
  threshold: {
    good: number;
    warning: number;
  };
  unit?: string;
  isInverted?: boolean; // If true, lower values are better (e.g., BCEA)
}

export const QualityIndicator: React.FC<QualityIndicatorProps> = ({
  label,
  value,
  threshold,
  unit = '',
  isInverted = false,
}) => {
  const getStatus = () => {
    if (isInverted) {
      // Lower is better
      if (value <= threshold.good) return 'good';
      if (value <= threshold.warning) return 'warning';
      return 'poor';
    } else {
      // Higher is better
      if (value >= threshold.good) return 'good';
      if (value >= threshold.warning) return 'warning';
      return 'poor';
    }
  };

  const status = getStatus();
  const percentage = isInverted
    ? Math.max(0, Math.min(100, ((threshold.warning - value) / (threshold.warning - threshold.good)) * 100))
    : Math.max(0, Math.min(100, ((value - threshold.warning) / (threshold.good - threshold.warning)) * 100));

  const statusConfig = {
    good: {
      color: 'bg-emerald-500',
      bgColor: 'bg-emerald-50',
      borderColor: 'border-emerald-200',
      textColor: 'text-emerald-800',
      icon: CheckCircle2,
      iconColor: 'text-emerald-600',
    },
    warning: {
      color: 'bg-amber-500',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      textColor: 'text-amber-800',
      icon: AlertTriangle,
      iconColor: 'text-amber-600',
    },
    poor: {
      color: 'bg-rose-500',
      bgColor: 'bg-rose-50',
      borderColor: 'border-rose-200',
      textColor: 'text-rose-800',
      icon: XCircle,
      iconColor: 'text-rose-600',
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`p-3 rounded-xl border ${config.borderColor} ${config.bgColor} space-y-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <Icon className={`w-4 h-4 ${config.iconColor}`} />
      </div>
      
      <div className="flex items-center justify-between">
        <span className={`text-lg font-bold ${config.textColor}`}>
          {typeof value === 'number' ? value.toFixed(1) : value}
          {unit && <span className="text-xs font-normal ml-1">{unit}</span>}
        </span>
        <span className={`text-[10px] font-medium uppercase tracking-wider ${config.textColor}`}>
          {status}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full ${config.color} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

interface QualityPanelProps {
  lighting?: number; // Red reflex intensity (0-1)
  fixation?: number; // BCEA in deg²
  focus?: number; // Blur variance score
  pupilTracking?: number; // Confidence score (0-100)
}

export const QualityPanel: React.FC<QualityPanelProps> = ({
  lighting = 0.75,
  fixation = 0.82,
  focus = 80,
  pupilTracking = 85,
}) => {
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center space-x-2 text-slate-700 font-semibold text-sm">
        <span className="text-blue-600">●</span>
        <span>Quality Indicators</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <QualityIndicator
          label="Lighting"
          value={lighting}
          threshold={{ good: 0.85, warning: 0.70 }}
          unit=""
          isInverted={false}
        />
        
        <QualityIndicator
          label="Fixation"
          value={fixation}
          threshold={{ good: 0.5, warning: 1.0 }}
          unit=" deg²"
          isInverted={true}
        />
        
        <QualityIndicator
          label="Focus"
          value={focus}
          threshold={{ good: 80, warning: 50 }}
          unit=""
          isInverted={false}
        />
        
        <QualityIndicator
          label="Tracking"
          value={pupilTracking}
          threshold={{ good: 90, warning: 70 }}
          unit="%"
          isInverted={false}
        />
      </div>
    </div>
  );
};
