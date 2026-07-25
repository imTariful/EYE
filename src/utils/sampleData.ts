import { ScanSession, FixationPoint } from '../types';

// Helper to generate scatter points for fixational microsaccade display
// Used for real-time visualization of collected fixation data
export function generateScatterPoints(bcea: number, count: number = 40): FixationPoint[] {
  const points: FixationPoint[] = [];
  const spread = Math.sqrt(bcea) * 0.45;
  for (let i = 0; i < count; i++) {
    // Box-Muller normal distribution
    const u1 = Math.random() || 0.0001;
    const u2 = Math.random() || 0.0001;
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    points.push({
      x: Math.round(z0 * spread * 100) / 100,
      y: Math.round(z1 * spread * 0.8 * 100) / 100,
    });
  }
  return points;
}

// No demo data - all data must be collected manually through the scanning workflow
