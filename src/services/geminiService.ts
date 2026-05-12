import { GoogleGenAI } from "@google/genai";

// ─── Stable, real models only ──────────────────────────────────────────────
const STABLE_MODELS = {
  Gemini: "gemini-2.0-flash",          // cheapest multimodal, ~$0.10/1M tokens
  GeminiLite: "gemini-2.0-flash-lite", // even cheaper for text-only tasks
  Groq: "llama-3.3-70b-versatile",
};

// Model list that the UI can pick from — keeps only real, available models
const MODEL_FALLBACK_CHAIN = [STABLE_MODELS.Gemini];

// ─── Image compression before sending to API (saves ~60-80% tokens) ────────
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
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL("image/jpeg", quality).split(",")[1];
      resolve(compressed);
    };
    img.onerror = () => resolve(base64); // fallback: return as-is
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

// ─── JSON helpers ───────────────────────────────────────────────────────────
function extractJson(text: string): string {
  if (!text) return "{}";
  const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch?.[1]) return mdMatch[1].trim();
  const first = text.indexOf("{");
  if (first === -1) return text;
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
  return text.substring(first);
}

function repairJson(text: string): string {
  let s = text.trim();
  if (!s) return "{}";
  const f = s.indexOf("{"), l = s.lastIndexOf("}");
  if (f !== -1 && l !== -1 && f < l) s = s.substring(f, l + 1);
  s = s.replace(/\\n/g, " ").replace(/\n/g, " ");
  try { return JSON.stringify(JSON.parse(s)); } catch (_) {}
  if ((s.match(/"/g) || []).length % 2 !== 0) s += '"';
  let opens = (s.match(/{/g) || []).length;
  let closes = (s.match(/}/g) || []).length;
  while (opens > closes) { s += "}"; closes++; }
  try { return JSON.stringify(JSON.parse(s)); } catch (_) { return "{}"; }
}

// ─── Keyword cleaner ────────────────────────────────────────────────────────
const STOPWORDS = new Set(["a","an","the","and","or","but","if","then","else","when","at","from","by","for","with","in","on","to","of","is","it","its","my","your","their","our"]);

function cleanKeywords(keywords: string[], limit: number): string[] {
  return [...new Set(
    keywords
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length >= 2 && /^[a-z0-9\-\s]+$/.test(k))
      .map(k => k.split(/\s+/)[0])
      .filter(k => k.length >= 2 && !STOPWORDS.has(k))
  )].slice(0, limit);
}

// ─── Types ──────────────────────────────────────────────────────────────────
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

// ─── Simple rate-limit aware API caller ─────────────────────────────────────
async function callGemini(
  key: string,
  model: string,
  contents: any[],
  useJson = true
): Promise<string> {
  const genAI = new GoogleGenAI({ apiKey: key });
  const config: any = { temperature: 0.15 };
  if (useJson) config.responseMimeType = "application/json";
  const result = await genAI.models.generateContent({
    model,
    contents: [{ role: "user", parts: contents }],
    config,
  });
  return result.text || "{}";
}

async function callGroq(
  key: string,
  model: string,
  messages: any[],
  useJson = true
): Promise<string> {
  const body: any = { model, messages, temperature: 0.1 };
  if (useJson) body.response_format = { type: "json_object" };
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw Object.assign(new Error(`Groq ${resp.status}: ${err.error?.message || resp.statusText}`), { status: resp.status });
  }
  return (await resp.json()).choices[0]?.message?.content || "{}";
}

// ─── Visual context cache (avoids re-analyzing same image) ──────────────────
const visualContextCache = new Map<string, string>();

async function getVisualContext(
  base64Data: string | string[],
  mimeType: string,
  mediaType: string,
  geminiKey: string
): Promise<string> {
  const cacheKey = Array.isArray(base64Data)
    ? base64Data[0]?.substring(0, 40) ?? ""
    : base64Data.substring(0, 40);

  if (visualContextCache.has(cacheKey)) return visualContextCache.get(cacheKey)!;

  const parts: any[] = [];
  if (Array.isArray(base64Data)) {
    // Use only 2 frames (start + middle) for video — saves tokens vs 3
    const indices = [0, Math.floor(base64Data.length / 2)];
    indices.forEach(i => {
      if (base64Data[i]) parts.push({ inlineData: { data: base64Data[i], mimeType: "image/jpeg" } });
    });
  } else {
    parts.push({ inlineData: { data: base64Data, mimeType } });
  }

  parts.push({
    text: `Brief visual audit for microstock SEO (max 120 words): 1.Main subject 2.Secondary objects 3.Setting/environment 4.Lighting & mood 5.Commercial use case${mediaType === "Video" ? " 6.Camera movement" : ""}`
  });

  try {
    const genAI = new GoogleGenAI({ apiKey: geminiKey });
    const result = await genAI.models.generateContent({
      model: STABLE_MODELS.Gemini,
      contents: [{ role: "user", parts }],
      config: { temperature: 0.1 },
    });
    const ctx = result.text || "";
    visualContextCache.set(cacheKey, ctx);
    return ctx;
  } catch (_) {
    return "";
  }
}

// ─── Generate AI Prompts ─────────────────────────────────────────────────────
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
  modelName: string = STABLE_MODELS.GeminiLite
): Promise<string[]> {
  const isGroq = modelName?.includes("llama");
  const allKeys = (apiKeys || []).filter(Boolean);
  if (allKeys.length === 0) return [];

  const arParam = targetAI === "Midjourney" ? `--ar ${aspectRatio}` : "";
  const aiHint =
    targetAI === "Midjourney" ? `Natural language + keywords. End with "${arParam}".` :
    targetAI === "DALL-E 3" ? "Very detailed natural language. Mention aspect ratio in description." :
    "Weighted keywords: (masterpiece:1.2), technical photo terms.";

  const isolationType =
    type === "PNG Asset"
      ? finishing === "On isolated transparance" ? "transparent background, alpha channel"
      : finishing === "On Solid black" ? "isolated on solid black background"
      : "isolated on pure white background"
      : "";

  // Compact prompt — reduces token usage by ~40%
  const prompt = `Expert ${targetAI} prompt engineer for Adobe Stock microstock.
Type: ${type} | Subject: ${subject} | Style: ${style} | AR: ${aspectRatio}
Negative: ${negativePrompt}${finishing ? ` | Finish: ${finishing}` : ""}

Rules: No IP/brands/trademarks. Commercial viability. Style purity: "${style}".
${aiHint}
${type === "PNG Asset" ? `EVERY prompt: ${isolationType}, clean edges, no shadows.` : "EVERY prompt: full edge-to-edge immersive environment."}
DIVERSITY: Each of ${count} prompts must be UNIQUE in composition & perspective.

Respond ONLY with a JSON array of ${count} prompt strings.`;

  for (const key of allKeys) {
    try {
      let raw: string;
      if (isGroq) {
        raw = await callGroq(key, modelName, [{ role: "user", content: prompt }], false);
      } else {
        raw = await callGemini(key, modelName, [{ text: prompt }], false);
      }
      const parsed = JSON.parse(extractJson(raw));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e: any) {
      if (e.status === 429) await new Promise(r => setTimeout(r, 3000));
      console.warn("generateAIPrompts failed:", e.message);
    }
  }
  return [];
}

// ─── Generate Suggested Themes ───────────────────────────────────────────────
export async function generateSuggestedThemes(
  type: "Background" | "PNG Asset",
  apiKeys?: string[],
  modelName?: string
): Promise<string[]> {
  const isGroq = modelName?.includes("llama");
  const allKeys = (apiKeys || []).filter(Boolean);
  if (allKeys.length === 0) return [];

  // Use lite model for this simple task — much cheaper
  const model = isGroq ? (modelName || STABLE_MODELS.Groq) : STABLE_MODELS.GeminiLite;
  const prompt = `List 12 high-commercial-value theme ideas for ${type === "Background" ? "background images" : "isolated PNG assets"} on Adobe Stock in 2026. Focus on: AI, sustainability, diverse lifestyle, health, abstract 3D. JSON array of strings only.`;

  for (const key of allKeys) {
    try {
      let raw: string;
      if (isGroq) {
        raw = await callGroq(key, model, [{ role: "user", content: prompt }], false);
      } else {
        raw = await callGemini(key, model, [{ text: prompt }], false);
      }
      const parsed = JSON.parse(extractJson(raw));
      if (Array.isArray(parsed)) return parsed;
    } catch (e: any) {
      if (e.status === 429) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return [];
}

// ─── Generate Stock Metadata (main function) ─────────────────────────────────
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
  onStatusUpdate?: (message: string) => void
): Promise<GeneratedMetadata> {
  const primaryModel = modelName || STABLE_MODELS.Gemini;
  const isGroqPrimary = primaryModel.includes("llama");
  const geminiKeys = (apiKeys || []).filter(k => k && !k.startsWith("gsk_"));
  const groqKeys = (apiKeys || []).filter(k => k?.startsWith("gsk_"));

  // Compress images before sending — saves significant token cost
  const supportsVision = ["image/png","image/jpeg","image/webp","image/heic","image/heif"].includes(mimeType);
  let compressedData: string | string[] = base64Data;
  if (supportsVision && !Array.isArray(base64Data)) {
    try { compressedData = await compressImageBase64(base64Data, 1024, 0.82); } catch (_) {}
  } else if (Array.isArray(base64Data)) {
    try {
      compressedData = await Promise.all(
        base64Data.slice(0, 2).map(f => compressImageBase64(f, 800, 0.75))
      );
    } catch (_) {}
  }

  const mediaHint =
    mediaType === "Video"
      ? "Identify camera technique, movement, speed, lighting. Include: 4k, slow-motion, cinematic."
      : mediaType === "Vektor"
      ? "Identify illustration style (flat/isometric/line art). Include: scalable, editable, vector."
      : "Focus on lighting, texture, commercial atmosphere.";

  const adobeCategories = "Animals,Architecture,Business,Drinks,Environment,States of Mind,Food,Graphic Resources,Hobbies,Industry,Landscapes,Lifestyle,People,Plants,Culture,Science,Social Issues,Sports,Technology,Transport,Travel";

  // Compact but complete metadata prompt
  const buildPrompt = (visualContext: string) => `Elite microstock metadata engineer for ${platforms.join(", ")} (2026 SEO).
VISUAL: ${visualContext || `File: ${fileName} | Theme: ${theme}`}
MEDIA: ${mediaType} — ${mediaHint}
LANGUAGE OUTPUT: ${language}

RULES:
1. NO brands/trademarks/IP (use generic: "smartphone" not "iPhone").
2. TITLE: Start with most searchable subject. EXACTLY ${titleCount} chars.
3. DESCRIPTION: One professional SEO sentence. EXACTLY ${descCount} chars.
4. KEYWORDS: Exactly ${numberOfKeywords} unique single-word terms. Ordered by importance.
5. CATEGORIES: One per platform from [${platforms.join(", ")}].
   Adobe Stock must be exactly one of: ${adobeCategories}.
6. seoScore: 1-100. seoInsights: 2-3 items [{label,value,impact}].
7. marketInsight: 1 sentence on commercial potential.

JSON only:
{"title":"","description":"","categories":[{"platform":"","category":""}],"keywords":[{"term":"","seoTier":"High|Medium|Low"}],"marketInsight":"","seoScore":0,"seoInsights":[{"label":"","value":"","impact":""}]}`;

  const tryGemini = async (keys: string[], model: string): Promise<GeneratedMetadata | null> => {
    // Step 1: Get visual context (cached, uses lite model if possible)
    let visualCtx = "";
    if (supportsVision && keys.length > 0) {
      onStatusUpdate?.("[Gemini] Analyzing visual content...");
      visualCtx = await getVisualContext(compressedData, mimeType, mediaType, keys[0]);
    }

    const prompt = buildPrompt(visualCtx);
    const contents: any[] = [];

    // Only send image data if vision model needed and context failed
    if (supportsVision && !visualCtx) {
      if (!Array.isArray(compressedData)) {
        contents.push({ inlineData: { data: compressedData, mimeType } });
      } else {
        (compressedData as string[]).forEach(f =>
          contents.push({ inlineData: { data: f, mimeType: "image/jpeg" } })
        );
      }
    }
    contents.push({ text: prompt });

    for (const key of keys) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          onStatusUpdate?.(`[Gemini] ${model} — attempt ${attempt + 1}...`);
          const raw = await callGemini(key, model, contents);
          return parseMetadata(raw, titleCount, descCount, numberOfKeywords);
        } catch (e: any) {
          console.warn(`Gemini attempt failed (${model}):`, e.message);
          if (e.status === 429 || e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED")) {
            await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
          } else if (attempt === 0) {
            await new Promise(r => setTimeout(r, 1500));
          }
        }
      }
    }
    return null;
  };

  const tryGroq = async (keys: string[], model: string): Promise<GeneratedMetadata | null> => {
    onStatusUpdate?.(`[Groq] ${model}...`);
    const visualCtx = "";
    const prompt = buildPrompt(visualCtx);

    const userContent: any[] = [{ type: "text", text: prompt }];
    if (model.includes("llama-4") || model.includes("vision")) {
      if (!Array.isArray(compressedData) && supportsVision) {
        userContent.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${compressedData}` } });
      }
    }

    for (const key of keys) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await callGroq(key, model, [{ role: "user", content: userContent }]);
          return parseMetadata(raw, titleCount, descCount, numberOfKeywords);
        } catch (e: any) {
          console.warn(`Groq attempt failed (${model}):`, e.message);
          if (e.status === 429) await new Promise(r => setTimeout(r, 5000));
          else if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
        }
      }
    }
    return null;
  };

  // Try primary, then fallback
  let result: GeneratedMetadata | null = null;

  if (!isGroqPrimary) {
    result = await tryGemini(geminiKeys, primaryModel);
    if (!result && groqKeys.length > 0) {
      result = await tryGroq(groqKeys, STABLE_MODELS.Groq);
    }
    // Last resort: try lite model
    if (!result && geminiKeys.length > 0) {
      result = await tryGemini(geminiKeys, STABLE_MODELS.GeminiLite);
    }
  } else {
    result = await tryGroq(groqKeys, primaryModel);
    if (!result && geminiKeys.length > 0) {
      result = await tryGemini(geminiKeys, STABLE_MODELS.Gemini);
    }
  }

  if (!result) throw new Error("All providers exhausted. Check your API keys and quota.");
  return result;
}

function parseMetadata(
  raw: string,
  titleCount: number,
  descCount: number,
  numberOfKeywords: number
): GeneratedMetadata {
  const text = repairJson(extractJson(raw));
  const parsed = JSON.parse(text) as GeneratedMetadata;

  if (parsed.title) parsed.title = parsed.title.trim().substring(0, titleCount);
  if (parsed.description) parsed.description = parsed.description.trim().substring(0, descCount);

  if (parsed.keywords) {
    const rawTerms = (Array.isArray(parsed.keywords) ? parsed.keywords : []).map((kw: any) =>
      typeof kw === "string" ? kw : kw.term || ""
    );
    const cleaned = cleanKeywords(rawTerms, numberOfKeywords);
    parsed.keywords = cleaned.map((term, i) => ({
      term,
      seoTier: (i < 10 ? "High" : i < 30 ? "Medium" : "Low") as "High" | "Medium" | "Low",
    }));
  }

  if (Array.isArray(parsed.categories)) {
    const seen = new Set<string>();
    parsed.categories = parsed.categories
      .map((c: any) =>
        typeof c === "string"
          ? { platform: "General", category: c }
          : { platform: c.platform || "General", category: c.category || "Unknown" }
      )
      .filter(c => { if (seen.has(c.platform)) return false; seen.add(c.platform); return true; });
  }

  return parsed;
}
