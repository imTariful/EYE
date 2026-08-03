import { describe, expect, test } from 'vitest';
import type { AccommodativeData, MicrosaccadeData, PatientProfile } from '../../types';
import {
  analyzeHighFrequencyMicroFluctuations,
  calculateBCEA,
  calculateMultiModalRisk,
  calculatePhotorefraction,
  calculateThibosPowerVectors,
  detectEngbertKlieglMicrosaccades,
  j0AndJ45ToAxisDegrees,
  predictMyopiaProgressionLi2024,
  reconstitutePrescription,
  savitzkyGolayFilter,
} from '../opticsEngine';
import {
  DEFAULT_ACCOMMODATIVE_LAG_D,
  DEFAULT_NPC_CM,
  resolveManualAccommodativeInputs,
} from '../accommodativeInputs';

const neutralAccommodative: AccommodativeData = {
  npcCm: 6,
  accommodativeLagDiopters: 0.5,
  fatigueIndex: 50,
  constrictionVelocityMmSec: 3.5,
  responseLatencyMs: 300,
};

const stableMicrosaccade: MicrosaccadeData = {
  bceaDeg2: 0.3,
  fixationStabilityScore: 90,
  microsaccadeFrequencyHz: 1.8,
  fixationPoints: [],
  amblyopiaRisk: 'LOW',
};

const basePatient: PatientProfile = {
  patientName: 'Regression Patient',
  age: 15,
  gender: 'MALE',
  parentsWithMyopia: 0,
  dailyScreenHours: 1,
  dailyOutdoorHours: 3,
  readingDistanceCm: 40,
  currentGlasses: 'NONE',
  symptoms: {
    eyeStrain: false,
    frequentHeadaches: false,
    distanceBlur: false,
    squintingToSee: false,
    dryEyes: false,
  },
};

describe('photorefraction', () => {
  test('matches the canonical Howland anchor', () => {
    const result = calculatePhotorefraction(0.28, 'TOP', 5.5, 0.85, 100, 12, 6);
    expect(result.sphericalEquivalentDiopters).toBe(-2.5);
  });

  test('clamps the implemented range and rounds to quarter diopters', () => {
    expect(calculatePhotorefraction(0.8, 'TOP', 2, 0.8, 150, 1, 15).sphericalEquivalentDiopters).toBe(-10);
    expect(calculatePhotorefraction(0.8, 'BOTTOM', 2, 0.8, 150, 1, 15).sphericalEquivalentDiopters).toBe(8);
    const rounded = calculatePhotorefraction(0.31, 'TOP', 5.5, 0.85, 100, 12, 6).sphericalEquivalentDiopters;
    expect(rounded * 4).toBe(Math.round(rounded * 4));
  });
});

describe('fixation processing', () => {
  test('BCEA grows with a more spread cluster and uses the documented short-stream fallback', () => {
    const tight = Array.from({ length: 20 }, (_, i) => ({ x: Math.sin(i) * 0.05, y: Math.cos(i) * 0.04 }));
    const spread = tight.map(({ x, y }) => ({ x: x * 10, y: y * 10 }));
    expect(calculateBCEA(tight).bceaDeg2).toBeLessThan(calculateBCEA(spread).bceaDeg2);
    expect(calculateBCEA(tight.slice(0, 4)).bceaDeg2).toBe(0.25);
  });

  test('Savitzky-Golay preserves a flat stream and reduces deterministic noise', () => {
    for (const value of savitzkyGolayFilter(Array(15).fill(3))) {
      expect(value).toBeCloseTo(3, 10);
    }
    const signal = Array.from({ length: 41 }, (_, i) => Math.sin(i / 5));
    const noisy = signal.map((value, i) => value + (i % 2 === 0 ? 0.25 : -0.25));
    const smoothed = savitzkyGolayFilter(noisy, 7, 2);
    const noisyError = noisy.reduce((sum, value, i) => sum + Math.abs(value - signal[i]), 0);
    const smoothError = smoothed.reduce((sum, value, i) => sum + Math.abs(value - signal[i]), 0);
    expect(smoothError).toBeLessThan(noisyError);
    expect(Math.max(...smoothed) - Math.min(...smoothed)).toBeGreaterThan(1.5);
  });

  test('Engbert-Kliegl detects an injected movement and ignores a flat stream', () => {
    const flat = Array.from({ length: 20 }, () => ({ x: 0, y: 0 }));
    const injected = flat.map((point, i) => i === 10 ? { x: 2, y: -1 } : point);
    expect(detectEngbertKlieglMicrosaccades(injected, 30).count).toBeGreaterThanOrEqual(1);
    expect(detectEngbertKlieglMicrosaccades(flat, 30).count).toBe(0);
  });
});

describe('power vectors', () => {
  test('round-trips sphere/cylinder/axis', () => {
    const vectors = calculateThibosPowerVectors(-2, -1, 45);
    const reconstructed = reconstitutePrescription(vectors.M, vectors.J0, vectors.J45);
    expect(reconstructed.sphere).toBeCloseTo(-2, 2);
    expect(reconstructed.cylinder).toBeCloseTo(-1, 2);
    expect(reconstructed.axis).toBeCloseTo(45, 0);
  });

  test('converts known J vectors and handles the zero vector', () => {
    expect(j0AndJ45ToAxisDegrees(1, 0)).toBe(0);
    expect(j0AndJ45ToAxisDegrees(0, 1)).toBe(45);
    expect(j0AndJ45ToAxisDegrees(0, 0)).toBe(0);
  });
});

describe('honesty and regression safeguards', () => {
  test('Li integration is marked illustrative and has no claimed AUC/MAE output', () => {
    const result = predictMyopiaProgressionLi2024(basePatient, calculatePhotorefraction(0.28, 'TOP'));
    expect(result.illustrativeOnly).toBe(true);
    expect(result).not.toHaveProperty('aucScore');
    expect(result).not.toHaveProperty('maeDiopters');
  });

  test('symptoms and poor tested acuity change risk with scans fixed', () => {
    const photo = calculatePhotorefraction(0, 'SYMMETRIC');
    const baseline = calculateMultiModalRisk(basePatient, photo, neutralAccommodative, stableMicrosaccade);
    const symptomatic = calculateMultiModalRisk({
      ...basePatient,
      symptoms: { eyeStrain: true, frequentHeadaches: true, distanceBlur: true, squintingToSee: true, dryEyes: true },
    }, photo, neutralAccommodative, stableMicrosaccade);
    const poorAcuity = calculateMultiModalRisk({
      ...basePatient,
      visualAcuity: { logMAR: 1, snellen: '20/200', tested: true },
    }, photo, neutralAccommodative, stableMicrosaccade);
    expect(symptomatic.overallRiskPercent).toBeGreaterThan(baseline.overallRiskPercent);
    expect(poorAcuity.overallRiskPercent).toBeGreaterThan(baseline.overallRiskPercent);
  });

  test('young female illustrative progression magnitude is approximately 15% higher', () => {
    const photo = calculatePhotorefraction(0.28, 'TOP');
    const pediatric = { ...basePatient, age: 10 };
    const male = predictMyopiaProgressionLi2024({ ...pediatric, gender: 'MALE' }, photo);
    const female = predictMyopiaProgressionLi2024({ ...pediatric, gender: 'FEMALE' }, photo);
    expect(Math.abs(female.predictedChange12M / male.predictedChange12M)).toBeGreaterThanOrEqual(1.1);
    expect(Math.abs(female.predictedChange12M / male.predictedChange12M)).toBeLessThanOrEqual(1.2);
  });

  test('hyperopic trajectories drift toward zero without crossing it', () => {
    const result = calculateMultiModalRisk(
      basePatient,
      calculatePhotorefraction(0.03, 'BOTTOM'),
      neutralAccommodative,
      stableMicrosaccade,
    );
    for (const key of ['estimatedDiopters', 'highRiskDiopters', 'lowRiskDiopters'] as const) {
      const values = result.trajectory.map(point => point[key]);
      expect(values.every(value => value >= 0)).toBe(true);
      expect(values.every((value, index) => index === 0 || value <= values[index - 1])).toBe(true);
    }
  });

  test('manual NPC/lag defaults are deterministic and higher pupil jitter increases fatigue', () => {
    expect(resolveManualAccommodativeInputs(Number.NaN, Number.NaN)).toEqual({
      npcCm: DEFAULT_NPC_CM,
      accommodativeLagDiopters: DEFAULT_ACCOMMODATIVE_LAG_D,
    });
    expect(resolveManualAccommodativeInputs(9.5, 0.9)).toEqual(resolveManualAccommodativeInputs(9.5, 0.9));

    const relaxed = Array.from({ length: 50 }, (_, i) => 4.2 + Math.sin(i * 1.4) * 0.02);
    const jitter = Array.from({ length: 50 }, (_, i) => 4.2 + Math.sin(i * 1.4) + Math.sin(i * 0.7) * 0.4);
    expect(analyzeHighFrequencyMicroFluctuations(jitter, 30).fatigueIndex)
      .toBeGreaterThan(analyzeHighFrequencyMicroFluctuations(relaxed, 30).fatigueIndex);
  });
});
