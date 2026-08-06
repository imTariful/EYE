# Run OcuRisk locally

## Prerequisites

Node.js 20, 22, 23, or 24, a modern browser, and a webcam.

## Setup

Run `npm install`, then create `.env` in the project root. For local offline AI, configure Ollama:

```env
LLM_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
PORT=3000
HOST=localhost
```

## Run dev

Run `npm run dev`, then open http://localhost:3000 (not port 5173).

The server automatically creates the local SQLite database at `data/ocurisk.db`. No separate database server or manual schema creation is needed.

To inspect saved sessions manually, open `data/ocurisk.db` in DB Browser for SQLite and select the `scan_sessions` table under **Browse Data**.

## Run prod

Run `npm run build` and then `npm start`.

## Browser camera permission

Allow camera access when prompted. Chrome or Edge is recommended.

## Offline behaviour

The camera, calculations, localStorage and SQLite persistence run locally. With Ollama running and the configured model downloaded in advance, AI chat and report generation also work without internet. Gemini mode requires internet; fallback text is shown if the selected AI provider is unavailable.

## Troubleshooting

If the port is in use, set the `PORT` environment variable. For a black camera feed, check your operating system's camera privacy settings.
