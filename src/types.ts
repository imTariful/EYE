export type Step = 1 | 2 | 3 | 4 | 5 | 6;

export interface PatientProfile {
  patientName: string;
  age: number;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  parentsWithMyopia: 0 | 1 | 2;
  dailyScreenHours: number;
  dailyOutdoorHours: number;
  readingDistanceCm: number;
  currentGlasses: 'NONE' | 'MYOPIA' | 'HYPEROPIA';
  currentDiopters?: number;
  symptoms: {
    eyeStrain: boolean;
    frequentHeadaches: boolean;
    distanceBlur: boolean;
    squintingToSee: boolean;
    dryEyes: boolean;
  };
  visualAcuity?: {
    logMAR: number;
    snellen: string;
    tested: boolean;
  };
}

export interface PhotorefractionData {
  pupilDiameterMm: number;
  redReflexIntensityRatio: number;
  crescentHeightRatio: number; // Crescent height relative to pupil radius
  crescentOrientation: 'TOP' | 'BOTTOM' | 'SYMMETRIC'; // Top = Myopia, Bottom = Hyperopia
  sphericalEquivalentDiopters: number; // e.g. -2.50
  astigmatismCylinderDiopters: number; // e.g. -0.50
  classification: 'EMMETROPIA' | 'MILD_MYOPIA' | 'MODERATE_MYOPIA' | 'HIGH_MYOPIA' | 'HYPEROPIA';
  confidenceScore: number; // 0-100%
  luminanceSlope?: number; // Dynamic luminance slope (dL/dx)
  aaposRiskCategory?: 'EMMETROPIA' | 'MILD_MYOPIA' | 'MODERATE_MYOPIA' | 'HIGH_MYOPIA' | 'HYPEROPIA';
  leukocoriaRisk?: 'NORMAL' | 'SUSPECT' | 'CRADLE_POSITIVE';
  rotationalAstigmatism?: {
    cylinderDiopters: number;
    axisDegrees: number;
    j0: number;
    j45: number;
  };
}

export interface AccommodativeData {
  npcCm: number; // Near Point of Convergence in cm (Normal: < 6-8 cm)
  accommodativeLagDiopters: number; // Accommodative lag in Diopters (Normal: +0.25 to +0.75 D)
  fatigueIndex: number; // 0 - 100
  constrictionVelocityMmSec: number; // Pupil constriction speed
  responseLatencyMs: number;
  accommodativeSlopeShift?: number; // Slope shift during near-target approach
}

export interface FixationPoint {
  x: number; // horizontal displacement in degrees
  y: number; // vertical displacement in degrees
}

export interface MicrosaccadeData {
  bceaDeg2: number; // Bivariate Contour Ellipse Area in deg^2 (Kalman smoothed)
  rawBceaDeg2?: number; // Raw unsmoothed BCEA in deg^2
  fixationStabilityScore: number; // 0 - 100
  microsaccadeFrequencyHz: number;
  fixationPoints: FixationPoint[];
  amblyopiaRisk: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface FeatureContribution {
  feature: string;
  impactScore: number; // -10 to +10
  description: string;
  category: 'GENETIC' | 'BEHAVIORAL' | 'OPTICAL' | 'ACCOMMODATIVE';
}

export interface BayesianDensityPoint {
  riskPercent: number;
  priorProbability: number;
  posteriorProbability: number;
}

export interface TrajectoryPoint {
  year: number;
  label: string;
  estimatedDiopters: number;
  highRiskDiopters: number;
  lowRiskDiopters: number;
}

export interface Li2024MyopiaProgression {
  predictedChange12M: number; // 12-month diopter change (e.g. -0.48 D)
  projectedDiopters12M: number; // Projected SE at 12 months
  highMyopiaProbabilityPercent: number; // Probability of progressing to high myopia
  aucScore: number; // 0.99
  maeDiopters: number; // 0.119 D
}

export interface Foo2023FiveYearHighMyopiaRisk {
  riskPercent5Y: number; // 0-100%
  aucScore: number; // 0.97
  fundusAdapterValidated: boolean;
  riskCategory5Y: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
}

export interface CradleLeukocoriaResult {
  isPositive: boolean;
  consecutivePositiveFrames: number;
  flashProximityScore: number;
  confidence: number;
}

export interface RiskScoreResult {
  overallRiskPercent: number; // 0 - 100
  riskCategory: 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH';
  alpha: number; // Beta distribution parameter
  beta: number;  // Beta distribution parameter
  uncertaintyMargin: number; // +/- percentage
  densityPoints: BayesianDensityPoint[];
  featureContributions: FeatureContribution[];
  trajectory: TrajectoryPoint[];
  li2024MyopiaProgression12M?: Li2024MyopiaProgression;
  foo2023FiveYearHighMyopiaRisk?: Foo2023FiveYearHighMyopiaRisk;
  cradleLeukocoria?: CradleLeukocoriaResult;
}

export interface ScanSession {
  id: string;
  createdAt: string;
  patient: PatientProfile;
  photorefraction: PhotorefractionData;
  accommodative: AccommodativeData;
  microsaccade: MicrosaccadeData;
  riskResult: RiskScoreResult;
  aiNotes?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestedQuestions?: string[];
}
