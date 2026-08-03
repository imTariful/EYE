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
  currentPrescription?: {
    sphere: number;
    cylinder: number;
    axis: number;
  };
  currentPrescriptionPowerVectors?: {
    M: number;
    J0: number;
    J45: number;
  };
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
    response?: 'IDENTIFIED' | 'TOO_BLURRY' | 'INCORRECT';
  };
}

export interface EyeMetrics {
  pupilDiameterMm: number;
  redReflexIntensityRatio: number;
  crescentHeightRatio: number; // Crescent height relative to pupil radius
  crescentOrientation: 'TOP' | 'BOTTOM' | 'SYMMETRIC'; // Top = Myopia, Bottom = Hyperopia
  sphericalEquivalentDiopters: number; // e.g. -2.50
  astigmatismCylinderDiopters: number; // e.g. -0.50
  classification: 'EMMETROPIA' | 'MILD_MYOPIA' | 'MODERATE_MYOPIA' | 'HIGH_MYOPIA' | 'HYPEROPIA';
  confidenceScore: number; // 0-100%
  luminanceSlope?: number; // Dynamic luminance slope (dL/dx)
  rotationalAstigmatism?: {
    cylinderDiopters: number;
    axisDegrees: number;
    j0: number;
    j45: number;
  };
}

export interface PhotorefractionData {
  // Combined metrics (legacy support)
  pupilDiameterMm: number;
  redReflexIntensityRatio: number;
  crescentHeightRatio: number;
  crescentOrientation: 'TOP' | 'BOTTOM' | 'SYMMETRIC';
  sphericalEquivalentDiopters: number;
  astigmatismCylinderDiopters: number;
  classification: 'EMMETROPIA' | 'MILD_MYOPIA' | 'MODERATE_MYOPIA' | 'HIGH_MYOPIA' | 'HYPEROPIA';
  confidenceScore: number;
  luminanceSlope?: number;
  aaposRiskCategory?: 'EMMETROPIA' | 'MILD_MYOPIA' | 'MODERATE_MYOPIA' | 'HIGH_MYOPIA' | 'HYPEROPIA';
  leukocoriaRisk?: 'NORMAL' | 'SUSPECT' | 'CRADLE_POSITIVE';
  rotationalAstigmatism?: {
    cylinderDiopters: number;
    axisDegrees: number;
    j0: number;
    j45: number;
  };
  // Individual eye metrics (OD = Right Eye, OS = Left Eye)
  od?: EyeMetrics; // Right Eye (Oculus Dexter)
  os?: EyeMetrics; // Left Eye (Oculus Sinister)
  // Anisometropia detection
  anisometropiaDelta?: number; // Difference in SE between eyes
  anisometropiaRisk?: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface AccommodativeEyeMetrics {
  npcCm: number; // Near Point of Convergence in cm (Normal: < 6-8 cm)
  accommodativeLagDiopters: number; // Accommodative lag in Diopters (Normal: +0.25 to +0.75 D)
  fatigueIndex: number; // 0 - 100
  constrictionVelocityMmSec: number; // Pupil constriction speed
  responseLatencyMs: number;
  accommodativeSlopeShift?: number; // Slope shift during near-target approach
  cameraNpcProxyCm?: number; // Webcam vergence proxy; does not replace manual/clinical NPC
  cameraNpcProxyConfidence?: 'LOW' | 'MODERATE';
  cameraNpcProxyVergenceAngleDeg?: number;
}

export interface AccommodativeData {
  // Combined metrics (legacy support)
  npcCm: number; // Near Point of Convergence in cm (Normal: < 6-8 cm)
  accommodativeLagDiopters: number; // Accommodative lag in Diopters (Normal: +0.25 to +0.75 D)
  fatigueIndex: number; // 0 - 100
  constrictionVelocityMmSec: number; // Pupil constriction speed
  responseLatencyMs: number;
  accommodativeSlopeShift?: number; // Slope shift during near-target approach
  // Individual eye metrics (OD = Right Eye, OS = Left Eye)
  od?: AccommodativeEyeMetrics; // Right Eye (Oculus Dexter)
  os?: AccommodativeEyeMetrics; // Left Eye (Oculus Sinister)
}

export interface FixationPoint {
  x: number; // horizontal displacement in degrees
  y: number; // vertical displacement in degrees
}

export interface MicrosaccadeEyeMetrics {
  bceaDeg2: number; // Bivariate Contour Ellipse Area in deg^2 (Savitzky-Golay smoothed)
  rawBceaDeg2?: number; // Raw unsmoothed BCEA in deg^2
  bceaConfidenceLevel?: number; // 1-sigma (68.27%) or 2-sigma (95.45%)
  fixationStabilityScore: number; // 0 - 100
  microsaccadeFrequencyHz: number;
  microsaccadeFrequencyConfidence?: 'MEASURED' | 'LOW';
  fixationPoints: FixationPoint[];
  amblyopiaRisk: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface MicrosaccadeData {
  // Combined metrics (legacy support)
  bceaDeg2: number; // Bivariate Contour Ellipse Area in deg^2 (Savitzky-Golay smoothed)
  rawBceaDeg2?: number; // Raw unsmoothed BCEA in deg^2
  bceaConfidenceLevel?: number; // 1-sigma (68.27%) or 2-sigma (95.45%)
  fixationStabilityScore: number; // 0 - 100
  microsaccadeFrequencyHz: number;
  microsaccadeFrequencyConfidence?: 'MEASURED' | 'LOW';
  fixationPoints: FixationPoint[];
  amblyopiaRisk: 'LOW' | 'MODERATE' | 'HIGH';
  // Individual eye fixation data
  odFixationPoints?: FixationPoint[]; // Right eye fixation
  osFixationPoints?: FixationPoint[]; // Left eye fixation
  odBceaDeg2?: number; // Right eye BCEA
  osBceaDeg2?: number; // Left eye BCEA
  // Individual eye metrics (OD = Right Eye, OS = Left Eye)
  od?: MicrosaccadeEyeMetrics; // Right Eye (Oculus Dexter)
  os?: MicrosaccadeEyeMetrics; // Left Eye (Oculus Sinister)
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
  aucScore?: number;
  maeDiopters?: number;
  illustrativeOnly?: boolean;
  modelNote?: string;
}

export interface Foo2023FiveYearHighMyopiaRisk {
  riskPercent5Y: number; // 0-100%
  aucScore?: number;
  fundusAdapterValidated: boolean;
  riskCategory5Y: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
  illustrativeOnly?: boolean;
  modelNote?: string;
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
  demoMode?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestedQuestions?: string[];
}
