import { GoogleGenAI } from "@google/genai";

// ─── Real, stable, available models only ────────────────────────────────────
export const STABLE_MODELS = {
  GeminiFlash:     "gemini-2.0-flash",
  GeminiFlashLite: "gemini-2.0-flash-lite",
  Groq:            "llama-3.3-70b-versatile",
};

// ─── Types ───────────────────────────────────────────────────────────────────
export interface KeywordInfo {
  term: string;
  seoTier: "High" | "Medium" | "Low";
}

export interface GeneratedMetadata {
  title: string;
  description: string;
  categories: { platform: string; category: string }[];
  keywords: KeywordInfo[];
  suggestedKeywords: string[];
  marketInsight?: string;
  seoScore?: number;
  seoInsights?: { label: string; value: string; impact: string }[];
}

// ─── Image compression (saves 60-80% tokens) ─────────────────────────────────
export async function compressImageBase64(
  base64: string,
  maxDimension = 1024,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) { height = Math.round(height * maxDimension / width); width = maxDimension; }
        else { width = Math.round(width * maxDimension / height); height = maxDimension; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.onerror = () => resolve(base64);
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────
function extractJson(text: string): string {
  if (!text) return "{}";
  const md = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md?.[1]) return md[1].trim();
  const first = text.indexOf("{");
  if (first === -1) return "{}";
  let depth = 0, inStr = false, esc = false;
  for (let i = first; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) return text.substring(first, i + 1); }
    }
  }
  return text.substring(first) || "{}";
}

function repairJson(text: string): string {
  let s = text.trim();
  if (!s) return "{}";
  const f = s.indexOf("{"), l = s.lastIndexOf("}");
  if (f !== -1 && l !== -1 && f < l) s = s.substring(f, l + 1);
  s = s.replace(/\\n/g, " ").replace(/\n/g, " ");
  try { return JSON.stringify(JSON.parse(s)); } catch (_) {}
  // Best-effort repairs
  if ((s.match(/"/g) || []).length % 2 !== 0) s += '"';
  let opens = (s.match(/{/g) || []).length;
  let closes = (s.match(/}/g) || []).length;
  while (opens > closes) { s += "}"; closes++; }
  try { return JSON.stringify(JSON.parse(s)); } catch (_) { return "{}"; }
}

// ─── Keyword cleaner ──────────────────────────────────────────────────────────
const STOPWORDS = new Set(["a","an","the","and","or","but","if","then","else","when","at","from","by","for","with","in","on","to","of","is","it","its","my","your","their","our","this","that","are","was","were","has","have","had","be","been","being","do","does","did","will","would","could","should","may","might","shall","must","can"]);

function cleanKeywords(keywords: string[], limit: number): string[] {
  return [...new Set(
    keywords
      .map(k => k.trim().toLowerCase().replace(/[^a-z0-9\-]/g, ""))
      .filter(k => k.length >= 2 && !STOPWORDS.has(k))
  )].slice(0, limit);
}

// ─── Low-level API callers ────────────────────────────────────────────────────
async function callGemini(key: string, model: string, parts: any[]): Promise<string> {
  const genAI = new GoogleGenAI({ apiKey: key });
  const result = await genAI.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { temperature: 0.15, responseMimeType: "application/json" },
  });
  return result.text ?? "{}";
}

async function callGroq(key: string, model: string, messages: any[]): Promise<string> {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const msg = errBody?.error?.message || resp.statusText;
    const err = new Error(`Groq ${resp.status}: ${msg}`);
    (err as any).status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "{}";
}

// ─── Sleep helper ─────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Visual context cache ─────────────────────────────────────────────────────
const visualContextCache = new Map<string, string>();

async function analyzeVisual(
  data: string | string[],
  mimeType: string,
  mediaType: string,
  geminiKey: string
): Promise<string> {
  const cacheKey = (Array.isArray(data) ? data[0] : data).substring(0, 40);
  if (visualContextCache.has(cacheKey)) return visualContextCache.get(cacheKey)!;

  const parts: any[] = [];
  if (Array.isArray(data)) {
    [0, Math.floor(data.length / 2)].forEach(i => {
      if (data[i]) parts.push({ inlineData: { data: data[i], mimeType: "image/jpeg" } });
    });
  } else {
    parts.push({ inlineData: { data, mimeType } });
  }
  parts.push({
    text: `Visual audit for microstock SEO (max 100 words): 1.Main subject 2.Secondary objects 3.Setting 4.Lighting & mood 5.Commercial use case${mediaType === "Video" ? " 6.Camera movement" : ""}. Be concise.`,
  });

  try {
    const genAI = new GoogleGenAI({ apiKey: geminiKey });
    const result = await genAI.models.generateContent({
      model: STABLE_MODELS.GeminiFlash,
      contents: [{ role: "user", parts }],
      config: { temperature: 0.1 },
    });
    const ctx = result.text ?? "";
    if (ctx) visualContextCache.set(cacheKey, ctx);
    return ctx;
  } catch (e) {
    console.warn("Visual analysis failed, continuing without it:", e);
    return "";
  }
}

// ─── Build metadata prompt ────────────────────────────────────────────────────
function buildMetadataPrompt(opts: {
  visualCtx: string; fileName: string; theme: string;
  mediaType: string; mediaHint: string;
  platforms: string[]; language: string;
  titleCount: number; descCount: number; numberOfKeywords: number;
}): string {
  const adobeCats = "Animals,Architecture,Business,Drinks,Environment,States of Mind,Food,Graphic Resources,Hobbies,Industry,Landscapes,Lifestyle,People,Plants,Culture,Science,Social Issues,Sports,Technology,Transport,Travel";
  const visual = opts.visualCtx || `File: ${opts.fileName} | Theme: ${opts.theme}`;
  return `You are an elite microstock metadata engineer optimizing for ${opts.platforms.join(", ")} in 2026.

VISUAL CONTEXT: ${visual}
MEDIA TYPE: ${opts.mediaType} — ${opts.mediaHint}
OUTPUT LANGUAGE: ${opts.language}

RULES:
1. NO brands/trademarks/IP — use generics ("smartphone" not "iPhone").
2. TITLE: Most searchable subject first. Target ~${opts.titleCount} chars (hard max ${opts.titleCount}).
3. DESCRIPTION: One professional SEO sentence. Target ~${opts.descCount} chars (hard max ${opts.descCount}).
4. KEYWORDS: Exactly ${opts.numberOfKeywords} unique single-word terms, ordered by search importance.
5. CATEGORIES: Exactly one per platform [${opts.platforms.join(", ")}].
   Adobe Stock must use one of: ${adobeCats}.
6. seoScore: integer 1-100.
7. seoInsights: exactly 2 objects [{label, value, impact}].
8. marketInsight: 1 sentence on commercial potential.

Respond ONLY with valid JSON matching this exact structure:
{
  "title": "",
  "description": "",
  "categories": [{"platform": "", "category": ""}],
  "keywords": [{"term": "", "seoTier": "High"}],
  "marketInsight": "",
  "seoScore": 75,
  "seoInsights": [{"label": "", "value": "", "impact": ""}]
}`;
}

// ─── Parse & clean raw JSON response ─────────────────────────────────────────
function parseMetadata(raw: string, titleCount: number, descCount: number, numberOfKeywords: number): GeneratedMetadata {
  const parsed = JSON.parse(repairJson(extractJson(raw))) as GeneratedMetadata;

  if (parsed.title) parsed.title = parsed.title.trim().substring(0, titleCount);
  if (parsed.description) parsed.description = parsed.description.trim().substring(0, descCount);

  if (Array.isArray(parsed.keywords)) {
    const terms = parsed.keywords.map((kw: any) => typeof kw === "string" ? kw : (kw.term ?? ""));
    const cleaned = cleanKeywords(terms, numberOfKeywords);
    parsed.keywords = cleaned.map((term, i) => ({
      term,
      seoTier: (i < 10 ? "High" : i < 30 ? "Medium" : "Low") as "High" | "Medium" | "Low",
    }));
  } else {
    parsed.keywords = [];
  }

  if (Array.isArray(parsed.categories)) {
    const seen = new Set<string>();
    parsed.categories = parsed.categories
      .map((c: any) => typeof c === "string"
        ? { platform: "General", category: c }
        : { platform: c.platform ?? "General", category: c.category ?? "Unknown" })
      .filter(c => { if (seen.has(c.platform)) return false; seen.add(c.platform); return true; });
  } else {
    parsed.categories = [];
  }

  if (!parsed.suggestedKeywords) parsed.suggestedKeywords = [];
  return parsed;
}

// ─── generateAIPrompts ────────────────────────────────────────────────────────
export async function generateAIPrompts(
  type: "Background" | "PNG Asset",
  subject: string,
  style: string,
  negativePrompt: string,
  count: number,
  finishing?: string,
  apiKeys?: string[],
  targetAI: string = "Midjourney",
  aspectRatio: string = "3:2",
  modelName: string = STABLE_MODELS.GeminiFlashLite,
  provider: "Gemini" | "Groq" = "Gemini"
): Promise<string[]> {
  const keys = (apiKeys || []).filter(Boolean);
  if (keys.length === 0) return [];

  const arParam = targetAI === "Midjourney" ? ` --ar ${aspectRatio}` : "";
  const aiHint =
    targetAI === "Midjourney" ? `Natural language + keywords. End every prompt with "${arParam}".` :
    targetAI === "DALL-E 3" ? "Highly detailed natural language. Mention aspect ratio in text." :
    "Comma-separated weighted keywords: (subject:1.2), technical terms.";

  const isolationType =
    type === "PNG Asset"
      ? finishing?.includes("transparance") ? "transparent background, alpha channel, no background"
      : finishing?.includes("black") ? "isolated on solid black background"
      : "isolated on pure white background"
      : "";

  const prompt = `You are an expert ${targetAI} prompt engineer creating microstock assets for Adobe Stock.
Asset type: ${type} | Subject: ${subject} | Style: ${style} | AR: ${aspectRatio}
Negative: ${negativePrompt}${finishing ? ` | Finish: ${finishing}` : ""}

Rules:
- No IP, brands, or trademarks. Commercial viability required.
- Strict style purity: "${style}".
- ${aiHint}
${type === "PNG Asset" ? `- Every prompt MUST include: ${isolationType}, clean cut edges, no drop shadows.` : "- Every prompt MUST describe a full immersive edge-to-edge environment."}
- Each of the ${count} prompts must be COMPLETELY UNIQUE in composition, angle, and subject variation.

Output ONLY a JSON array of exactly ${count} prompt strings. No other text.`;

  for (const key of keys) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let raw: string;
        if (provider === "Groq") {
          raw = await callGroq(key, modelName, [{ role: "user", content: prompt }]);
        } else {
          // Use text-only for prompts (cheaper, no vision needed)
          const genAI = new GoogleGenAI({ apiKey: key });
          const result = await genAI.models.generateContent({
            model: modelName,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { temperature: 0.7 },
          });
          raw = result.text ?? "[]";
        }
        const cleaned = extractJson(raw).replace(/^\[/, "["); // ensure array
        const arr = JSON.parse(cleaned.startsWith("[") ? cleaned : `[${cleaned}]`);
        if (Array.isArray(arr) && arr.length > 0) return arr;
      } catch (e: any) {
        console.warn(`generateAIPrompts attempt ${attempt + 1} failed:`, e.message);
        if ((e.status === 429) || e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED")) {
          await sleep(3000 * (attempt + 1));
        } else {
          await sleep(800);
        }
      }
    }
  }
  return [];
}

// ─── generateSuggestedThemes ──────────────────────────────────────────────────
export async function generateSuggestedThemes(
  type: "Background" | "PNG Asset",
  apiKeys?: string[],
  modelName?: string,
  provider: "Gemini" | "Groq" = "Gemini"
): Promise<string[]> {
  const keys = (apiKeys || []).filter(Boolean);
  if (keys.length === 0) return [];

  // Always use lite/cheap model for this simple task
  const model = provider === "Groq" ? (modelName || STABLE_MODELS.Groq) : STABLE_MODELS.GeminiFlashLite;
  const prompt = `List 12 high-commercial-value theme ideas for ${type === "Background" ? "stock background images" : "isolated PNG stock assets"} on Adobe Stock in 2026. Topics: AI, sustainability, diverse lifestyle, health, abstract 3D, business. Output ONLY a JSON array of short strings (3-6 words each). No explanations.`;

  for (const key of keys) {
    try {
      let raw: string;
      if (provider === "Groq") {
        raw = await callGroq(key, model, [{ role: "user", content: prompt }]);
      } else {
        const genAI = new GoogleGenAI({ apiKey: key });
        const result = await genAI.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: { temperature: 0.5 },
        });
        raw = result.text ?? "[]";
      }
      // Try parsing as JSON array
      const extracted = raw.trim();
      const arrayMatch = extracted.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const arr = JSON.parse(arrayMatch[0]);
        if (Array.isArray(arr) && arr.length > 0) return arr;
      }
    } catch (e: any) {
      console.warn("generateSuggestedThemes failed:", e.message);
      if (e.status === 429) await sleep(2000);
    }
  }
  return [];
}

// ─── generateStockMetadata (main function) ────────────────────────────────────
export async function generateStockMetadata(
  base64Data: string | string[],
  mimeType: string,
  fileName: string,
  theme: string,
  numberOfKeywords: number,
  titleCount: number,
  descCount: number,
  language: string,
  mediaType: string,
  platforms: string[],
  apiKeys?: string[],
  modelName?: string,
  onStatusUpdate?: (message: string) => void,
  provider: "Gemini" | "Groq" = "Gemini"
): Promise<GeneratedMetadata> {

  const keys = (apiKeys || []).filter(Boolean);
  if (keys.length === 0) {
    throw new Error("No API keys provided. Please add at least one API key in Settings.");
  }

  const supportsVision = ["image/png","image/jpeg","image/webp","image/heic","image/heif"].includes(mimeType);

  // ── Compress images to save tokens ──────────────────────────────────────────
  let compressed: string | string[] = base64Data;
  if (supportsVision && !Array.isArray(base64Data)) {
    try { compressed = await compressImageBase64(base64Data, 1024, 0.82); } catch (_) {}
  } else if (Array.isArray(base64Data)) {
    try {
      compressed = await Promise.all(
        base64Data.slice(0, 2).map(f => compressImageBase64(f, 800, 0.78))
      );
    } catch (_) {}
  }

  // ── Media type hints ─────────────────────────────────────────────────────────
  const mediaHint =
    mediaType === "Video"  ? "Camera technique, movement, speed, lighting style. Include: 4k, cinematic, slow-motion." :
    mediaType === "Vektor" ? "Illustration style: flat/isometric/line art. Include: scalable, editable, vector." :
                             "Lighting quality, texture detail, commercial atmosphere, professional.";

  // ── Try Gemini ───────────────────────────────────────────────────────────────
  const tryGemini = async (model: string): Promise<GeneratedMetadata | null> => {
    // Step 1: Get visual description (uses cache after first call)
    let visualCtx = "";
    if (supportsVision && keys.length > 0) {
      onStatusUpdate?.("🔍 Analyzing visual content...");
      visualCtx = await analyzeVisual(compressed, mimeType, mediaType, keys[0]);
    }

    const prompt = buildMetadataPrompt({ visualCtx, fileName, theme, mediaType, mediaHint, platforms, language, titleCount, descCount, numberOfKeywords });

    // Step 2: Build parts — only attach image if visual analysis failed (fallback)
    const parts: any[] = [];
    if (supportsVision && !visualCtx) {
      // Attach image directly as fallback
      if (Array.isArray(compressed)) {
        (compressed as string[]).forEach(f => parts.push({ inlineData: { data: f, mimeType: "image/jpeg" } }));
      } else {
        parts.push({ inlineData: { data: compressed, mimeType } });
      }
    }
    parts.push({ text: prompt });

    for (const key of keys) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          onStatusUpdate?.(`⚡ Generating metadata [${model}]${attempt > 0 ? ` retry ${attempt}` : ""}...`);
          const raw = await callGemini(key, model, parts);
          const result = parseMetadata(raw, titleCount, descCount, numberOfKeywords);
          if (result.title) return result; // Only accept if we got a title
          throw new Error("Empty response from model");
        } catch (e: any) {
          const isQuota = e.status === 429 || e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED") || e.message?.includes("quota");
          const isModelError = e.message?.includes("404") || e.message?.includes("not found") || e.message?.includes("INVALID_ARGUMENT");
          console.warn(`Gemini ${model} attempt ${attempt + 1} failed:`, e.message);
          if (isModelError) break; // Don't retry with same bad model
          if (isQuota) {
            await sleep(4000 * (attempt + 1));
          } else {
            await sleep(1500 * (attempt + 1));
          }
        }
      }
    }
    return null;
  };

  // ── Try Groq ─────────────────────────────────────────────────────────────────
  const tryGroq = async (model: string): Promise<GeneratedMetadata | null> => {
    const prompt = buildMetadataPrompt({ visualCtx: `File: ${fileName} | Theme: ${theme}`, fileName, theme, mediaType, mediaHint, platforms, language, titleCount, descCount, numberOfKeywords });

    const userContent: any[] = [{ type: "text", text: prompt }];
    // Only Llama 4 Scout / Vision models support images
    if ((model.includes("llama-4") || model.includes("vision")) && !Array.isArray(compressed) && supportsVision) {
      userContent.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${compressed}` } });
    }

    for (const key of keys) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          onStatusUpdate?.(`⚡ Generating metadata [Groq/${model}]${attempt > 0 ? ` retry ${attempt}` : ""}...`);
          const raw = await callGroq(key, model, [{ role: "user", content: userContent }]);
          const result = parseMetadata(raw, titleCount, descCount, numberOfKeywords);
          if (result.title) return result;
          throw new Error("Empty response from Groq");
        } catch (e: any) {
          const isQuota = (e as any).status === 429 || e.message?.includes("429");
          const isModelError = (e as any).status === 404 || e.message?.includes("404") || e.message?.includes("not found");
          console.warn(`Groq ${model} attempt ${attempt + 1} failed:`, e.message);
          if (isModelError) break;
          if (isQuota) await sleep(5000 * (attempt + 1));
          else await sleep(1500 * (attempt + 1));
        }
      }
    }
    return null;
  };

  // ── Execution strategy based on selected provider ────────────────────────────
  let result: GeneratedMetadata | null = null;
  const primaryModel = modelName || (provider === "Groq" ? STABLE_MODELS.Groq : STABLE_MODELS.GeminiFlash);

  if (provider === "Gemini") {
    // Try selected model first
    result = await tryGemini(primaryModel);
    // Fallback to Flash if a different (possibly bad) model was selected
    if (!result && primaryModel !== STABLE_MODELS.GeminiFlash) {
      onStatusUpdate?.("🔄 Trying fallback Gemini model...");
      result = await tryGemini(STABLE_MODELS.GeminiFlash);
    }
    // Last resort: Flash Lite (most lenient quota)
    if (!result && primaryModel !== STABLE_MODELS.GeminiFlashLite) {
      onStatusUpdate?.("🔄 Trying Gemini Flash Lite...");
      result = await tryGemini(STABLE_MODELS.GeminiFlashLite);
    }
  } else {
    // Groq primary
    result = await tryGroq(primaryModel);
    // Fallback to Groq stable model
    if (!result && primaryModel !== STABLE_MODELS.Groq) {
      onStatusUpdate?.("🔄 Trying fallback Groq model...");
      result = await tryGroq(STABLE_MODELS.Groq);
    }
    // Final fallback: llama3-8b (highest free-tier limit)
    if (!result) {
      onStatusUpdate?.("🔄 Trying Groq llama3-8b...");
      result = await tryGroq("llama3-8b-8192");
    }
  }

  if (!result) {
    throw new Error(
      `Failed to generate metadata with ${provider}. ` +
      `Please verify your ${provider} API key is valid and has available quota. ` +
      `Try a different model or provider in Settings.`
    );
  }

  return result;
}
