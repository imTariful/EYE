# Run OcuRisk locally

## Prerequisites

Node 18+, a modern browser, and a webcam.

## Setup

Run `npm install`, then copy `.env.example` to `.env` and add your Gemini API key.

## Run dev

Run `npm run dev`, then open http://localhost:3000 (not port 5173).

The server automatically creates the local SQLite database at `data/ocurisk.db`. No separate database server or manual schema creation is needed.

To inspect saved sessions manually, open `data/ocurisk.db` in DB Browser for SQLite and select the `scan_sessions` table under **Browse Data**.

## Run prod

Run `npm run build` and then `npm start`.

## Browser camera permission

Allow camera access when prompted. Chrome or Edge is recommended.

## Offline behaviour

The app runs offline and the camera uses on-device vision. AI chat and report generation need internet; fallback text is shown while offline.

## Troubleshooting

If the port is in use, set the `PORT` environment variable. For a black camera feed, check your operating system's camera privacy settings.
