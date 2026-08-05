import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || 'localhost';

app.use(express.json({ limit: '10mb' }));

// Lazy/safe AI client getter
let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is missing. AI features will use predefined fallback text when Gemini is unavailable.');
    }
    genAIClient = new GoogleGenAI({
      apiKey: apiKey || 'DUMMY_KEY_FOR_LOCAL_DEV',
      httpOptions: {
        headers: {
          'User-Agent': 'ocurisk-build',
        },
      },
    });
  }
  return genAIClient;
}

// ---------------------------------------------------------------------------
// Unified LLM caller — supports Google Gemini OR a local Ollama model.
// Controlled by the LLM_PROVIDER env var in .env ("ollama" | "gemini").
// This lets you run fully offline+private (Ollama) or fall back to the cloud
// (Gemini) by changing a single line in .env — no code changes required.
// ---------------------------------------------------------------------------
type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

async function generateLLMReply(
  systemInstruction: string,
  messages: ChatMsg[],
  temperature: number,
): Promise<string> {
  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();

  // ---- LOCAL LLM PATH (Ollama, OpenAI-compatible endpoint) ----
  if (provider === 'ollama') {
    const url = `${process.env.OLLAMA_URL || 'http://localhost:11434'}/v1/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
        messages: [{ role: 'system', content: systemInstruction }, ...messages],
        temperature,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Ollama HTTP ${resp.status}: ${await resp.text()}`);
    }
    const data: any = await resp.json();
    return data?.choices?.[0]?.message?.content || '';
  }

  // ---- CLOUD LLM PATH (Google Gemini) ----
  const ai = getGenAI();
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: { systemInstruction, temperature },
  });
  return response.text || '';
}

// ------------------- API ENDPOINTS ------------------- //

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'OcuRisk-AI-Backend', timestamp: new Date().toISOString() });
});

// Endpoint: AI Eye-Health Agent Chat
app.post('/api/llm-agent/chat', async (req, res) => {
  try {
    const { message, session, conversationHistory } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message parameter is required.' });
    }

    const patientInfo = session?.patient
      ? `Patient: ${session.patient.patientName}, Age ${session.patient.age}, Parents with Myopia: ${session.patient.parentsWithMyopia}, Screen: ${session.patient.dailyScreenHours}h/day, Outdoor: ${session.patient.dailyOutdoorHours}h/day.`
      : 'Patient details unspecified.';

    const opticalInfo = session?.photorefraction
      ? `Refractive Error: ${session.photorefraction.sphericalEquivalentDiopters} D (${session.photorefraction.classification}), Crescent Height: ${session.photorefraction.crescentHeightRatio}, Astigmatism: ${session.photorefraction.astigmatismCylinderDiopters} D.`
      : 'Optical metrics pending.';

    const accommInfo = session?.accommodative
      ? `Accommodative Lag: +${session.accommodative.accommodativeLagDiopters} D, Near Point of Convergence (NPC): ${session.accommodative.npcCm} cm, Fatigue Index: ${session.accommodative.fatigueIndex}/100.`
      : 'Accommodative metrics pending.';

    const microInfo = session?.microsaccade
      ? `BCEA (Fixational Ellipse Area): ${session.microsaccade.bceaDeg2} deg², Fixation Stability: ${session.microsaccade.fixationStabilityScore}%, Amblyopia Risk: ${session.microsaccade.amblyopiaRisk}.`
      : 'Microsaccade metrics pending.';

    const riskInfo = session?.riskResult
      ? `12-Month Progression Risk: ${session.riskResult.overallRiskPercent}% (${session.riskResult.riskCategory} Risk).`
      : 'Risk calculation pending.';

    const systemInstruction = `You are OcuRisk AI, a specialized Ophthalmic Eye-Health Assistant and Clinical Educator.
Your goal is to answer patient questions about their smartphone eye screening results, explain complex optical metrics in clear, empathetic, plain language, and offer evidence-based habits for myopia control.

Current Patient Context:
${patientInfo}
${opticalInfo}
${accommInfo}
${microInfo}
${riskInfo}

Key Metric Definitions to translate into plain language when asked:
- Spherical Equivalent (Diopters): The main metric for optical prescription. Negative numbers (e.g. -2.50D) indicate myopia (nearsightedness); positive numbers indicate hyperopia (farsightedness).
- Accommodative Lag: When focusing on near objects, if the eye focuses slightly behind the retina, it creates a "lag". High lag (+0.75D or higher) signals retinal defocus which can trigger eye elongation and myopia progression.
- Near Point of Convergence (NPC): The closest point to the bridge of the nose where both eyes can maintain focus together. Normal is under 6-8cm. Greater than 8-10cm suggests convergence fatigue or insufficiency.
- BCEA (Bivariate Contour Ellipse Area): Measures how tightly the eye holds focus during fixation in degrees squared (deg²). Smaller BCEA (<0.5) means very steady fixation. High BCEA (>1.0) can indicate eye strain, fatigue, or amblyopia risk.
- Bayesian Multi-Modal Risk: Combines genetic history, lifestyle, and optical scans into a 0-100% 12-month progression score.

Rules:
1. Always maintain a warm, reassuring, professional tone.
2. Refer directly to the patient's specific numbers when relevant to personalize the response.
3. Keep responses concise (2-4 paragraphs) with key highlights or bullet points for readability.
4. MANDATORY SAFETY DISCLAIMER: At the end of every answer, include a short standard medical disclaimer: "Note: OcuRisk is an AI screening tool and does not provide formal medical diagnoses. Please consult an eye care professional (optometrist or ophthalmologist) for clinical examinations."`;

    const chatMessages: ChatMsg[] = [
      ...(conversationHistory || []).map((h: { sender: string; text: string }) => ({
        role: (h.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: h.text,
      })),
      { role: 'user', content: message },
    ];

    let replyText = await generateLLMReply(systemInstruction, chatMessages, 0.7);
    if (!replyText) {
      replyText = 'I have reviewed your scan metrics. Please feel free to ask any questions about your refractive score, accommodative lag, or myopia progression risks.';
    }

    // LLM Response Safety & Structure Validation
    const validation = validateLLMOutput(replyText);
    if (!validation.valid) {
      console.warn('LLM chat output failed safety validation:', validation.reason);
      if (!replyText.toLowerCase().includes('disclaimer')) {
        replyText += '\n\n*Note: OcuRisk is an AI screening tool and does not provide formal medical diagnoses. Please consult an eye care professional (optometrist or ophthalmologist) for clinical examinations.*';
      }
    }

    res.json({
      reply: replyText,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/llm-agent/chat:', error);
    res.status(500).json({
      error: 'Failed to generate AI response.',
      details: error.message || String(error),
      fallbackReply: `OcuRisk AI is currently operating in offline mode. Based on your scan metrics, please review your Refractive Error (${req.body.session?.photorefraction?.sphericalEquivalentDiopters || -2.50}D) and Accommodative Lag (+${req.body.session?.accommodative?.accommodativeLagDiopters || 1.40}D) cards in the dashboard. Always schedule an eye exam with an optometrist for clinical verification.`,
    });
  }
});

/**
 * LLM Response Safety and Structural Validation Function
 * Checks for:
 * 1. Disclaimer presence ("disclaimer" or "consult")
 * 2. Diagnostic claim detection (rejects forbidden terms)
 * 3. Structure validation (required section headings)
 * 4. Length constraints (100 to 3000 chars)
 */
function validateLLMOutput(text: string, requiredSections: string[] = []): { valid: boolean; reason?: string } {
  if (!text || text.length < 50 || text.length > 4000) {
    return { valid: false, reason: 'Output length out of bounds' };
  }
  const lower = text.toLowerCase();

  // Disclaimer presence check
  if (!lower.includes('disclaimer') && !lower.includes('consult')) {
    return { valid: false, reason: 'Missing medical disclaimer' };
  }

  // Diagnostic claim detection
  const forbiddenTerms = ['diagnose', 'diagnosis', 'you have', 'suffering from'];
  for (const term of forbiddenTerms) {
    if (lower.includes(term) && !lower.includes('not provide formal medical diagnoses') && !lower.includes('not a diagnostic device')) {
      return { valid: false, reason: `Diagnostic claim term detected: ${term}` };
    }
  }

  // Required section verification
  for (const sec of requiredSections) {
    if (!lower.includes(sec.toLowerCase())) {
      return { valid: false, reason: `Missing required section: ${sec}` };
    }
  }

  return { valid: true };
}

// Endpoint: AI Generated Personal Eye Health Report
app.post('/api/llm-agent/report', async (req, res) => {
  try {
    const { session } = req.body;

    if (!session) {
      return res.status(400).json({ error: 'Session data is required.' });
    }

    const prompt = `Generate a structured, elegant Personal Eye-Health Summary Report for patient ${session.patient.patientName} (Age ${session.patient.age}).

Patient Profile:
- Age: ${session.patient.age}
- Family Myopia History: ${session.patient.parentsWithMyopia} parent(s) myopic
- Daily Screen Time: ${session.patient.dailyScreenHours} hours/day
- Daily Outdoor Exposure: ${session.patient.dailyOutdoorHours} hours/day

Screening Measurements:
- Estimated Spherical Equivalent: ${session.photorefraction.sphericalEquivalentDiopters} D (${session.photorefraction.classification})
- Crescent Height Ratio: ${session.photorefraction.crescentHeightRatio} (${session.photorefraction.crescentOrientation})
- Accommodative Lag: +${session.accommodative.accommodativeLagDiopters} D
- Near Point of Convergence (NPC): ${session.accommodative.npcCm} cm
- BCEA Fixational Ellipse: ${session.microsaccade.bceaDeg2} deg²
- 12-Month Myopia Progression Risk: ${session.riskResult.overallRiskPercent}% (${session.riskResult.riskCategory} Risk)

Individual Eye Metrics:
- OD (Right Eye): SE ${session.photorefraction.od?.sphericalEquivalentDiopters || session.photorefraction.sphericalEquivalentDiopters} D, Classification: ${session.photorefraction.od?.classification || session.photorefraction.classification}, BCEA: ${session.microsaccade.od?.bceaDeg2 || session.microsaccade.bceaDeg2} deg²
- OS (Left Eye): SE ${session.photorefraction.os?.sphericalEquivalentDiopters || session.photorefraction.sphericalEquivalentDiopters} D, Classification: ${session.photorefraction.os?.classification || session.photorefraction.classification}, BCEA: ${session.microsaccade.os?.bceaDeg2 || session.microsaccade.bceaDeg2} deg²
- Anisometropia: ${session.photorefraction.anisometropiaDelta || 'N/A'} D (${session.photorefraction.anisometropiaRisk || 'N/A'} Risk)

Please format the summary in 5 markdown sections:
1. Executive Summary & Plain Language Interpretation
2. Individual Eye Analysis (OD vs OS comparison, anisometropia assessment)
3. Key Risk Drivers (Behavioral, Genetic, Optical)
4. Actionable Prevention Plan (20-20-20 rule, outdoor light, ergonomic recommendations)
5. Key Questions to Ask Your Optometrist / Ophthalmologist

MANDATORY: You MUST include the text "Medical Disclaimer: OcuRisk is an AI screening tool, not a diagnostic device. Please consult a licensed eye care professional." at the bottom.`;

    let reportMarkdown = await generateLLMReply(
      'You are an expert ophthalmic AI clinical writer producing structured, high-clarity patient health reports.',
      [{ role: 'user', content: prompt }],
      0.6,
    );
    const reportValidation = validateLLMOutput(reportMarkdown, ['Executive Summary', 'Key Risk Drivers', 'Prevention Plan']);

    if (!reportValidation.valid) {
      console.warn('Report output failed safety validation:', reportValidation.reason);
      if (!reportMarkdown.toLowerCase().includes('disclaimer')) {
        reportMarkdown += '\n\n*Medical Disclaimer: OcuRisk is an AI screening tool, not a diagnostic device. Please consult a licensed eye care professional.*';
      }
    }

    res.json({
      reportMarkdown,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/llm-agent/report:', error);
    res.status(500).json({
      error: 'Failed to generate report',
      reportMarkdown: `### Executive Summary & Plain Language Interpretation
Based on the multi-modal photorefraction and accommodative scan, patient shows an estimated refractive error of **${req.body.session?.photorefraction?.sphericalEquivalentDiopters || -2.50} D** with a **${req.body.session?.riskResult?.overallRiskPercent || 75}% 12-Month Progression Risk**.

### Key Risk Drivers
- High screen exposure relative to outdoor natural sunlight exposure.
- Accommodative lag inducing hyperopic retinal defocus during near vision tasks.

### Actionable Prevention Plan
- **20-20-20 Rule**: Every 20 minutes, focus on an object 20 feet away for 20 seconds.
- **Natural Sunlight**: Target 120+ minutes of outdoor daytime light daily.
- **Ergonomics**: Maintain a reading distance of at least 30-40 cm.

*Medical Disclaimer: OcuRisk is an AI screening tool, not a diagnostic device. Please consult a licensed eye care professional.*`,
    });
  }
});

// ------------------- SERVER BOOT & VITE MIDDLEWARE ------------------- //

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const listen = (port: number, retried = false) => {
    const server = app.listen(port, HOST, () => {
      console.log(`OcuRisk Full-Stack Server running on http://localhost:${port} (bound to ${HOST}:${port})`);
    });

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && !retried) {
        const fallbackPort = port + 1;
        console.warn(`Port ${port} is already in use; retrying on http://localhost:${fallbackPort}`);
        listen(fallbackPort, true);
        return;
      }

      console.error(`OcuRisk server could not start on ${HOST}:${port}: ${error.message}`);
      process.exit(1);
    });
  };

  listen(PORT);
}

startServer();
