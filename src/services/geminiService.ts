import { GoogleGenAI } from "@google/genai";

const MODEL_FALLBACK_CHAIN = [
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview"
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
  const allKeys = [process.env.GEMINI_API_KEY, ...(apiKeys || [])].filter(Boolean) as string[];
  
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
  const combinations: { model: string; key: string }[] = [];
  for (const model of MODEL_FALLBACK_CHAIN) {
    for (const key of allKeys) {
      combinations.push({ model, key });
    }
  }
  
  let localComboIndex = globalCombinationIndex;
  const maxRetries = 10;

  while (attempt <= maxRetries) {
    const { model: currentModel, key } = combinations[localComboIndex % combinations.length];
    try {
      const genAI = new GoogleGenAI({ apiKey: key });
      const result = await genAI.models.generateContent({
        model: currentModel,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const content = result.text || "[]";
      const parsed = JSON.parse(extractJson(content));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
      console.warn("Failed to generate prompts:", e);
      if (e.status === 429 || e.status === 403) {
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
  const allKeys = [process.env.GEMINI_API_KEY, ...(apiKeys || [])].filter(Boolean) as string[];
  const prompt = `Generate a list of 10-15 diverse and high-commercial value theme or subject ideas for ${type === 'Background' ? 'background images' : 'isolated PNG assets'} to be sold on Adobe Stock in 2026.
  Categories: Sustainable energy, Advanced AI, Metaverse, Diverse lifestyle, Abstract 3D, Health.
  Format the response as a simple JSON array of strings.`;

  let attempt = 0;
  const combinations: { model: string; key: string }[] = [];
  for (const model of MODEL_FALLBACK_CHAIN) {
    for (const key of allKeys) {
      combinations.push({ model, key });
    }
  }
  
  let localComboIndex = globalCombinationIndex;
  const maxRetries = 10;

  while (attempt <= maxRetries) {
    const { model: currentModel, key } = combinations[localComboIndex % combinations.length];
    try {
      const genAI = new GoogleGenAI({ apiKey: key });
      const result = await genAI.models.generateContent({
        model: currentModel,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const content = result.text || "[]";
      const parsed = JSON.parse(extractJson(content));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
      console.warn("Failed to generate themes:", e);
      if (e.status === 429 || e.status === 403) {
        localComboIndex++;
        globalCombinationIndex = localComboIndex;
      }
      attempt++;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return [];
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
  const allKeys = [process.env.GEMINI_API_KEY, ...(apiKeys || [])].filter(Boolean) as string[];
  const combinations: { model: string; key: string }[] = [];
  for (const model of MODEL_FALLBACK_CHAIN) {
    for (const key of allKeys) {
      combinations.push({ model, key });
    }
  }

  let visualContext = "";
  let attempt = 0;
  const maxRetries = combinations.length * 2;
  let localComboIndex = globalCombinationIndex;
  
  const isSupported = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType);

  let typeSpecificLogic = "";
  if (mediaType === "Gambar") {
    typeSpecificLogic = `ASSET TYPE: PHOTOGRAPH/IMAGE
- Focus on: Composition, lighting, lens effects, technical quality.
- Keywords: Sensory details, mood, high-fidelity terms.`;
  } else if (mediaType === "Video") {
    typeSpecificLogic = `ASSET TYPE: VIDEO/FOOTAGE
- Focus on: Camera movement, frame rate, emotional arc.
- Keywords: Motion terms, Cinematic, B-roll.`;
  } else if (mediaType === "Vektor") {
    typeSpecificLogic = `ASSET TYPE: VECTOR ILLUSTRATION
- Focus on: Versatility, scalability, style (flat, isometric), technical readiness.
- Keywords: Scalable, Editable, Vector, Design element.`;
  }

  const basePrompt = `You are a Senior Microstock SEO Specialist. Generate metadata:
  - Title: Exactly ${titleCount} chars.
  - Description: Exactly ${descCount} chars.
  - Keywords: Exactly ${numberOfKeywords} single-word keywords.
  - Language: ${language}.
  ${typeSpecificLogic}
  
  Calculate seoScore (0-100) and provide 3 actionable seoInsights.
  Format: Valid JSON with title, description, categories, keywords, marketInsight, seoScore, seoInsights.`;

  while (attempt <= maxRetries) {
    const { model: currentModel, key } = combinations[localComboIndex % combinations.length];
    try {
      if (!visualContext && isSupported && !Array.isArray(base64Data)) {
          const genAI_desc = new GoogleGenAI({ apiKey: key });
          const descResult = await genAI_desc.models.generateContent({
            model: currentModel,
            contents: [{
              role: 'user',
              parts: [{ inlineData: { data: base64Data, mimeType: mimeType } }, { text: "Describe what's in this image." }]
            }]
          });
          visualContext = descResult.text || "";
      }

      const promptWithContext = `${basePrompt}\n\nVisual Context: ${visualContext}\nFileName: ${fileName}\nTheme: ${theme}`;
      const genAI = new GoogleGenAI({ apiKey: key });
      
      const contents: any[] = [];
      if (isSupported && !Array.isArray(base64Data)) {
        contents.push({ inlineData: { data: base64Data, mimeType: mimeType } });
      } else if (Array.isArray(base64Data)) {
        const frameIndices = [0, Math.floor(base64Data.length / 2), base64Data.length - 1];
        frameIndices.forEach(idx => contents.push({ inlineData: { data: base64Data[idx], mimeType: 'image/jpeg' } }));
      }
      contents.push({ text: promptWithContext });

      const result = await genAI.models.generateContent({
        model: currentModel,
        contents: [{ role: 'user', parts: contents }],
      });
      
      const parsed = JSON.parse(extractJson(result.text || "{}")) as GeneratedMetadata;
      if (parsed.keywords) {
        parsed.keywords = parsed.keywords.map((kw, i) => ({
          term: kw.term,
          seoTier: i < 10 ? "High" : i < 30 ? "Medium" : "Low"
        }));
      }
      return parsed;
    } catch (e: any) {
      console.warn(`Rotation attempt ${attempt} failed with ${currentModel}:`, e);
      if (e.status === 429 || e.status === 403) {
        localComboIndex++;
        globalCombinationIndex = localComboIndex;
      }
      attempt++;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error("Exhausted all Gemini rotation options.");
}
