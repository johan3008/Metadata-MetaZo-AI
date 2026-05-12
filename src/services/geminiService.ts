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

// ─── Image compression ────────────────────────────────────────────────────────
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

// ─── Sleep helper ─────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Parse plain-text response from AI ────────────────────────────────────────
// The AI now responds in plain text format:
//   TITLE:
//   ...
//   DESCRIPTION:
//   ...
//   KEYWORDS:
//   keyword1, keyword2, ...
function parsePlainTextMetadata(
  raw: string,
  numberOfKeywords: number,
  titleCount: number,
  descCount: number,
  platforms: string[],
  mediaType: string
): GeneratedMetadata | null {
  try {
    const titleMatch = raw.match(/TITLE:\s*\n?([\s\S]*?)(?=\nDESCRIPTION:|$)/i);
    const descMatch  = raw.match(/DESCRIPTION:\s*\n?([\s\S]*?)(?=\nKEYWORDS:|$)/i);
    const kwMatch    = raw.match(/KEYWORDS:\s*\n?([\s\S]*?)$/i);

    const title       = titleMatch?.[1]?.trim() ?? "";
    const description = descMatch?.[1]?.trim() ?? "";
    const kwRaw       = kwMatch?.[1]?.trim() ?? "";

    if (!title || !description || !kwRaw) return null;

    // Parse keywords — preserve multi-word phrases (long-tail)
    const rawKws = kwRaw
      .split(/,|\n/)
      .map(k => k.trim().replace(/^[\-\*\d\.\s]+/, "").trim())  // strip bullets/numbers
      .filter(k => k.length >= 2);

    // Deduplicate (case-insensitive), preserve original casing
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const kw of rawKws) {
      const key = kw.toLowerCase();
      if (!seen.has(key)) { seen.add(key); deduped.push(kw); }
      if (deduped.length >= numberOfKeywords) break;
    }

    const keywords: KeywordInfo[] = deduped.map((term, i) => ({
      term,
      seoTier: (i < 10 ? "High" : i < 30 ? "Medium" : "Low") as "High" | "Medium" | "Low",
    }));

    // Auto-assign Adobe category based on media type
    const adobeCategoryMap: Record<string, string> = {
      Video:   "Technology",
      Vektor:  "Graphic Resources",
      Gambar:  "Lifestyle",
    };
    const categories = platforms.map(p => ({
      platform: p,
      category: p === "Adobe Stock"
        ? (adobeCategoryMap[mediaType] ?? "Lifestyle")
        : "General",
    }));

    return {
      title: title.substring(0, titleCount),
      description: description.substring(0, descCount),
      categories,
      keywords,
      suggestedKeywords: [],
      marketInsight: "",
      seoScore: 85,
      seoInsights: [],
    };
  } catch (e) {
    console.warn("parsePlainTextMetadata failed:", e);
    return null;
  }
}

// ─── Build the metadata prompt (plain-text output format) ─────────────────────
function buildMetadataPrompt(opts: {
  mediaType: string;
  fileName: string;
  theme: string;
  platforms: string[];
  language: string;
  titleCount: number;
  descCount: number;
  numberOfKeywords: number;
  isVideo: boolean;
}): string {
  const videoNote = opts.isVideo
    ? `\nMEDIA TYPE: Video — 3 frames are provided: START, MIDDLE, and END of the video. Analyze the full visual arc.`
    : `\nMEDIA TYPE: ${opts.mediaType}`;

  const themeNote = opts.theme ? `\nADDITIONAL CONTEXT FROM USER: "${opts.theme}"` : "";

  return `You are a professional microstock metadata generator.
Your task is to analyze the uploaded ${opts.isVideo ? "video frames" : "image"} carefully and generate highly accurate stock metadata.${videoNote}${themeNote}
TARGET PLATFORMS: ${opts.platforms.join(", ")}
OUTPUT LANGUAGE: ${opts.language}

STRICT RULES:
1. NEVER hallucinate.
   - Only describe objects, actions, colors, emotions, locations, and concepts that are clearly visible.
   - Do not invent brands, places, ethnicity, professions, or events unless visually obvious.
2. Metadata must match the actual visual content exactly.
   - The title, description, and keywords must directly reflect the media.
   - Avoid generic filler text.
3. Prioritize SEO for microstock marketplaces.
   - Use strong buyer search terms.
   - Use commercially relevant wording.
   - Use natural ${opts.language}.
4. Generate:
   - 1 SEO title
   - 1 accurate description
   - Exactly ${opts.numberOfKeywords} relevant keywords

5. TITLE RULES:
   - Between ${Math.max(50, opts.titleCount - 30)} and ${opts.titleCount} characters
   - Clear and readable
   - Important keywords at beginning
   - No keyword stuffing
   - No symbols like | or #

6. DESCRIPTION RULES:
   - Between ${Math.max(80, opts.descCount - 50)} and ${opts.descCount} characters
   - Natural commercial wording
   - Accurate to media
   - No fake context

7. KEYWORD RULES:
   - Exactly ${opts.numberOfKeywords} keywords
   - Most important keywords first
   - Single words AND long-tail phrases (2-3 words) are allowed and encouraged
   - No duplicate keywords
   - No irrelevant keywords
   - No spam
   - Multi-word keywords like "tropical beach" or "business meeting" are VALID

8. Prioritize:
   - Main subject
   - Action
   - Environment
   - Composition
   - Mood
   - Commercial concepts
   - Color
   - Camera perspective

9. If media is unclear:
   - Stay conservative
   - Use generic accurate terms only

10. Output format EXACTLY (no extra text, no JSON):
TITLE:
<your title here>
DESCRIPTION:
<your description here>
KEYWORDS:
<keyword1>, <keyword2>, <keyword3>, ...all ${opts.numberOfKeywords} keywords on one line separated by commas`;
}

// ─── Low-level API callers ────────────────────────────────────────────────────
async function callGeminiText(key: string, model: string, parts: any[]): Promise<string> {
  const genAI = new GoogleGenAI({ apiKey: key });
  const result = await genAI.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    // NO responseMimeType:"application/json" — we want plain text output
    config: { temperature: 0.2 },
  });
  return result.text ?? "";
}

async function callGroq(key: string, model: string, messages: any[]): Promise<string> {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      // No response_format JSON for plain text
      temperature: 0.2,
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
  return data.choices?.[0]?.message?.content ?? "";
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
          const genAI = new GoogleGenAI({ apiKey: key });
          const result = await genAI.models.generateContent({
            model: modelName,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { temperature: 0.7 },
          });
          raw = result.text ?? "[]";
        }
        // Try to extract JSON array
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          const arr = JSON.parse(arrayMatch[0]);
          if (Array.isArray(arr) && arr.length > 0) return arr;
        }
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
      const arrayMatch = raw.trim().match(/\[[\s\S]*\]/);
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

  const isVideo = Array.isArray(base64Data);
  const supportsVision = isVideo || ["image/png","image/jpeg","image/webp","image/heic","image/heif"].includes(mimeType);

  // ── Compress to reduce token cost ───────────────────────────────────────────
  let compressed: string | string[] = base64Data;
  if (!isVideo && supportsVision) {
    try { compressed = await compressImageBase64(base64Data as string, 1024, 0.82); } catch (_) {}
  } else if (isVideo) {
    try {
      // Compress all 3 frames (awal, tengah, akhir)
      compressed = await Promise.all(
        (base64Data as string[]).slice(0, 3).map(f => compressImageBase64(f, 900, 0.80))
      );
    } catch (_) { compressed = (base64Data as string[]).slice(0, 3); }
  }

  // ── Build the prompt ─────────────────────────────────────────────────────────
  const prompt = buildMetadataPrompt({
    mediaType,
    fileName,
    theme,
    platforms,
    language,
    titleCount,
    descCount,
    numberOfKeywords,
    isVideo,
  });

  // ── Try Gemini ───────────────────────────────────────────────────────────────
  const tryGemini = async (model: string): Promise<GeneratedMetadata | null> => {
    // Always send the actual image/frames directly to the model
    const parts: any[] = [];

    if (isVideo) {
      // Attach all 3 frames: AWAL, TENGAH, AKHIR
      const labels = ["[FRAME: START/AWAL]", "[FRAME: MIDDLE/TENGAH]", "[FRAME: END/AKHIR]"];
      (compressed as string[]).forEach((f, i) => {
        parts.push({ text: labels[i] ?? `[FRAME ${i + 1}]` });
        parts.push({ inlineData: { data: f, mimeType: "image/jpeg" } });
      });
    } else if (supportsVision) {
      parts.push({ inlineData: { data: compressed as string, mimeType } });
    }

    parts.push({ text: prompt });

    for (const key of keys) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          onStatusUpdate?.(`⚡ Generating metadata [${model}]${attempt > 0 ? ` retry ${attempt}` : ""}...`);
          const raw = await callGeminiText(key, model, parts);
          const result = parsePlainTextMetadata(raw, numberOfKeywords, titleCount, descCount, platforms, mediaType);
          if (result?.title) return result;
          throw new Error("Could not parse metadata from response");
        } catch (e: any) {
          const isQuota = e.status === 429 || e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED") || e.message?.includes("quota");
          const isModelError = e.message?.includes("404") || e.message?.includes("not found") || e.message?.includes("INVALID_ARGUMENT");
          console.warn(`Gemini ${model} attempt ${attempt + 1} failed:`, e.message);
          if (isModelError) break;
          if (isQuota) { await sleep(4000 * (attempt + 1)); } else { await sleep(1500 * (attempt + 1)); }
        }
      }
    }
    return null;
  };

  // ── Try Groq ─────────────────────────────────────────────────────────────────
  const tryGroq = async (model: string): Promise<GeneratedMetadata | null> => {
    const userContent: any[] = [];

    // Vision-capable models: attach frames/image
    if (model.includes("llama-4") || model.includes("vision")) {
      if (isVideo) {
        const labels = ["[FRAME: START/AWAL]", "[FRAME: MIDDLE/TENGAH]", "[FRAME: END/AKHIR]"];
        (compressed as string[]).forEach((f, i) => {
          userContent.push({ type: "text", text: labels[i] ?? `[FRAME ${i + 1}]` });
          userContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f}` } });
        });
      } else if (supportsVision) {
        userContent.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${compressed}` } });
      }
    }

    userContent.push({ type: "text", text: prompt });

    for (const key of keys) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          onStatusUpdate?.(`⚡ Generating metadata [Groq/${model}]${attempt > 0 ? ` retry ${attempt}` : ""}...`);
          const raw = await callGroq(key, model, [{ role: "user", content: userContent }]);
          const result = parsePlainTextMetadata(raw, numberOfKeywords, titleCount, descCount, platforms, mediaType);
          if (result?.title) return result;
          throw new Error("Could not parse metadata from Groq response");
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

  // ── Execution strategy ───────────────────────────────────────────────────────
  let result: GeneratedMetadata | null = null;
  const primaryModel = modelName || (provider === "Groq" ? STABLE_MODELS.Groq : STABLE_MODELS.GeminiFlash);

  onStatusUpdate?.("🔍 Analyzing visual content...");

  if (provider === "Gemini") {
    result = await tryGemini(primaryModel);
    if (!result && primaryModel !== STABLE_MODELS.GeminiFlash) {
      onStatusUpdate?.("🔄 Trying fallback Gemini model...");
      result = await tryGemini(STABLE_MODELS.GeminiFlash);
    }
    if (!result && primaryModel !== STABLE_MODELS.GeminiFlashLite) {
      onStatusUpdate?.("🔄 Trying Gemini Flash Lite...");
      result = await tryGemini(STABLE_MODELS.GeminiFlashLite);
    }
  } else {
    result = await tryGroq(primaryModel);
    if (!result && primaryModel !== STABLE_MODELS.Groq) {
      onStatusUpdate?.("🔄 Trying fallback Groq model...");
      result = await tryGroq(STABLE_MODELS.Groq);
    }
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
