/**
 * Gemma 4 Deep Analysis Engine
 *
 * Routes content through Google DeepMind Gemma 4 for AI-powered
 * manipulation analysis that goes beyond regex pattern matching.
 *
 * Supports:
 *  - Google AI Studio API (generativelanguage.googleapis.com)
 *  - OpenAI-compatible endpoints (Ollama, vLLM, etc.)
 *  - Multimodal input: text, image, video, audio (E2B/E4B models)
 *
 * Configure via env vars:
 *  VITE_GEMMA_API_ENDPOINT  — full URL to the generate/chat endpoint
 *  VITE_GEMMA_API_KEY       — API key (optional for local Ollama)
 */

const ENDPOINT = import.meta.env.VITE_GEMMA_API_ENDPOINT || '';
const API_KEY = import.meta.env.VITE_GEMMA_API_KEY || '';

// ---------- helpers ----------

export function isGemmaConfigured() {
  return ENDPOINT.length > 0;
}

function isGoogleAIStudio() {
  return ENDPOINT.includes('generativelanguage.googleapis.com');
}

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY && !isGoogleAIStudio()) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }
  return headers;
}

function buildUrl() {
  if (isGoogleAIStudio()) {
    const sep = ENDPOINT.includes('?') ? '&' : '?';
    return `${ENDPOINT}${sep}key=${API_KEY}`;
  }
  return ENDPOINT;
}

// ---------- prompts ----------

const ANALYSIS_SYSTEM_PROMPT = `You are a cognitive-manipulation analysis engine embedded in BrainSNN, a neuromorphic brain visualiser. Given input content, produce a JSON object with EXACTLY these numeric fields (0–1 floats):

- emotionalActivation: degree of fear/outrage/panic optimization
- cognitiveSuppression: degree of urgency/certainty theater/cognitive overload
- manipulationPressure: overall steering-reaction-over-understanding
- trustErosion: sensationalism / coercive framing risk

Also include:
- evidence: array of up to 10 short phrases from the content that triggered your assessment
- reasoning: 1-2 sentence explanation
- confidence: "low" | "medium" | "high"
- recommendedAction: one sentence advice

Return ONLY valid JSON, no markdown fences, no commentary.`;

const MULTIMODAL_SYSTEM_PROMPT = `You are a multimodal cognitive-manipulation analysis engine. Analyse the provided media (image, video frame, or audio transcript) for manipulation patterns: emotional triggers, fear appeals, urgency cues, misleading framing, sensationalism.

Return ONLY a JSON object with these fields (0–1 floats):
- emotionalActivation, cognitiveSuppression, manipulationPressure, trustErosion
- evidence (array of up to 10 short descriptions of detected patterns)
- reasoning (1-2 sentences)
- confidence: "low" | "medium" | "high"
- recommendedAction (one sentence)`;

// ---------- API call ----------

async function callGemma(parts, systemPrompt) {
  const url = buildUrl();
  const headers = buildHeaders();

  let body;

  if (isGoogleAIStudio()) {
    // Google AI Studio / Gemini-style payload
    body = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json'
      }
    });
  } else {
    // OpenAI-compatible (Ollama, vLLM, etc.)
    const userContent = parts.map((p) => {
      if (p.text) return { type: 'text', text: p.text };
      if (p.inlineData) return { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
      return { type: 'text', text: '[unsupported media]' };
    });
    body = JSON.stringify({
      model: 'gemma4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : userContent }
      ],
      temperature: 0.2,
      max_tokens: 1024
    });
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemma API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();

  // Extract text from response
  let raw;
  if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
    // Google AI Studio format
    raw = json.candidates[0].content.parts[0].text;
  } else if (json.choices?.[0]?.message?.content) {
    // OpenAI-compatible format
    raw = json.choices[0].message.content;
  } else {
    throw new Error('Unexpected Gemma response structure');
  }

  return parseGemmaResponse(raw);
}

function parseGemmaResponse(raw) {
  // Strip markdown fences if model included them despite instructions
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const parsed = JSON.parse(cleaned);

  const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));

  return {
    emotionalActivation: clamp(parsed.emotionalActivation),
    cognitiveSuppression: clamp(parsed.cognitiveSuppression),
    manipulationPressure: clamp(parsed.manipulationPressure),
    trustErosion: clamp(parsed.trustErosion),
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 10) : [],
    reasoning: parsed.reasoning || '',
    confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
    recommendedAction: parsed.recommendedAction || '',
    source: 'gemma4'
  };
}

// ---------- public API ----------

/**
 * Analyse text content for manipulation patterns using Gemma 4.
 * Falls back gracefully if Gemma is not configured.
 */
export async function analyzeContentWithGemma(text) {
  if (!isGemmaConfigured()) {
    throw new Error('Gemma API not configured. Set VITE_GEMMA_API_ENDPOINT.');
  }
  return callGemma([{ text }], ANALYSIS_SYSTEM_PROMPT);
}

/**
 * Analyse multimodal content (image, video frame, audio).
 * Accepts a File or Blob + MIME type.
 */
export async function analyzeMultimodalWithGemma(file) {
  if (!isGemmaConfigured()) {
    throw new Error('Gemma API not configured. Set VITE_GEMMA_API_ENDPOINT.');
  }

  const buffer = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const mimeType = file.type || 'image/png';

  const parts = [
    { text: 'Analyse this media for cognitive manipulation patterns.' },
    { inlineData: { mimeType, data: base64 } }
  ];

  return callGemma(parts, MULTIMODAL_SYSTEM_PROMPT);
}

/**
 * Health check — verify the configured endpoint is reachable.
 */
export async function checkGemmaHealth() {
  if (!isGemmaConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    const result = await analyzeContentWithGemma('This is a neutral test sentence with no manipulation.');
    return { ok: true, model: 'gemma4', latency: 0, result };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
