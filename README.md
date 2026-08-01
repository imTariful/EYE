# OcuRisk AI Screening App

Multi-Modal Ophthalmic Screening & Photorefraction System for Myopia Risk Assessment.

## Overview

OcuRisk transforms standard smartphone camera hardware into an AI-powered ophthalmic tool. By analyzing pupillary red reflex crescents, accommodative lag dynamics, and fixational microsaccades, it computes a 12-month myopia progression risk score.

**Important:** This application requires manual data collection through the 6-step scanning workflow. All patient data is collected in real-time using device camera and sensors. No demo or pre-loaded data is included.

## Features

- **AI Photorefraction:** Analyzes pupil red reflex and crescent height patterns to estimate spherical equivalent refractive error
- **Auto-Capture Mode:** Intelligent flash trigger that automatically captures when conditions are perfect (correct distance, dark room, proper gaze direction)
- **Individual Eye Reporting:** Separate OD (Right Eye) and OS (Left Eye) metrics for comprehensive analysis
- **Anisometropia Detection:** Automatic detection and risk assessment of refractive asymmetry between eyes
- **Accommodative Testing:** Tracks Near Point of Convergence (NPC) and accommodative lag to detect eye strain
- **Microsaccade BCEA:** Computes Bivariate Contour Ellipse Area from fixational microsaccades using Savitzky-Golay smoothing
- **Bayesian Fusion Engine:** Synthesizes physical scans with genetic factors and behavioral habits
- **Visual Acuity Testing:** Digital Snellen E-chart for distance vision assessment
- **Media Upload:** Support for uploading images and videos for offline photorefraction analysis with blur detection
- **Quality Indicators:** Real-time feedback on lighting, fixation stability, and focus quality during scans
- **Navigation Guards:** Step validation ensuring minimum stable frames and quality thresholds before proceeding
- **Medical Terminology Translation:** Patient-friendly explanations of clinical terms
- **Corrected Myopia Prediction:** Li et al. 2024 model with accurate SE coefficient and age-based decay for 5-year trajectories
- **Thibos Power Vector Optics:** Converts between prescription formats and power vectors

## Prerequisites

- Node.js (v18 or higher)
- Modern web browser with camera access
- AI API key (for chat and report generation features)

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

Create a `.env.local` file in the project root:

```env
GEMINI_API_KEY=your_api_key_here
APP_URL=http://localhost:5173
```

## Running the Application

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Building for Production

```bash
npm run build
```

## 6-Step Scanning Workflow

1. **Welcome Screen** - Introduction to the system
2. **Patient Questionnaire** - Demographics, genetic factors, daily habits, visual acuity test
3. **Accommodative Scan** - Camera-based NPC and accommodative lag measurement
4. **Photorefraction Scan** - Red reflex analysis for refractive error estimation with intelligent auto-capture mode
5. **Fusion Processing** - Bayesian multi-modal risk calculation
6. **Results Report** - Comprehensive risk assessment with AI chat assistant

## Data Privacy

- All scan data is stored locally in your browser's localStorage
- No patient data is transmitted to external servers (except for AI API calls if enabled)
- History can be cleared at any time from the History drawer

## Medical Disclaimer

This tool is for screening purposes only and is not a substitute for professional medical diagnosis. Always consult with a qualified ophthalmologist for clinical decisions.

## Technology Stack

- **Frontend:** React, TypeScript, Vite
- **Styling:** Tailwind CSS
- **Computer Vision:** MediaPipe FaceLandmarker, OpenCV.js
- **Charts:** Recharts
- **AI Integration:** @google/genai

## License

This project is for educational and research purposes.
