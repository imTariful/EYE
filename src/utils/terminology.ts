/**
 * Medical Terminology Translation System
 * Translates clinical ophthalmic terms into patient-friendly language
 */

export interface TerminologyEntry {
  medical: string;
  simplified: string;
  category: 'refractive' | 'accommodative' | 'fixation' | 'diagnostic' | 'general';
  explanation?: string;
}

const TERMINOLOGY_MAP: Record<string, TerminologyEntry> = {
  // Refractive Terms
  'BCEA': {
    medical: 'BCEA (Bivariate Contour Ellipse Area)',
    simplified: 'Fixation Stability',
    category: 'fixation',
    explanation: 'How steady your gaze is during fixation. Smaller values indicate more stable eye movement.',
  },
  'Spherical Equivalent': {
    medical: 'Spherical Equivalent (SE)',
    simplified: 'Overall Prescription',
    category: 'refractive',
    explanation: 'A single number representing your overall refractive error (e.g., -2.50D for myopia).',
  },
  'Myopia': {
    medical: 'Myopia',
    simplified: 'Nearsightedness',
    category: 'refractive',
    explanation: 'Difficulty seeing distant objects clearly. Vision is better up close.',
  },
  'Hyperopia': {
    medical: 'Hyperopia',
    simplified: 'Farsightedness',
    category: 'refractive',
    explanation: 'Difficulty seeing near objects clearly. Vision is better at a distance.',
  },
  'Emmetropia': {
    medical: 'Emmetropia',
    simplified: 'Normal Vision',
    category: 'refractive',
    explanation: 'No refractive error - vision is clear at all distances without correction.',
  },
  'Astigmatism': {
    medical: 'Astigmatism',
    simplified: 'Blurred Vision at All Distances',
    category: 'refractive',
    explanation: 'Irregular curvature of the cornea causing blurred vision at all distances.',
  },
  'Diopters': {
    medical: 'Diopters (D)',
    simplified: 'Prescription Strength',
    category: 'refractive',
    explanation: 'Unit of measurement for lens power. Negative numbers indicate myopia, positive indicate hyperopia.',
  },
  'Cylinder': {
    medical: 'Cylinder',
    simplified: 'Astigmatism Correction',
    category: 'refractive',
    explanation: 'The amount of astigmatism correction needed in your prescription.',
  },
  'Axis': {
    medical: 'Axis',
    simplified: 'Lens Angle',
    category: 'refractive',
    explanation: 'The angle (in degrees) at which the astigmatism correction is positioned.',
  },
  'LogMAR': {
    medical: 'LogMAR',
    simplified: 'Vision Score',
    category: 'refractive',
    explanation: 'A logarithmic scale for visual acuity. Lower values indicate better vision (0.0 = 20/20).',
  },
  'Snellen': {
    medical: 'Snellen',
    simplified: 'Distance Vision',
    category: 'refractive',
    explanation: 'Traditional vision test format (e.g., 20/20, 20/40). First number is test distance, second is what a normal eye sees.',
  },

  // Accommodative Terms
  'NPC': {
    medical: 'NPC (Near Point of Convergence)',
    simplified: 'Focusing Limit',
    category: 'accommodative',
    explanation: 'The closest point to your nose where both eyes can maintain focus together. Normal is under 6-8cm.',
  },
  'Accommodative Lag': {
    medical: 'Accommodative Lag',
    simplified: 'Focusing Delay',
    category: 'accommodative',
    explanation: 'When focusing up close, if your eyes focus slightly behind the target instead of on it. Can cause eye strain.',
  },
  'Convergence Insufficiency': {
    medical: 'Convergence Insufficiency',
    simplified: 'Eye Teamwork Difficulty',
    category: 'accommodative',
    explanation: 'Difficulty turning both eyes inward to focus on near objects. Can cause reading fatigue.',
  },
  'Pupil Constriction': {
    medical: 'Pupil Constriction',
    simplified: 'Pupil Shrinking',
    category: 'accommodative',
    explanation: 'The natural response of pupils getting smaller in bright light or when focusing near.',
  },

  // Fixation Terms
  'Microsaccade': {
    medical: 'Microsaccade',
    simplified: 'Tiny Eye Movements',
    category: 'fixation',
    explanation: 'Very small, involuntary eye movements that occur even when staring at a fixed point.',
  },
  'Fixation Stability': {
    medical: 'Fixation Stability',
    simplified: 'Gaze Steadiness',
    category: 'fixation',
    explanation: 'How well your eyes can maintain focus on a single point without drifting.',
  },
  'Fixation Point': {
    medical: 'Fixation Point',
    simplified: 'Focus Point',
    category: 'fixation',
    explanation: 'The specific location where your eyes are directed during a measurement.',
  },

  // Diagnostic Terms
  'Leukocoria': {
    medical: 'Leukocoria',
    simplified: 'White Reflex',
    category: 'diagnostic',
    explanation: 'An abnormal white glow in the pupil that can indicate serious eye conditions like retinoblastoma.',
  },
  'Photorefraction': {
    medical: 'Photorefraction',
    simplified: 'Light-Based Vision Test',
    category: 'diagnostic',
    explanation: 'A technique using light reflection patterns to estimate refractive error without dilation.',
  },
  'Red Reflex': {
    medical: 'Red Reflex',
    simplified: 'Eye Glow',
    category: 'diagnostic',
    explanation: 'The reddish-orange reflection from the retina when light shines into the eye.',
  },
  'Crescent': {
    medical: 'Photorefraction Crescent',
    simplified: 'Light Pattern',
    category: 'diagnostic',
    explanation: 'The curved light pattern in the pupil that helps determine if you are nearsighted or farsighted.',
  },
  'CPR': {
    medical: 'Crescent-to-Pupil Ratio',
    simplified: 'Pattern Size Ratio',
    category: 'diagnostic',
    explanation: 'The ratio of the light pattern size to the pupil size, used to calculate prescription.',
  },
  'Anisometropia': {
    medical: 'Anisometropia',
    simplified: 'Unequal Vision Between Eyes',
    category: 'diagnostic',
    explanation: 'A significant difference in prescription between your left and right eyes.',
  },
  'Amblyopia': {
    medical: 'Amblyopia',
    simplified: 'Lazy Eye',
    category: 'diagnostic',
    explanation: 'Reduced vision in one eye that cannot be corrected with glasses alone.',
  },
  'Myopia Progression': {
    medical: 'Myopia Progression',
    simplified: 'Nearsightedness Trend',
    category: 'diagnostic',
    explanation: 'How quickly your nearsightedness is getting worse over time.',
  },
  'High Myopia': {
    medical: 'High Myopia',
    simplified: 'Severe Nearsightedness',
    category: 'diagnostic',
    explanation: 'Significant nearsightedness (typically -6.00D or worse) that increases risk of eye health problems.',
  },

  // General Terms
  'OD': {
    medical: 'OD (Oculus Dexter)',
    simplified: 'Right Eye',
    category: 'general',
    explanation: 'Latin abbreviation for the right eye.',
  },
  'OS': {
    medical: 'OS (Oculus Sinister)',
    simplified: 'Left Eye',
    category: 'general',
    explanation: 'Latin abbreviation for the left eye.',
  },
  'OU': {
    medical: 'OU (Oculus Uterque)',
    simplified: 'Both Eyes',
    category: 'general',
    explanation: 'Latin abbreviation for both eyes.',
  },
  'IPD': {
    medical: 'IPD (Inter-Pupillary Distance)',
    simplified: 'Distance Between Pupils',
    category: 'general',
    explanation: 'The distance between the centers of your pupils, measured in millimeters.',
  },
  'AAPOS': {
    medical: 'AAPOS',
    simplified: 'Pediatric Eye Association',
    category: 'general',
    explanation: 'American Association for Pediatric Ophthalmology and Strabismus - sets clinical standards.',
  },
  'CRADLE': {
    medical: 'CRADLE',
    simplified: 'Leukocoria Detection System',
    category: 'diagnostic',
    explanation: 'An algorithm for detecting abnormal white reflex in children\'s eyes.',
  },
};

/**
 * Translates a medical term to its simplified version
 * @param medicalTerm - The medical term to translate
 * @returns The simplified term or original if not found
 */
export function translateTerm(medicalTerm: string): string {
  const entry = TERMINOLOGY_MAP[medicalTerm];
  return entry ? entry.simplified : medicalTerm;
}

/**
 * Gets full terminology entry for a medical term
 * @param medicalTerm - The medical term to look up
 * @returns The terminology entry or null if not found
 */
export function getTerminologyEntry(medicalTerm: string): TerminologyEntry | null {
  return TERMINOLOGY_MAP[medicalTerm] || null;
}

/**
 * Translates all medical terms in a text to simplified versions
 * @param text - The text containing medical terms
 * @returns Text with medical terms replaced by simplified versions
 */
export function translateText(text: string): string {
  let translated = text;
  
  // Sort by length (longest first) to avoid partial replacements
  const terms = Object.keys(TERMINOLOGY_MAP).sort((a, b) => b.length - a.length);
  
  for (const term of terms) {
    const entry = TERMINOLOGY_MAP[term];
    // Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    translated = translated.replace(regex, entry.simplified);
  }
  
  return translated;
}

/**
 * Gets all terminology entries for a specific category
 * @param category - The category to filter by
 * @returns Array of terminology entries
 */
export function getTerminologyByCategory(
  category: TerminologyEntry['category']
): TerminologyEntry[] {
  return Object.values(TERMINOLOGY_MAP).filter(entry => entry.category === category);
}

/**
 * Creates a tooltip with medical term and explanation
 * @param medicalTerm - The medical term
 * @returns Object with simplified term and explanation for UI display
 */
export function createTooltip(medicalTerm: string): {
  simplified: string;
  explanation?: string;
  original: string;
} {
  const entry = TERMINOLOGY_MAP[medicalTerm];
  return {
    simplified: entry ? entry.simplified : medicalTerm,
    explanation: entry?.explanation,
    original: medicalTerm,
  };
}

/**
 * Formats a value with its translated unit
 * @param value - The numeric value
 * @param unit - The medical unit (e.g., 'Diopters', 'BCEA')
 * @returns Formatted string with simplified unit
 */
export function formatWithUnit(value: number, unit: string): string {
  const simplifiedUnit = translateTerm(unit);
  return `${value} ${simplifiedUnit}`;
}

/**
 * Gets a comprehensive glossary for patient education
 * @returns Array of all terminology entries sorted by category
 */
export function getGlossary(): TerminologyEntry[] {
  return Object.values(TERMINOLOGY_MAP).sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.medical.localeCompare(b.medical);
  });
}
