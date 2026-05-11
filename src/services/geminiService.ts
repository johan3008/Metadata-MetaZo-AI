import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI | null = null;

export function getGeminiClient(apiKey?: string): GoogleGenAI {
  if (!ai || apiKey) {
    ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || '' });
  }
  return ai;
}

export async function generateImageDescription(
  base64Data: string,
  mimeType: string
): Promise<string> {
  const genAI = getGeminiClient();
  
  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: base64Data, mimeType: mimeType } },
          { text: "Provide a detailed description of this image suitable for SEO metadata generation, focusing on subject, setting, and mood." }
        ],
      },
    ],
  });

  return result.text || "Professional photography asset";
}

const MODEL_FALLBACK_CHAIN = [
  "gemini-2.0-flash",
  "gemini-1.5-pro"
];

const VISION_MODELS = [
  "gemini-2.0-flash"
];

function getNextModel(currentModel: string): string | null {
  const currentIndex = MODEL_FALLBACK_CHAIN.indexOf(currentModel);
  const startIndex = currentIndex === -1 ? 0 : currentIndex + 1;
  
  for (let i = startIndex; i < MODEL_FALLBACK_CHAIN.length; i++) {
    return MODEL_FALLBACK_CHAIN[i];
  }
  return null;
}

function extractJson(text: string): string {
  if (!text) return "";
  
  // Try to find markdown code blocks first
  const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (markdownMatch && markdownMatch[1]) {
    return markdownMatch[1].trim();
  }

  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let start = -1;
  let endChar = '';
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
    endChar = '}';
  } else if (firstBracket !== -1) {
    start = firstBracket;
    endChar = ']';
  }
  
  if (start === -1) return text;

  // Instead of lastIndexOf, we should find the matching closer by walking
  // to avoid including trailing garbage that happens to contain a closer.
  let depth = 0;
  let inString = false;
  let escaped = false;
  const opener = endChar === '}' ? '{' : '[';

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    
    if (escaped) {
      escaped = false;
      continue;
    }
    
    if (char === '\\') {
      escaped = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === opener) depth++;
      else if (char === endChar) {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }
  }
  
  return text.substring(start);
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
  modelName: string = 'llama-3.3-70b-versatile'
): Promise<string[]> {
  let attempt = 0;
  const maxRetries = 15;
  let currentKeyIndex = 0;
  let currentModelName = modelName;

  const getProviderToUse = () => {
    const userKeys = apiKeys || [];
    const groqKeys = userKeys.filter(k => k.startsWith('gsk_'));
    
    if (groqKeys.length > 0) {
      return { type: 'groq' as const, key: groqKeys[currentKeyIndex % groqKeys.length], model: currentModelName };
    }
    throw new Error("Pembangkitan prompt memerlukan Groq API key ('gsk_...'). Silakan tambahkan di Pengaturan.");
  };

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
  5. DIVERSITY & UNIQUENESS MANDATE (CRITICAL): Every single prompt MUST be significantly unique and distinct from the others in composition, perspective, lighting, action, and sub-elements. NO SIMILAR OR DUPLICATE PROMPTS allowed. This is critical to comply with Adobe Stock's "Generative AI Similar Content" policy, which strictly prohibits spamming or submitting multiple variations of the same prompt.
  
  Task: Generate exactly ${count} highly detailed and descriptive image generation prompts. 
  ${type === 'PNG Asset' 
    ? `CRITICAL FOR PNG ASSET: Every prompt MUST specify a strict isolation style: ${finishing === 'On isolated transparance' ? '"transparent background", "alpha channel", "no background"' : finishing === 'On Solid black' ? '"isolated on solid black background"' : '"isolated on pure white background"'}. Include "clean edges", "detailed borders", and "no drop shadows".` 
    : `CRITICAL FOR BACKGROUND: Every prompt MUST describe a full, edge-to-edge, immersive environment. Focus on composition, lighting, and depth.`}
  
  Format the response as a JSON array of strings. Each string is one complete prompt.`;

  while (attempt <= maxRetries) {
    try {
      const genAI = getGeminiClient();
      const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const content = result.text || "{}";
      // If client returns a JSON object instead of an array
      const parsed = JSON.parse(extractJson(content));
      let resultArray: string[] = [];
      if (Array.isArray(parsed)) {
          resultArray = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
          const values = Object.values(parsed);
          const arrayVal = values.find(v => Array.isArray(v));
          resultArray = Array.isArray(arrayVal) ? arrayVal : Object.values(parsed).map(String);
      } else {
          resultArray = [content];
      }

      return resultArray;
    } catch (e: any) {
      console.error("Failed to generate prompts:", e);
      throw e;
    }
  }
  return [];
}

export async function generateSuggestedThemes(
  type: 'Background' | 'PNG Asset',
  apiKeys?: string[],
  modelName: string = 'gemini-2.0-flash'
): Promise<string[]> {
  let attempt = 0;
  const maxRetries = 3;

  const prompt = `You are a creative brainstormer for microstock content. Generate a list of 10-15 diverse and high-commercial value theme or subject ideas for ${type === 'Background' ? 'background images' : 'isolated PNG assets'} to be sold on Adobe Stock in 2026.
  
  Focus on high-demand categories:
  - Sustainable energy and Eco-friendly tech
  - Advanced AI, Metaverse, and Future Workspaces
  - Diverse people in lifestyle and professional settings
  - Abstract 3D textures and minimalist architectures
  - Health, Wellness, and Modern Medicine
  
  Format the response as a simple JSON array of strings. Each string should be a short but descriptive subject idea (3-8 words). Examples: "Multi-ethnic team discussing sustainable architecture", "Abstract 3D liquid metal flowing texture", "Futuristic smart home control interface concept".`;

  while (attempt <= maxRetries) {
    try {
      const genAI = getGeminiClient();
      const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const content = result.text || "[]";
      const parsed = JSON.parse(extractJson(content));
      let resultArray: string[] = [];
      if (Array.isArray(parsed)) {
          resultArray = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
          const values = Object.values(parsed);
          const arrayVal = values.find(v => Array.isArray(v));
          resultArray = Array.isArray(arrayVal) ? arrayVal : Object.values(parsed).map(String);
      }
      return resultArray;
    } catch (e: any) {
      console.error("Failed to generate themes:", e);
      throw e;
    }
  }
  return [];
}

export async function generateAIImage(
  prompt: string,
  aspectRatio: string = "1:1",
  apiKeys?: string[]
): Promise<string> {
  throw new Error("Pembangkitan gambar AI (Text-to-Image) dinonaktifkan karena fitur ini memerlukan Gemini API Key. Aktifkan kembali di masa mendatang.");
}

let globalCombinationIndex = 0;
let globalGeminiKeyIndex = 0;
let globalKeyRotationIndex = 0;

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
  let attempt = 0;
  const originalModelName = modelName === 'auto-rotate-3x' ? MODEL_FALLBACK_CHAIN[0] : (modelName || MODEL_FALLBACK_CHAIN[0]);
  let currentModelName = originalModelName;
  
  // Track key rotation using module-level variable
  let currentKeyIndex = globalGeminiKeyIndex;
  const allKeys = [process.env.GEMINI_API_KEY, ...(apiKeys || [])].filter(Boolean) as string[];
  
  // Create all combinations of models and keys to try
  const combinations: { model: string; key: string }[] = [];
  for (const model of MODEL_FALLBACK_CHAIN) {
    for (const key of allKeys) {
      combinations.push({ model, key });
    }
  }

  // Use global key tracking or 0 if somehow reset
  let localComboIndex = globalCombinationIndex;
  
  const maxRetries = combinations.length * 3;
  
  const isSupported = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType);
  // Pre-analysis: Get description if visual data exists
  let visualContext = "";
  if (isSupported && !Array.isArray(base64Data)) {
    try {
      visualContext = await generateImageDescription(base64Data, mimeType);
    } catch (e) {
      console.warn("Visual analysis failed, falling back to contextual Info", e);
    }
  }
  
  // platformsStr is unused currently - removing it might be fine, but I will keep it for now.
  
  // Type-specific enhancement strategy
  let typeSpecificLogic = "";
  if (mediaType === "Gambar") {
    typeSpecificLogic = `
ASSET TYPE: PHOTOGRAPH/IMAGE
- Focus on: Composition, lighting (golden hour, studio, flat, etc.), lens effects (bokeh, wide angle), and technical quality (shutter speed, aperture if relevant).
- Keywords: Include sensory details, mood, and high-fidelity terms.`;
  } else if (mediaType === "Video") {
    typeSpecificLogic = `
ASSET TYPE: VIDEO/FOOTAGE
- Focus on: Camera movement (pan, tilt, zoom, drone, handheld), frame rate (slow motion, timelapse), and emotional arc.
- Keywords: Use motion-related terms and "B-roll", "Footage", "Cinematic" where appropriate.`;
  } else if (mediaType === "Vektor") {
    typeSpecificLogic = `
ASSET TYPE: VECTOR ILLUSTRATION
- Focus on: Versatility, scalability, style (flat, isometric, gradient, linear), and technical readiness for design.
- Keywords: MUST include "Scalable", "Editable", "Vector", "Illustration", "Graphic", "Design element". Avoid terms implying photography unless it's a realistic vector.`;
  }

  let prompt = `You are a Senior Microstock SEO Specialist. Generate metadata to maximize page 1 ranking on Adobe Stock:
  - Title: Exactly ${titleCount} chars, front-load keywords, no filler words.
  - Description: Exactly ${descCount} chars, factual summary + use cases.
  - Categories: Official taxonomy matching.
  - Keywords: Exactly ${numberOfKeywords} single-word keywords.
    - MUST include LSI (Latent Semantic Indexing) keywords based on deep search intent Analysis.
    - Distribution: Subject, Context, Emotional, Technical.
    - Classify each keyword with an 'seoTier'.
  - Language: ${language}.
  - Rules: High relevance, no hallucinations, commercial intent only. Must match visual content perfectly.
  
  SEO SCORE & INSIGHTS CALCULATION ALGORITHM:
  1. seoScore (0-100): Calculate based on:
     - Keyword Relevancy (40%): How perfectly keywords match the visual subject.
     - Title Optimization (30%): Strategic front-loading and character count precision.
     - LSI Density (20%): Coverage of related search terms.
     - Trend Alignment (10%): Match with current 2026 commercial demand.
  2. seoInsights: Provide exactly 3-4 specific, DIRECTLY ACTIONABLE insights. 
     - Focus on: "Missing Niche Terms", "Title Strength", "Call to Action Effectiveness", or "Visual Consistency".
     - Examples of Actionable Insights: "Add 'sustainable' to target eco-conscious buyers," or "Move the main subject to the first 3 words of the title for better ranking."
  
  ${typeSpecificLogic}
  
  ${visualContext ? `Visual Context: "${visualContext}"` : `Filename: "${fileName}", Concept: "${theme}"`}
  ${Array.isArray(base64Data) ? `Note: This is a video; I am providing the beginning, middle, and end frames for deep visual context.` : ''}
  ${theme ? `Focus: "${theme}"` : ''}
  
  Format: Valid JSON as defined below.`;

  while (attempt <= maxRetries) {
    const { model: currentModelName, key: currentKey } = combinations[localComboIndex % combinations.length];

    try {
      // Use a local client instance to avoid global state race conditions
      const genAI = new GoogleGenAI({ apiKey: currentKey });
       const jsonSchemaInstruction = `
Your response MUST be a valid JSON object with the following structure:
{
  "title": "string",
  "description": "string",
  "categories": [{"platform": "string", "category": "string"}],
  "keywords": [{"term": "string", "seoTier": "High" | "Medium" | "Low"}],
  "suggestedKeywords": ["string"],
  "marketInsight": "string",
  "seoScore": number (0-100),
  "seoInsights": [{"label": "string", "value": "string", "impact": "Positive" | "Neutral" | "Negative"}]
}
`;
      const fullPrompt = prompt + "\n" + jsonSchemaInstruction;

      const contents: any[] = [];
      if (isSupported && !Array.isArray(base64Data)) {
          contents.push({ inlineData: { data: base64Data, mimeType: mimeType } });
      } else if (Array.isArray(base64Data)) {
          // Send beginning, middle, and end frames individually to improve context
          const frameIndices = [0, Math.floor(base64Data.length / 2), base64Data.length - 1];
          frameIndices.forEach(index => {
              contents.push({ inlineData: { data: base64Data[index], mimeType: 'image/jpeg' } });
          });
      }
      contents.push({ text: fullPrompt });

      const result = await genAI.models.generateContent({
        model: currentModelName,
        contents: [{ role: 'user', parts: contents }],
      });
      
      const jsonResponse = extractJson(result.text || "{}");
      const parsedResult = JSON.parse(jsonResponse) as GeneratedMetadata;
      
      // Programmatically assign SEO tiers based on position to ensure consistency
      if (parsedResult.keywords && Array.isArray(parsedResult.keywords)) {
        parsedResult.keywords = parsedResult.keywords.map((kw, index) => {
          let seoTier: "High" | "Medium" | "Low" = "Low";
          if (index < 10) seoTier = "High";
          else if (index < 30) seoTier = "Medium";
          
          return {
            term: kw.term,
            seoTier: seoTier
          };
        });
      }
      
      return parsedResult;
    } catch (e: any) {
      console.error(`Failed to generate metadata using model ${currentModelName} and key ending in ${currentKey.slice(-4)}:`, e);
      
      if (e.status === 429 || (e.error && e.error.code === 429)) {
          console.warn(`Quota exhausted for model ${currentModelName} and key ending in ${currentKey.slice(-4)}. Rotating...`);
          localComboIndex++;
          globalCombinationIndex = localComboIndex;
      }
      
      attempt++;
      
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, Math.min(attempt, 5)) * 1000));
    }
  }
  
  throw new Error("Failed to generate metadata after multiple retries across all available models and keys.");
}

