import { GoogleGenAI } from "@google/genai";

const MODEL_FALLBACK_CHAIN = [
  "gemini-3.1-flash-lite"
];

let globalCombinationIndex = 0;

function extractJson(text: string): string {
  if (!text) return "";
  const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (markdownMatch && markdownMatch[1]) {
    return markdownMatch[1].trim();
  }
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return text;
  
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) return text.substring(firstBrace, i + 1);
      }
    }
  }
  return text.substring(firstBrace);
}

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

export async function generateAIPrompts(
  type: 'Background' | 'PNG Asset',
  subject: string,
  style: string,
  negativePrompt: string,
  count: number,
  finishing?: string,
  apiKeys?: string[],
  targetAI: string = 'Midjourney',
  aspectRatio: string = '3:2',
  modelName: string = 'gemini-3-flash-preview'
): Promise<string[]> {
  const isGroqModel = modelName?.includes('llama');
  const systemKey = isGroqModel ? undefined : process.env.GEMINI_API_KEY;
  const allKeys = [systemKey, ...(apiKeys || [])].filter(Boolean) as string[];
  
  const midjourneyAr = aspectRatio.replace(':', ':');
  const midjourneyOptim = targetAI === 'Midjourney' 
    ? `- Use natural language mixed with descriptive keywords. Include parameters like "--v 6.1" or "--stylize" if appropriate. ALWAYS add the aspect ratio parameter "--ar ${midjourneyAr}" at the very end.`
    : '';
    
  const dalleOptim = targetAI === 'DALL-E 3'
    ? '- Use extremely descriptive, long-form natural language. DALL-E 3 follows intricate details perfectly. Mention aspect ratio in the description.'
    : '';
    
  const sdOptim = targetAI === 'Stable Diffusion'
    ? '- Use weighted keyword format (e.g., (masterpiece:1.2), high quality). Use clear directional lighting and technical photography terms.'
    : '';

  const prompt = `You are a professional prompt engineer for AI image generators, specifically optimizing for ${targetAI}. Your goal is to create high-quality microstock assets for Adobe Stock.
  Target Asset Type: ${type}
  Subject Concept: ${subject}
  Target Style: ${style}
  Target Aspect Ratio: ${aspectRatio}
  Negative Constraints: ${negativePrompt}
  ${finishing ? `Finishing/Transparency Style: ${finishing}` : ''}
  
  AI TOOL SPECIFIC OPTIMIZATION (${targetAI}):
  ${midjourneyOptim}
  ${dalleOptim}
  ${sdOptim}
  
  ADOBE STOCK COMPLIANCE & QUALITY RULES:
  1. NO INTELLECTUAL PROPERTY (IP): Absolutely do NOT include brand names, trademarks, company logos, or copyrighted characters.
  2. HUMAN SUBJECTS: Realistic faces are okay but MUST be generic and high-quality.
  3. STRICT STYLE PURITY: Every prompt MUST strictly follow the "${style}" aesthetic. 
  4. COMMERCIAL VIABILITY: Create assets that look professional and versatile.
  5. DIVERSITY & UNIQUENESS MANDATE (CRITICAL): Every single prompt MUST be significantly unique and distinct from the others in composition, perspective, lighting, action, and sub-elements. NO SIMILAR OR DUPLICATE PROMPTS allowed.
  
  Task: Generate exactly ${count} highly detailed and descriptive image generation prompts. 
  ${type === 'PNG Asset' 
    ? `CRITICAL FOR PNG ASSET: Every prompt MUST specify a strict isolation style: ${finishing === 'On isolated transparance' ? '"transparent background", "alpha channel", "no background"' : finishing === 'On Solid black' ? '"isolated on solid black background"' : '"isolated on pure white background"'}. Include "clean edges", "detailed borders", and "no drop shadows".` 
    : `CRITICAL FOR BACKGROUND: Every prompt MUST describe a full, edge-to-edge, immersive environment. Focus on composition, lighting, and depth.`}
  
  Format the response as a JSON array of strings. Each string is one complete prompt.`;

  let attempt = 0;
  const targetModels = modelName ? [modelName] : MODEL_FALLBACK_CHAIN;
  const combinations: { model: string; key: string }[] = [];
  for (const model of targetModels) {
    for (const key of allKeys) {
      combinations.push({ model, key });
    }
  }
  
  let localComboIndex = globalCombinationIndex;
  const maxRetries = 10;

  while (attempt <= maxRetries) {
    const { model: currentModel, key } = combinations[localComboIndex % combinations.length];
    try {
      let content = "[]";
      if (currentModel.startsWith('llama')) {
         const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: currentModel, messages: [{ role: "user", content: prompt }] })
         });
         if (!response.ok) throw new Error(`Groq API Error: ${response.status}`);
         const data = await response.json();
         content = data.choices[0]?.message?.content || "[]";
      } else {
        const genAI = new GoogleGenAI({ apiKey: key });
        const result = await genAI.models.generateContent({
          model: currentModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        content = result.text || "[]";
      }
      const parsed = JSON.parse(extractJson(content));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
      console.warn("Failed to generate prompts:", e);
      if (e.status === 429 || e.status === 403 || e.message?.includes('429')) {
        localComboIndex++;
        globalCombinationIndex = localComboIndex;
      }
      attempt++;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return [];
}

export async function generateSuggestedThemes(
  type: 'Background' | 'PNG Asset',
  apiKeys?: string[],
  modelName?: string
): Promise<string[]> {
  const isGroqModel = modelName?.includes('llama');
  const systemKey = isGroqModel ? undefined : process.env.GEMINI_API_KEY;
  const allKeys = [systemKey, ...(apiKeys || [])].filter(Boolean) as string[];
  const prompt = `Generate a list of 10-15 diverse and high-commercial value theme or subject ideas for ${type === 'Background' ? 'background images' : 'isolated PNG assets'} to be sold on Adobe Stock in 2026.
  Categories: Sustainable energy, Advanced AI, Metaverse, Diverse lifestyle, Abstract 3D, Health.
  Format the response as a simple JSON array of strings.`;

  let attempt = 0;
  const targetModels = modelName ? [modelName] : MODEL_FALLBACK_CHAIN;
  const combinations: { model: string; key: string }[] = [];
  for (const model of targetModels) {
    for (const key of allKeys) {
      combinations.push({ model, key });
    }
  }
  
  let localComboIndex = globalCombinationIndex;
  const maxRetries = 10;

  while (attempt <= maxRetries) {
    const { model: currentModel, key } = combinations[localComboIndex % combinations.length];
    try {
      let content = "[]";
      if (currentModel.startsWith('llama')) {
         const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: currentModel, messages: [{ role: "user", content: prompt }] })
         });
         if (!response.ok) throw new Error(`Groq API Error: ${response.status}`);
         const data = await response.json();
         content = data.choices[0]?.message?.content || "[]";
      } else {
        const genAI = new GoogleGenAI({ apiKey: key });
        const result = await genAI.models.generateContent({
          model: currentModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        content = result.text || "[]";
      }
      const parsed = JSON.parse(extractJson(content));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
      console.warn("Failed to generate themes:", e);
      if (e.status === 429 || e.status === 403 || e.message?.includes('429')) {
        localComboIndex++;
        globalCombinationIndex = localComboIndex;
      }
      attempt++;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return [];
}

function cleanKeywords(keywords: string[], limit: number): string[] {
  const stopwords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'from', 'by', 'for', 'with', 'in', 'on', 'to', 'of', 'is', 'it', 'its', 'my', 'your', 'their', 'our']);
  const cleaned = [...new Set(
    keywords
      .map(k => k.trim().toLowerCase())
      .filter(k => k.length >= 2 && /^[a-z0-9\-\s]+$/.test(k)) // Relaxed to allow spaces if they slip in, but prompt says single word
      .map(k => k.split(/\s+/)[0]) // Force single word
      .filter(k => k.length >= 2)
      .filter(k => !stopwords.has(k))
  )];
  return cleaned.slice(0, limit); 
}

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
  const primaryModel = modelName || 'gemini-2.0-flash';
  const primaryProvider = primaryModel.includes('llama') ? 'Groq' : 'Gemini';

  const STABLE_MODELS = {
    Gemini: 'gemini-2.0-flash',
    Groq: 'llama-3.3-70b-versatile'
  };

  const repairJson = (text: string): string => {
    let cleaned = text.trim();
    if (!cleaned) return "{}";
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    cleaned = cleaned.replace(/\\n/g, ' ').replace(/\n/g, ' '); 
    try {
      return JSON.stringify(JSON.parse(cleaned));
    } catch (e) {
      let quoteCount = (cleaned.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) cleaned += '"';
      let openBraces = (cleaned.match(/{/g) || []).length;
      let closeBraces = (cleaned.match(/}/g) || []).length;
      while (openBraces > closeBraces) {
        cleaned += '}';
        closeBraces++;
      }
      try {
        return JSON.stringify(JSON.parse(cleaned));
      } catch (e2) {
        return "{}";
      }
    }
  };

  const basePrompt = `You are an elite microstock metadata generator specialized for Adobe Stock, Shutterstock, and iStock. Your expertise lies in high-conversion SEO and marketplace search intent.

SOURCE INTERNAL VISUAL AUDIT:
{VISUAL_CONTEXT}

PLATFORM TARGETS: ${platforms.join(', ')}
MEDIA TYPE: ${mediaType}

ABSOLUTE MANDATORY RULES:
1. NO HALLUCINATION: Only describe what is strictly visible. Do not invent context or hidden objects.
2. TITLE (STRICT LENGTH): Engineering a descriptive title. It MUST be EXACTLY ${titleCount} characters long. If the title is too short, expand it with more specific visual details or technical descriptors until it reaches the precise target of ${titleCount} characters. DO NOT return less or more.
3. DESCRIPTION (STRICT LENGTH): Create one professional SEO-friendly sentence. It MUST be EXACTLY ${descCount} characters long. Expand with atmosphere or setting details to hit the count.
4. KEYWORD HIERARCHY (EXACTLY ${numberOfKeywords} UNIQUE ITEMS):
   - You MUST generate exactly ${numberOfKeywords} single-word keywords.
   - Priority 1: Main subject (Anchor keywords)
   - Priority 2: Secondary subjects/objects
   - Priority 3: Visible actions/verbs
   - Priority 4: Environment/Location
   - Priority 5: Colors, lighting, mood, and high-level concepts
   - REQUIREMENT: Only single words. No phrases.
5. CATEGORIES: Map exactly ONE official category for each platform in [${platforms.join(', ')}].
   - For Adobe Stock, pick exactly ONE from: Animals, Architecture, Business, Drinks, Environment, States of Mind, Food, Graphic Resources, Hobbies, Industry, Landscapes, Lifestyle, People, Plants, Culture, Science, Social Issues, Sports, Technology, Transport, Travel.
6. SEARCH TRENDS: Use keywords commonly used in 2026 microstock markets.

JSON OUTPUT STRUCTURE (STRICTLY REQUIRED):
{
  "title": "...",
  "description": "...",
  "categories": [{ "platform": "...", "category": "..." }],
  "keywords": [{ "term": "...", "seoTier": "..." }],
  "marketInsight": "...",
  "seoScore": 0,
  "seoInsights": [{ "label": "...", "value": "...", "impact": "..." }]
}`;

  let currentProvider = primaryProvider;
  let currentModel = primaryModel;
  let visualContext = "";
  let providersTried = new Set<string>();

  const isSupported = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType);

  while (providersTried.size < 2) {
    providersTried.add(currentProvider);
    const providerApiKeys = (currentProvider === 'Groq') ? (apiKeys || []) : [process.env.GEMINI_API_KEY, ...(apiKeys || [])].filter(Boolean) as string[];
    
    for (const key of providerApiKeys) {
      let retries = 0;
      const maxRetriesPerKey = 2;

      while (retries <= maxRetriesPerKey) {
        try {
          if (onStatusUpdate) {
            const retryInfo = retries > 0 ? ` (Retry ${retries}/2)` : "";
            onStatusUpdate(`[${currentProvider}] Generating with ${currentModel}${retryInfo}...`);
          }

          if (!visualContext && isSupported && !Array.isArray(base64Data)) {
            const visKey = process.env.GEMINI_API_KEY || (currentProvider === 'Gemini' ? key : null);
            if (visKey) {
              const genAI_desc = new GoogleGenAI({ apiKey: visKey });
              const descResult = await genAI_desc.models.generateContent({
                model: "gemini-2.0-flash",
                contents: [{
                  role: 'user',
                  parts: [
                    { inlineData: { data: base64Data, mimeType: mimeType } }, 
                    { text: "Analyze this image for high-end microstock SEO. Perform a deep visual audit: 1. Identify the absolute main subject. 2. List secondary objects and supporting elements. 3. Describe the specific environment/setting. 4. Identify lighting, colors, and commercial mood. 5. Note any specific actions or concepts. Return as a logical internal description for a metadata engineer." }
                  ]
                }]
              });
              visualContext = descResult.text || "";
            }
          }

          const promptWithContext = basePrompt.replace('{VISUAL_CONTEXT}', visualContext || `FileName: ${fileName}\nTheme: ${theme}`);
          let textResult = "{}";

          if (currentProvider === 'Groq') {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({ 
                model: currentModel, 
                messages: [{ role: "user", content: promptWithContext }], 
                response_format: { type: "json_object" },
                temperature: 0.1
              })
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              if (response.status === 404 && currentModel !== STABLE_MODELS.Groq) {
                currentModel = STABLE_MODELS.Groq;
                continue;
              }
              throw new Error(`Groq API Error: ${response.status}`);
            }
            const data = await response.json();
            textResult = data.choices[0]?.message?.content || "{}";
          } else {
            const genAI = new GoogleGenAI({ apiKey: key });
            const contents: any[] = [];
            if (isSupported && !Array.isArray(base64Data)) {
              contents.push({ inlineData: { data: base64Data, mimeType: mimeType } });
            } else if (Array.isArray(base64Data)) {
              const frameIndices = [0, Math.floor(base64Data.length / 2), base64Data.length - 1];
              frameIndices.forEach(idx => contents.push({ inlineData: { data: base64Data[idx], mimeType: 'image/jpeg' } }));
            }
            contents.push({ text: promptWithContext });

            try {
              const result = await genAI.models.generateContent({
                model: currentModel,
                contents: [{ role: 'user', parts: contents }],
                config: { temperature: 0.2, responseMimeType: "application/json" }
              });
              textResult = result.text || "{}";
            } catch (gemError: any) {
              if (gemError.message?.includes('404') && currentModel !== STABLE_MODELS.Gemini) {
                currentModel = STABLE_MODELS.Gemini;
                continue;
              }
              throw gemError;
            }
          }

          const text = repairJson(extractJson(textResult));
          const parsed = JSON.parse(text) as GeneratedMetadata;

          if (parsed.title) parsed.title = parsed.title.trim().substring(0, titleCount);
          if (parsed.description) parsed.description = parsed.description.trim().substring(0, descCount);
          
          if (parsed.keywords) {
            const rawTerms = (Array.isArray(parsed.keywords) ? parsed.keywords : []).map((kw: any) => typeof kw === 'string' ? kw : (kw.term || ""));
            const cleanedTerms = cleanKeywords(rawTerms, numberOfKeywords);
            parsed.keywords = cleanedTerms.map((term, i) => ({ term, seoTier: i < 10 ? "High" : i < 30 ? "Medium" : "Low" }));
          }

          if (Array.isArray(parsed.categories)) {
            const seen = new Set();
            parsed.categories = parsed.categories
              .map((c: any) => (typeof c === 'string' ? { platform: 'General', category: c } : { platform: c.platform || 'General', category: c.category || 'Unknown' }))
              .filter(c => { if (seen.has(c.platform)) return false; seen.add(c.platform); return true; });
          }

          return parsed;

        } catch (err: any) {
          console.error(`Attempt failed (${currentProvider}/${currentModel}):`, err.message);
          retries++;
          if (retries <= maxRetriesPerKey) {
            await new Promise(r => setTimeout(r, 1000 * retries));
            continue;
          }
        }
      }
    }

    currentProvider = (currentProvider === 'Gemini') ? 'Groq' : 'Gemini';
    currentModel = STABLE_MODELS[currentProvider];
  }

  throw new Error(`Exhausted all providers (Gemini & Groq). Please check your API keys and connection.`);
}
