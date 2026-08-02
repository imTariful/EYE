# OcuRisk AI Screening Prototype

Multi-modal, smartphone-oriented eye-health screening and myopia-risk research application.

> **Research and educational prototype:** OcuRisk is not a clinical diagnostic device and is not FDA-cleared or CE-marked. Its measurements and risk estimates are intended to demonstrate an early-warning and referral-support workflow. They must not be used to diagnose disease, prescribe lenses, or replace an examination by a licensed eye-care professional.

## Overview

OcuRisk combines a six-step React workflow with browser-based computer vision, questionnaire data, optical calculations, fixation analysis, deterministic risk fusion, and optional Gemini-generated explanations.

The application can:

- track facial and iris landmarks from a webcam;
- sample pupil-region red-channel intensity and estimate red-reflex crescent geometry;
- estimate spherical-equivalent refractive error with an eccentric-photorefraction formula;
- calculate fixation stability from tracked gaze points;
- combine optical, behavioral, genetic, symptom, and self-reported inputs into screening-risk outputs; and
- provide optional AI chat and a generated eye-health note through Google Gemini.

The repository includes pre-populated example values so the interface can be explored without clinical equipment. Camera-derived values remain sensitive to hardware, distance, lighting, image quality, and calibration.

## Features

- **MediaPipe iris and face tracking:** MediaPipe Tasks Vision `FaceLandmarker` supplies facial landmarks, iris landmarks, and blink blendshapes. GPU execution is attempted first, with a CPU delegate fallback.
- **Hand-written TypeScript computer vision:** When MediaPipe is unavailable, the browser uses YCbCr skin segmentation, estimated eye regions, Otsu-thresholded dark-region centroid search, pupil-boundary analysis, and Canvas `ImageData` processing. The project does **not** use OpenCV.js.
- **Red-reflex sampling:** Red-channel intensity is sampled from detected pupil regions. Brightness distribution across those regions is used to estimate crescent ratio and orientation.
- **Photorefraction estimation:** Crescent geometry, pupil diameter, working distance, and flash eccentricity are passed to the Howland-style calculation described below.
- **Per-eye reporting:** The results model supports separate OD and OS estimates and an anisometropia risk calculation.
- **Fixation stability and BCEA:** Camera-tracked fixation points are converted to Bivariate Contour Ellipse Area. Savitzky-Golay smoothing is used by default; a Kalman-filter smoothing path remains available as a fallback in the calculation utility.
- **Pupil micro-fluctuation fatigue estimate:** Step 3 analyzes a detected pupil-diameter history with FFT-based high-frequency fluctuation analysis. Insufficient histories use a neutral fallback rather than a fabricated measurement.
- **Honest NPC and accommodative-lag inputs:** A normal webcam cannot measure vergence break or accommodative response directly. NPC and accommodative lag are therefore clearly marked as self-reported/manual values, with optional entry of measurements obtained from an appropriate test.
- **Behavioral and visual inputs:** Age, family history, screen time, outdoor exposure, reading distance, symptoms, gender, and optional Snellen/logMAR results contribute to the prototype risk calculation.
- **Risk fusion and visualizations:** A deterministic prior-plus-likelihood scoring engine maps the combined evidence to beta-distribution parameters for the displayed probability curves and generates feature-contribution and trajectory data.
- **Research-inspired progression integrations:** The code contains prototype functions based on coefficients and risk factors labelled for Li et al. (2024) 12-month progression and Foo et al. (2023) five-year high-myopia risk. These are code-level research integrations, not bundled trained clinical models, and have not been clinically validated by this repository.
- **Thibos power vectors:** Utilities convert sphere/cylinder/axis values to and from `M`, `J0`, and `J45` power-vector representations.
- **Visual-acuity exercise:** Step 2 includes a stable tumbling-E interaction that records a Snellen/logMAR screening input.
- **Image and video upload:** Step 4 supports local image analysis and sampled video-frame analysis with blur-quality checks.
- **Optional Gemini assistance:** The results screen can request plain-language chat responses and a structured AI health note from Google Gemini through the Express server.
- **Local scan history:** Up to 20 completed scan sessions are stored in browser `localStorage` and can be restored or cleared from the History drawer.

## Photorefraction Calculation

The current spherical-equivalent estimate uses the following Howland-style eccentric-photorefraction relationship:

```text
SE = sign · k · (c · workingDistanceCm)
     ──────────────────────────────────
       flashEccentricityMm · pupilDiameterMm
```

Where:

- `SE` is the estimated spherical equivalent in diopters;
- `sign` is `-1` for a top crescent, `+1` for a bottom crescent, and `0` for a symmetric pattern;
- `c` is the crescent-height ratio;
- `k` defaults to `6.0`;
- working distance defaults to `100 cm`; and
- flash eccentricity defaults to `12 mm`.

The result is constrained to the implemented range and rounded to the nearest `0.25 D`. The value `k = 6.0` is used as a published coaxial-flash optical constant in this prototype. Per-device calibration against clinical reference measurements is future work; phone optics, sensor processing, flash geometry, and capture distance can materially affect the estimate.

## Prerequisites

- Node.js 18 or newer
- npm
- A modern browser, preferably Chrome or Edge
- A webcam or smartphone camera for live tracking features
- Internet access to load the MediaPipe WASM runtime and Face Landmarker model
- A Google Gemini API key for live AI chat and AI health-note generation

The screening workflow can still be explored without a Gemini key, but AI requests will fall back to locally defined error responses.

## Installation

1. Clone or download the repository.
2. Install dependencies from the project root:

   ```bash
   npm install
   ```

## Configuration

Copy `.env.example` to a file named `.env` in the project root:

```env
GEMINI_API_KEY=your_google_gemini_api_key
```

`server.ts` calls `dotenv.config()`, which loads `.env`. `GEMINI_API_KEY` is required for successful live Gemini chat and report requests.

Optional server variables supported by the code are:

```env
PORT=3000
HOST=localhost
```

`APP_URL` appears in the example environment file for hosting metadata but is not currently read by the application code.

Do not commit `.env`; it is excluded by `.gitignore`.

## Running the Application

Start the combined Express and Vite development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The Express server defaults to port `3000`. If that port is occupied, the current server implementation retries once on port `3001` and prints the selected address in the terminal.

### Production build

```bash
npm run build
npm start
```

The build command creates the Vite frontend and bundles `server.ts` to `dist/server.cjs`. The production server serves the compiled SPA from `dist`.

### Other scripts

```bash
npm run lint       # TypeScript type-check: tsc --noEmit
npm run preview    # Vite's standalone production preview
```

## Six-Step Screening Workflow

1. **Welcome** — explains the prototype and screening workflow.
2. **Questionnaire** — collects demographics, family history, visual habits, reading distance, symptoms, eyewear information, and optional tumbling-E visual acuity.
3. **Pupil and fixation scan** — tracks detected eye positions for BCEA and collects pupil-diameter history for a micro-fluctuation fatigue estimate. NPC and accommodative lag remain manual/self-reported inputs and are not inferred from the webcam.
4. **Photorefraction scan** — processes live camera frames or uploaded media, evaluates capture quality, samples pupil/red-reflex features, and calculates combined and per-eye refractive estimates.
5. **Fusion processing** — combines questionnaire and scan inputs into a prototype screening-risk score, beta-distribution visualization, feature contributions, and projected trajectories.
6. **Results** — displays combined and per-eye outputs, anisometropia and leukocoria screening flags, charts, scan history, optional Gemini chat, and the optional AI health note.

## Data Privacy and External Data Flow

- Completed scan sessions are stored locally in the browser under the `ocurisk_scan_history` `localStorage` key, with a maximum of 20 sessions.
- Camera and uploaded-media analysis is performed in the browser. The active photorefraction workflow does not upload images to the Express `/api/analyze-photo` endpoint.
- Ordinary local screening calculations do not require sending the session to Gemini.
- When the user sends an AI chat message, the frontend posts the message, recent conversation history, and the **full scan session** to `POST /api/llm-agent/chat` on the local Express server.
- When the user selects **Export AI Health Note**, the frontend posts the **full scan session** to `POST /api/llm-agent/report`.
- When Gemini access is configured and the request is attempted, those server routes include patient-profile and screening measurements in prompts forwarded to the Google Gemini API through `@google/genai`. This can include the patient identifier/name, age, family and lifestyle information, estimated photorefraction diopters, NPC, accommodative lag, fixation metrics, and risk results.
- Clearing the local History drawer removes saved browser history, but it cannot retract data already sent to Google through an AI request.

Do not enter directly identifying patient information or use the AI features with sensitive health data unless the intended privacy policy, consent process, and Google API data-handling terms have been reviewed for the deployment environment.

## Limitations

- **Single-camera/per-eye estimation constraints:** Measurements come from a monocular consumer-camera view and estimated eye regions. Per-eye outputs from the same frame are not equivalent to binocular clinical instrumentation.
- **Ambient-light dependence:** Red-reflex intensity, crescent detection, pupil boundaries, and blur measurements vary with room lighting, flash behavior, exposure, focus, and image quality.
- **Calibration required:** The `k = 6.0` constant and camera-distance assumptions require device-specific and population-level validation against clinical reference instruments before medical use.
- **NPC is not webcam-measured:** Near point of convergence is a manual/self-reported value, optionally obtained through a separate pen or push-up test.
- **Accommodative lag is not webcam-measured:** Entered lag values require an appropriate professional or validated measurement method.
- **Consumer-device variability:** Camera focal length, digital stabilization, image processing, sensor size, field of view, and flash offset differ between devices.
- **Research-model limitations:** Risk weights, thresholds, Li/Foo-labelled integrations, and trajectory calculations are prototype implementations and are not established as clinically accurate by this repository.
- **Fallback behavior:** When reliable camera measurements are unavailable, portions of the demonstration can use defaults or simulation-oriented fallback values. Such outputs must not be treated as patient measurements.
- **No clinical validation package:** The repository does not include prospective clinical trials, sensitivity/specificity analysis, regulatory documentation, or validation against cycloplegic refraction.

## Medical Disclaimer

OcuRisk is a research and educational screening prototype. It is not FDA-cleared, CE-marked, or approved as a medical device.

It is not a substitute for:

- cycloplegic autorefraction;
- retinoscopy;
- slit-lamp or dilated ophthalmic examination;
- calibrated photoscreening equipment; or
- assessment by a licensed optometrist or ophthalmologist.

Ambient lighting, camera distance, device optics, flash geometry, focus, movement, and calibration can materially affect results. An elevated or normal-looking output is not a diagnosis and must not be used to start, stop, or change treatment. Consult a licensed eye-care professional for any visual symptoms, abnormal reflex, suspected refractive error, or medical concern.

## Technology Stack

- **Frontend:** React 19, TypeScript, Vite 6
- **Styling:** Tailwind CSS 4
- **Backend:** Express 4 with Vite middleware in development
- **Computer vision:** MediaPipe Tasks Vision `FaceLandmarker` plus hand-written TypeScript/Canvas algorithms for YCbCr segmentation, Otsu thresholding, pupil-region analysis, red-channel sampling, blur variance, and crescent estimation
- **Signal processing and optics:** Savitzky-Golay and optional Kalman smoothing, BCEA, FFT-based pupil micro-fluctuation analysis, Howland-style photorefraction, beta-distribution risk visualization, progression calculations, and Thibos power vectors
- **Charts:** Recharts
- **Icons:** Lucide React
- **AI integration:** Google Gemini through `@google/genai`, called only from the Express server
- **Persistence:** Browser `localStorage`

## License

This repository is intended for educational and research demonstration. No separate open-source `LICENSE` file is currently included, so no additional reuse rights should be assumed unless the project owner adds or provides a license.
