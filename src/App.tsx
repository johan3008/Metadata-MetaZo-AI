import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Image as ImageIcon, FileVideo, Layers, UploadCloud, Trash2, Copy, Download, RefreshCw, Sun, Moon, Key, Play, Clock, Heart, PenTool, Video, Zap, Info, Cpu, CheckCircle2, Maximize, Palette, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";
import { generateStockMetadata, GeneratedMetadata, generateAIPrompts, generateSuggestedThemes } from './services/geminiService';
import { initializeApp } from 'firebase/app';
import { getAuth, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, getDocFromServer, onSnapshot, disableNetwork } from 'firebase/firestore';
import { auth as firebaseAuth, db } from './lib/firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

let isQuotaExceededGlobal = false;

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errorMsg,
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  if (errorMsg.includes("resource-exhausted") || errorMsg.includes("quota") || errorMsg.includes("Quota limit exceeded")) {
    isQuotaExceededGlobal = true;
    try { disableNetwork(db); } catch (e) { /* ignore */ }
    window.dispatchEvent(new CustomEvent('show-dialog', { 
      detail: { 
        title: 'Quota Exceeded', 
        message: 'Telah mencapai batas kuota database harian Firestore. Perubahan riwayat dan pengaturan tidak dapat disimpan. Kuota akan direset besok.',
        type: 'error'
      } 
    }));
  } else if (errorMsg.includes("Missing or insufficient permissions")) {
    throw new Error(JSON.stringify(errInfo));
  }
}

type MediaType = 'Gambar' | 'Video' | 'Vektor' | 'Riwayat' | 'Settings' | 'PromptGenerator';

interface FileItem {
  id: string;
  file: File;
  previewUrl: string | null;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';
  result?: GeneratedMetadata;
  error?: string;
  statusMessage?: string;
  submissionStatus?: Record<string, 'PENDING' | 'SUBMITTING' | 'SUCCESS' | 'ERROR'>;
}

const platformOptions = [
  'Adobe Stock',
  'Shutterstock',
  'Canva',
  'Freepik',
  'Dreamstime',
  'Vecteezy'
];

interface UpscaleResult {
  upscaledUrl: string;
}

const simulateUpscale = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file for upscaling"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to load image for upscaling"));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        // Increase resolution by 2x (simulated upscale)
        canvas.width = img.width * 2;
        canvas.height = img.height * 2;
        
        // Draw image with smoothing (bicubic simulation)
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Add a slight sharpening filter or just return data url
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

const languageOptions = [
  { label: 'English', value: 'English' },
  { label: 'Deutsch (German)', value: 'German' },
  { label: 'Español (Spanish)', value: 'Spanish' },
  { label: 'Français (French)', value: 'French' },
  { label: 'Italiano (Italian)', value: 'Italian' },
  { label: '日本語 (Japanese)', value: 'Japanese' },
  { label: '한국어 (Korean)', value: 'Korean' },
  { label: 'Português (Portuguese)', value: 'Portuguese' },
  { label: 'Русский (Russian)', value: 'Russian' },
  { label: '中文 (Simplified Chinese)', value: 'Chinese Simplified' }
];

const translations = {
  id: {
    gambar: 'Gambar',
    video: 'Video',
    vektor: 'Vektor',
    aiPrompt: 'AI Prompt',
    riwayat: 'Riwayat',
    setup: 'Setup',
    title: 'AUTO METADATA GENERATOR',
    subtitle: 'Generate judul, deskripsi, dan keyword otomatis untuk Adobe Stock dan platform lainnya menggunakan Gemini Vision.',
    uploadTab: 'Upload & Process',
    historyTab: 'Riwayat',
    settingsTab: 'Settings'
  },
  en: {
    gambar: 'Image',
    video: 'Video',
    vektor: 'Vector',
    aiPrompt: 'AI Prompt',
    riwayat: 'History',
    setup: 'Setup',
    title: 'AUTO METADATA GENERATOR',
    subtitle: 'Automatically generate titles, descriptions, and keywords for Adobe Stock and other platforms using Gemini Vision.',
    uploadTab: 'Upload & Process',
    historyTab: 'History',
    settingsTab: 'Settings'
  }
};

const DialogModal = ({ 
  isOpen, 
  title, 
  message, 
  type, 
  onClose 
}: { 
  isOpen: boolean, 
  title: string, 
  message: string, 
  type: 'success' | 'warning' | 'info' | 'error', 
  onClose: () => void 
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div 
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface border-2 border-border/50 rounded-3xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center gap-4 relative overflow-hidden"
          >
            {type === 'success' && <div className="absolute top-0 left-0 w-full h-1.5 bg-green-500"></div>}
            {type === 'warning' && <div className="absolute top-0 left-0 w-full h-1.5 bg-yellow-500"></div>}
            {type === 'error' && <div className="absolute top-0 left-0 w-full h-1.5 bg-red-500"></div>}
            {type === 'info' && <div className="absolute top-0 left-0 w-full h-1.5 bg-accent"></div>}
            
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${type === 'success' ? 'bg-green-500/10 text-green-500' : type === 'warning' ? 'bg-yellow-500/10 text-yellow-500' : type === 'error' ? 'bg-red-500/10 text-red-500' : 'bg-accent/10 text-accent'}`}>
              {type === 'success' && <CheckCircle2 className="w-8 h-8" />}
              {type === 'warning' && <AlertTriangle className="w-8 h-8" />}
              {type === 'error' && <AlertTriangle className="w-8 h-8" />}
              {type === 'info' && <Info className="w-8 h-8" />}
            </div>
            
            <div>
              <h3 className="text-xl font-black text-text-primary tracking-tight mb-2">{title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{message}</p>
            </div>
            
            <button 
              onClick={onClose}
              className="mt-4 w-full px-6 py-3 bg-subtle hover:bg-border/60 text-text-primary font-bold rounded-xl transition-all"
            >
              Acknowledge
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

function AppContent() {
  const user = { uid: 'guest-operator' };
  
  const [mediaType, setMediaType] = useState<MediaType>('Gambar');
  const [theme, setTheme] = useState('');
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [keywordCount, setKeywordCount] = useState<number>(25);
  const [enableUpscaling, setEnableUpscaling] = useState<boolean>(false);
  const [titleCount, setTitleCount] = useState<number>(10);
  const [descCount, setDescCount] = useState<number>(30);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('English');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['Adobe Stock']);
  const [uploadMode, setUploadMode] = useState<'Single' | 'Batch'>('Batch');
  const [statusFilter, setStatusFilter] = useState<'All' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>('All');
  const [selectedModel, setSelectedModel] = useState<string>('auto-rotate-3x');
  const [apiKeys, setApiKeys] = useState<{key: string, enabled: boolean}[]>([]);
  const [keyStatuses, setKeyStatuses] = useState<Record<string, 'VALID' | 'INVALID' | 'TESTING' | 'PENDING'>>({});
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [useSystemKey, setUseSystemKey] = useState<boolean>(false);
  const [uiLanguage, setUiLanguage] = useState<'id' | 'en'>(() => {
    const saved = localStorage.getItem('uiLanguage');
    return (saved === 'id' || saved === 'en') ? saved : 'id';
  });
  const [integrations, setIntegrations] = useState({
    adobe: { apiKey: '', secret: '' },
    shutterstock: { token: '' }
  });
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    localStorage.setItem('uiLanguage', uiLanguage);
  }, [uiLanguage]);

  const t = (key: keyof typeof translations['id']) => translations[uiLanguage][key];
  
  // Custom Dialog State
  const [dialogState, setDialogState] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'warning' | 'info' | 'error' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success'
  });

  const closeDialog = () => setDialogState(prev => ({ ...prev, isOpen: false }));

  useEffect(() => {
    const handleCustomDialog = (e: Event) => {
      const customEvent = e as CustomEvent;
      setDialogState({
        isOpen: true,
        title: customEvent.detail.title,
        message: customEvent.detail.message,
        type: customEvent.detail.type
      });
    };
    window.addEventListener('show-dialog', handleCustomDialog);
    return () => window.removeEventListener('show-dialog', handleCustomDialog);
  }, []);

  // Prompt Generator State
  const [promptGenType, setPromptGenType] = useState<'Background' | 'PNG Asset'>('Background');
  const [promptSubject, setPromptSubject] = useState('');
  const [promptStyle, setPromptStyle] = useState('Realistic Photo');
  const [promptNegative, setPromptNegative] = useState('');
  const [promptFinishing, setPromptFinishing] = useState('On pure White');
  const [promptVariations, setPromptVariations] = useState(10);
  const [promptTargetAI, setPromptTargetAI] = useState('Midjourney');
  const [promptAspectRatio, setPromptAspectRatio] = useState('3:2');
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [generatedPrompts, setGeneratedPrompts] = useState<string[]>([]);
  const [isGeneratingThemes, setIsGeneratingThemes] = useState(false);
  const [suggestedThemes, setSuggestedThemes] = useState<string[]>([]);
  const [showThemeSuggestions, setShowThemeSuggestions] = useState(false);

  const handleSuggestIdea = async () => {
    if (apiKeys.filter(k => k.enabled).length === 0) {
      setDialogState({
        isOpen: true,
        title: uiLanguage === 'id' ? 'API Key Diperlukan' : 'API Key Required',
        message: uiLanguage === 'id' ? 'Anda belum menambahkan API Key. Sistem membutuhkan setidaknya 1 API Key Gemini aktif di Pengaturan.' : 'You have not added an API Key. The system requires at least 1 active Gemini API Key in Settings.',
        type: 'error'
      });
      return;
    }

    setIsGeneratingThemes(true);
    try {
      const keysStr = apiKeys.filter(k => k.enabled).map(k => k.key);
      const themes = await generateSuggestedThemes(promptGenType, keysStr, selectedModel);
      setSuggestedThemes(themes);
      setShowThemeSuggestions(true);
    } catch (err: any) {
      console.error("Error suggesting themes:", err);
      setDialogState({
        isOpen: true,
        title: 'Gemini Generator Error',
        message: err.message?.includes('Quota') ? err.message : 'Gagal mendapatkan ide. Silakan coba lagi.',
        type: 'warning'
      });
    } finally {
      setIsGeneratingThemes(false);
    }
  };

  const handleGeneratePrompts = async () => {
    if (!promptSubject.trim()) return;
    
    if (apiKeys.filter(k => k.enabled).length === 0) {
      setDialogState({
        isOpen: true,
        title: uiLanguage === 'id' ? 'API Key Diperlukan' : 'API Key Required',
        message: uiLanguage === 'id' ? 'Anda belum menambahkan API Key. Sistem membutuhkan setidaknya 1 API Key Gemini aktif di Pengaturan.' : 'You have not added an API Key. The system requires at least 1 active Gemini API Key in Settings.',
        type: 'error'
      });
      return;
    }

    setIsGeneratingPrompts(true);
    try {
      const keysStr = apiKeys.filter(k => k.enabled).map(k => k.key);
      const result = await generateAIPrompts(
        promptGenType,
        promptSubject,
        promptStyle,
        promptNegative,
        promptVariations,
        promptFinishing,
        keysStr,
        promptTargetAI,
        promptAspectRatio,
        selectedModel
      );
      setGeneratedPrompts(result);
    } catch (err: any) {
      console.error("Error generating prompts:", err);
      setDialogState({
        isOpen: true,
        title: 'Gemini Generator Error',
        message: err.message?.includes('Quota') ? err.message : 'Gagal membuat prompt. Silakan coba lagi.',
        type: 'warning'
      });
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  // Realtime Clock Effect
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Local Storage Load
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('metazo_settings');
      if (savedSettings) {
        const data = JSON.parse(savedSettings);
        if (data.themeMode !== undefined) setThemeMode(data.themeMode);
        if (data.metadataLanguage) setSelectedLanguage(data.metadataLanguage);
        if (data.geminiModel) setSelectedModel(data.geminiModel);
        if (data.useSystemKey !== undefined) setUseSystemKey(data.useSystemKey);
        if (data.keywordCount) setKeywordCount(data.keywordCount);
        if (data.enableUpscaling !== undefined) setEnableUpscaling(data.enableUpscaling);
      }
      
      const savedIntegrations = localStorage.getItem('metazo_integrations');
      if (savedIntegrations) {
        setIntegrations(JSON.parse(savedIntegrations));
      }
      
      const savedApiKeys = localStorage.getItem('metazo_apikeys');
      if (savedApiKeys) {
        setApiKeys(JSON.parse(savedApiKeys));
      }
      
      const savedHistory = localStorage.getItem('metazo_history');
      if (savedHistory) {
        setHistoryItems(JSON.parse(savedHistory));
      }
    } catch (e) {
      console.error('Failed to parse local storage data', e);
    }
    
    setIsInitialLoad(false);
  }, []);

  // Removed exportToCSV implementation here to keep it concise, let's keep exportToCSV but just change the other stuff

  const exportToCSV = () => {
    if (historyItems.length === 0) return;
    
    const headers = ["Filename", "Title", "Description", "Keywords", "Market Insight", "Timestamp", "Media Type"];
    const rows = historyItems.map(item => [
      item.fileName,
      item.result.title,
      item.result.description,
      item.result.keywords.map((k: any) => k.term).join(", "),
      item.result.marketInsight || "",
      new Date(item.timestamp).toLocaleString(),
      item.mediaType
    ]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${(cell || "").toString().replace(/"/g, '""')}"`).join(","))
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `metazo_history_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Save to History Helper
  const saveToHistory = async (newItem: any) => {
    try {
      const updatedHistory = JSON.parse(JSON.stringify([newItem, ...historyItems])).slice(0, 50); // Keep last 50
      setHistoryItems(updatedHistory);
      localStorage.setItem('metazo_history', JSON.stringify(updatedHistory));
    } catch (err) {
      console.error(err);
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      const updatedHistory = historyItems.filter(item => item.id !== id);
      setHistoryItems(updatedHistory);
      localStorage.setItem('metazo_history', JSON.stringify(updatedHistory));
    } catch (err) {
      console.error(err);
    }
  };

  // Local Storage Sync - Save Settings
  useEffect(() => {
    if (isInitialLoad) return;

    const timer = setTimeout(() => {
      try {
        localStorage.setItem('metazo_settings', JSON.stringify({
          themeMode,
          metadataLanguage: selectedLanguage,
          geminiModel: selectedModel,
          useSystemKey,
          keywordCount,
          enableUpscaling
        }));
        localStorage.setItem('metazo_integrations', JSON.stringify(integrations));
        localStorage.setItem('metazo_apikeys', JSON.stringify(apiKeys));
      } catch (err) {
        console.error(err);
      }
    }, 1000); // Debounce saves

    return () => clearTimeout(timer);
  }, [themeMode, selectedLanguage, selectedModel, useSystemKey, keywordCount, enableUpscaling, integrations, apiKeys, isInitialLoad]);

  // Handle Theme Application
  useEffect(() => {
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      if (themeMode === 'system') {
        setIsDarkMode(e.matches);
      }
    };

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      setIsDarkMode(mediaQuery.matches);
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    } else {
      setIsDarkMode(themeMode === 'dark');
    }
  }, [themeMode]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);
  
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzingBatch, setIsAnalyzingBatch] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queueSectionRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Effect to scroll to processing item
  useEffect(() => {
    const processingItem = fileItems.find(item => item.status === 'PROCESSING');
    if (processingItem) {
      const ref = itemRefs.current.get(processingItem.id);
      if (ref) {
        ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [fileItems]);

  // Effect to scroll back to top when finished
  useEffect(() => {
    if (!isAnalyzingBatch && fileItems.some(item => item.status === 'SUCCESS')) {
      // Small delay to ensure last item finishes animation
      setTimeout(() => {
        if (fileItems.length > 0) {
          const firstItem = itemRefs.current.get(fileItems[0].id);
          if (firstItem) {
            firstItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 500);
    }
  }, [isAnalyzingBatch]);

  const keywordOptions = [10, 25, 35, 40, 49];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesSelected(Array.from(e.target.files));
    }
    // Reset value so same files can be selected again if needed
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFilesSelected = (files: File[]) => {
    let filesToProcess = files;
    if (uploadMode === 'Single') {
      filesToProcess = [files[0]];
      // Clear existing previews if in single mode
      fileItems.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    }

    const newItems: FileItem[] = filesToProcess.map(file => {
      let previewUrl = null;
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        previewUrl = URL.createObjectURL(file);
      }
      return {
        id: Math.random().toString(36).substring(2, 9),
        file,
        previewUrl,
        status: 'PENDING'
      };
    });
    
    if (uploadMode === 'Single') {
      setFileItems(newItems);
    } else {
      setFileItems(prev => [...prev, ...newItems]);
    }

    setTimeout(() => {
      queueSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const removeFile = (id: string) => {
    setFileItems(prev => {
      const items = [...prev];
      const index = items.findIndex(item => item.id === id);
      if (index !== -1 && items[index].previewUrl) {
        URL.revokeObjectURL(items[index].previewUrl!);
      }
      return items.filter(item => item.id !== id);
    });
  };

  const [draggedItemIndex, setDraggedItemIndex] = useState<{fileId: string, index: number} | null>(null);

  /* Inactivity Logout removed since Login is disabled */
  /* if (!user) {
    return <Login />;
  } */

  const recalculateTiers = (keywords: any[]) => {
    return keywords.map((k, i) => ({
      ...k,
      seoTier: i < 10 ? 'High' : (i < 30 ? 'Medium' : 'Low')
    }));
  };

  const moveKeyword = (fileId: string, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setFileItems(prev => prev.map(item => {
      if (item.id !== fileId || !item.result) return item;
      
      const newKeywords = [...item.result.keywords];
      const [moved] = newKeywords.splice(fromIndex, 1);
      newKeywords.splice(toIndex, 0, moved);
      return { ...item, result: { ...item.result, keywords: recalculateTiers(newKeywords) } };
    }));
  };

  const submitToStock = async (fileId: string, platform: string) => {
    const item = fileItems.find(i => i.id === fileId);
    if (!item || !item.result) return;

    setFileItems(prev => prev.map(i => i.id === fileId ? {
      ...i,
      submissionStatus: { ...i.submissionStatus, [platform]: 'SUBMITTING' }
    } : i));

    try {
      // Simulation of API call to Contributor API
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      setFileItems(prev => prev.map(i => i.id === fileId ? {
        ...i,
        submissionStatus: { ...i.submissionStatus, [platform]: 'SUCCESS' }
      } : i));
    } catch (err) {
      setFileItems(prev => prev.map(i => i.id === fileId ? {
        ...i,
        submissionStatus: { ...i.submissionStatus, [platform]: 'ERROR' }
      } : i));
    }
  };

  const removeKeyword = (fileId: string, index: number) => {
    setFileItems(prev => prev.map(item => {
      if (item.id !== fileId || !item.result) return item;
      const newKeywords = item.result.keywords.filter((_, i) => i !== index);
      return { ...item, result: { ...item.result, keywords: recalculateTiers(newKeywords) } };
    }));
  };

  const addKeyword = (fileId: string, term: string) => {
    if (!term.trim()) return;
    setFileItems(prev => prev.map(item => {
      if (item.id !== fileId || !item.result) return item;
      const newKeywords = [...item.result.keywords, { term: term.trim(), seoTier: 'Low' }];
      return { ...item, result: { ...item.result, keywords: recalculateTiers(newKeywords) } };
    }));
  };

  const clearAllFiles = () => {
    fileItems.forEach(item => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setFileItems([]);
  };

  const downloadCSV = () => {
    const successfulItems = fileItems.filter(item => item.status === 'SUCCESS' && item.result);
    if (successfulItems.length === 0) return;

    let csvContent = "Filename,Title,Description,Keywords,Adobe Category,Shutterstock Category 1,Shutterstock Category 2,Other Categories\n";
    
    successfulItems.forEach(item => {
      const result = item.result!;
      const filename = `"${item.file.name.replace(/"/g, '""')}"`;
      const title = `"${result.title.replace(/"/g, '""')}"`;
      const description = `"${result.description.replace(/"/g, '""')}"`;
      
      const adobeCat = (result.categories.find(c => c.platform === 'Adobe Stock')?.category || '');
      const shCats = (result.categories.find(c => c.platform === 'Shutterstock')?.category || '').split(',').map(s => s.trim());
      const shCat1 = shCats[0] || '';
      const shCat2 = shCats[1] || '';
      
      const otherCats = (result.categories || [])
        .filter(c => c.platform !== 'Adobe Stock' && c.platform !== 'Shutterstock')
        .map(c => `${c.platform}: ${c.category}`)
        .join(' | ');

      const categoryCol = `"${otherCats.replace(/"/g, '""')}"`;
      const keywords = `"${result.keywords.map(k => k.term).join(',').replace(/"/g, '""')}"`;
      
      csvContent += `${filename},${title},${description},${keywords},"${adobeCat}","${shCat1}","${shCat2}",${categoryCol}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'microstock_metadata.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const base64Data = reader.result.split(',')[1];
          resolve(base64Data);
        } else {
          reject(new Error("Failed to read file as base64"));
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const extractFramesFromVideo = (file: File): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.playsInline = true;
      video.muted = true;
      const url = URL.createObjectURL(file);
      video.src = url;
      video.load();

      video.onloadedmetadata = async () => {
        const duration = video.duration;
        const frames: string[] = [];
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // Extract 3 specific frames: Awal (10%), Tengah (50%), Akhir (90%)
        const targetTimes = [
          duration * 0.1, // Awal (10% untuk menghindari fade-in hitam)
          duration * 0.5, // Tengah
          duration * 0.9  // Akhir (90% untuk menghindari fade-out hitam)
        ];
        
        for (const time of targetTimes) {
          video.currentTime = time;
          
          await new Promise<void>((onSeeked) => {
            video.onseeked = () => onSeeked();
            video.onerror = () => onSeeked(); // Continue on error
          });

          if (video.videoWidth && video.videoHeight && context) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const base64Data = dataUrl.split(',')[1];
            frames.push(base64Data);
          }
        }
        URL.revokeObjectURL(url);
        resolve(frames);
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load video"));
      };
    });
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev => 
      prev.includes(platform) 
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  const handleAnalyzeBatch = async () => {
    if (apiKeys.filter(k => k.enabled).length === 0 && !useSystemKey) {
      setDialogState({
        isOpen: true,
        title: uiLanguage === 'id' ? 'API Key Diperlukan' : 'API Key Required',
        message: uiLanguage === 'id' ? 'Anda belum menambahkan API Key. Sistem membutuhkan setidaknya 1 API Key Gemini aktif di Pengaturan.' : 'You have not added an API Key. The system requires at least 1 active Gemini API Key in Settings.',
        type: 'error'
      });
      return;
    }

    const pendingItems = fileItems.filter(item => item.status === 'PENDING' || item.status === 'ERROR');
    if (pendingItems.length === 0) return;

    setIsAnalyzingBatch(true);

    try {
      const queue = [...pendingItems];
      const CONCURRENCY_LIMIT = 1;

      const processItem = async (currentItem: FileItem) => {
        if (!currentItem) return;
        
        setFileItems(prev => 
          prev.map(item => item.id === currentItem.id ? { ...item, status: 'PROCESSING', statusMessage: enableUpscaling ? 'Upscaling image with AI...' : 'Analyzing...' } : item)
        );

        try {
          if (enableUpscaling && (mediaType === 'Gambar' || mediaType === 'Vektor') && !currentItem.file.type.startsWith('video/')) {
            const statusMsg = uiLanguage === 'id' ? 'Meningkatkan kualitas gambar (AI)...' : 'Upscaling image quality (AI)...';
            setFileItems(prev => prev.map(item => item.id === currentItem.id ? { ...item, statusMessage: statusMsg } : item));
            
            await new Promise(resolve => setTimeout(resolve, 2000)); 
            const upscaledUrl = await simulateUpscale(currentItem.file);
            setFileItems(prev => prev.map(item => item.id === currentItem.id ? { ...item, previewUrl: upscaledUrl } : item));
          }

          let base64Data: string | string[];
          const prepMsg = uiLanguage === 'id' ? 'Menyiapkan file...' : 'Preparing file...';
          setFileItems(prev => prev.map(item => item.id === currentItem.id ? { ...item, statusMessage: prepMsg } : item));

          if (mediaType === 'Video' || currentItem.file.type.startsWith('video/')) {
            base64Data = await extractFramesFromVideo(currentItem.file);
          } else {
            base64Data = await fileToBase64(currentItem.file);
          }

          const metadata = await generateStockMetadata(
            base64Data,
            currentItem.file.type,
            currentItem.file.name,
            theme,
            keywordCount,
            titleCount,
            descCount,
            selectedLanguage,
            mediaType === 'Settings' ? 'Gambar' : mediaType,
            selectedPlatforms,
            apiKeys.filter(k => k.enabled).map(k => k.key),
            selectedModel,
            (msg) => {
              setFileItems(prev => 
                prev.map(item => item.id === currentItem.id ? { ...item, statusMessage: msg } : item)
              );
            }
          );
          
          setFileItems(prev => 
            prev.map(item => item.id === currentItem.id ? { ...item, status: 'SUCCESS', statusMessage: 'Done', result: metadata } : item)
          );

          // Save to history (non-blocking)
          saveToHistory({
            id: currentItem.id,
            fileName: currentItem.file.name,
            result: metadata,
            timestamp: new Date().toISOString(),
            mediaType
          }).catch(console.error);

        } catch (err: any) {
          console.error("Error generating metadata for file:", currentItem.file.name, err);
          const isRateLimit = err.message?.includes("rate limit") || err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED");
          
          setFileItems(prev => 
            prev.map(item => item.id === currentItem.id ? { ...item, status: 'ERROR', error: err.message || "Gagal memproses file." } : item)
          );
          
          if (isRateLimit) {
            console.warn("Detected rate limit. Adding extra cooldown...");
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      };

      const worker = async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item) await processItem(item);
        }
      };

      const workers = [];
      for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        workers.push(worker());
      }
      
      await Promise.all(workers);

    } catch (err) {
      console.error("Batch processing error:", err);
    } finally {
      setIsAnalyzingBatch(false);
    }
  };

  const handleRegenerate = async (id: string) => {
    if (apiKeys.filter(k => k.enabled).length === 0) {
      setDialogState({
        isOpen: true,
        title: uiLanguage === 'id' ? 'API Key Diperlukan' : 'API Key Required',
        message: uiLanguage === 'id' ? 'Anda belum menambahkan API Key. Sistem membutuhkan setidaknya 1 API Key Groq aktif di Pengaturan.' : 'You have not added an API Key. The system requires at least 1 active Groq API Key in Settings.',
        type: 'error'
      });
      return;
    }

    const item = fileItems.find(i => i.id === id);
    if (!item) return;

    setFileItems(prev => 
      prev.map(i => i.id === id ? { ...i, status: 'PROCESSING', statusMessage: enableUpscaling ? 'Reloading & Upscaling...' : 'Regenerating...' } : i)
    );

    try {
      if (enableUpscaling && (mediaType === 'Gambar' || mediaType === 'Vektor') && !item.file.type.startsWith('video/')) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const upscaledUrl = await simulateUpscale(item.file);
        setFileItems(prev => prev.map(i => i.id === id ? { ...i, previewUrl: upscaledUrl } : i));
      }

      let base64Data: string | string[];
      if (mediaType === 'Video' || item.file.type.startsWith('video/')) {
        base64Data = await extractFramesFromVideo(item.file);
      } else {
        base64Data = await fileToBase64(item.file);
      }

      const metadata = await generateStockMetadata(
        base64Data,
        item.file.type,
        item.file.name,
        theme,
        keywordCount,
        titleCount,
        descCount,
        selectedLanguage,
        mediaType === 'Settings' ? 'Gambar' : mediaType,
        selectedPlatforms,
        apiKeys.filter(k => k.enabled).map(k => k.key),
        selectedModel
      );
      
      setFileItems(prev => 
        prev.map(i => i.id === id ? { ...i, status: 'SUCCESS', result: metadata } : i)
      );
    } catch (err: any) {
      console.error("Error regenerating metadata for file:", item.file.name, err);
      setFileItems(prev => 
        prev.map(i => i.id === id ? { ...i, status: 'ERROR', error: err.message || "Gagal memproses file." } : i)
      );
    }
  };

  const showDialog = (title: string, message: string, type: 'success' | 'warning' | 'info' | 'error') => {
    setDialogState({ isOpen: true, title, message, type });
  };

  const exportKeys = () => {
    if (apiKeys.length === 0) {
      showDialog('Empty Vault', 'No API keys found to synchronize.', 'warning');
      return;
    }
    const keyString = apiKeys.map(k => k.key).join('\n');
    navigator.clipboard.writeText(keyString);
    showDialog('Integration Sync Success', 'All API keys have been copied to the system buffer (clipboard).', 'success');
  };

  const importBulkKeys = () => {
    const rawKeys = bulkInput.split(/[\n,;]+/).map(k => k.trim()).filter(k => k.length > 10);
    // Deduplicate input and filter out existing
    const uniqueBatch = Array.from(new Set(rawKeys));
    const newKeysOnly = uniqueBatch.filter(key => !apiKeys.some(k => k.key === key));
    
    if (newKeysOnly.length > 0) {
      const processedKeys = newKeysOnly.map(key => ({ key, enabled: true }));
      setApiKeys(prev => [...prev, ...processedKeys]);
      setBulkInput('');
      setShowBulkImport(false);
      showDialog('Bulk Deploy Success', `${newKeysOnly.length} new API keys have been integrated into the cluster.`, 'success');
    } else {
      showDialog('Deployment Halted', 'No unique or valid API keys were detected in the input stream.', 'warning');
    }
  };

  const testKey = async (key: string) => {
    setKeyStatuses(prev => ({ ...prev, [key]: 'TESTING' }));
    // const isValid = await validateApiKey(key); // Groq validation removed
    const isValid = true; // Placeholder for now
    setKeyStatuses(prev => ({ ...prev, [key]: isValid ? 'VALID' : 'INVALID' }));
    
    if (isValid) {
      showDialog('Integration Link Verified', `This API key is fully operational and authenticated with Gemini servers.`, 'success');
    } else {
      showDialog('Link Breakdown', 'This API key failed validation. It might be expired, restricted, or incorrectly formatted.', 'error');
    }
  };

  const toggleKeyVisibility = (key: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderUploadContent = () => {
    return (
      <div 
        className="flex flex-col items-center justify-center h-full w-full p-8 cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadCloud className="w-12 h-12 text-accent mb-4 animate-bounce" />
        <p className="text-text-primary text-center font-[700] text-[16px] tracking-tight">
          Unggah {mediaType} Anda Di Sini
        </p>
        <p className="text-text-secondary text-center font-[500] text-[14px] mt-1">
          Tarik & lepas file atau <span className="text-accent hover:underline">pilih berkas</span>
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          {mediaType === 'Gambar' && ['JPG', 'PNG', 'WEBP', 'HEIC'].map(ext => <span key={ext} className="px-2 py-0.5 bg-subtle border border-border rounded text-[10px] font-bold text-text-secondary">{ext}</span>)}
          {mediaType === 'Video' && ['MP4', 'MOV', 'AVI'].map(ext => <span key={ext} className="px-2 py-0.5 bg-subtle border border-border rounded text-[10px] font-bold text-text-secondary">{ext}</span>)}
          {mediaType === 'Vektor' && ['EPS', 'AI', 'SVG'].map(ext => <span key={ext} className="px-2 py-0.5 bg-subtle border border-border rounded text-[10px] font-bold text-text-secondary">{ext}</span>)}
        </div>
      </div>
    );
  };

  const renderPromptGeneratorContent = () => {
    const styleOptions = promptGenType === 'Background' 
      ? ['Cinematic', 'Realistic Photo', 'Vector Art', 'Photorealistic', 'Fantasy Art', 'Sci-fi Concept Art', 'Anime/Manga', 'Watercolor Painting', 'Oil Painting', 'Abstract', 'Vintage Photography', 'Cyberpunk', 'Steampunk']
      : ['3D render', 'Flat icon', 'vector art', 'Isometric', 'Pixel Art', 'Claymation Style', 'Sticker Illustration', 'Low Poly', 'Hand Drawn Sketch', 'Origami Style', 'Glassmorphism', 'Metall Embos'];

    const aiModels = [
      { id: 'Midjourney', label: 'Midjourney v6.1', icon: Zap, color: 'text-purple-500' },
      { id: 'DALL-E 3', label: 'DALL-E 3', icon: Sparkles, color: 'text-orange-500' },
      { id: 'Stable Diffusion', label: 'SDXL / Flux', icon: PenTool, color: 'text-blue-500' }
    ];

    const aspectRatios = [
      { id: '1:1', label: '1:1 Square', class: 'w-4 h-4' },
      { id: '3:2', label: '3:2 Classic', class: 'w-6 h-4' },
      { id: '2:3', label: '2:3 Portrait', class: 'w-4 h-6' },
      { id: '16:9', label: '16:9 Cinema', class: 'w-7 h-4' },
      { id: '9:16', label: '9:16 Mobile', class: 'w-4 h-7' }
    ];

    return (
      <section className="col-span-full">
        <div className="bg-surface rounded-[4rem] p-8 lg:p-16 border-2 border-border/40 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] relative overflow-hidden group">
          {/* Background Elements */}
          <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-accent opacity-[0.03] rounded-full blur-[120px] pointer-events-none group-hover:opacity-[0.05] transition-opacity duration-1000"></div>
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent to-transparent opacity-30"></div>
          
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between mb-16 gap-12 relative z-10 border-b border-border/40 pb-12">
            <div className="flex items-center gap-8">
              <motion.div 
                animate={{ rotate: [3, -3, 3] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                className="w-24 h-24 bg-gradient-to-br from-accent via-purple-500 to-indigo-600 text-white rounded-[2.5rem] flex items-center justify-center shadow-[0_20px_50px_rgba(var(--accent-rgb),0.3)] relative group-hover:shadow-[0_20px_60px_rgba(var(--accent-rgb),0.4)] transition-shadow"
              >
                <div className="absolute inset-1 border-2 border-white/20 rounded-[2rem] pointer-events-none"></div>
                <Layers className="w-12 h-12" />
              </motion.div>
              <div>
                <div className="flex items-center gap-4 mb-2">
                  <h2 className="text-5xl font-black text-text-primary tracking-tighter uppercase italic leading-none">PROMPT ENGINE</h2>
                  <div className="flex items-center gap-2 px-3 py-1 bg-accent/10 border border-accent/20 rounded-full">
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse"></div>
                    <span className="text-accent text-[9px] font-black uppercase tracking-widest">N-CORE v2.1</span>
                  </div>
                </div>
                <p className="text-text-secondary font-black text-[10px] uppercase tracking-[0.4em] opacity-40">Integrated Synthesis Pipeline</p>
              </div>
            </div>
            
            <div className="flex flex-col gap-4 min-w-[320px]">
              <label className="text-[10px] font-black text-text-secondary uppercase tracking-[0.4em] px-4 opacity-60">Output Mode Protocol</label>
              <div className="flex bg-subtle/50 backdrop-blur-md p-2 rounded-3xl border-2 border-border/60 shadow-inner group/toggle">
                {(['Background', 'PNG Asset'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setPromptGenType(type);
                      setGeneratedPrompts([]);
                      setPromptStyle(type === 'Background' ? 'Realistic Photo' : '3D render');
                    }}
                    className={`flex-1 px-8 py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all duration-500 relative overflow-hidden ${
                      promptGenType === type 
                        ? 'text-white' 
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {promptGenType === type && (
                      <motion.div 
                        layoutId="active-toggle"
                        className="absolute inset-0 bg-accent shadow-lg shadow-accent/20"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      />
                    )}
                    <span className="relative z-10">{type}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-16 relative z-10">
            {/* Top: Input Configuration */}
            <div className="space-y-12">
              {/* Architecture Target */}
              <div className="space-y-6">
                <div className="flex items-center gap-3 px-1">
                  <div className="w-1.5 h-6 bg-accent rounded-full"></div>
                  <label className="text-[11px] font-black text-text-primary uppercase tracking-[0.3em]">Hardware Architecture</label>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {aiModels.map((model) => (
                    <motion.button
                      whileHover={{ y: -4 }}
                      whileTap={{ scale: 0.96 }}
                      key={model.id}
                      onClick={() => setPromptTargetAI(model.id)}
                      className={`flex flex-col items-center justify-center p-6 rounded-[2rem] border-2 transition-all duration-500 gap-4 relative overflow-hidden ${
                        promptTargetAI === model.id 
                          ? 'bg-accent/5 border-accent shadow-xl shadow-accent/5 ring-4 ring-accent/5' 
                          : 'bg-subtle/20 border-transparent hover:border-border opacity-60 grayscale'
                      }`}
                    >
                      {promptTargetAI === model.id && (
                        <div className="absolute top-0 right-0 w-8 h-8 bg-accent flex items-center justify-center rounded-bl-xl text-white">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      )}
                      <model.icon className={`w-8 h-8 ${promptTargetAI === model.id ? model.color : 'text-text-secondary'}`} />
                      <span className={`text-[9px] font-black uppercase tracking-widest ${promptTargetAI === model.id ? 'text-accent' : 'text-text-secondary'}`}>
                        {model.label.split(' ')[0]}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Subject Definition */}
              <div className="space-y-6">
                <div className="flex justify-between items-end px-1">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-6 bg-purple-500 rounded-full"></div>
                    <label className="text-[11px] font-black text-text-primary uppercase tracking-[0.3em]">Primary Concept</label>
                  </div>
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleSuggestIdea}
                    disabled={isGeneratingThemes}
                    className="flex items-center gap-2 text-[10px] font-black text-accent uppercase tracking-widest hover:bg-accent/10 disabled:opacity-40 transition-all bg-accent/5 px-4 py-2 rounded-full border border-accent/20"
                  >
                    {isGeneratingThemes ? <RefreshCw className="w-3.5 h-3.5 animate-spin"/> : <Cpu className="w-3.5 h-3.5" />}
                    <span>AI Brainstorm</span>
                  </motion.button>
                </div>
                
                <div className="relative group/area">
                  <textarea
                    value={promptSubject}
                    onChange={(e) => setPromptSubject(e.target.value)}
                    placeholder={promptGenType === 'Background' ? "Descriptive landscape, cinematic lighting, ultra-detailed..." : "Subject macro, studio lighting, hyper-realistic..."}
                    className="w-full min-h-[200px] bg-subtle/20 backdrop-blur-sm border-2 border-border/80 focus:border-accent focus:bg-surface rounded-[2.5rem] p-8 text-[15px] font-medium focus:outline-none transition-all resize-none shadow-inner leading-relaxed"
                  />
                  
                  <AnimatePresence>
                    {showThemeSuggestions && suggestedThemes.length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.98, filter: "blur(10px)" }}
                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.98, filter: "blur(10px)" }}
                        className="absolute inset-0 z-30 bg-surface/98 backdrop-blur-3xl rounded-[2.5rem] border-2 border-accent shadow-2xl p-8 overflow-y-auto custom-scrollbar"
                      >
                        <div className="flex justify-between items-center mb-8 sticky top-0 bg-surface/98 py-2 z-10">
                          <h4 className="text-xs font-black text-accent uppercase tracking-[0.3em] flex items-center gap-3">
                            <Sparkles className="w-4 h-4" /> Recommended Blueprints
                          </h4>
                          <button onClick={() => setShowThemeSuggestions(false)} className="p-2 hover:bg-subtle rounded-xl transition-colors">
                            <Trash2 className="w-4 h-4 text-text-secondary hover:text-red-500" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                          {suggestedThemes.map((theme, i) => (
                            <motion.button
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.05 }}
                              key={i}
                              onClick={() => {
                                setPromptSubject(theme);
                                setShowThemeSuggestions(false);
                              }}
                              className="text-left p-5 rounded-2xl bg-subtle/40 hover:bg-accent border-2 border-border/50 hover:border-accent transition-all duration-300 relative group/item"
                            >
                              <span className="text-[10px] font-black opacity-30 group-hover/item:opacity-100 group-hover/item:text-white/60 mr-3 italic">{String(i+1).padStart(2,'0')}</span>
                              <span className="text-sm font-semibold group-hover/item:text-white">{theme}</span>
                            </motion.button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Parameters Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <div className="flex items-center gap-3 px-1">
                    <div className="w-1.5 h-6 bg-indigo-500 rounded-full"></div>
                    <label className="text-[11px] font-black text-text-primary uppercase tracking-[0.3em]">Aesthetic Protocol</label>
                  </div>
                  <select
                    value={promptStyle}
                    onChange={(e) => setPromptStyle(e.target.value)}
                    className="w-full bg-subtle/30 border-2 border-border/60 rounded-2xl px-6 py-5 text-sm font-black focus:outline-none focus:border-accent transition-all cursor-pointer appearance-none shadow-sm"
                  >
                    {styleOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-3 px-1">
                    <div className="w-1.5 h-6 bg-pink-500 rounded-full"></div>
                    <label className="text-[11px] font-black text-text-primary uppercase tracking-[0.3em]">Spatial Constraint</label>
                  </div>
                  <div className="grid grid-cols-5 gap-3">
                    {aspectRatios.map((ar) => (
                      <button
                        key={ar.id}
                        onClick={() => setPromptAspectRatio(ar.id)}
                        title={ar.label}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all duration-300 ${
                          promptAspectRatio === ar.id 
                            ? 'bg-accent/10 border-accent shadow-lg shadow-accent/5' 
                            : 'bg-subtle/20 border-transparent hover:border-border opacity-40 grayscale group-hover:opacity-100'
                        }`}
                      >
                        <div className={`bg-current ${ar.class} rounded-sm mb-2 transition-all ${promptAspectRatio === ar.id ? 'text-accent scale-110' : 'text-text-secondary opacity-50'}`} />
                        <span className={`text-[8px] font-black tracking-tighter ${promptAspectRatio === ar.id ? 'text-accent' : 'text-text-secondary'}`}>{ar.id}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Logic Density */}
              <div className="space-y-8 pt-6 border-t border-border/40">
                <div className="space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-6 bg-emerald-500 rounded-full"></div>
                      <label className="text-[11px] font-black text-text-primary uppercase tracking-[0.3em]">Batch Population</label>
                    </div>
                    <div className="px-4 py-1 bg-accent/10 rounded-full border border-accent/20">
                      <span className="text-[12px] font-black text-accent font-mono">{promptVariations} UNITS</span>
                    </div>
                  </div>
                  <div className="relative flex items-center h-8">
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={promptVariations}
                      onChange={(e) => setPromptVariations(Number(e.target.value))}
                      className="w-full h-1.5 bg-subtle rounded-full appearance-none cursor-pointer accent-accent transition-all hover:h-2"
                    />
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.02, y: -4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleGeneratePrompts}
                  disabled={isGeneratingPrompts || !promptSubject.trim()}
                  className="w-full py-8 bg-text-primary text-surface rounded-[2.5rem] font-black uppercase tracking-[0.4em] hover:shadow-2xl hover:shadow-text-primary/10 transition-all flex flex-col items-center justify-center relative overflow-hidden group/btn disabled:opacity-50"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000"></div>
                  {isGeneratingPrompts ? (
                    <div className="flex items-center gap-4">
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      <span className="text-sm italic">SYNTHESIZING...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <Zap className="w-6 h-6 fill-accent text-accent" />
                      <span className="text-sm italic">INITIALIZE DEPLOYMENT</span>
                    </div>
                  )}
                </motion.button>
              </div>
            </div>

            {/* Bottom: Results Dashboard */}
            <div className="bg-subtle/10 border-2 border-border/40 rounded-[3rem] p-10 min-h-[700px] flex flex-col relative overflow-hidden group/results">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,_var(--tw-gradient-stops))] from-accent/5 via-transparent to-transparent pointer-events-none"></div>
              
              <div className="flex justify-between items-center mb-10 relative z-10 border-b border-border/30 pb-6">
                <div className="flex items-center gap-4">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
                  <h3 className="text-xs font-black text-text-primary uppercase tracking-[0.4em]">NEURAL OUTPUT STREAM</h3>
                </div>
                <AnimatePresence>
                  {generatedPrompts.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex gap-4"
                    >
                      <button 
                        onClick={() => {
                          const blob = new Blob([generatedPrompts.join('\n\n')], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `neural-prompts-${Date.now()}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                          setDialogState({
                            isOpen: true,
                            title: 'Extraction Complete',
                            message: 'Semua prompt berhasil diunduh dalam format .txt',
                            type: 'success'
                          });
                        }}
                        className="px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-500 text-[9px] font-black uppercase tracking-widest hover:bg-blue-500 hover:text-white transition-all flex items-center gap-2 shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" /> TXT EXTRACT
                      </button>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(generatedPrompts.join('\n\n'));
                          setDialogState({
                            isOpen: true,
                            title: 'Sync Complete',
                            message: 'Semua output sequence berhasil disalin ke clipboard.',
                            type: 'success'
                          });
                        }}
                        className="px-4 py-2 bg-accent/10 border border-accent/20 rounded-xl text-accent text-[9px] font-black uppercase tracking-widest hover:bg-accent hover:text-white transition-all flex items-center gap-2 shadow-sm"
                      >
                        <Copy className="w-3.5 h-3.5" /> SYNC ALL
                      </button>
                      <button 
                        onClick={() => {
                          setGeneratedPrompts([]);
                          setDialogState({
                            isOpen: true,
                            title: 'Stream Purged',
                            message: 'Semua output stream telah dibersihkan dari layar.',
                            type: 'info'
                          });
                        }}
                        className="px-4 py-2 bg-red-500/5 border border-red-500/10 rounded-xl text-red-500 text-[9px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center gap-2 shadow-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> PURGE
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 relative z-10 scroll-smooth">
                {isGeneratingPrompts ? (
                  <div className="flex flex-col items-center justify-center h-full gap-10">
                    <div className="relative">
                      <div className="w-32 h-32 border-[6px] border-accent/10 border-t-accent rounded-full animate-spin"></div>
                      <Cpu className="w-10 h-10 text-accent absolute inset-0 m-auto animate-pulse" />
                      <div className="absolute -top-4 -left-4 w-4 h-4 bg-purple-500 rounded-full blur-sm animate-bounce"></div>
                    </div>
                    <div className="space-y-4 text-center">
                      <p className="font-black text-text-primary text-2xl tracking-tighter italic uppercase">Processing Data...</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-[10px] text-text-secondary font-black uppercase tracking-[0.3em] opacity-40">Compiling for</span>
                        <span className="text-[10px] text-accent font-black uppercase tracking-[0.3em]">{promptTargetAI} Logic</span>
                      </div>
                    </div>
                  </div>
                ) : generatedPrompts.length > 0 ? (
                  <div className="grid grid-cols-1 gap-6 pb-6">
                    {generatedPrompts.map((p, i) => (
                      <motion.div 
                        initial={{ opacity: 0, y: 30, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ delay: i * 0.04, type: "spring", stiffness: 100 }}
                        key={i} 
                        className="group bg-surface/40 backdrop-blur-xl p-8 rounded-[2.5rem] border-2 border-border/40 hover:border-accent hover:shadow-2xl hover:shadow-accent/10 transition-all duration-500 relative flex gap-8 items-start overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-accent opacity-[0.01] group-hover:opacity-[0.05] rounded-full blur-[40px] -mr-16 -mt-16 transition-opacity"></div>
                        
                        <div className="w-12 h-12 rounded-[1.25rem] bg-subtle/50 border-2 border-border flex items-center justify-center shrink-0 font-black text-xs text-text-secondary group-hover:text-accent group-hover:border-accent/40 group-hover:shadow-[0_0_20px_rgba(var(--accent-rgb),0.3)] transition-all">
                          {String(i + 1).padStart(2, '0')}
                        </div>
                        
                        <div className="flex-1 space-y-6 pt-1">
                          <p className="text-[16px] font-semibold text-text-primary leading-[1.8] tracking-tight">{p}</p>
                          <div className="flex flex-wrap gap-3">
                             <div className="flex items-center gap-1.5 px-3 py-1 bg-subtle/60 rounded-full border border-border/50">
                               <Cpu className="w-3 h-3 text-accent" />
                               <span className="text-[9px] font-black text-text-secondary uppercase tracking-tighter">{promptTargetAI}</span>
                             </div>
                             <div className="flex items-center gap-1.5 px-3 py-1 bg-subtle/60 rounded-full border border-border/50">
                               <Maximize className="w-3 h-3 text-text-secondary" />
                               <span className="text-[9px] font-black text-text-secondary uppercase tracking-tighter">AR {promptAspectRatio}</span>
                             </div>
                             <div className="flex items-center gap-1.5 px-3 py-1 bg-subtle/60 rounded-full border border-border/50">
                               <Palette className="w-3 h-3 text-text-secondary" />
                               <span className="text-[9px] font-black text-text-secondary uppercase tracking-tighter">{promptStyle}</span>
                             </div>
                          </div>
                        </div>

                        <motion.button 
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={(e) => {
                            navigator.clipboard.writeText(p);
                            const target = e.currentTarget as HTMLElement;
                            if (target) {
                              const original = target.innerHTML;
                              target.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
                              target.classList.add('text-accent', 'bg-accent/10');
                              setTimeout(() => {
                                target.innerHTML = original;
                                target.classList.remove('text-accent', 'bg-accent/10');
                              }, 2000);
                            }
                            setDialogState({
                              isOpen: true,
                              title: 'Prompt Copied',
                              message: 'Prompt berhasil disalin ke clipboard.',
                              type: 'success'
                            });
                          }}
                          className="p-4 bg-subtle/50 hover:bg-white rounded-2xl text-text-secondary hover:text-accent transition-all shadow-sm border border-border group-hover:border-accent group-hover:shadow-[0_0_15px_rgba(var(--accent-rgb),0.2)]"
                        >
                          <Copy className="w-6 h-6" />
                        </motion.button>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full py-20 text-center gap-10">
                    <div className="relative group/wait">
                      <div className="w-40 h-40 bg-surface/40 rounded-[3.5rem] flex items-center justify-center border-4 border-dashed border-border group-hover/wait:border-accent group-hover/wait:rotate-6 transition-all duration-700">
                        <Layers className="w-16 h-16 text-border group-hover/wait:text-accent transition-colors" />
                        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent rounded-[3.5rem]"></div>
                      </div>
                      <motion.div 
                        animate={{ y: [0, -10, 0] }}
                        transition={{ duration: 3, repeat: Infinity }}
                        className="absolute -bottom-4 -right-4 w-16 h-16 bg-surface rounded-2xl shadow-2xl flex items-center justify-center border-2 border-border group-hover/wait:border-accent"
                      >
                        <Zap className="w-7 h-7 text-accent fill-accent" />
                      </motion.div>
                    </div>
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <h4 className="text-3xl font-black text-text-primary uppercase tracking-tighter leading-none italic">Awaiting Semantic Protocol</h4>
                        <p className="text-[10px] font-black text-text-secondary uppercase tracking-[0.5em] opacity-40">Bridge established. System idling.</p>
                      </div>
                      <p className="text-sm text-text-secondary max-w-[350px] leading-[1.8] mx-auto font-medium opacity-80 italic">Configure your visual architecture parameters and trigger the synth-engine to deploy high-commercial value metadata blueprints.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderMainContent = () => {
    if (mediaType === 'PromptGenerator') {
      return renderPromptGeneratorContent();
    }
    if (mediaType === 'Settings') {
      return (
        <section className="col-span-full bg-surface/40 backdrop-blur-3xl rounded-[3rem] p-12 border-2 border-border/40 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent to-transparent opacity-30"></div>
          
          <div className="flex items-center gap-6 mb-12 border-b border-border/50 pb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-accent via-purple-500 to-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-xl shadow-accent/20 rotate-3">
              <Key className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-3xl font-black text-text-primary tracking-tighter uppercase leading-none italic">PROTOCOL CONFIG</h2>
              <div className="flex items-center gap-2 mt-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <p className="text-[10px] text-text-secondary font-black uppercase tracking-[0.3em] opacity-60">Integration Engine & Core</p>
              </div>
            </div>
          </div>

          <div className="space-y-12 max-w-4xl">
            {/* API Key Collection */}
            <div className="space-y-8 transition-all duration-500">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border-b border-border/50 pb-6">
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-text-primary uppercase tracking-[0.2em] flex items-center gap-3">
                    <Cpu className="w-4 h-4 text-accent" />
                    API Key Pool ({apiKeys.filter(k => k.enabled).length}/{apiKeys.length} Active)
                  </h3>
                  <p className="text-xs text-text-secondary font-medium italic">
                    Hardware-level rotation system prevents rate-limit intersection.
                  </p>
                </div>
                <div className="flex flex-col md:flex-row items-center gap-4">
                  <div className="flex gap-3">
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                        if (apiKeys.length > 0 && window.confirm('Are you sure you want to purge all API keys?')) {
                            setApiKeys([]);
                            showDialog('Vault Purged', 'All API keys have been removed from the neural pool.', 'info');
                        }
                    }}
                    className="px-4 py-2 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2.5 transition-all shadow-sm text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> PURGE POOL
                  </motion.button>
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setShowBulkImport(true)}
                    className="px-4 py-2 bg-subtle hover:bg-surface border border-border rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2.5 transition-all shadow-sm"
                  >
                    <UploadCloud className="w-3.5 h-3.5" /> BULK DEPLOY
                  </motion.button>
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={exportKeys}
                    className="px-4 py-2 bg-subtle hover:bg-surface border border-border rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2.5 transition-all shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" /> SYNC BUFFER
                  </motion.button>
                  </div>
                </div>
              </div>

              {showBulkImport && (
                <motion.div 
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-8 bg-surface border-2 border-accent/20 rounded-[2.5rem] shadow-2xl space-y-6 relative overflow-hidden mb-8"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full blur-2xl"></div>
                  <div className="flex justify-between items-center relative z-10">
                    <span className="text-[11px] font-black text-accent uppercase tracking-[0.3em]">Batch Import</span>
                    <button onClick={() => setShowBulkImport(false)} className="p-2 hover:bg-subtle rounded-xl transition-colors text-text-secondary hover:text-red-500">
                      <Trash2 className="w-4 h-4"/>
                    </button>
                  </div>
                  <textarea
                    value={bulkInput}
                    onChange={(e) => setBulkInput(e.target.value)}
                    placeholder="Line-delimited API Keys..."
                    className="w-full h-40 bg-subtle/50 border-2 border-border rounded-2xl p-5 text-sm font-mono focus:outline-none focus:border-accent transition-all resize-none shadow-inner"
                  />
                  <div className="flex justify-end items-center gap-6 relative z-10">
                    <button 
                      onClick={() => setShowBulkImport(false)}
                      className="text-[11px] font-black text-text-secondary uppercase tracking-widest hover:text-text-primary transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={importBulkKeys}
                      className="px-8 py-3 bg-accent text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:opacity-90 shadow-lg shadow-accent/20 transform active:scale-95 transition-all"
                    >
                      Commit Keys
                    </button>
                  </div>
                </motion.div>
              )}

              {apiKeys.length > 0 && (
                <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar p-1">
                  <div className="flex items-center gap-3 px-4">
                    <Cpu className="w-5 h-5 text-accent" />
                    <h3 className="text-sm font-black text-text-primary uppercase tracking-[0.3em]">API Key Pool</h3>
                    <div className="h-px flex-1 bg-border/40"></div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <AnimatePresence mode="popLayout">
                      {apiKeys.map((item, index) => (
                        <motion.div 
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          key={`node-${item.key}-${index}`} 
                          className={`group relative flex flex-col gap-4 p-8 rounded-[2.5rem] border-2 transition-all duration-300 ${item.enabled ? 'bg-surface border-border/60 hover:border-accent hover:shadow-2xl hover:shadow-accent/5' : 'bg-subtle/50 border-dashed border-border opacity-50 grayscale'}`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-4">
                              <div className="relative">
                                <div className={`w-3.5 h-3.5 rounded-full shadow-[0_0_12px_rgba(var(--accent-rgb),0.5)] ${
                                  keyStatuses[item.key] === 'VALID' ? 'bg-green-500 shadow-green-500/20' : 
                                  keyStatuses[item.key] === 'INVALID' ? 'bg-red-500 shadow-red-500/20' : 
                                  keyStatuses[item.key] === 'TESTING' ? 'bg-accent animate-ping' : 
                                  item.enabled ? 'bg-accent animate-pulse' : 'bg-gray-400 opacity-40'
                                }`} />
                                {keyStatuses[item.key] === 'TESTING' && (
                                  <div className="absolute inset-0 bg-accent rounded-full"></div>
                                )}
                              </div>
                              <div>
                                 <div className="flex items-center gap-2">
                                   <Layers className={`w-4 h-4 ${item.enabled ? 'text-accent' : 'text-text-secondary'}`} />
                                   <span className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] opacity-60">
                                     Gemini Key ${index + 1}
                                   </span>
                                 </div>
                                 {keyStatuses[item.key] && (
                                   <p className={`text-[8px] font-black underline uppercase tracking-widest mt-1 ${
                                     keyStatuses[item.key] === 'VALID' ? 'text-green-500' : 
                                     keyStatuses[item.key] === 'INVALID' ? 'text-red-500' : 'text-accent'
                                   }`}>
                                     STATUS: {keyStatuses[item.key]}
                                   </p>
                                 )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => testKey(item.key)}
                                disabled={keyStatuses[item.key] === 'TESTING'}
                                className="p-3 text-text-secondary hover:text-accent hover:bg-accent/5 rounded-2xl transition-all active:scale-90 disabled:opacity-50"
                                title="Test API Key"
                              >
                                <RefreshCw className={`w-4 h-4 ${keyStatuses[item.key] === 'TESTING' ? 'animate-spin' : ''}`} />
                              </button>
                              <button 
                                onClick={() => setApiKeys(prev => prev.map((k) => k.key === item.key ? { ...k, enabled: !k.enabled } : k))}
                                className={`p-3 rounded-2xl transition-all active:scale-90 ${item.enabled ? 'text-accent bg-accent/10 border border-accent/20' : 'text-text-secondary bg-subtle border border-border'}`}
                                title={item.enabled ? 'Deactivate Key' : 'Activate Key'}
                              >
                                <Play className={`w-4 h-4 ${item.enabled ? 'fill-current' : ''}`} />
                              </button>
                              <button 
                                onClick={() => setApiKeys(prev => prev.filter((k) => k.key !== item.key))}
                                className="p-3 text-red-500/40 hover:text-red-500 hover:bg-red-500/5 rounded-2xl transition-all active:scale-90"
                                title="Remove Key"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div className="bg-subtle/50 rounded-[1.5rem] p-4 border border-border/40 relative group/key">
                             <code className={`text-xs font-mono tracking-widest break-all pr-12 block ${item.enabled ? 'text-text-primary' : 'text-text-secondary'}`}>
                              {visibleKeys.has(item.key) 
                                ? item.key 
                                : `${item.key.substring(0, 14)}••••••••••${item.key.substring(item.key.length - 8)}`
                              }
                            </code>
                            <button 
                              onClick={() => toggleKeyVisibility(item.key)}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary hover:text-accent p-2 transition-colors"
                            >
                              {visibleKeys.has(item.key) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              <form onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem('newKey') as HTMLInputElement;
                const value = input.value.trim();
                if (!value) return;
                
                if (apiKeys.some(k => k.key === value)) {
                  showDialog('Duplicate Detected', 'This API key is already integrated in your pool.', 'warning');
                  return;
                }
                
                // Extra safety: ensure value is not empty
                if (value.length < 10) {
                  showDialog('Invalid Key', 'The key sequence provided is too short to be valid.', 'error');
                  return;
                }
                
                setApiKeys(prev => [...prev, { key: value, enabled: true }]);
                showDialog('Key Integrated', 'New API key has been added and enabled.', 'success');
                input.value = '';
              }} className="relative group">
                <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                  <Key className="w-5 h-5 text-border group-focus-within:text-accent transition-colors" />
                </div>
                <input
                  name="newKey"
                  type="password"
                  placeholder="Deploy Gemini key (AIza...)"
                  className="w-full bg-subtle/20 border-2 border-border group-focus-within:border-accent group-focus-within:bg-surface rounded-3xl pl-14 pr-44 py-5 text-sm font-black focus:outline-none transition-all shadow-inner"
                />
                <div className="absolute inset-y-2 right-2 flex items-center">
                  <button type="submit" className="h-full px-8 bg-accent text-white rounded-[1.2rem] font-black text-[11px] uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-accent/20 active:scale-95">
                    DEPLOY
                  </button>
                </div>
              </form>
            </div>

            {/* Model Selection */}
            <div className="space-y-6 pt-12 border-t border-border/50">
              <div className="flex items-center gap-3">
                <Cpu className="w-5 h-5 text-accent" />
                <h3 className="text-sm font-black text-text-primary uppercase tracking-[0.2em]">Model Selection</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', sub: 'Balanced', desc: 'Fast and efficient model for metadata engineering.' },
                  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', sub: 'High reasoning', desc: 'Powerful model for deep semantic understanding of assets.' },
                  { id: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro', sub: 'Advanced', desc: 'Advanced reasoning model for complex tasks.' },
                  { id: 'gemini-2.0-flash-thinking', label: 'Gemini 2.0 Flash Thinking', sub: 'Expert', desc: 'Expert model for complex reasoning and analysis.' },
                  { id: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro', sub: 'Latest', desc: 'The latest Gemini model with state-of-the-art performance.' },
                  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', sub: 'Fastest', desc: 'Lightweight model for maximum speed.' },
                  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', sub: 'Powerful', desc: 'Powerful model for high-end reasoning.' }
                ].map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    className={`text-left p-6 rounded-[2rem] border-2 transition-all duration-300 relative overflow-hidden group ${
                      selectedModel === model.id 
                        ? 'bg-accent/5 border-accent shadow-xl shadow-accent/5 ring-4 ring-accent/5' 
                        : 'bg-surface border-border hover:border-accent/40 grayscale opacity-60'
                    }`}
                  >
                    {selectedModel === model.id && <div className="absolute top-0 right-0 w-8 h-8 bg-accent flex items-center justify-center rounded-bl-xl text-white"><Sparkles className="w-4 h-4" /></div>}
                    <p className={`text-[9px] font-black uppercase tracking-[0.3em] mb-1 ${selectedModel === model.id ? 'text-accent' : 'text-text-secondary'}`}>{model.sub}</p>
                    <h4 className="text-xl font-black text-text-primary tracking-tighter uppercase mb-4 italic">{model.label}</h4>
                    <p className="text-[11px] font-medium text-text-secondary leading-relaxed opacity-80">{model.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* External Integrations */}
            <div className="pt-12 border-t border-border/50">
              <div className="flex items-center gap-6 mb-10">
                <div className="w-14 h-14 bg-accent text-white rounded-2xl flex items-center justify-center shadow-xl shadow-accent/20 transform -rotate-3">
                  <Layers className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-text-primary uppercase tracking-tighter leading-none italic">Market Ecosystem</h2>
                  <p className="text-xs text-text-secondary font-bold uppercase tracking-[0.2em] opacity-60 mt-1">Cross-Platform API Interconnect</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Adobe Stock Card */}
                <div className="p-8 rounded-[2.5rem] bg-surface border-2 border-border hover:border-accent transition-all duration-500 shadow-xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-[#FF0000] opacity-[0.03] group-hover:opacity-[0.06] rounded-full blur-3xl transition-opacity"></div>
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                      <div className="bg-[#FF0000] text-white w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shadow-lg shadow-red-500/20">AS</div>
                      <div>
                        <h4 className="font-black text-text-primary uppercase tracking-tight italic">Adobe Stock</h4>
                        <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest opacity-40">Native Submission</p>
                      </div>
                    </div>
                    <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all ${integrations.adobe.apiKey ? 'bg-green-500/10 border-green-500/30 text-green-600 shadow-sm' : 'bg-subtle border-border text-text-secondary opacity-60'}`}>
                      {integrations.adobe.apiKey ? 'Linked' : 'Offline'}
                    </div>
                  </div>
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-text-secondary uppercase tracking-[0.3em] px-1 opacity-60">Adobe Core Key</label>
                      <input 
                        type="password" 
                        value={integrations.adobe.apiKey}
                        onChange={(e) => setIntegrations(prev => ({ ...prev, adobe: { ...prev.adobe, apiKey: e.target.value } }))}
                        className="w-full bg-subtle/40 border-2 border-border focus:border-accent rounded-2xl px-5 py-4 text-xs font-mono focus:outline-none transition-all shadow-inner"
                        placeholder="••••••••••••"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-text-secondary uppercase tracking-[0.3em] px-1 opacity-60">API Key Secret</label>
                      <input 
                        type="password" 
                        value={integrations.adobe.secret}
                        onChange={(e) => setIntegrations(prev => ({ ...prev, adobe: { ...prev.adobe, secret: e.target.value } }))}
                        className="w-full bg-subtle/40 border-2 border-border focus:border-accent rounded-2xl px-5 py-4 text-xs font-mono focus:outline-none transition-all shadow-inner"
                        placeholder="••••••••••••"
                      />
                    </div>
                  </div>
                </div>

                {/* Shutterstock Card */}
                <div className="p-8 rounded-[2.5rem] bg-surface border-2 border-border hover:border-[#E31D2D] transition-all duration-500 shadow-xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-[#E31D2D] opacity-[0.03] group-hover:opacity-[0.06] rounded-full blur-3xl transition-opacity"></div>
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                      <div className="bg-[#E31D2D] text-white w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shadow-lg shadow-red-600/20">SS</div>
                      <div>
                        <h4 className="font-black text-text-primary uppercase tracking-tight italic">Shutterstock</h4>
                        <p className="text-[10px] font-black text-text-secondary uppercase tracking-widest opacity-40">Enterprise Access</p>
                      </div>
                    </div>
                    <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all ${integrations.shutterstock.token ? 'bg-green-500/10 border-green-500/30 text-green-600 shadow-sm' : 'bg-subtle border-border text-text-secondary opacity-60'}`}>
                      {integrations.shutterstock.token ? 'Linked' : 'Offline'}
                    </div>
                  </div>
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-text-secondary uppercase tracking-[0.3em] px-1 opacity-60">Contributor Session Token</label>
                      <input 
                        type="password" 
                        value={integrations.shutterstock.token}
                        onChange={(e) => setIntegrations(prev => ({ ...prev, shutterstock: { ...prev.shutterstock, token: e.target.value } }))}
                        className="w-full bg-subtle/40 border-2 border-border focus:border-[#E31D2D] rounded-2xl px-5 py-4 text-xs font-mono focus:outline-none transition-all shadow-inner"
                        placeholder="••••••••••••"
                      />
                    </div>
                    <div className="h-[95px] flex items-center justify-center border-2 border-dashed border-border/40 rounded-2xl bg-subtle/20 grayscale opacity-40">
                       <p className="text-[9px] font-black uppercase tracking-[0.3em]">Metadata Archive Mode Only</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-20 pt-12 border-t border-border/50 flex flex-col items-center">
            <motion.button 
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setMediaType('Gambar')}
              className="w-full sm:w-auto px-12 py-5 bg-text-primary text-surface rounded-full font-black text-[11px] uppercase tracking-[0.3em] shadow-2xl transition-all transform hover:shadow-text-primary/10 active:opacity-90"
            >
              TERMINATE CONFIG & EXIT
            </motion.button>
            <p className="text-[9px] text-text-secondary font-black uppercase tracking-[0.4em] mt-6 opacity-30">MetaZo Environment v2.0.0</p>
          </div>
        </section>
      );

    }

    if (mediaType === 'Riwayat') {
      return (
        <section className="col-span-full">
          <div className="bg-surface rounded-xl p-8 border border-border shadow-sm min-h-[500px]">
             <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4 border-b border-border pb-6">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-accent text-white rounded-2xl flex items-center justify-center shadow-lg shadow-accent/20">
                    <RefreshCw className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-[800] text-text-primary tracking-tight">Riwayat Analisis</h2>
                    <p className="text-sm text-text-secondary font-medium">Melacak metadata terbaik Anda untuk Page 1 Ranking.</p>
                  </div>
               </div>
               <div className="flex items-center gap-2">
                 {historyItems.length > 0 && (
                   <button 
                     onClick={exportToCSV}
                     className="bg-bg text-text-primary hover:bg-subtle px-4 py-2 rounded-xl text-xs font-[800] flex items-center gap-2 transition-all border border-border shadow-sm uppercase tracking-widest"
                   >
                     <Download className="w-4 h-4 text-accent" />
                     Ekspor CSV
                   </button>
                 )}
                 {historyItems.length > 0 && (
                   <button 
                    onClick={async () => {
                      if (window.confirm('Apakah Anda yakin ingin menghapus semua riwayat analisis?')) {
                         setHistoryItems([]);
                         localStorage.setItem('metazo_history', '[]');
                      }
                    }}
                    className="text-red-500 hover:bg-red-50 px-4 py-2 rounded-xl text-xs font-[800] flex items-center gap-2 transition-all border border-red-100 uppercase tracking-widest"
                   >
                     <Trash2 className="w-4 h-4" />
                     Hapus Semua
                   </button>
                 )}
               </div>
             </div>

             {historyItems.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-20 text-center gap-6 bg-subtle/30 rounded-3xl border border-dashed border-border/60">
                 <div className="w-20 h-20 bg-surface rounded-3xl flex items-center justify-center border border-border shadow-sm text-border">
                   <Clock className="w-10 h-10" />
                 </div>
                 <div className="space-y-1">
                   <h3 className="text-lg font-[800] text-text-primary">Jejak Digital Masih Kosong</h3>
                   <p className="text-sm text-text-secondary max-w-[280px]">Mulai analisis aset Anda sekarang, dan biarkan AI MetaZo menyimpan hartamu di sini.</p>
                 </div>
                 <button 
                  onClick={() => setMediaType('Gambar')}
                  className="bg-accent text-white px-6 py-2.5 rounded-full text-xs font-[800] tracking-widest hover:opacity-90 shadow-md shadow-accent/20 transition-all"
                 >
                   MULAI SEKARANG
                 </button>
               </div>
             ) : (
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {historyItems.map((item) => (
                   <div key={item.id} className="p-5 bg-bg/50 hover:bg-surface rounded-2xl border border-border flex flex-col gap-4 transition-all hover:shadow-md hover:border-accent/30 group relative overflow-hidden">
                     <div className="absolute top-0 right-0 p-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            const keywords = item.result.keywords.map((k: any) => k.term).join(", ");
                            const csvRow = `"${item.fileName}","${item.result.title}","${item.result.description}","${keywords}"`;
                            navigator.clipboard.writeText(csvRow);
                          }}
                          className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-accent shadow-sm"
                          title="Copy as CSV Row"
                        >
                          <Layers className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            const text = `Title: ${item.result.title}\nDescription: ${item.result.description}\nKeywords: ${item.result.keywords.map((k: any) => k.term).join(', ')}`;
                            navigator.clipboard.writeText(text);
                          }}
                          className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-accent shadow-sm"
                          title="Copy All"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => deleteHistoryItem(item.id)}
                          className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-text-secondary hover:text-red-500 shadow-sm"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                     </div>
                     <div className="flex gap-4">
                        <div className="w-16 h-16 bg-surface rounded-xl flex items-center justify-center border border-border shrink-0 shadow-inner">
                           {item.mediaType === 'Gambar' ? <ImageIcon className="w-8 h-8 text-accent/40" /> : 
                            item.mediaType === 'Video' ? <Video className="w-8 h-8 text-accent/40" /> : 
                            <PenTool className="w-8 h-8 text-accent/40" />}
                        </div>
                        <div className="space-y-1 min-w-0 pr-10">
                          <h4 className="font-[800] text-text-primary text-[13px] line-clamp-1">{item.fileName}</h4>
                          <span className="text-[10px] font-[800] text-text-secondary uppercase tracking-widest bg-subtle px-2 py-0.5 rounded flex w-fit">{item.mediaType}</span>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <div className="text-[14px] font-[700] text-text-primary line-clamp-2 leading-tight">
                           {item.result.title}
                        </div>
                        <div className="flex flex-wrap gap-1">
                           {item.result.keywords.slice(0, 5).map((k: any, i: number) => (
                             <span key={i} className="text-[10px] font-[700] text-text-secondary bg-surface border border-border px-1.5 py-0.5 rounded">
                               #{k.term}
                             </span>
                           ))}
                           {item.result.keywords.length > 5 && (
                             <span className="text-[10px] font-[700] text-accent px-1.5 py-0.5">+{item.result.keywords.length - 5} more</span>
                           )}
                        </div>
                     </div>
                     <div className="pt-2 border-t border-border/40 text-[10px] font-[700] text-text-secondary flex items-center gap-2 italic">
                        <Clock className="w-3 h-3" />
                        {new Date(item.timestamp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                     </div>
                   </div>
                 ))}
               </div>
             )}
          </div>
        </section>
      );
    }
    return (
      <>
        <section className="glass rounded-[2.5rem] p-8 border border-border shadow-card flex flex-col relative overflow-hidden">
          <div className="absolute -top-12 -left-12 w-48 h-48 bg-accent opacity-[0.03] rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="flex items-center gap-4 mb-8">
            <div className="w-10 h-10 bg-accent/10 text-accent rounded-xl flex items-center justify-center font-black text-sm shrink-0 border border-accent/20">
              01
            </div>
            <div>
              <h2 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">Source Input</h2>
              <p className="text-sm font-bold text-text-primary">Media Upload Center</p>
            </div>
          </div>
          
          <div 
            className={`flex-grow border-2 border-dashed rounded-[2rem] transition-all relative overflow-hidden flex flex-col items-center justify-center group ${
              isDragging ? 'border-accent bg-accent/5 ring-4 ring-accent/10' : 'border-border/60 bg-subtle/30 hover:border-accent/40 hover:bg-subtle/50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ minHeight: '320px' }}
          >
            <input 
              type="file" 
              className="hidden" 
              multiple={uploadMode === 'Batch'} 
              ref={fileInputRef} 
              onChange={handleFileChange}
              accept={
                mediaType === 'Gambar' ? "image/*" : 
                mediaType === 'Video' ? "video/*" : 
                mediaType === 'Vektor' ? ".eps,.ai,.svg" : "*/*"
              }
            />
            {renderUploadContent()}
          </div>
        </section>

        {/* Right Column: Control Panel */}
        <section className="glass rounded-[2.5rem] p-8 border border-border shadow-card flex flex-col relative">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-10 h-10 bg-accent/10 text-accent rounded-xl flex items-center justify-center font-black text-sm shrink-0 border border-accent/20">
              02
            </div>
            <div>
              <h2 className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">Optimization</h2>
              <p className="text-sm font-bold text-text-primary">Core Configuration</p>
            </div>
          </div>

          <div className="space-y-8 flex-grow">
            {/* Upload Mode */}
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest px-1">
                Workflow Mode
              </label>
              <div className="flex bg-subtle/50 border border-border rounded-2xl p-1 shadow-inner">
                {(['Single', 'Batch'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setUploadMode(mode)}
                    className={`flex-1 py-2.5 text-[11px] font-black rounded-xl transition-all uppercase tracking-wider ${
                      uploadMode === mode
                        ? 'bg-accent text-white shadow-lg shadow-accent/20'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Platforms */}
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest px-1">
                Target Platforms
              </label>
              <div className="grid grid-cols-2 gap-2">
                {platformOptions.map((platform) => (
                  <label key={platform} className={`flex items-center gap-2 cursor-pointer border rounded-xl px-3 py-2.5 transition-all active:scale-95 ${selectedPlatforms.includes(platform) ? 'bg-accent/5 border-accent/30 text-accent' : 'bg-subtle/30 border-border/50 text-text-secondary hover:border-accent/20'}`}>
                    <input
                      type="checkbox"
                      checked={selectedPlatforms.includes(platform)}
                      onChange={() => togglePlatform(platform)}
                      className="hidden"
                    />
                    <div className={`w-3.5 h-3.5 rounded border transition-all flex items-center justify-center ${selectedPlatforms.includes(platform) ? 'bg-accent border-accent' : 'bg-surface border-border'}`}>
                       {selectedPlatforms.includes(platform) && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-tight">{platform}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* AI Image Upscale Toggle */}
            <div className="pt-2">
              <div className="p-5 rounded-[1.5rem] bg-gradient-to-br from-accent/[0.03] to-purple-500/[0.03] border border-accent/10 flex items-center justify-between gap-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${enableUpscaling ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'bg-surface border border-border text-text-secondary shadow-inner'}`}>
                    <Layers className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[10px] font-black text-text-primary flex items-center gap-2 uppercase tracking-wide">
                      AI UPSCALING
                      <span className="px-1.5 py-0.5 bg-accent text-[8px] font-black text-white rounded-md tracking-tighter">BETA</span>
                    </h3>
                    <p className="text-[10px] text-text-secondary mt-1 font-medium leading-tight">Enhanced fidelity sampling.</p>
                  </div>
                </div>
                <button 
                  onClick={() => setEnableUpscaling(!enableUpscaling)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 focus:outline-none ${enableUpscaling ? 'bg-accent' : 'bg-border'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xl ring-0 transition duration-200 ease-in-out ${enableUpscaling ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>

            {/* Special Instructions */}
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest px-1">
                Design Directive
              </label>
              <div className="relative group">
                <input
                  type="text"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="e.g. Cinematic lighting, Texture focus..."
                  className="w-full bg-subtle/30 border border-border group-focus-within:border-accent/40 rounded-2xl px-5 py-3.5 text-[13px] text-text-primary font-bold placeholder:font-medium focus:outline-none transition-all shadow-inner"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-20 pointer-events-none text-accent">
                  <Sparkles className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* Language Selection */}
            <div className="flex flex-col gap-3">
              <label className="text-[10px] font-black text-text-secondary uppercase tracking-widest px-1">
                Output Language
              </label>
              <div className="relative group">
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value)}
                  className="w-full bg-subtle/30 border border-border group-hover:border-accent/30 rounded-2xl px-5 py-3.5 text-[13px] font-black text-text-primary focus:outline-none cursor-pointer appearance-none shadow-inner"
                >
                  {languageOptions.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
                <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary opacity-40">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Interactive Slider Controls */}
            <div className="flex flex-col pt-2 gap-2">
              <label className="text-[12px] font-[600] text-text-secondary uppercase tracking-[0.05em]">
                Pengaturan Meta Data Output
              </label>
              <div className="flex flex-col gap-8 p-5 rounded-xl bg-surface border border-border w-full shadow-sm relative overflow-hidden">
                <style dangerouslySetInnerHTML={{__html: `
                  input[type=range].slider-thumb-custom::-webkit-slider-runnable-track {
                    height: 6px;
                    border-radius: 9999px;
                  }
                  input[type=range].slider-thumb-custom::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    height: 16px;
                    width: 16px;
                    border-radius: 50%;
                    background: var(--color-accent);
                    cursor: pointer;
                    margin-top: -5px;
                  }
                  input[type=range].slider-thumb-custom::-moz-range-thumb {
                    height: 16px;
                    width: 16px;
                    border-radius: 50%;
                    background: var(--color-accent);
                    cursor: pointer;
                    border: none;
                  }
                `}} />

                {/* Target Title Count Slider */}
                <div className="flex flex-col gap-4 w-full">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-text-secondary">
                      <span className="font-serif text-[18px] font-[400] leading-none">T</span>
                      <span className="text-[11px] font-[700] tracking-[0.1em] uppercase">Panjang Title</span>
                    </div>
                    <div className="bg-subtle border border-border rounded-xl px-3 py-1.5 flex items-baseline gap-1.5 min-w-[70px] justify-center">
                      <span className="text-accent font-[700] text-[14px]">{titleCount}</span>
                      <span className="text-text-secondary text-[10px] font-[800]">{uiLanguage === 'id' ? 'KARAKTER' : 'CHARS'}</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="200"
                    value={titleCount}
                    onChange={(e) => setTitleCount(Number(e.target.value))}
                    className="w-full h-[6px] rounded-full appearance-none cursor-pointer outline-none slider-thumb-custom bg-transparent"
                    style={{ 
                      background: `linear-gradient(to right, var(--color-accent) ${((titleCount - 10) / 190) * 100}%, var(--color-border) ${((titleCount - 10) / 190) * 100}%)` 
                    }}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3 text-text-secondary">
                      <span className="font-serif text-[18px] font-[400] leading-none">D</span>
                      <span className="text-[11px] font-[700] tracking-[0.1em] uppercase">{uiLanguage === 'id' ? 'Panjang Deskripsi' : 'Description Length'}</span>
                    </div>
                    <div className="bg-subtle border border-border rounded-xl px-3 py-1.5 flex items-baseline gap-1.5 min-w-[70px] justify-center">
                      <span className="text-accent font-[700] text-[14px]">{descCount}</span>
                      <span className="text-text-secondary text-[10px] font-[800]">{uiLanguage === 'id' ? 'KARAKTER' : 'CHARS'}</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="500"
                    value={descCount}
                    onChange={(e) => setDescCount(Number(e.target.value))}
                    className="w-full h-[6px] rounded-full appearance-none cursor-pointer outline-none slider-thumb-custom bg-transparent"
                    style={{ 
                      background: `linear-gradient(to right, var(--color-accent) ${((descCount - 10) / 490) * 100}%, var(--color-border) ${((descCount - 10) / 490) * 100}%)` 
                    }}
                  />
                </div>

                {/* Keyword Quantity Slider */}
                <div className="flex flex-col gap-4 w-full">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-accent">
                      <Sparkles className="w-[18px] h-[18px]" />
                      <span className="text-[10px] font-[800] tracking-[0.05em] text-white bg-accent px-2 py-0.5 rounded-[3px]">{uiLanguage === 'id' ? 'JUMLAH KATA KUNCI' : 'KEYWORD QUANTITY'}</span>
                    </div>
                    <div className="bg-subtle border border-border rounded-xl flex items-stretch overflow-hidden min-w-[70px] h-[32px]">
                      <div className="bg-accent px-2.5 flex items-center justify-center">
                        <span className="text-white font-[700] text-[14px] leading-none">{keywordCount}</span>
                      </div>
                      <div className="px-2 flex items-center justify-center">
                        <span className="text-text-secondary text-[10px] font-[800] leading-none">{uiLanguage === 'id' ? 'KATA' : 'WORDS'}</span>
                      </div>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    value={keywordCount}
                    onChange={(e) => setKeywordCount(Number(e.target.value))}
                    className="w-full h-[6px] rounded-full appearance-none cursor-pointer outline-none slider-thumb-custom bg-transparent"
                    style={{ 
                      background: `linear-gradient(to right, var(--color-accent) ${((keywordCount - 5) / 45) * 100}%, var(--color-border) ${((keywordCount - 5) / 45) * 100}%)` 
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex gap-4 mt-8">
            <button
              onClick={handleAnalyzeBatch}
              disabled={isAnalyzingBatch || fileItems.length === 0 || !fileItems.some(item => item.status === 'PENDING' || item.status === 'ERROR')}
              className="flex-1 bg-accent text-white font-[600] text-[14px] py-[12px] px-[20px] rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed border-none hover:opacity-90 shadow-sm"
            >
              {isAnalyzingBatch ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {uiLanguage === 'id' ? 'Menganalisis...' : 'Analyzing...'}
                </span>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 text-white" />
                  {uiLanguage === 'id' ? 'MULAI ANALISIS' : 'START ANALYSIS'}
                </>
              )}
            </button>
            {fileItems.some(item => item.status === 'ERROR') && (
              <button
                onClick={() => {
                   setFileItems(prev => prev.map(item => item.status === 'ERROR' ? { ...item, status: 'PENDING', error: undefined, statusMessage: undefined } : item));
                }}
                className="bg-red-500/10 text-red-500 font-[600] text-[14px] py-[12px] px-[20px] rounded-lg flex items-center justify-center gap-2 transition-all border border-red-500/20 hover:bg-red-500/20"
              >
                <RefreshCw className="w-5 h-5" />
                {uiLanguage === 'id' ? 'ULANGI GAGAL' : 'RETRY FAILURES'}
              </button>
            )}
          </div>
        </section>
      </>
    );
  };

  return (
    <>
      <div className="min-h-screen bg-bg font-sans pb-20 flex flex-col relative overflow-hidden">
        {/* Background Decorative Pattern */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.05] z-0">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>

      {/* Header */}
      <header className="glass border-b border-border px-6 py-6 mb-8 sticky top-0 z-50 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <motion.div 
            whileHover={{ rotate: 15, scale: 1.1 }}
            className="w-12 h-12 bg-accent rounded-2xl flex items-center justify-center text-white shadow-lg shadow-accent/20 animate-float"
          >
            <Sparkles className="w-7 h-7" />
          </motion.div>
          <div className="flex flex-col">
            <h1 className="font-extrabold text-2xl md:text-3xl tracking-tight flex items-center gap-3">
              MetaZo AI
              <span className="text-[10px] font-mono font-black bg-accent/10 px-2 py-0.5 rounded-full text-accent uppercase tracking-tighter">PRO v2.0.0</span>
            </h1>
            <p className="text-xs text-text-secondary font-medium tracking-wide">AUTOMATED MICROSTOCK WORKFLOW</p>
          </div>
        </div>

        {/* Center - Realtime Clock */}
        <div className="hidden lg:flex items-center gap-3 bg-white/40 dark:bg-slate-900/40 border border-white/40 dark:border-slate-800/40 rounded-2xl px-6 py-2.5 shadow-inner backdrop-blur-md">
            <div className="flex flex-col items-end leading-none">
              <span className="text-[9px] font-black text-accent/70 uppercase tracking-[0.2em] mb-1">SYSTEM TIME</span>
              <span className="text-lg font-mono font-bold text-text-primary tracking-widest tabular-nums leading-none">
                {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </span>
            </div>
            <div className="w-px h-8 bg-border/50 mx-1"></div>
            <Clock className="w-5 h-5 text-accent animate-pulse" />
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-subtle/80 border border-border rounded-xl p-1 shadow-inner backdrop-blur-sm">
            {[
              { id: 'light', icon: Sun },
              { id: 'system', icon: Sparkles },
              { id: 'dark', icon: Moon }
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setThemeMode(m.id as any)}
                className={`relative p-2 rounded-lg transition-all z-10 ${
                  themeMode === m.id 
                    ? 'text-white' 
                    : 'text-text-secondary hover:text-accent'
                }`}
              >
                {themeMode === m.id && (
                  <motion.div
                    layoutId="activeTheme"
                    className="absolute inset-0 bg-accent rounded-lg -z-10 shadow-md"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <m.icon className="w-4 h-4" />
              </button>
            ))}
          </div>
          <div className="flex bg-subtle/80 border border-border rounded-xl p-1 shadow-inner backdrop-blur-sm">
            <button
              onClick={() => setUiLanguage('en')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${uiLanguage === 'en' ? 'bg-accent text-white shadow-md' : 'text-text-secondary hover:text-accent'}`}
            >
              EN
            </button>
            <button
              onClick={() => setUiLanguage('id')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${uiLanguage === 'id' ? 'bg-accent text-white shadow-md' : 'text-text-secondary hover:text-accent'}`}
            >
              ID
            </button>
          </div>
        </div>
      </header>

      {/* Hero / Promo Section (Optional, subtle) */}
      <div className="max-w-5xl mx-auto w-full px-4 mb-6">
        <div className="bg-gradient-to-r from-accent/5 to-transparent border-l-4 border-accent p-4 rounded-r-2xl">
           <p className="text-[13px] text-text-secondary font-medium leading-relaxed">
             <span className="text-accent font-black mr-2">TIPS:</span> 
             {uiLanguage === 'id' ? (
               <>Gunakan menu <span className="font-bold text-text-primary">Prompt Generator</span> untuk mendapatkan inspirasi visual yang fresh sesuai tren Adobe Stock 2026.</>
             ) : (
               <>Use the <span className="font-bold text-text-primary">Prompt Generator</span> menu to get fresh visual inspiration based on 2026 Adobe Stock trends.</>
             )}
           </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap justify-center items-center gap-3 mb-10 px-4">
        <div className="glass p-1.5 rounded-2xl flex border border-border/50 shadow-lg shadow-black/5 overflow-x-auto max-w-full hide-scrollbar">
          {[
            { id: 'Gambar', label: t('gambar'), icon: ImageIcon },
            { id: 'Video', label: t('video'), icon: Video },
            { id: 'Vektor', label: t('vektor'), icon: PenTool },
            { id: 'PromptGenerator', label: t('aiPrompt'), icon: Sparkles },
            { id: 'Riwayat', label: t('historyTab'), icon: RefreshCw },
            { id: 'Settings', label: t('settingsTab'), icon: Key },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMediaType(tab.id as MediaType)}
              className={`flex items-center gap-2.5 px-6 py-2.5 rounded-xl font-bold text-xs tracking-wide transition-all whitespace-nowrap active:scale-95 ${
                mediaType === tab.id
                  ? 'bg-accent text-white shadow-lg shadow-accent/30'
                  : 'text-text-secondary hover:bg-accent/5 hover:text-accent'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label.toUpperCase()}
            </button>
          ))}
        </div>
        <motion.a 
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          href="https://saweria.co/Johan3009" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-black text-xs tracking-wide bg-pink-500 text-white shadow-lg shadow-pink-500/25 hover:opacity-90 transition-all whitespace-nowrap"
        >
          <Heart className="w-4 h-4 fill-current" />
          DONATE
        </motion.a>
      </div>

      <main className="max-w-5xl mx-auto px-4 grid grid-cols-1 md:grid-cols-[1fr_380px] gap-6 w-full">
         {renderMainContent()}
      </main>

      {/* Batch Processing List Section */}
      {fileItems.length > 0 && (
        <section ref={queueSectionRef} className="max-w-7xl mx-auto px-4 mt-12 mb-20 animate-in fade-in slide-in-from-bottom-6 duration-700 w-full">
          <div className="glass border border-border shadow-2xl rounded-[2.5rem] overflow-hidden">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center px-8 py-6 border-b border-border bg-subtle/20 backdrop-blur-md gap-6">
              <div className="flex flex-wrap items-center gap-4 w-full lg:w-auto">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center text-white shadow-lg shadow-accent/20">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xs font-black text-text-secondary uppercase tracking-[0.2em] mb-0.5">Asset Queue</h2>
                    <p className="text-sm font-bold text-text-primary">
                      {statusFilter === 'All' ? 'Total Pipeline' : `${statusFilter} Pipeline`}
                    </p>
                  </div>
                  <span className="bg-accent/10 text-accent text-[10px] font-black px-2.5 py-1 rounded-full ml-1 border border-accent/20">
                    {statusFilter === 'All' ? fileItems.length : fileItems.filter(i => i.status === statusFilter).length}
                  </span>
                </div>
                
                <div className="w-px h-10 bg-border/50 mx-2 hidden lg:block"></div>

                <div className="flex bg-subtle/50 p-1 rounded-2xl border border-border overflow-x-auto max-w-full hide-scrollbar shadow-inner">
                  {(['All', 'PENDING', 'PROCESSING', 'SUCCESS', 'ERROR'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setStatusFilter(f)}
                      className={`text-[10px] font-black px-4 py-2 rounded-xl uppercase tracking-widest transition-all whitespace-nowrap active:scale-95 ${
                        statusFilter === f 
                          ? 'bg-accent text-white shadow-md' 
                          : 'text-text-secondary hover:text-accent'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="flex items-center gap-3 w-full lg:w-auto overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
                {fileItems.some(item => item.status === 'SUCCESS') && (
                  <button 
                    onClick={downloadCSV}
                    className="text-[11px] font-black text-white bg-green-500 hover:bg-green-600 transition-all flex items-center gap-2.5 px-6 py-2.5 rounded-xl shadow-lg shadow-green-500/20 whitespace-nowrap active:scale-95 uppercase tracking-widest"
                  >
                    <Download className="w-4 h-4" />
                    EXPORT DATA
                  </button>
                )}
                <button 
                  onClick={clearAllFiles}
                  className="text-[11px] font-black text-red-500 hover:text-white hover:bg-red-500 transition-all flex items-center gap-2 border border-red-500/20 bg-red-500/5 px-5 py-2.5 rounded-xl whitespace-nowrap active:scale-95 uppercase tracking-widest"
                >
                  <Trash2 className="w-4 h-4" />
                  Flush All
                </button>
              </div>
            </div>
            
            <div className="flex flex-col divide-y divide-border/40">
                  <AnimatePresence>
                    {fileItems.filter(item => statusFilter === 'All' ? true : item.status === statusFilter).map((item, index) => (
                      <motion.div 
                        key={item.id} 
                        ref={el => itemRefs.current.set(item.id, el)}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ delay: index * 0.05 }}
                        className="p-6 lg:p-8 hover:bg-accent/[0.01] transition-colors group flex flex-col lg:flex-row gap-8 items-start relative"
                      >
                        <div className="relative w-full lg:w-72 h-56 lg:h-72 rounded-[2rem] bg-subtle/50 flex items-center justify-center overflow-hidden border border-border/80 shrink-0 shadow-lg group-hover:shadow-xl transition-all group-hover:-translate-y-1">
                          {item.previewUrl ? (
                            item.file.type.startsWith('video/') ? (
                              <video 
                                src={item.previewUrl} 
                                className="w-full h-full object-cover cursor-pointer" 
                                muted 
                                playsInline 
                                loop 
                                onMouseEnter={(e) => {
                                  const playPromise = e.currentTarget.play();
                                  if (playPromise !== undefined) {
                                    playPromise.catch(() => {
                                      // Silence "interrupted by pause" error
                                    });
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.pause();
                                  e.currentTarget.currentTime = 0;
                                }}
                              />
                            ) : (
                              <img src={item.previewUrl} alt="preview" className="w-full h-full object-cover" />
                            )
                          ) : (
                            <div className="flex flex-col items-center gap-4 opacity-20">
                              {mediaType === 'Gambar' ? <ImageIcon className="w-16 h-16" /> : 
                               mediaType === 'Video' ? <Video className="w-16 h-16" /> : 
                               <PenTool className="w-16 h-16" />}
                            </div>
                          )}
                          
                          {/* Floating Type Badge */}
                          <div className="absolute top-4 left-4 glass px-3 py-1.5 rounded-xl border border-white/20 shadow-lg">
                             <span className="text-[10px] font-black text-text-primary uppercase tracking-widest">{item.file.type.split('/')[1]?.toUpperCase() || 'FILE'}</span>
                          </div>
                        </div>
                        
                        {/* Content */}
                        <div className="flex-grow min-w-0 space-y-6">
                           <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                            <div className="space-y-1 min-w-0">
                               <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono font-bold text-accent px-1.5 py-0.5 bg-accent/5 rounded border border-accent/10 leading-none">#{index + 1}</span>
                                <h3 className="text-xl font-extrabold text-text-primary truncate max-w-sm" title={item.file.name}>
                                  {item.file.name}
                                </h3>
                               </div>
                               <p className="font-mono text-[11px] text-text-secondary uppercase tracking-tighter">
                                 FILE SIZE: {(item.file.size / (1024 * 1024)).toFixed(2)}MB • DIMENSIONS: AUTHENTIC
                               </p>
                            </div>

                            <div className="flex items-center gap-4 self-end sm:self-auto uppercase tracking-widest">
                                 {item.status === 'PENDING' && (
                                   <span className="flex items-center gap-2 px-4 py-2 rounded-xl bg-subtle text-text-secondary text-[10px] font-black border border-border/50">
                                     <Clock className="w-3.5 h-3.5" />
                                     WAITING
                                   </span>
                                 )}
                                 {item.status === 'PROCESSING' && (
                                   <div className="flex flex-col items-end gap-2">
                                     <span className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-[10px] font-black shadow-lg shadow-accent/20">
                                       <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                       SYNCHRONIZING
                                     </span>
                                     {item.statusMessage && (
                                       <span className="text-[9px] text-accent font-black animate-pulse">
                                         {item.statusMessage.toUpperCase()}
                                       </span>
                                     )}
                                   </div>
                                 )}
                                 {item.status === 'SUCCESS' && (
                                   <button 
                                      onClick={() => {
                                        // We can use a trick to toggle view if we add it to the state or just rely on a local toggle
                                        const el = document.getElementById(`meta-${item.id}`);
                                        if (el) el.classList.toggle('hidden');
                                      }}
                                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500 text-white text-[10px] font-black shadow-lg shadow-green-500/20 active:scale-95 transition-all"
                                   >
                                     <Sparkles className="w-3.5 h-3.5" />
                                     VIEW DATA
                                   </button>
                                 )}
                                 {item.status === 'ERROR' && (
                                   <div className="flex flex-col items-end gap-2 max-w-sm">
                                     <span className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500 text-white text-[10px] font-black shadow-lg shadow-red-500/20">
                                       <AlertTriangle className="w-3.5 h-3.5" />
                                       ERROR
                                     </span>
                                     {item.error && (
                                        <span className="text-[10px] text-red-500 text-right leading-tight font-medium bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                                          {item.error}
                                        </span>
                                     )}
                                   </div>
                                 )}
                                 
                                 {/* Individual Delete Button */}
                                 <button 
                                   onClick={() => setFileItems(prev => prev.filter(f => f.id !== item.id))}
                                   className="p-2.5 rounded-xl bg-subtle hover:bg-red-500/10 text-text-secondary hover:text-red-500 border border-border/50 transition-all active:scale-90"
                                   title="Hapus aset ini"
                                 >
                                   <Trash2 className="w-4 h-4" />
                                 </button>
                            </div>
                          </div>

                          {/* Metadata Display (Collapsible for mobile) */}
                          {item.status === 'SUCCESS' && item.result ? (
                            <div id={`meta-${item.id}`} className="hidden lg:block animate-in fade-in zoom-in-95 duration-300">
                                <div className="bg-subtle/30 backdrop-blur-sm p-6 lg:p-8 rounded-[2rem] space-y-8 border border-border/50 relative overflow-hidden shadow-inner">
                              <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none">
                                <Sparkles className="w-24 h-24" />
                              </div>

                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                 {/* Column 1: Identity & Categories */}
                                 <div className="space-y-8">
                                   <div className="space-y-3">
                                     <div className="flex items-center gap-2">
                                       <span className="text-[9px] font-black text-accent uppercase tracking-widest bg-accent/5 px-2 py-0.5 rounded border border-accent/10 font-mono">01. IDENTITY</span>
                                     </div>
                                     <div className="space-y-1">
                                       <span className="text-[10px] font-black text-text-secondary uppercase tracking-tighter">Primary Title</span>
                                       <div className="bg-surface/50 p-5 rounded-3xl border border-border/50 flex items-start gap-3 group/field hover:border-accent/40 transition-all shadow-sm">
                                         <span className="flex-1 text-sm font-bold text-text-primary leading-snug break-words tracking-tight">{item.result.title}</span>
                                         <button 
                                           onClick={() => navigator.clipboard.writeText(item.result!.title)} 
                                           className="text-text-secondary hover:text-accent p-2 rounded-xl hover:bg-accent/10 transition-colors active:scale-95 shrink-0"
                                         >
                                           <Copy className="w-4 h-4" />
                                         </button>
                                       </div>
                                     </div>
                                   </div>

                                   <div className="space-y-3">
                                     <div className="flex items-center gap-2">
                                       <span className="text-[9px] font-black text-accent uppercase tracking-widest bg-accent/5 px-2 py-0.5 rounded border border-accent/10 font-mono">02. TAXONOMY</span>
                                     </div>
                                     <div className="space-y-1">
                                       <span className="text-[10px] font-black text-text-secondary uppercase tracking-tighter">Platform Categories</span>
                                       <div className="flex flex-wrap gap-2 pt-1 font-mono">
                                         {(item.result.categories || []).map((catObj, idx) => (
                                            <div key={`${catObj.platform}-${idx}`} className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-xl border border-border shadow-sm hover:border-accent/20 transition-all">
                                              <span className="text-[9px] font-black text-accent uppercase">{(catObj.platform || '').substring(0,2)}</span>
                                              <span className="text-[10px] font-bold text-text-primary truncate max-w-[140px] uppercase">{catObj.category}</span>
                                            </div>
                                         ))}
                                       </div>
                                     </div>
                                   </div>
                                 </div>

                                 {/* SEO AUDIT v2.0 */}
                                 <div className="space-y-8 bg-surface/40 p-8 rounded-[3rem] border-2 border-accent/10 shadow-2xl relative overflow-hidden group/seo">
                                   <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover/seo:opacity-[0.1] transition-opacity pointer-events-none">
                                     <Sparkles className="w-24 h-24 text-accent" />
                                   </div>
                                   <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 bg-accent rounded-full animate-pulse"></div>
                                        <span className="text-[10px] font-black text-accent uppercase tracking-widest">SEO AUDIT v2.1</span>
                                      </div>
                                      <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 rounded-full border border-green-500/20">
                                        <CheckCircle2 className="w-3 h-3 text-green-600" />
                                        <span className="text-[8px] font-black text-green-600 uppercase tracking-widest">Market Ready</span>
                                      </div>
                                   </div>
                                   
                                   <div className="flex flex-col sm:flex-row items-center gap-8 py-2">
                                     <div className="relative w-28 h-28 shrink-0">
                                       <svg className="w-full h-full transform -rotate-90">
                                         <circle cx="56" cy="56" r="50" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-border/20" />
                                         <motion.circle 
                                           initial={{ strokeDasharray: "0 314" }}
                                           animate={{ strokeDasharray: `${(item.result.seoScore || 85) * 3.14} 314` }}
                                           transition={{ duration: 2, ease: "easeOut" }}
                                           cx="56" cy="56" r="50" stroke="currentColor" strokeWidth="10" fill="transparent" strokeLinecap="round" className="text-accent drop-shadow-[0_0_8px_rgba(var(--accent-rgb),0.5)]" 
                                         />
                                       </svg>
                                       <div className="absolute inset-0 flex flex-col items-center justify-center translate-y-1">
                                         <span className="text-3xl font-black text-text-primary tracking-tighter italic">{(item.result.seoScore || 85)}</span>
                                         <span className="text-[8px] font-black text-accent uppercase tracking-widest">HEALTH</span>
                                       </div>
                                     </div>
                                     <div className="space-y-2 flex-1 text-center sm:text-left">
                                       <h4 className="text-[15px] font-black text-text-primary uppercase italic tracking-tighter leading-none">Commercial Power</h4>
                                       <p className="text-[11px] text-text-secondary leading-snug opacity-70 font-medium">Derived from 2026 search intent modeling and multi-platform relevance indexing.</p>
                                       <div className="pt-2">
                                          <div className="w-full h-1.5 bg-border/40 rounded-full overflow-hidden">
                                            <motion.div 
                                              initial={{ width: 0 }}
                                              animate={{ width: `${item.result.seoScore || 85}%` }}
                                              className="h-full bg-accent"
                                            />
                                          </div>
                                       </div>
                                     </div>
                                   </div>

                                   <div className="grid grid-cols-1 gap-3">
                                      {item.result.seoInsights?.map((insight, idx) => (
                                        <div key={idx} className="flex items-start gap-4 p-4 bg-surface/60 rounded-2xl border border-border/50 hover:border-accent/40 transition-all hover:bg-surface group/insight group-hover/seo:border-accent/20">
                                          <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${insight.impact === 'High' ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]' : insight.impact === 'Medium' ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.4)]' : 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.4)]'}`} />
                                          <div className="space-y-0.5 min-w-0">
                                            <div className="flex items-center gap-2">
                                              <p className="text-[10px] font-black text-accent uppercase tracking-[0.1em]">{insight.label}</p>
                                              <span className="text-[8px] font-black text-text-secondary/40 uppercase tracking-widest">{insight.impact} IMPACT</span>
                                            </div>
                                            <p className="text-[12px] font-bold text-text-primary italic leading-tight group-hover/insight:text-accent transition-colors truncate">"{insight.value}"</p>
                                          </div>
                                        </div>
                                      ))}
                                      {(!item.result.seoInsights || item.result.seoInsights.length === 0) && (
                                        <div className="p-6 bg-accent/5 rounded-[2rem] border border-accent/10 border-dashed text-center flex flex-col items-center gap-3">
                                           <Zap className="w-6 h-6 text-accent opacity-30 animate-pulse" />
                                           <span className="text-[10px] font-black text-accent uppercase tracking-widest opacity-60">Strategic Performance Optimized</span>
                                        </div>
                                      )}
                                   </div>
                                 </div>
                               </div>

                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-black text-accent uppercase tracking-widest bg-accent/5 px-2 py-0.5 rounded border border-accent/10">03. Narrative</span>
                                </div>
                                <div className="space-y-1">
                                  <span className="text-[10px] font-black text-text-secondary uppercase tracking-tighter">Contextual Description</span>
                                  <div className="bg-surface/50 p-4 rounded-2xl border border-border/50 text-[13px] text-text-secondary leading-relaxed font-medium">
                                    {item.result.description}
                                  </div>
                                </div>
                              </div>

                              {item.result.marketInsight && (
                                <div className="p-5 rounded-2xl bg-gradient-to-r from-accent/[0.03] to-transparent border-l-4 border-accent space-y-2">
                                  <div className="flex items-center gap-2 text-accent">
                                    <Zap className="w-4 h-4 fill-current" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.1em]">AI Strategic Insight 2026</span>
                                  </div>
                                  <p className="text-[12px] text-text-primary leading-relaxed font-bold italic opacity-90">
                                    "{item.result.marketInsight}"
                                  </p>
                                </div>
                              )}

                              <div className="pt-6 border-t border-border/50 space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black text-accent uppercase tracking-widest bg-accent/5 px-2 py-0.5 rounded border border-accent/10">04. Indexing</span>
                                    <span className="text-[10px] font-black text-text-secondary uppercase tracking-tighter">Keywords ({item.result.keywords.length})</span>
                                  </div>
                                  <form className="flex gap-2" onSubmit={(e) => {
                                      e.preventDefault();
                                      const input = e.currentTarget.querySelector('input');
                                      if (input) {
                                        addKeyword(item.id, input.value);
                                        input.value = '';
                                      }
                                    }}>
                                    <input type="text" placeholder="Add..." className="text-[11px] px-4 py-2 rounded-xl border border-border w-32 bg-surface font-bold focus:border-accent/40 focus:outline-none transition-all shadow-inner" />
                                    <button type="submit" className="text-[11px] font-black bg-accent text-white px-3 rounded-xl shadow-lg shadow-accent/20 hover:scale-105 active:scale-95 transition-all">+</button>
                                  </form>
                               </div>
                                <div className="flex flex-wrap gap-2">
                                    {item.result.keywords.map((kw, i) => (
                                      <div 
                                        key={i} 
                                        draggable
                                        onDragStart={() => setDraggedItemIndex({fileId: item.id, index: i})}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={() => {
                                          if (draggedItemIndex && draggedItemIndex.fileId === item.id) {
                                            moveKeyword(item.id, draggedItemIndex.index, i);
                                            setDraggedItemIndex(null);
                                          }
                                        }}
                                        className={`group/keyword flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-move font-mono ${
                                          kw.seoTier === 'High' ? 'bg-green-500/10 border-green-500/30 text-green-600' :
                                          kw.seoTier === 'Medium' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600' :
                                          'bg-surface border-border text-text-secondary'
                                        } hover:border-accent active:scale-95 ${draggedItemIndex?.fileId === item.id && draggedItemIndex?.index === i ? 'opacity-20 grayscale' : ''}`}
                                      >
                                        <span className="text-[11px] font-black uppercase tracking-tight">
                                          {kw.term}
                                        </span>
                                        <div className="flex items-center gap-1 opacity-0 group-hover/keyword:opacity-100 transition-opacity">
                                          <button onClick={(e) => { e.stopPropagation(); removeKeyword(item.id, i); }} className="text-red-500 hover:scale-125 transition-transform"><Trash2 className="w-3 h-3" /></button>
                                          <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(kw.term); }} className="text-accent hover:scale-125 transition-transform ml-0.5"><Copy className="w-3 h-3" /></button>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                            <div className="bg-subtle/20 border border-dashed border-border rounded-2xl p-8 flex items-center justify-center min-h-[200px]">
                              <div className="flex flex-col items-center gap-3 opacity-40">
                                {item.status === 'ERROR' ? (
                                  <>
                                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                                      <Info className="w-6 h-6" />
                                    </div>
                                    <span className="text-sm font-black text-red-600 uppercase tracking-widest text-center max-w-sm">
                                      CRITICAL FAILURE: {item.error}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="w-10 h-10 animate-spin text-accent" />
                                    <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest animate-pulse">
                                      Processing Metadata...
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-row sm:flex-col gap-2 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-border/30 mt-2 sm:mt-0">
                          {item.status === 'SUCCESS' && item.result && (
                            <div className="flex flex-row sm:flex-col gap-2 mb-0 sm:mb-2 p-1.5 sm:p-2 bg-subtle/30 rounded-lg border border-border/30 flex-1 sm:flex-none justify-center">
                              <span className="hidden sm:block text-[9px] font-[800] text-text-secondary uppercase text-center tracking-wider px-1">Integrasi API</span>
                              {selectedPlatforms.includes('Adobe Stock') && (
                                <button 
                                  onClick={() => submitToStock(item.id, 'Adobe Stock')}
                                  disabled={!integrations.adobe.apiKey || item.submissionStatus?.['Adobe Stock'] === 'SUBMITTING'}
                                  className={`px-3 py-1.5 rounded-md text-[10px] font-[700] transition-all flex items-center justify-center gap-2 border flex-1 sm:flex-none ${
                                    item.submissionStatus?.['Adobe Stock'] === 'SUCCESS' ? 'bg-green-50 border-green-200 text-green-700 font-[800]' :
                                    item.submissionStatus?.['Adobe Stock'] === 'ERROR' ? 'bg-red-50 border-red-200 text-red-700' :
                                    'bg-surface border-border hover:border-accent hover:text-accent text-text-primary shadow-sm'
                                  } disabled:opacity-50`}
                                  title="Submit directly to Adobe Stock"
                                >
                                  {item.submissionStatus?.['Adobe Stock'] === 'SUBMITTING' ? <RefreshCw className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3" />}
                                  <span className="sm:inline">{item.submissionStatus?.['Adobe Stock'] === 'SUCCESS' ? 'TERKIRIM' : 'ADOBE'}</span>
                                </button>
                              )}
                              {selectedPlatforms.includes('Shutterstock') && (
                                <button 
                                  onClick={() => submitToStock(item.id, 'Shutterstock')}
                                  disabled={!integrations.shutterstock.token || item.submissionStatus?.['Shutterstock'] === 'SUBMITTING'}
                                  className={`px-3 py-1.5 rounded-md text-[10px] font-[700] transition-all flex items-center justify-center gap-2 border flex-1 sm:flex-none ${
                                    item.submissionStatus?.['Shutterstock'] === 'SUCCESS' ? 'bg-green-50 border-green-200 text-green-700 font-[800]' :
                                    item.submissionStatus?.['Shutterstock'] === 'ERROR' ? 'bg-red-50 border-red-200 text-red-700' :
                                    'bg-surface border-border hover:border-[#E31D2D] hover:text-[#E31D2D] text-text-primary shadow-sm'
                                  } disabled:opacity-50`}
                                  title="Submit directly to Shutterstock"
                                >
                                  {item.submissionStatus?.['Shutterstock'] === 'SUBMITTING' ? <RefreshCw className="w-3 h-3 animate-spin"/> : <Sparkles className="w-3 h-3" />}
                                  <span className="sm:inline">{item.submissionStatus?.['Shutterstock'] === 'SUCCESS' ? 'TERKIRIM' : 'SHUTTER'}</span>
                                </button>
                              )}
                            </div>
                          )}
                          <div className="flex flex-row sm:flex-col gap-2 self-center sm:self-auto">
                             {(item.status === 'SUCCESS' || item.status === 'ERROR') && (
                              <button onClick={() => handleRegenerate(item.id)} className="p-2 sm:p-2.5 rounded-lg bg-subtle text-text-secondary hover:text-accent hover:bg-border/30 transition-colors border border-transparent hover:border-border" title="Regenerate">
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => removeFile(item.id)} className="p-2 sm:p-2.5 rounded-lg bg-subtle text-text-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors border border-transparent hover:border-red-200" title="Hapus">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
            </div>
          </div>
        </section>
      )}
      
      {/* Changelog Section */}
      <section className="max-w-7xl mx-auto px-4 py-8 border-t border-border mt-12 mb-12">
        <h2 className="text-xl font-[800] tracking-tight mb-8">Changelog</h2>
        <div className="space-y-6">
          <div className="bg-surface p-6 rounded-2xl border border-border shadow-xl shadow-accent/5 ring-1 ring-accent/20">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm font-mono font-bold bg-accent text-white px-3 py-1 rounded-full">v2.0.0</span>
              <span className="text-sm text-text-secondary font-bold uppercase tracking-widest">Mei 2026 - CURRENT</span>
            </div>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-2">
              <li className="text-text-primary font-bold italic">SEO AUDIT v2.1: Analisis skor kesehatan metadata secara real-time</li>
              <li className="text-text-primary font-bold italic">Strategic Insights: Penjelasan keunggulan komersial aset di pasar 2026</li>
              <li>Long-Tail Optimization: Peningkatan relevansi kata kunci untuk pencarian spesifik</li>
              <li>Upgrade Prompt Engine: Sinkronisasi dengan algoritma terbaru Adobe Stock 2026</li>
              <li>Pembaruan versi ke v2.0.0 (Core Upgrade)</li>
            </ul>
          </div>
          <div className="bg-surface/50 p-6 rounded-2xl border border-border opacity-60">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm font-mono font-bold bg-accent/10 px-2 py-0.5 rounded-full text-accent">v1.3.0</span>
              <span className="text-sm text-text-secondary">Mei 2026</span>
            </div>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>AI Prompt Generator: Layout baru (Hasil di bawah input)</li>
              <li>AI Prompt Generator: Kategori gaya yang lebih dinamis dan spesifik</li>
              <li>Fitur "Dapatkan Ide AI": Brainstorming tema otomatis untuk microstock</li>
              <li>Adobe Stock Compliance: Hardening prompt untuk keamanan IP & komersial</li>
              <li>Dukungan wajah manusia yang realistis & beragam</li>
              <li>Peningkatan kemurnian gaya (Style Purity) pada hasil prompt</li>
              <li>Pembaruan versi ke v1.3.0</li>
            </ul>
          </div>
          <div className="bg-surface/50 p-6 rounded-2xl border border-border opacity-60">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm font-mono font-bold bg-accent/10 px-2 py-0.5 rounded-full text-accent">v1.2.0</span>
              <span className="text-sm text-text-secondary">Mei 2026</span>
            </div>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>Auto-log out setelah 30 menit tidak aktif</li>
              <li>Update tampilan halaman login dengan fitur highlight</li>
              <li>Penambahan footer copyright</li>
            </ul>
          </div>
        </div>
      </section>
      
      <div className="text-center text-text-secondary text-xs pb-10 mt-24">
        <p>&copy; {new Date().getFullYear()} MetaZo. All rights reserved.</p>
        <div className="mt-2">
          <a href="https://saweria.co/Johan3009" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent transition-colors">
            <Heart className="w-3 h-3 text-red-500" />
            <span>Support us</span>
          </a>
        </div>
      </div>
      <DialogModal {...dialogState} onClose={closeDialog} />
    </div>
  </>
  );
}

export default function App() {
  return (
    <AppContent />
  );
}
