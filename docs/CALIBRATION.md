# OcuRisk Calibration and Research Notes

OcuRisk is a research and educational screening prototype. The values below document the assumptions implemented in code; they do not constitute clinical validation or device clearance.

## Eccentric photorefraction

The spherical-equivalent estimate in `src/utils/opticsEngine.ts` uses:

```text
SE = sign · k · (c · workingDistanceCm)
     ----------------------------------
       flashEccentricityMm · pupilDiameterMm
```

- `sign` is negative for a top crescent, positive for a bottom crescent, and zero for a symmetric pattern.
- `c` is the detected crescent-height ratio.
- `k` defaults to `6.0`, used here as a published coaxial-flash constant.
- Working distance defaults to `100 cm`.
- Flash eccentricity defaults to `12 mm`.
- Output is clamped to `-10.0 D` through `+8.0 D` and rounded to `0.25 D`.

The default constant is not a universal camera calibration. Before any medical use, each camera/flash configuration would need comparison against reference measurements such as cycloplegic autorefraction or retinoscopy. Sensor crop, digital zoom, focus, exposure processing, flash offset, working distance, and pupil segmentation all affect the result.

## Iris ruler and distance assumptions

The MediaPipe path estimates pixels per millimetre from an assumed iris diameter:

- Adult iris diameter: `11.7 mm`
- Child iris diameter: `11.0 mm`

These are population averages, not measurements of the current user's iris. The distance utility also defaults to an approximate focal length of `600 px`. That value is device-dependent and is not read from camera calibration metadata. Pupil diameter and distance are therefore screening estimates until a known-size target or device-specific calibration is used.

## Research integrations

| Integration | What this repository implements | Status |
| --- | --- | --- |
| Li et al. (2024)-labelled 12-month progression | A deterministic calculation using prototype coefficients and available profile/refractive inputs | Illustrative reconstruction, not the published trained model |
| Foo et al. (2023)-labelled five-year high-myopia risk | A deterministic logistic-style calculation using profile/refractive inputs; no fundus adapter is used | Illustrative reconstruction, not the published trained model |

The application does not report published AUC or MAE values as performance achieved by this code. The integrations require independent validation before any clinical interpretation.

## Confidence scores

Photorefraction confidence is a heuristic signal-quality score, normally clamped to `55–97`. It rewards plausible pupil size and reflex range and penalizes edge-case crescent measurements. It is not a confidence interval, calibrated probability of correctness, sensitivity/specificity result, or regulatory performance measure.

## CRADLE-style red-reflex flag

The live eye tracker marks an individual frame as abnormal when the red-reflex ratio is above `0.88` or below `0.35`. The temporal detector keeps a five-frame window and requires at least three positive frames plus a flash-proximity score above `0.55`.

This output is a referral-support flag only. It does not diagnose leukocoria, retinoblastoma, cataract, or any other disease. Lighting, flash activity, exposure, pupil localization, and image artifacts can produce false signals. An abnormal flag should be professionally assessed; a normal flag does not rule out disease.

## Other measurement boundaries

- Manual NPC and accommodative lag are self-reported or externally measured; a standard webcam cannot directly measure them.
- The Step 3 camera NPC value is only a vergence-trend proxy based on changing interpupillary pixel distance and never replaces the manual NPC field.
- Microsaccade event frequency uses an Engbert-Kliegl-style velocity threshold when enough tracked points and events exist. A clearly marked neutral fallback is used when no reliable event is detected.
- The pupil-boundary radial-contrast correction is an image-space refinement, not a physical millimetre calibration.

