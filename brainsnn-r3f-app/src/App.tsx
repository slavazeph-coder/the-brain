import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Zap, 
  Cpu, 
  Search, 
  Sparkles, 
  Play, 
  Pause, 
  Share2, 
  Clock, 
  ShieldAlert, 
  FileText, 
  Compass, 
  HelpCircle, 
  Terminal, 
  DollarSign, 
  Layers, 
  Check, 
  AlertTriangle, 
  ChevronRight, 
  Sliders, 
  ArrowUpRight, 
  ExternalLink,
  BookOpen,
  Eye,
  Info,
  Flame,
  Volume2,
  Copy,
  Plus,
  Heart,
  MessageSquare,
  Download,
  Cloud,
  Menu,
  X
} from "lucide-react";
import BrainVisualizer from "./components/BrainVisualizer";
import BenchmarksTable from "./components/BenchmarksTable";
import { AnalysisResult, BrainMetrics, SubscriptionPlan } from "./types";
import { motion, AnimatePresence } from "motion/react";

// Preloaded examples representing critical affective payload scenarios
const PRELOAD_SCENARIOS = [
  {
    label: "🚨 Fear Cascade (Panic Trigger)",
    text: "WARNING: A critical risk factor has just been discovered in local water supplies. Environmental teams urge instant action. Banned chemicals may cause long-term neurological erosion. Stop drinking and share this alert now before it's too late!"
  },
  {
    label: "🔥 Sensory Burst (Viral Clickbait)",
    text: "This underground brain hack will double your cognitive processing speed in 24 hours. Top clinical neurologists do not want you to know this simple formula. Comment 'AFFECT' below and I will expose the entire secret directly to your inbox!"
  },
  {
    label: "🧠 Academic Baseline (SNN Fact Sheet)",
    text: "Spiking Neural Networks (SNNs) process information using discrete, temporal events known as spikes. By utilizing physics-based wave equations instead of standard transformer dot-product attention, the Crumb LLM achieves O(N log N) space complexity and maintains fixed cache sizes."
  },
  {
    label: "❤️ Empathic Resonance (CSR Narrative)",
    text: "We believe in building a future where technology is transparent, ethical, and built for people. Join our collective global community in preserving neural sovereignty. Together, we can create brand landscapes that respect focus and mental calm."
  }
];

// Deterministic segmenter to split text into high-fidelity sentence structures with localized viral indexes
function segmentContent(text: string): { text: string; score: number }[] {
  if (!text) return [];
  // Split by sentence ending punctuation (. ! ?) but preserve the punctuation marks
  const rawSentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  
  return rawSentences.map((sentence) => {
    const trimmed = sentence.trim();
    if (!trimmed) return { text: sentence, score: 30 };
    
    // Base potential starts at 50
    let score = 50;
    
    // Feature factors that naturally spike or attenuate localized attention
    const upperWords = trimmed.split(/\s+/).filter(w => w.length > 2 && w === w.toUpperCase());
    score += upperWords.length * 9; // CAP words increase salience dramatically
    
    if (trimmed.includes('!')) score += 16;
    if (trimmed.includes('?')) score += 6;
    
    const triggerWords = [
      'warning', 'banned', 'urgent', 'secret', 'hack', 'clinical', 
      'neurological', 'exposure', 'viral', 'comment', 'instant', 
      'risk', 'discover', 'expose', 'critical', 'double', 'formula', 
      'never', 'shocking', 'must', 'clickbaity', 'manipulate', 'potential'
    ];
    
    const sentenceLower = trimmed.toLowerCase();
    triggerWords.forEach(word => {
      if (sentenceLower.includes(word)) {
        score += 11;
      }
    });

    // Content length optimization sweet-spot filters
    if (trimmed.length > 35 && trimmed.length < 130) {
      score += 6;
    } else if (trimmed.length > 220) {
      score -= 12; // excess load reduces immediate virality
    }
    
    // Consistent character hash algorithm prevents score jumping on re-renders
    let hash = 0;
    for (let i = 0; i < trimmed.length; i++) {
      hash = (hash << 5) - hash + trimmed.charCodeAt(i);
      hash |= 0;
    }
    const noiseValue = (Math.abs(hash) % 20) - 10; // -10 to +9 offset
    score += noiseValue;
    
    return {
      text: sentence,
      score: Math.min(100, Math.max(12, score))
    };
  });
}

// Safe clipboard write: navigator.clipboard is only defined in secure
// contexts (HTTPS/localhost). Guard so a copy action never throws on HTTP
// or in unsupported browsers. Returns whether the write was attempted.
function copyToClipboard(text: string): boolean {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  return false;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'demo' | 'crumb' | 'pricing' | 'lab'>('demo');
  const [contentInput, setContentInput] = useState(PRELOAD_SCENARIOS[0].text);
  const [contentType, setContentType] = useState<'text' | 'url' | 'video'>('text');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [scanHistory, setScanHistory] = useState<AnalysisResult[]>([]);
  const [shareCopied, setShareCopied] = useState(false);
  const [postCopied, setPostCopied] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Crumb LLM Physics Tuner States
  const [damping, setDamping] = useState(0.15);
  const [frequency, setFrequency] = useState(4.5);
  const [phase, setPhase] = useState(0.0);
  const [showMathModal, setShowMathModal] = useState(false);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trend Alerts States
  const [trendAlertsEnabled, setTrendAlertsEnabled] = useState(true);
  const [trendThreshold, setTrendThreshold] = useState(72);
  const [highlightAnomalies, setHighlightAnomalies] = useState(false);

  // Viral Exporter Modal states
  const [showGifModal, setShowGifModal] = useState(false);
  const [gifProgress, setGifProgress] = useState(0);
  const [activeExportPlatform, setActiveExportPlatform] = useState<'x' | 'linkedin' | 'tiktok'>('x');

  // Video Reel Interactive Demo States
  const [reelPlaying, setReelPlaying] = useState(true);
  const [recState, setRecState] = useState<keyof BrainMetrics | 'attention'>('excitement');
  const [reelTime, setReelTime] = useState(0);
  const [reelCaption, setReelCaption] = useState("Wait until the 12th second of this reel... See the exact neural trigger pattern light up!");
  const [reelStyle, setReelStyle] = useState<"viral" | "matrix" | "subliminal">("viral");
  const [reelLikes, setReelLikes] = useState(85420);
  const [isLiked, setIsLiked] = useState(false);
  const [customCommentText, setCustomCommentText] = useState("");
  const [activeFilter, setActiveFilter] = useState<"normal" | "lowpass" | "highpass" | "gamma">("normal");

  // Pricing Modal state
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [checkoutComplete, setCheckoutComplete] = useState(false);
  const [creditCardNum, setCreditCardNum] = useState("");
  const [checkoutEmail, setCheckoutEmail] = useState("");

  const pricingTiers: SubscriptionPlan[] = [
    {
      id: "tier_free",
      name: "Cognitive Explorer",
      price: "$0",
      period: "forever",
      description: "Basic SNN profiling for creators and writers testing hooks.",
      features: [
        "5 multi-modal text/link scans per day",
        "Interactive 3D Cortical Visualizer mesh",
        "Standard attention timeline decay model",
        "Public shareable scan URLs",
        "Basic GaugeGap sentiment comparison score"
      ],
      cta: "Continue Free",
      popular: false
    },
    {
      id: "tier_pro",
      name: "SNN Neuro-Marketer (Pro)",
      price: "$49",
      period: "month",
      description: "Comprehensive brand safety safeguards and automatic video audits.",
      features: [
        "Unlimited text, article URLs, and Video links",
        "Instagram, TikTok, YouTube video frame analysis",
        "Raw WebM brain render exports (with zero watermark)",
        "Advanced Crumb LLM parameter wave-function adjustments",
        "Full API access (1000 requests/min rate limit)",
        "Pre-testing simulated conversion uplifts"
      ],
      cta: "Upgrade to Pro",
      popular: true
    },
    {
      id: "tier_enterprise",
      name: "Cerebral Custom Core",
      price: "Custom",
      period: "quote",
      description: "Dedicated infrastructure, model tuning, and safety firewalls.",
      features: [
        "Self-hosted offline Crumb LLM edge models",
        "Zero-retention data privacy guarantees",
        "Custom neuromodulated scenario profiles",
        "Unlimited concurrent pipeline instances",
        "Dedicated SNN architect support team",
        "SLA guaranteed priority API processing"
      ],
      cta: "Contact Foundry",
      popular: false
    }
  ];

  // Draw Physics Tuner Wave
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Draw reference lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw grid bounds
    for (let i = 40; i < width; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, height);
      ctx.stroke();
    }

    // Plot: y(t) = a * sin(omega * t + phi) * exp(-alpha * t)
    ctx.strokeStyle = "#00f5ff";
    ctx.shadowBlur = 8;
    ctx.shadowColor = "rgba(0, 245, 255, 0.5)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    const amplitude = height * 0.38;
    for (let x = 0; x < width; x++) {
      const t = x / 60; // Normalize horizontal scale
      // Wave mechanics formula
      const wave = Math.sin(frequency * t + phase);
      const dampingFactor = Math.exp(-damping * t);
      const y = (height / 2) + wave * dampingFactor * amplitude;

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Plot standard Transformer attention line as comparison (Decaying or baseline step)
    ctx.strokeStyle = "rgba(168, 85, 247, 0.4)";
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const t = x / 60;
      // Exponential decay or sudden memory leak loss at sequence length (quadratic decay)
      const transformerDecay = Math.max(0.02, 1 - (t * t * 0.05));
      const y = (height * 0.8) - transformerDecay * (height * 0.4);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Clear shadow configuration
    ctx.shadowBlur = 0;
  }, [damping, frequency, phase, activeTab]);

  // Simulated live brain reactions on vertical Reel player interval
  useEffect(() => {
    let interval: any;
    if (reelPlaying) {
      interval = setInterval(() => {
        setReelTime(t => (t + 1) % 31);
        // Randomize mock state
        if (Math.random() < 0.2) {
          const metricsKeys: (keyof BrainMetrics | 'attention')[] = [
            'fear', 'anger', 'urgency', 'trust', 'excitement', 'empathy', 'attention'
          ];
          setRecState(metricsKeys[Math.floor(Math.random() * metricsKeys.length)]);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [reelPlaying]);

  const handleSyncAndAnalyze = () => {
    setContentInput(reelCaption);
    setActiveTab('demo');
    // Call triggerScan with the current reel caption directly
    triggerScan(reelCaption);
    setTimeout(() => {
      const target = document.getElementById("demo-hub-anchor");
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  };

  // Run initial trigger scan on mount
  useEffect(() => {
    triggerScan(PRELOAD_SCENARIOS[0].text);
  }, []);

  // Simulated GIF exporter timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showGifModal) {
      setGifProgress(0);
      timer = setInterval(() => {
        setGifProgress((p) => {
          if (p >= 100) {
            clearInterval(timer);
            return 100;
          }
          return p + 4;
        });
      }, 60);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [showGifModal]);

  const optimizeInputForVibe = (vibe: 'dopamine' | 'threat' | 'empathy' | 'academic') => {
    let rewritten = contentInput;
    
    // Clean any prior badges if present
    const cleanText = rewritten.replace(/^(🔥 REVEALED:|🚨 SYSTEM RISK EMERGENCY WARNING:|❤️ A peaceful vision for connection:|🎓 TECHNICAL MATRIX SYNTHESIS:)\s*/i, "");
    const baseText = cleanText.trim() || "Analyze this text for emotional neural indicators.";

    if (vibe === 'dopamine') {
      rewritten = `🔥 REVEALED: ${baseText} Top industry insiders do not want you to know this simple visual secret. Comment 'HYPERSPIKE' now and I'll dm details!`;
    } else if (vibe === 'threat') {
      rewritten = `🚨 SYSTEM RISK EMERGENCY WARNING: ${baseText} Extreme risk factors are active now. Instant action required before it is too late!`;
    } else if (vibe === 'empathy') {
      rewritten = `❤️ A peaceful vision for connection: ${baseText} Our collective values guide this movement to preserve mindful attention, consensus, and emotional warmth.`;
    } else {
      rewritten = `🎓 TECHNICAL MATRIX SYNTHESIS: ${baseText} Resolving wave-function equation parameters to optimize high-salience O(N log N) baseline stability.`;
    }
    
    setContentInput(rewritten);
    triggerScan(rewritten);
  };

  const triggerScan = async (overrideContent?: string) => {
    const rawContent = overrideContent || contentInput;
    if (!rawContent.trim()) return;

    // Cancel any pending status-clear from a prior (failed) scan so it can't
    // wipe the status line of this new scan mid-flight.
    if (statusClearTimer.current) {
      clearTimeout(statusClearTimer.current);
      statusClearTimer.current = null;
    }

    setIsProcessing(true);
    setStatusMessage("Compiling synaptic layers...");

    // Fast simulated status log phases matching physical SNN compile steps
    const states = [
      "Connecting to Crumb LLM wave-field...",
      "Simulating 35 cortical layers...",
      "Resolving O(N log N) synapse paths...",
      "Computing emotional payload spectrum..."
    ];

    let stateIdx = 0;
    const interval = setInterval(() => {
      if (stateIdx < states.length) {
        setStatusMessage(states[stateIdx]);
        stateIdx++;
      }
    }, 350);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: rawContent,
          type: contentType
        })
      });

      if (!response.ok) {
        throw new Error("Analysis failed");
      }

      const data: AnalysisResult = await response.json();
      setAnalysisResult(data);

      // Prepend to scan history
      setScanHistory(prev => {
        if (prev.some(x => x.id === data.id)) return prev;
        return [data, ...prev].slice(0, 10);
      });
      setStatusMessage("");

    } catch (err) {
      console.error(err);
      // Keep the failure visible briefly so it is announced rather than wiped instantly.
      setStatusMessage("Simulation fault. Recovering local neuro-emulator...");
      statusClearTimer.current = setTimeout(() => {
        setStatusMessage("");
        statusClearTimer.current = null;
      }, 4000);
    } finally {
      clearInterval(interval);
      setIsProcessing(false);
    }
  };

  const handleShare = () => {
    copyToClipboard(`${window.location.origin}/share/${analysisResult?.id || "demo"}`);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const loadScenarioPreload = (text: string) => {
    setContentInput(text);
    triggerScan(text);
  };

  const toggleContentType = (type: 'text' | 'url' | 'video') => {
    setContentType(type);
    if (type === 'video') {
      setContentInput("https://www.tiktok.com/@growthcoach/video/7391902019");
    } else if (type === 'url') {
      setContentInput("https://techcrunch.com/2026/06/neuromarketing-crumb-snn-v2");
    } else {
      setContentInput(PRELOAD_SCENARIOS[0].text);
    }
  };

  const handleSimulatePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditCardNum.trim()) return;
    setCheckoutComplete(true);
    setTimeout(() => {
      setSelectedPlan(null);
      setCheckoutComplete(false);
      setCreditCardNum("");
      setCheckoutEmail("");
    }, 2500);
  };

  // Compose the current scan into a branded "NeuroGlow" social card and download
  // it as a real PNG. Self-contained (offscreen canvas), so it works regardless
  // of which tab is mounted. Colors are locked to the BrainSNN theme.
  const downloadNeuroGlowFrame = () => {
    const W = 1200, H = 675;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#06060a";
    ctx.fillRect(0, 0, W, H);

    const accent = ctx.createLinearGradient(0, 0, W, H);
    accent.addColorStop(0, "#00f5ff");
    accent.addColorStop(1, "#a855f7");
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 8);

    // Monogram tile
    ctx.fillStyle = accent;
    const tileX = 80, tileY = 70, tileS = 92;
    ctx.beginPath();
    ctx.roundRect(tileX, tileY, tileS, tileS, 20);
    ctx.fill();
    ctx.fillStyle = "#06060a";
    ctx.font = "700 30px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SNN", tileX + tileS / 2, tileY + tileS / 2 + 1);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f1f1f6";
    ctx.font = "700 52px 'Inter', system-ui, sans-serif";
    ctx.fillText("BrainSNN", tileX + tileS + 28, tileY + 62);

    const r = analysisResult;
    ctx.fillStyle = "#f1f1f6";
    ctx.font = "700 44px 'Inter', system-ui, sans-serif";
    ctx.fillText(r?.title ?? "Affective Intelligence Scan", 80, 250);

    ctx.fillStyle = "#9aa0b4";
    ctx.font = "400 24px 'Inter', system-ui, sans-serif";
    ctx.fillText(`Payload: ${r?.payloadType ?? "—"}   ·   Risk: ${r?.riskRating ?? "—"}`, 80, 300);

    // Metric tiles
    const metrics: [string, string][] = [
      ["VIRAL SCORE", `${r?.viralScore ?? 0}`],
      ["FIRING RATE", `${r?.metrics?.firingRate ?? 0} Hz`],
      ["PLASTICITY", `${r?.metrics?.plasticity ?? 0}%`],
      ["CONFIDENCE", `${r?.confidence ?? 0}%`],
    ];
    const cardW = 250, cardH = 130, gap = 24, startX = 80, startY = 360;
    metrics.forEach(([label, value], i) => {
      const x = startX + i * (cardW + gap);
      ctx.fillStyle = "#0a0a0f";
      ctx.beginPath();
      ctx.roundRect(x, startY, cardW, cardH, 16);
      ctx.fill();
      ctx.strokeStyle = "rgba(168,85,247,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, startY, cardW, cardH, 16);
      ctx.stroke();
      ctx.fillStyle = "#7c8294";
      ctx.font = "500 16px 'JetBrains Mono', monospace";
      ctx.fillText(label, x + 22, startY + 42);
      ctx.fillStyle = "#00f5ff";
      ctx.font = "700 46px 'Inter', system-ui, sans-serif";
      ctx.fillText(value, x + 22, startY + 100);
    });

    ctx.fillStyle = "#00f5ff";
    ctx.font = "500 22px 'JetBrains Mono', monospace";
    ctx.fillText("brainsnn.com", 80, 600);
    ctx.fillStyle = "#a855f7";
    ctx.font = "400 18px 'JetBrains Mono', monospace";
    ctx.fillText("O(N log N) · WAVE-EQUATION ATTENTION CORE", 80, 632);

    const link = document.createElement("a");
    link.download = `brainsnn-neuroglow-${r?.id ?? "scan"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  // Sentence-level virality scoring is O(n) over the content and was being
  // recomputed on every render; memoize on the raw content it depends on.
  const scoredSegments = useMemo(
    () => segmentContent(analysisResult?.rawContent ?? "").map((seg, idx) => ({ ...seg, originalIndex: idx })),
    [analysisResult?.rawContent]
  );

  return (
    <div className="w-full min-h-screen bg-[#0a0a0f] text-[#e0e0e0] flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* Dynamic Cyber Grid/Waves Background */}
      <div className="absolute inset-x-0 top-0 h-[600px] pointer-events-none opacity-20 overflow-hidden z-0">
        <svg className="absolute w-[200%] h-full stroke-[#2d1b54] stroke-1 fill-none opacity-40 translate-x-[-25%] animate-slow-spin">
          <path d="M0,80 Q250,180 500,80 T1000,80 T1500,80 T2000,80" />
          <path d="M0,260 Q300,160 650,260 T1300,260 T1950,260" />
          <path d="M0,450 Q200,520 500,450 T1000,450 T1500,450" />
        </svg>
      </div>

      {/* Navigation Top Header Bar */}
      <header className="sticky top-0 w-full border-b border-white/10 bg-[#0a0a0f]/85 backdrop-blur-md z-50 px-4 md:px-8 py-3.5 flex items-center justify-between" id="header-rail-main">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-[#00f5ff] to-[#a855f7] rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(0,245,255,0.35)]">
            <span className="font-bold text-xs text-white tracking-widest">SNN</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-bold font-sans text-white tracking-tight leading-none">BrainSNN.com</span>
              <span className="text-[10px] bg-cyan-950/40 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded font-mono font-bold">V2.0</span>
            </div>
            <p className="text-[9px] text-[#00f5ff] uppercase tracking-widest font-mono">Affective Intelligence Core</p>
          </div>
        </div>

        {/* Global tab navigator standard layout */}
        <nav className="hidden md:flex items-center gap-8 text-[11px] font-mono uppercase tracking-widest font-semibold">
          <button 
            onClick={() => setActiveTab('demo')} 
            className={`transition-colors cursor-pointer ${activeTab === 'demo' ? "text-[#00f5ff] border-b border-[#00f5ff]" : "text-white/60 hover:text-white"}`}
          >
            SNN Visualizer
          </button>
          <button 
            onClick={() => setActiveTab('crumb')} 
            className={`transition-colors cursor-pointer ${activeTab === 'crumb' ? "text-[#00f5ff] border-b border-[#00f5ff]" : "text-white/60 hover:text-white"}`}
          >
            Crumb LLM Physics
          </button>
          <button 
            onClick={() => setActiveTab('pricing')} 
            className={`transition-colors cursor-pointer ${activeTab === 'pricing' ? "text-[#00f5ff] border-b border-[#00f5ff]" : "text-white/60 hover:text-white"}`}
          >
            Monetization Deck
          </button>
          <button 
            onClick={() => setActiveTab('lab')} 
            className={`transition-colors cursor-pointer ${activeTab === 'lab' ? "text-[#00f5ff] border-b border-[#00f5ff]" : "text-white/60 hover:text-white"}`}
          >
            Cognitive Firewall
          </button>
        </nav>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              setActiveTab('pricing');
              const spec = document.getElementById("pricing-section-target");
              if (spec) spec.scrollIntoView({ behavior: 'smooth' });
            }}
            className="hidden sm:inline-flex px-4.5 py-1.5 bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-black text-[10px] font-black uppercase rounded-full transition-all cursor-pointer shadow-[0_0_15px_rgba(0,245,255,0.2)]"
          >
            Claim Free API Key
          </button>
          {/* Quick status box */}
          <div className="flex items-center gap-1.5 bg-zinc-950/65 border border-white/5 rounded-full px-3 py-1 font-mono text-[9px] text-[#00f5ff] uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
            <span>SYSTEM OPTIMAL</span>
          </div>
          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen(v => !v)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav"
            className="md:hidden flex items-center justify-center bg-zinc-950/65 border border-white/5 rounded-full p-2 text-[#00f5ff] cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Mobile tab navigator (additive; reuses header styling) */}
      {mobileMenuOpen && (
        <nav
          id="mobile-nav"
          className="md:hidden sticky top-[57px] z-40 bg-[#0a0a0f]/95 backdrop-blur-md border-b border-white/10 flex flex-col px-4 py-1 font-mono text-xs uppercase tracking-widest"
        >
          {([['demo', 'SNN Visualizer'], ['crumb', 'Crumb LLM Physics'], ['pricing', 'Monetization Deck'], ['lab', 'Cognitive Firewall']] as [typeof activeTab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); setMobileMenuOpen(false); }}
              className={`text-left py-3 border-b border-white/5 last:border-b-0 transition-colors cursor-pointer ${activeTab === id ? "text-[#00f5ff]" : "text-white/70 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {/* Hero Visual Segment with vertical reel style reactive mock player & promo hooks */}
      <section className="relative w-full border-b border-white/10 overflow-hidden py-12 md:py-20 px-4 md:px-8 z-10" id="hero-segment-main">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-950/30 border border-purple-500/25 rounded-full text-xs font-semibold text-purple-300">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Neuromarketing Trends 2026: Real-Time Multimodal pre-testing</span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight font-sans text-white leading-tight">
              See the Emotions <br className="hidden sm:inline" />
              Hidden in Any Content — <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-[#a855f7]">
                Before Behavior Forms.
              </span>
            </h1>

            <p className="text-zinc-400 text-sm sm:text-base leading-relaxed max-w-2xl">
              Powered by the proprietary, physics-based <span className="text-cyan-300 font-semibold">Crumb LLM</span> using O(N log N) Spiking Neural Networks (SNNs). Decode emotional metrics, attention cascades, and brand safety profiles in text, URL articles, or vertical video feeds.
            </p>

            <div className="flex flex-wrap gap-4 pt-2">
              <button
                onClick={() => {
                  setActiveTab('demo');
                  const target = document.getElementById("demo-hub-anchor");
                  if (target) target.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-6 py-3 bg-[#a855f7] hover:bg-purple-600 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)] hover:-translate-y-0.5"
              >
                Launch Active Demo
              </button>
              
              <button
                onClick={() => {
                  setActiveTab('crumb');
                  const target = document.getElementById("crumb-explainer-target");
                  if (target) target.scrollIntoView({ behavior: 'smooth' });
                }}
                className="px-6 py-3 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-semibold text-xs uppercase tracking-wider rounded-lg transition-all"
              >
                Inspect Wave Benchmarks
              </button>
            </div>

            {/* Micro benchmark numbers */}
            <div className="grid grid-cols-3 gap-6 pt-6 border-t border-white/5 max-w-lg">
              <div>
                <p className="text-[10px] font-mono text-zinc-500 uppercase">Attention Run</p>
                <p className="text-xl font-bold text-white mt-0.5">O(n log n)</p>
                <p className="text-[9px] font-mono text-cyan-400">Wave Mechanics</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-zinc-500 uppercase">Perplexity Gain</p>
                <p className="text-xl font-bold text-white mt-0.5">-14.2%</p>
                <p className="text-[9px] font-mono text-[#a855f7]">Lower Energy</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-zinc-500 uppercase">SNN Sync speed</p>
                <p className="text-xl font-bold text-white mt-0.5">0.1 ms</p>
                <p className="text-[9px] font-mono text-emerald-400">Temporal steps</p>
              </div>
            </div>
          </div>

          {/* Vertical Video Reels Mockup Widget */}
          <div className="lg:col-span-5 flex flex-col gap-5 items-center w-full">
            <div className="w-full max-w-[340px] bg-[#0c0c14] border border-white/10 rounded-2xl overflow-hidden shadow-[0_0_35px_rgba(168,85,247,0.15)] relative">
              
              {/* Media Player Visuals */}
              <div className="aspect-[9/16] relative bg-[#06060c] overflow-hidden flex items-center justify-center">
                
                {/* Dynamically styled background based on reelStyle */}
                {reelStyle === "viral" && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-rose-950/10 to-black/40 z-10" />
                    <div className="absolute inset-x-0 bottom-1/4 h-24 flex items-center justify-center opacity-65 z-0">
                      <div className="w-48 h-48 bg-rose-500/20 rounded-full blur-3xl animate-pulse"></div>
                      <div className="w-32 h-32 bg-[#a855f7]/20 rounded-full blur-2xl animate-pulse ml-10"></div>
                    </div>
                  </>
                )}

                {reelStyle === "matrix" && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-green-950/20 to-black/60 z-10" />
                    <div className="absolute inset-x-0 bottom-1/4 h-24 flex items-center justify-center opacity-65 z-0">
                      <div className="w-48 h-48 bg-emerald-500/15 rounded-full blur-3xl animate-pulse"></div>
                      <div className="w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl animate-pulse ml-10"></div>
                      <div className="absolute font-mono text-[8px] text-green-500/10 select-none overflow-hidden h-full w-full pointer-events-none p-4 leading-none">
                        SYNAPSE_STREAM_ONLINE<br/>L_FACTOR_O_LOG_N<br/>NEURO_EMPATHY_BURST<br/>SNN_SPIKE_LOCK_VERified
                      </div>
                    </div>
                  </>
                )}

                {reelStyle === "subliminal" && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-amber-950/25 to-black/50 z-10" />
                    <div className="absolute inset-x-0 bottom-1/4 h-24 flex items-center justify-center opacity-65 z-0">
                      <div className="w-48 h-48 bg-amber-500/15 rounded-full blur-3xl animate-pulse"></div>
                      <div className="w-32 h-32 bg-red-500/10 rounded-full blur-2xl animate-pulse ml-10"></div>
                    </div>
                  </>
                )}

                {/* Simulated Content Frame Video Overlays */}
                <div className="absolute inset-0 flex flex-col justify-between p-4 z-20">
                  
                  {/* Top Reel Bar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-cyan-400 flex items-center justify-center text-[10px] text-black font-extrabold font-mono shadow-[0_0_10px_rgba(34,211,238,0.5)]">AI</div>
                      <span className="text-xs font-semibold text-white/95 font-sans drop-shadow-md">@NeuroEngine</span>
                    </div>
                    <span className="text-[9px] font-mono bg-rose-600/90 text-white px-2 py-0.5 rounded uppercase tracking-wider font-bold shadow-[0_0_8px_rgba(225,29,72,0.4)] animate-pulse">
                      LIVE SCAN
                    </span>
                  </div>

                  {/* Comment Popovers timeline if applicable */}
                  <AnimatePresence>
                    {customCommentText && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.8, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="self-center bg-black/80 border border-cyan-400/30 text-cyan-300 text-[10px] px-3 py-1.5 rounded-full backdrop-blur-sm shadow-lg max-w-[80%] text-center mt-12 py-1 flex items-center gap-1.5"
                      >
                        <span className="font-mono text-white/60 font-sans">Response Stream:</span>
                        <span>"{customCommentText}"</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Dynamic Floating Scan Hud Indicators Overlay */}
                  <div className="space-y-3">
                    {/* Live Neuro EEG Waves trace */}
                    <div className="bg-black/75 border border-white/10 rounded-xl p-3 backdrop-blur-sm shadow-2xl relative">
                      
                      {/* EEG Status header */}
                      <div className="flex justify-between items-center text-[10px] font-mono text-zinc-400 mb-1.5">
                        <span className="text-[#00f5ff] font-bold uppercase flex items-center gap-1">
                          <Flame className="w-3 h-3 text-cyan-400 animate-bounce" />
                          Emotional Salience Phase:
                        </span>
                        <span>0:{reelTime < 10 ? '0' + reelTime : reelTime}s / 0:30s</span>
                      </div>
                      
                      {/* Live miniature EEG plotter lines */}
                      <div className="h-10 flex items-end gap-0.5 w-full relative group">
                        {Array.from({ length: 42 }, (_, i) => {
                          const multiplier = activeFilter === 'lowpass' ? 0.3 : activeFilter === 'highpass' ? 1.8 : activeFilter === 'gamma' ? 3.0 : 1.0;
                          const base = 12 + Math.sin(i * 0.4 * multiplier + reelTime * 1.5) * 10;
                          const spike = (i > 14 && i < 26) ? (Math.random() * (recState === 'urgency' || recState === 'fear' ? 24 : 14) + 12) : 0;
                          const heightVal = Math.min(Math.max((base + spike) * (1 / (activeFilter === 'lowpass' ? 1.6 : 1)), 4), 36);
                          
                          let color = "bg-[#a855f7]/55";
                          if (recState === 'fear') color = "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]";
                          else if (recState === 'excitement') color = "bg-[#00f5ff] shadow-[0_0_8px_rgba(6,182,212,0.5)]";
                          else if (recState === 'urgency') color = "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]";
                          else if (recState === 'trust') color = "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]";
                          else if (recState === 'empathy') color = "bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.5)]";
                          else if (recState === 'anger') color = "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]";
                          
                          return (
                            <div 
                              key={i} 
                              style={{ height: `${heightVal}px` }} 
                              className={`flex-1 rounded-t-sm transition-all duration-300 ${color}`}
                            />
                          );
                        })}
                      </div>

                      {/* Display live values of custom metrics */}
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-white/5 text-[10px] font-mono text-zinc-300">
                        <div className="flex items-center gap-1">
                          <span className="text-zinc-500">Trigger:</span>
                          <span className={`font-semibold uppercase tracking-wide px-1 rounded ${
                            recState === 'fear' ? 'text-red-400 bg-red-400/10' :
                            recState === 'excitement' ? 'text-[#00f5ff] bg-[#00f5ff]/10' :
                            recState === 'urgency' ? 'text-amber-400 bg-amber-400/10' :
                            'text-zinc-300'
                          }`}>
                            {recState}
                          </span>
                        </div>
                        <div className="text-right">Risk Level: <span className={`font-bold uppercase ${reelTime > 13 && reelTime < 25 ? "text-red-400" : "text-emerald-400"}`}>{reelTime > 13 && reelTime < 25 ? "Spiking" : "Optimal"}</span></div>
                      </div>

                    </div>

                    {/* Live-updating Overlay Message Caption */}
                    <div className="bg-gradient-to-r from-purple-950/80 to-slate-950/80 p-3 rounded-xl border border-purple-500/20 backdrop-blur-sm shadow-xl transition-all">
                      <p className="text-xs font-bold text-white tracking-wide leading-relaxed line-clamp-3">
                        "{reelCaption}"
                      </p>
                      <div className="mt-1.5 flex justify-between items-center text-[9px] font-mono font-bold text-purple-300 uppercase tracking-widest">
                        <span>PRE-TEST CAPTION DECK</span>
                        <span className="animate-pulse text-cyan-400">{activeFilter.toUpperCase()} FILTER ON</span>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Media controls buttons overlay right */}
                <div className="absolute right-3.5 top-1/4 flex flex-col gap-4.5 z-20 text-white">
                  
                  {/* Play & Pause */}
                  <button
                    onClick={() => setReelPlaying(!reelPlaying)}
                    title="Toggle simulated playback"
                    aria-label={reelPlaying ? "Pause preview" : "Play preview"}
                    aria-pressed={reelPlaying}
                    className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/10 flex items-center justify-center transition-all cursor-pointer shadow-md group border-none"
                  >
                    {reelPlaying ? <Pause className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" /> : <Play className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />}
                  </button>

                  {/* Likes counter dynamic interaction */}
                  <button 
                    onClick={() => {
                      setIsLiked(!isLiked);
                      setReelLikes(prev => isLiked ? prev - 1 : prev + 1);
                    }}
                    title="Give reaction"
                    aria-label="Like preview"
                    aria-pressed={isLiked}
                    className="flex flex-col items-center cursor-pointer focus:outline-none"
                  >
                    <div className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all shadow-md ${
                      isLiked 
                        ? 'bg-rose-500/20 border-rose-500/60 text-rose-400' 
                        : 'bg-black/60 hover:bg-black/80 border-white/10 text-white'
                    }`}>
                      <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-500 text-rose-500 animate-bounce' : ''}`} />
                    </div>
                    <span className="text-[9px] font-semibold font-mono mt-1 text-zinc-300">
                      {(reelLikes / 1000).toFixed(1)}K
                    </span>
                  </button>

                  {/* Direct Analyze helper inside player */}
                  <button 
                    onClick={handleSyncAndAnalyze}
                    title="Directly trigger SNN on this caption"
                    className="flex flex-col items-center cursor-pointer focus:outline-none"
                  >
                    <div className="w-10 h-10 rounded-full bg-[#a855f7]/30 hover:bg-[#a855f7]/55 border border-[#a855f7]/55 flex items-center justify-center transition-all shadow-md">
                      <Zap className="w-4 h-4 text-cyan-300 animate-pulse" />
                    </div>
                    <span className="text-[9px] font-mono mt-1 text-purple-300 font-bold uppercase">SYNC</span>
                  </button>

                </div>

                {/* Central play overlay layer */}
                {!reelPlaying && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-12 cursor-pointer" onClick={() => setReelPlaying(true)}>
                    <div className="w-14 h-14 rounded-full bg-cyan-400/20 border border-cyan-400/60 flex items-center justify-center shadow-[0_0_25px_rgba(0,245,255,0.5)] animate-pulse">
                      <Play className="w-6 h-6 text-cyan-300 fill-cyan-400 ml-1" />
                    </div>
                  </div>
                )}
              </div>

              {/* Status footer for device representation */}
              <div className="bg-[#09090f] p-3 text-center border-t border-white/10 text-[10px] font-mono text-zinc-400 flex justify-between items-center px-4">
                <span>Model Engine: </span>
                <span className="text-[#a855f7] font-bold uppercase flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7] animate-ping"></span>
                  @NeuroEngine 1.4v
                </span>
              </div>
            </div>

            {/* Interactive Control Terminal Deck */}
            <div className="w-full max-w-[340px] bg-zinc-950/90 border border-white/5 p-4 rounded-xl space-y-4 shadow-xl">
              <div className="flex items-center gap-1.5 border-b border-white/5 pb-2">
                <Sliders className="w-3.5 h-3.5 text-purple-400" />
                <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-300">
                  NeuroEngine Configuration Deck
                </h4>
              </div>

              {/* Preset theme selector */}
              <div className="space-y-1.5">
                <span className="text-[9px] text-zinc-500 font-mono uppercase block">Live Video Feed Preset Theme:</span>
                <div className="grid grid-cols-3 gap-1.5">
                  <button 
                    onClick={() => setReelStyle("viral")}
                    className={`px-2 py-1 text-[9px] font-bold font-mono rounded border transition-all ${
                      reelStyle === "viral" 
                        ? "bg-rose-500/10 text-rose-400 border-rose-500/40" 
                        : "bg-zinc-900 border-transparent hover:border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Viral Sunset
                  </button>
                  <button 
                    onClick={() => setReelStyle("matrix")}
                    className={`px-2 py-1 text-[9px] font-bold font-mono rounded border transition-all ${
                      reelStyle === "matrix" 
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/40" 
                        : "bg-zinc-900 border-transparent hover:border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Matrix Core
                  </button>
                  <button 
                    onClick={() => setReelStyle("subliminal")}
                    className={`px-2 py-1 text-[9px] font-bold font-mono rounded border transition-all ${
                      reelStyle === "subliminal" 
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/40" 
                        : "bg-zinc-900 border-transparent hover:border-zinc-800 text-zinc-400"
                    }`}
                  >
                    Amber Alert
                  </button>
                </div>
              </div>

              {/* Interactive SNN Override badge triggers */}
              <div className="space-y-1.5">
                <span className="text-[9px] text-zinc-500 font-mono uppercase block">SNN Trigger Point Override:</span>
                <div className="flex flex-wrap gap-1">
                  {(['excitement', 'trust', 'empathy', 'fear', 'anger', 'urgency', 'attention'] as const).map((s) => (
                    <button 
                      key={s}
                      onClick={() => setRecState(s)} // Force exact wave State trigger overlay & graph changes!
                      className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase transition-all border ${
                        recState === s 
                          ? 'bg-[#00f5ff]/10 text-[#00f5ff] border-[#00f5ff]/40 shadow-[0_0_8px_rgba(6,182,212,0.15)]' 
                          : 'bg-zinc-900/60 text-zinc-500 border-transparent hover:text-zinc-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Caption custom text generator */}
              <div className="space-y-1">
                <label className="text-[9px] text-zinc-500 font-mono uppercase block">Custom Video Caption Editor:</label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={reelCaption}
                    onChange={(e) => setReelCaption(e.target.value)}
                    placeholder="Enter Custom vertical caption..."
                    className="w-full text-xs bg-zinc-900 border border-white/5 rounded px-2.5 py-1.5 text-zinc-300 focus:outline-none focus:border-purple-500/50 pr-7"
                  />
                  {reelCaption && (
                    <button 
                      onClick={() => setReelCaption("")}
                      className="absolute right-2 top-2 text-[9px] text-zinc-600 hover:text-zinc-400"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Simulated Comments Trigger Section */}
              <div className="space-y-1.5">
                <span className="text-[9px] text-zinc-500 font-mono uppercase block">Simulated Response Stream Comment:</span>
                <div className="flex gap-1.5">
                  <input 
                    type="text" 
                    value={customCommentText}
                    onChange={(e) => setCustomCommentText(e.target.value)}
                    placeholder="Type e.g. OMG scary / wow hype / now!"
                    className="flex-1 text-xs bg-zinc-900 border border-white/5 rounded px-2 py-1 text-zinc-300 focus:outline-[#a855f7] focus:outline-1"
                  />
                  <button 
                    onClick={() => {
                      if (!customCommentText.trim()) return;
                      // Instantly analyze state from keywords
                      const txt = customCommentText.toLowerCase();
                      if (txt.includes('scary') || txt.includes('fear') || txt.includes('omg')) {
                        setRecState('fear');
                      } else if (txt.includes('wow') || txt.includes('amazing') || txt.includes('hype')) {
                        setRecState('excitement');
                      } else if (txt.includes('fact') || txt.includes('academic') || txt.includes('true')) {
                        setRecState('trust');
                      } else if (txt.includes('buy') || txt.includes('hurry') || txt.includes('now')) {
                        setRecState('urgency');
                      }
                      // Clear and show floating feedback bubble
                    }}
                    className="px-2 py-1 rounded bg-[#a855f7]/30 hover:bg-[#a855f7]/55 text-purple-200 text-xs font-mono font-bold transition-colors"
                  >
                    Inject
                  </button>
                </div>
              </div>

              {/* Master Sync Action Button */}
              <button 
                onClick={handleSyncAndAnalyze}
                className="w-full py-2.5 bg-gradient-to-r from-cyan-500 via-indigo-500 to-[#a855f7] hover:from-cyan-400 hover:to-purple-500 text-white font-mono font-extrabold text-[10px] rounded-lg transition-all shadow-[0_0_15px_rgba(168,85,247,0.25)] flex items-center justify-center gap-1.5 hover:-translate-y-0.5 active:translate-y-0"
              >
                <Zap className="w-3.5 h-3.5 animate-bounce" />
                <span>SYNC & PRE-TEST THIS CAPTION IN 3D SNN MODEL</span>
              </button>

            </div>
          </div>

        </div>
      </section>

      {/* Main Core Work Area */}
      <main className="max-w-7xl mx-auto w-full px-4 md:px-8 py-10 z-10 flex-1 flex flex-col gap-10" id="main-content-layout">
        
        {/* Navigation / Tab Controls */}
        <div className="flex items-center gap-2 border-b border-white/5 pb-4">
          <button 
            onClick={() => setActiveTab('demo')}
            className={`px-5 py-2 rounded-lg text-xs font-mono font-bold tracking-wider cursor-pointer uppercase transition-all flex items-center gap-2 ${
              activeTab === 'demo' 
                ? "bg-purple-950/40 text-cyan-300 border border-cyan-500/30" 
                : "text-zinc-400 border border-transparent hover:bg-zinc-900/40 hover:text-white"
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>Interactive Demo</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('crumb')}
            className={`px-5 py-2 rounded-lg text-xs font-mono font-bold tracking-wider cursor-pointer uppercase transition-all flex items-center gap-2 ${
              activeTab === 'crumb' 
                ? "bg-purple-950/40 text-cyan-300 border border-cyan-500/30" 
                : "text-zinc-400 border border-transparent hover:bg-zinc-900/40 hover:text-white"
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Crumb Wave Tuning</span>
          </button>

          <button 
            onClick={() => setActiveTab('pricing')}
            className={`px-5 py-2 rounded-lg text-xs font-mono font-bold tracking-wider cursor-pointer uppercase transition-all flex items-center gap-2 ${
              activeTab === 'pricing' 
                ? "bg-purple-950/40 text-cyan-300 border border-cyan-500/30" 
                : "text-zinc-400 border border-transparent hover:bg-zinc-900/40 hover:text-white"
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>Flexible Pricing</span>
          </button>

          <button 
            onClick={() => setActiveTab('lab')}
            className={`px-5 py-2 rounded-lg text-xs font-mono font-bold tracking-wider cursor-pointer uppercase transition-all flex items-center gap-2 ${
              activeTab === 'lab' 
                ? "bg-purple-950/40 text-cyan-300 border border-cyan-500/30" 
                : "text-zinc-400 border border-transparent hover:bg-zinc-900/40 hover:text-white"
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Cognitive Firewall</span>
          </button>
        </div>

        {/* 1. INTERACTIVE DEMO HUB */}
        {activeTab === 'demo' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="demo-hub-anchor">
            
            {/* Left Console Panel: Inputs & Presets (5 Cols) */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              
              <div className="bg-[#0c0c14]/90 border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-xs font-mono tracking-widest text-purple-400 uppercase">
                    Affective Content Compiler
                  </h2>
                  <span className={`text-[10px] px-2 py-0.5 rounded border font-mono transition-colors duration-300 ${
                    analysisResult?.isFallback
                      ? "bg-amber-950/45 text-amber-400 border-amber-500/20"
                      : "bg-emerald-950/40 text-emerald-400 border-emerald-500/20"
                  }`}>
                    {analysisResult?.isFallback ? "Local Emulator Fallback" : "Online"}
                  </span>
                </div>

                {/* Content Input Tabs */}
                <div className="flex bg-black/40 border border-white/5 p-1 rounded-lg">
                  <button
                    onClick={() => toggleContentType('text')}
                    className={`flex-1 py-1 px-2.5 rounded-md text-[10px] font-mono uppercase tracking-tight transition-colors ${
                      contentType === 'text' ? "bg-purple-600/90 text-white" : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Text Copy
                  </button>
                  <button
                    onClick={() => toggleContentType('url')}
                    className={`flex-1 py-1 px-2.5 rounded-md text-[10px] font-mono uppercase tracking-tight transition-colors ${
                      contentType === 'url' ? "bg-purple-600/90 text-white" : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Article URL
                  </button>
                  <button
                    onClick={() => toggleContentType('video')}
                    className={`flex-1 py-1 px-2.5 rounded-md text-[10px] font-mono uppercase tracking-tight transition-colors ${
                      contentType === 'video' ? "bg-purple-600/90 text-white" : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Social Reel/Video
                  </button>
                </div>

                <div className="space-y-2.5">
                  <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
                    {contentType === 'text' && "Copywrite body context to profile:"}
                    {contentType === 'url' && "Target website article URL to scrape:"}
                    {contentType === 'video' && "Instagram Reel / TikTok / YouTube Shorts URL:"}
                  </label>
                  
                  {contentType === 'text' ? (
                    <textarea
                      value={contentInput}
                      onChange={(e) => setContentInput(e.target.value)}
                      placeholder="Type or paste high-risk messaging, headlines, social ad copy here..."
                      className="w-full h-36 bg-black/50 hover:bg-black/80 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50 border border-white/10 rounded-xl p-3 resize-none font-sans text-zinc-300 placeholder:text-zinc-600 transition-colors"
                      id="analysis-content-textarea"
                    />
                  ) : (
                    <input
                      type="text"
                      value={contentInput}
                      onChange={(e) => setContentInput(e.target.value)}
                      placeholder={contentType === 'url' ? "e.g. https://www.bloomberg.com/news/article" : "e.g. https://www.instagram.com/reel/C7u182Yx/"}
                      className="w-full bg-black/50 hover:bg-black/80 float-left text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500/50 border border-white/10 rounded-xl p-3 font-mono text-cyan-300 placeholder:text-zinc-600 transition-colors text-ellipsis overflow-hidden"
                      id="analysis-content-input"
                    />
                  )}
                </div>

                {contentType === 'text' && (
                  <div className="bg-[#0b0b12]/90 border border-cyan-500/10 rounded-xl p-3 space-y-2 mt-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-cyan-400 rotate-12" />
                        <span className="text-[10px] font-mono text-zinc-300 uppercase tracking-wider font-bold">
                          AI Neuromodulator Optimizer
                        </span>
                      </div>
                      <span className="text-[8px] bg-cyan-950/40 text-cyan-400 border border-cyan-500/15 px-1 py-0.5 rounded font-mono font-bold uppercase">
                        Vibe Engine
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-500 font-mono leading-relaxed">
                      Instantly rewrite draft messaging using specific SNN firing triggers to maximize outreach virality:
                    </p>
                    <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => optimizeInputForVibe('dopamine')}
                        className="bg-rose-950/20 hover:bg-rose-950/40 border border-rose-500/15 hover:border-rose-500/35 p-1.5 rounded-lg flex flex-col gap-0.5 items-center justify-center text-center transition-all group cursor-pointer"
                        title="Spike curiosity and high engagement Dopamine spikes"
                      >
                        <span className="text-xs group-hover:scale-110 transition-transform">🔥</span>
                        <span className="text-[9px] font-mono font-bold text-rose-300">Dopamine</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => optimizeInputForVibe('threat')}
                        className="bg-amber-950/20 hover:bg-amber-950/40 border border-amber-500/15 hover:border-amber-500/35 p-1.5 rounded-lg flex flex-col gap-0.5 items-center justify-center text-center transition-all group cursor-pointer"
                        title="Spike urgency, warning, and crisis triggers in brain"
                      >
                        <span className="text-xs group-hover:scale-110 transition-transform">🚨</span>
                        <span className="text-[9px] font-mono font-bold text-amber-300">Threat</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => optimizeInputForVibe('empathy')}
                        className="bg-purple-950/20 hover:bg-purple-950/40 border border-purple-500/15 hover:border-purple-500/35 p-1.5 rounded-lg flex flex-col gap-0.5 items-center justify-center text-center transition-all group cursor-pointer"
                        title="Spike transparency, connection, and empathy triggers"
                      >
                        <span className="text-xs group-hover:scale-110 transition-transform">❤️</span>
                        <span className="text-[9px] font-mono font-bold text-purple-300">Empathy</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => optimizeInputForVibe('academic')}
                        className="bg-cyan-950/20 hover:bg-cyan-950/40 border border-cyan-500/15 hover:border-cyan-500/35 p-1.5 rounded-lg flex flex-col gap-0.5 items-center justify-center text-center transition-all group cursor-pointer"
                        title="Spike authority, proof, and factual metrics"
                      >
                        <span className="text-xs group-hover:scale-110 transition-transform">🎓</span>
                        <span className="text-[9px] font-mono font-bold text-cyan-300">Authority</span>
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => triggerScan()}
                  disabled={isProcessing || !contentInput.trim()}
                  aria-busy={isProcessing}
                  className={`w-full py-3 rounded-xl text-xs uppercase font-bold tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 ${
                    isProcessing 
                      ? "bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed" 
                      : "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-[#a855f7] hover:to-indigo-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.35)] hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] active:translate-y-0.5"
                  }`}
                  id="btn-trigger-neurolink"
                >
                  {isProcessing ? (
                    <>
                      <span className="h-4 w-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></span>
                      <span>{statusMessage || "Neuromodulating..."}</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 text-cyan-300" />
                      <span>Compute SNN Affective Scan</span>
                    </>
                  )}
                </button>
                {/* Screen-reader announcement of scan progress / errors */}
                <span className="absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0" aria-live="polite">{statusMessage}</span>
              </div>

              {/* Preloaded Scenarios Block */}
              <div className="bg-[#0c0c14]/90 border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl space-y-3.5">
                <div className="flex items-center gap-1.5 border-b border-white/5 pb-2.5">
                  <BookOpen className="w-4 h-4 text-[#a855f7]" />
                  <h3 className="text-xs font-mono font-bold tracking-wider text-zinc-300 uppercase">
                    Preloaded Playbooks / Academic Presets
                  </h3>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed font-mono">
                  Inject scientific payloads into SNN network arrays to audit specific behavioral outputs:
                </p>
                <div className="flex flex-col gap-2">
                  {PRELOAD_SCENARIOS.map((sc, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setContentType('text');
                        loadScenarioPreload(sc.text);
                      }}
                      className="w-full text-left bg-zinc-950/40 hover:bg-purple-950/20 border border-white/5 hover:border-purple-500/25 p-2 px-3 rounded-lg text-[11px] text-zinc-300 hover:text-white transition-all font-sans cursor-pointer truncate"
                      title={sc.text}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* Middle Module: 3D Visualization Canvas (4 Cols) */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              {analysisResult?.isFallback && (
                <div className="bg-amber-950/20 border border-amber-200/20 rounded-xl p-3.5 space-y-1 text-xs animate-fadeIn shadow-[0_4px_15px_rgba(245,158,11,0.05)]">
                  <div className="flex items-center gap-2 text-amber-400 font-bold font-mono text-[10px] uppercase tracking-wider">
                    <ShieldAlert className="w-3.5 h-3.5 animate-pulse" />
                    <span>Holographic Local SNN Fallback Active</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed font-sans font-medium">
                    Cloud API reached active quota limits. Swapped automatically to high-precision local <strong className="text-zinc-200">Crumb SNN wave-equation emulator</strong>.
                  </p>
                </div>
              )}
              <BrainVisualizer
                metrics={
                  analysisResult 
                    ? analysisResult.metrics 
                    : { fear: 15, anger: 10, urgency: 20, trust: 50, excitement: 40, empathy: 30, firingRate: 45, plasticity: 50 }
                }
                payloadType={analysisResult ? analysisResult.payloadType : "Sustained Baseline"}
                isProcessing={isProcessing}
              />

              {/* Shareable scan indicators */}
              {analysisResult && (
                <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-xs">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-zinc-500">Scan reference code:</span>
                    <span className="text-cyan-400 font-bold">{analysisResult.id}</span>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={handleShare}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-purple-950/40 hover:bg-purple-950/70 text-purple-300 border border-purple-500/20 py-1.5 px-3 rounded transition-colors"
                      id="btn-copy-share-url"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{shareCopied ? "Link Copied!" : "Share Link"}</span>
                    </button>
                    <button
                      onClick={() => setShowGifModal(true)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1 bg-[#00f5ff]/10 hover:bg-[#00f5ff]/20 text-[#00f5ff] border border-[#00f5ff]/20 py-1.5 px-3 rounded transition-colors cursor-pointer"
                      title="Generate beautiful social media card preview and download simulated NeuroGlow GIF"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Distribute GIF</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right Dashboard Terminal Profile Outputs (3 Cols) */}
            <div className="lg:col-span-3 flex flex-col gap-6" id="dashboard-right-rail">
              
              {/* NeuroMetrics Grid */}
              <motion.div 
                key={`neurometrics-${analysisResult?.id || "default"}`}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="bg-[#0c0c14]/90 border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl space-y-4"
              >
                <div className="flex justify-between items-end">
                  <h3 className="text-[10px] font-mono uppercase text-zinc-500 font-bold tracking-widest">
                    Viral Potential Ratio
                  </h3>
                  <span className="text-2xl font-black text-[#00f5ff] animate-glow-cyan leading-none">
                    {analysisResult ? analysisResult.viralScore : 50}%
                  </span>
                </div>
                
                <div className="h-2 bg-black/60 rounded-full overflow-hidden border border-white/5">
                  <div 
                    style={{ width: `${analysisResult ? analysisResult.viralScore : 50}%` }}
                    className="h-full bg-gradient-to-r from-cyan-400 via-indigo-400 to-[#a855f7] rounded-full transition-all duration-1000"
                  />
                </div>

                <div className="space-y-3 pt-2">
                  <h4 className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider border-b border-white/5 pb-1 pointer-events-none">
                    SNN Cortical Activation Matrix:
                  </h4>

                  {/* Single Metric row Fear */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-medium">Fear / Risk Warnings</span>
                      <span className="text-red-400 font-bold">{analysisResult ? analysisResult.metrics.fear : 25}</span>
                    </div>
                    <div className="h-1 bg-black/50 rounded-full overflow-hidden">
                      <div 
                        style={{ width: `${analysisResult ? analysisResult.metrics.fear : 25}%` }} 
                        className="h-full bg-red-500 transition-all duration-700"
                      />
                    </div>
                  </div>

                  {/* Anger */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-medium font-sans">Anger / Indignation</span>
                      <span className="text-orange-400 font-bold">{analysisResult ? analysisResult.metrics.anger : 10}</span>
                    </div>
                    <div className="h-1 bg-black/50 rounded-full overflow-hidden">
                      <div 
                        style={{ width: `${analysisResult ? analysisResult.metrics.anger : 10}%` }} 
                        className="h-full bg-orange-500 transition-all duration-700"
                      />
                    </div>
                  </div>

                  {/* Urgency */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-medium font-sans">Urgency / Scarcity Command</span>
                      <span className="text-amber-400 font-bold">{analysisResult ? analysisResult.metrics.urgency : 35}</span>
                    </div>
                    <div className="h-1 bg-black/50 rounded-full overflow-hidden">
                      <div 
                        style={{ width: `${analysisResult ? analysisResult.metrics.urgency : 35}%` }} 
                        className="h-full bg-amber-500 transition-all duration-700"
                      />
                    </div>
                  </div>

                  {/* Trust */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-medium font-sans">Credibility / Fact Index</span>
                      <span className="text-emerald-400 font-bold">{analysisResult ? analysisResult.metrics.trust : 60}</span>
                    </div>
                    <div className="h-1 bg-black/50 rounded-full overflow-hidden">
                      <div 
                        style={{ width: `${analysisResult ? analysisResult.metrics.trust : 60}%` }} 
                        className="h-full bg-emerald-500 transition-all duration-700"
                      />
                    </div>
                  </div>

                  {/* Excitement */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-medium font-sans">Dopamine / Excitement</span>
                      <span className="text-cyan-400 font-bold">{analysisResult ? analysisResult.metrics.excitement : 40}</span>
                    </div>
                    <div className="h-1 bg-black/50 rounded-full overflow-hidden">
                      <div 
                        style={{ width: `${analysisResult ? analysisResult.metrics.excitement : 40}%` }} 
                        className="h-full bg-cyan-400 transition-all duration-700"
                      />
                    </div>
                  </div>

                  {/* Empathy */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400 font-medium font-sans">Empathy / Narrative Bond</span>
                      <span className="text-[#a855f7] font-bold">{analysisResult ? analysisResult.metrics.empathy : 30}</span>
                    </div>
                    <div className="h-1 bg-black/50 rounded-full overflow-hidden">
                      <div 
                        style={{ width: `${analysisResult ? analysisResult.metrics.empathy : 30}%` }} 
                        className="h-full bg-[#a855f7] transition-all duration-700"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 flex justify-between items-center">
                  <div className="text-[10px] font-mono text-zinc-400">
                    GAUGE GAP DEVIATION
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-mono font-bold ${
                      (analysisResult?.gaugeGapScore || 0) > 15 ? 'text-orange-400' : 'text-cyan-300'
                    }`}>
                      {analysisResult ? (analysisResult.gaugeGapScore > 0 ? `+${analysisResult.gaugeGapScore}` : analysisResult.gaugeGapScore) : "+14"}
                    </span>
                    <Info className="w-3 h-3 text-zinc-500" title="Measures how far the narrative tone strays from academic neutrality." />
                  </div>
                </div>

              </motion.div>

              {/* Brand Safety Alarm Indicator */}
              <motion.div 
                key={`safetyappraisal-${analysisResult?.id || "default"}`}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
                className={`p-4 rounded-xl border flex gap-3 ${
                  (analysisResult?.riskRating === 'High' || analysisResult?.riskRating === 'Critical')
                    ? "bg-red-950/20 border-red-500/20 text-red-100"
                    : analysisResult?.riskRating === 'Medium'
                    ? "bg-amber-950/25 border-amber-500/20 text-amber-100"
                    : "bg-emerald-950/20 border-emerald-500/20 text-emerald-100"
                }`}
              >
                {analysisResult && (analysisResult.riskRating === 'High' || analysisResult.riskRating === 'Critical') ? (
                  <ShieldAlert className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
                ) : (
                  <Check className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                )}
                
                <div className="space-y-1">
                  <p className="text-[10px] font-mono uppercase text-zinc-400">Cognitive Risk Appraisal</p>
                  <p className="text-xs font-bold font-sans">
                    Rating: <span className="underline">{analysisResult ? analysisResult.riskRating : "Low"} Risk</span>
                  </p>
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    {analysisResult ? analysisResult.riskDescription : "Content is aligned with premium, trusted brand baselines."}
                  </p>
                </div>
              </motion.div>

            </div>

          </div>
        )}

        {/* Detailed SNN Output Insights Panel (Always visible below main visualizer deck for perfect UX output) */}
        {activeTab === 'demo' && analysisResult && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-gradient-to-b from-zinc-950/60 to-black/90 border border-white/5 p-6 rounded-2xl shadow-xl hover:border-purple-500/10 transition-colors" id="insights-panel-parent">
            
            <div className="space-y-3 border-b md:border-b-0 md:border-r border-white/5 pb-4 md:pb-0 md:pr-6">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" />
                <h4 className="text-sm font-bold text-white uppercase tracking-tight">Affective Diagnosis</h4>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed font-mono">
                {analysisResult.summary}
              </p>
              <div className="mt-4 p-3 bg-zinc-950 border border-white/5 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-mono text-zinc-500 uppercase">Model confidence</p>
                  <p className="text-xs font-bold text-cyan-300 font-mono">{analysisResult.confidence}% Synapse Lock</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-mono text-zinc-500 uppercase">Attention Run</p>
                  <p className="text-xs font-bold text-[#a855f7] font-mono">{analysisResult.crumbModelStats.attentionComplexity}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3.5 border-b md:border-b-0 md:border-r border-white/5 pb-4 md:pb-0 md:pr-6">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#a855f7]" />
                <h4 className="text-sm font-bold text-white uppercase tracking-tight">Synaptic Insights</h4>
              </div>
              <ul className="space-y-2">
                {analysisResult.insights.map((ins, i) => (
                  <li key={i} className="flex gap-2 text-xs text-zinc-300 leading-relaxed font-sans">
                    <span className="text-[#a855f7] font-mono font-bold shrink-0">0{i+1}.</span>
                    <span>{ins}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3.5">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h4 className="text-sm font-bold text-white uppercase tracking-tight">Neuromarketing Optimizations</h4>
              </div>
              <ul className="space-y-2">
                {analysisResult.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 text-xs text-zinc-300 leading-relaxed font-sans">
                    <span className="text-amber-400 font-mono font-extrabold shrink-0">→</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        )}

        {/* 🚀 EXTRA: SNN TREND ALERTS & CONTENT VOLATILITY HEATMAP */}
        {activeTab === 'demo' && analysisResult && (
          <div className="bg-gradient-to-b from-[#0c0c14]/90 to-black/95 border border-white/5 p-6 rounded-2xl shadow-xl space-y-6 mt-6 transition-all hover:border-cyan-500/10" id="trend-alerts-container">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Flame className={`w-5 h-5 text-rose-500 ${trendAlertsEnabled ? 'animate-bounce' : ''}`} />
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                    SNN Trend Alerts & Volatility Heatmap
                  </h4>
                </div>
                <p className="text-xs text-zinc-400">
                  Breaks text into continuous structural nodes to localize and highlight sensory peaks exceeding viral indicators.
                </p>
              </div>

              {/* Status Pill */}
              <div className="shrink-0 flex items-center gap-1.5 self-start sm:self-center">
                <span className={`h-2 w-2 rounded-full ${trendAlertsEnabled ? 'bg-rose-500 animate-ping' : 'bg-zinc-600'}`} />
                <span className="text-[10px] font-mono uppercase text-zinc-400">
                  {trendAlertsEnabled ? 'Scanning Peak Anomalies' : 'Monitoring Offline'}
                </span>
              </div>
            </div>

            {/* Dashboard Control Bar */}
            <div className="bg-zinc-950 p-4 rounded-xl border border-white/5 grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
              
              {/* Enable Trend Alerts Toggle */}
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-zinc-200 block">
                    Enable Trend Alerts
                  </span>
                  <span className="text-[10px] text-zinc-500 block font-mono">
                    Highlights high-virality sentences.
                  </span>
                </div>
                
                <button
                  id="trend-alerts-toggle"
                  onClick={() => setTrendAlertsEnabled(!trendAlertsEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    trendAlertsEnabled ? "bg-rose-600" : "bg-zinc-700"
                  }`}
                  role="switch"
                  aria-checked={trendAlertsEnabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      trendAlertsEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Highlight Anomalies Toggle */}
              <div className="flex items-center justify-between gap-4 border-t lg:border-t-0 lg:border-x border-white/5 pt-4 lg:pt-0 lg:px-6">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Highlight Anomalies</span>
                  </span>
                  <span className="text-[10px] text-zinc-500 block font-mono">
                    Show top 5 extreme sensory peaks.
                  </span>
                </div>
                
                <button
                  id="highlight-anomalies-toggle"
                  onClick={() => setHighlightAnomalies(!highlightAnomalies)}
                  disabled={!trendAlertsEnabled}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    !trendAlertsEnabled ? "opacity-30 cursor-not-allowed bg-zinc-800" : highlightAnomalies ? "bg-cyan-500" : "bg-zinc-700"
                  }`}
                  role="switch"
                  aria-checked={highlightAnomalies}
                  title="Filter to top 5 emotional spikes"
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      highlightAnomalies && trendAlertsEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Threshold Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-rose-400" />
                    <span>Viral Salience Threshold</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                    {trendThreshold}%
                  </span>
                </div>

                <input
                  id="trend-threshold-slider"
                  type="range"
                  min="40"
                  max="90"
                  step="1"
                  value={trendThreshold}
                  onChange={(e) => setTrendThreshold(Number(e.target.value))}
                  disabled={!trendAlertsEnabled}
                  className={`w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none ${
                    !trendAlertsEnabled ? 'opacity-40 cursor-not-allowed' : ''
                  }`}
                />
                
                <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
                  <span>40% (Highly Sensitive)</span>
                  <span>90% (Extreme Peaks Only)</span>
                </div>
              </div>

            </div>

            {/* Rendered Text Arena */}
            <div className="bg-black/40 p-5 rounded-xl border border-white/5 space-y-4 max-h-[350px] overflow-y-auto custom-scrollbar">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
                SNN Segment Analysis Feed {highlightAnomalies && trendAlertsEnabled && "— Displaying Top 5 Extrema Waves Only"}
              </span>

              {trendAlertsEnabled ? (
                <div className="space-y-3.5 leading-relaxed">
                  {(() => {
                    const allSegments = scoredSegments;
                    let segmentsToRender = allSegments;
                    
                    if (highlightAnomalies) {
                      const sortedTop5 = [...allSegments]
                        .sort((a, b) => b.score - a.score)
                        .slice(0, 5);
                      segmentsToRender = allSegments.filter(seg => 
                        sortedTop5.some(t => t.originalIndex === seg.originalIndex)
                      );
                    }

                    if (segmentsToRender.length === 0) {
                      return (
                        <p className="text-xs text-zinc-500 font-mono text-center py-4">No segment matches the current filter settings.</p>
                      );
                    }

                    return segmentsToRender.map((seg) => {
                      const isHot = seg.score >= trendThreshold;
                      return (
                        <div 
                          key={seg.originalIndex}
                          className={`transition-all duration-300 rounded-xl p-3.5 border text-xs relative group ${
                            isHot 
                              ? 'bg-gradient-to-r from-rose-950/20 to-purple-950/5 border-rose-500/30 hover:border-rose-500/50 text-rose-100 shadow-[0_4px_20px_rgba(244,63,94,0.06)]' 
                              : 'bg-zinc-950/20 border-white/[0.02] text-zinc-400 hover:text-zinc-300 hover:bg-zinc-900/10'
                          }`}
                        >
                          {/* Dynamic Left Stripe Indicator */}
                          <div className={`absolute top-0 bottom-0 left-0 w-1 rounded-l-xl ${
                            isHot ? 'bg-gradient-to-b from-rose-500 to-[#a855f7]' : 'bg-transparent'
                          }`} />

                          {/* Top Badge Panel for Hot Sentences */}
                          {isHot && (
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold tracking-wider text-rose-400 uppercase bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                                <Flame className="w-3 h-3 text-rose-400 animate-pulse" />
                                <span>VIRAL SPIKE EXTREMUM: {seg.score}%</span>
                              </span>
                              <span className="text-[9px] font-mono text-zinc-500">
                                Segment #{seg.originalIndex + 1}
                              </span>
                            </div>
                          )}

                          <p className="font-sans text-xs leading-relaxed pl-1.5 selection:bg-rose-900/30">
                            {seg.text}
                          </p>

                          {/* Segment metrics details on hover */}
                          <div className="mt-2 text-[9px] font-mono text-zinc-500 flex flex-wrap gap-x-4 gap-y-1 pt-1.5 border-t border-white/[0.04] opacity-80 group-hover:opacity-100 transition-opacity pl-1.5">
                            <span>Salience score: <span className={isHot ? 'text-rose-400 font-bold' : 'text-zinc-400'}>{seg.score}%</span></span>
                            <span>Spiking factor: <span className="text-zinc-400">{(seg.score * 0.44 + damping * 20).toFixed(1)}Hz</span></span>
                            {isHot && (
                              <span className="text-rose-400/80 animate-pulse">✓ Predicted virality benchmark unlocked</span>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                    {analysisResult.rawContent}
                  </p>
                  <div className="p-3 bg-zinc-950/40 rounded-lg border border-dashed border-white/5 text-center mt-4">
                    <p className="text-xs text-zinc-500">
                      Trend alerts are presently disabled. Enable the switch above to isolate neural spikes in your paragraphs.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Legend / Diagnostic Context */}
            {trendAlertsEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[10px] font-mono text-zinc-500 bg-zinc-950/40 p-3 rounded-lg border border-white/5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded bg-rose-500/20 border border-rose-500/40 block" />
                  <span>Highlight: Hot Spot (&gt;= {trendThreshold}% score)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded bg-zinc-800 border border-white/5 block" />
                  <span>Muted: Baseline Sequence (&lt; {trendThreshold}% score)</span>
                </div>
              </div>
            )}

          </div>
        )}

        {/* 2. CRUMB LLM PHYSICS PLAYGROUND */}
        {activeTab === 'crumb' && (
          <div className="space-y-8 animate-fadeIn" id="crumb-explainer-target">
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-[#0d0d16] border border-white/5 p-6 md:p-8 rounded-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/5 rounded-full blur-[90px] pointer-events-none" />

              <div className="lg:col-span-6 space-y-6">
                <div>
                  <span className="bg-[#a855f7]/10 text-[#a855f7] border border-[#a855f7]/20 font-mono text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                    Wave Attention Equation v3.2
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-3 font-sans tracking-tight">
                    Crumb LLM Parameters & Attention attenuation Wave-form
                  </h2>
                </div>

                <p className="text-zinc-400 text-xs sm:text-sm leading-relaxed font-sans">
                  Unlike traditional memory-heavy Transformer attention vectors that scale quadratically O(N²), the Crumb LLM models historical attention parameters as waves moving through discrete dampening physical bounds. 
                </p>

                <div className="p-4 bg-zinc-950 border border-white/5 rounded-xl font-mono text-xs text-cyan-300 relative">
                  <span className="absolute top-2 right-3 text-[10px] text-zinc-600">Euler Constant formulation</span>
                  <p className="text-center font-bold text-slate-100 py-1 font-sans text-sm sm:text-base selection:bg-purple-900">
                    A(t) = w_salience · sin(ωt + φ) · e^(-αt)
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-2 text-center">
                    Where α (alpha) dampens early recall spikes, and ω (omega) cycles back into recurrent memory loops.
                  </p>
                </div>

                {/* Live sliders controls */}
                <div className="space-y-4 pt-2">
                  <h3 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-wider">
                    Tune SNN Physical Constants live:
                  </h3>
                  
                  {/* Damping parameter slider */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-300">Damping Coefficient (α)</span>
                      <span className="text-cyan-400 font-bold">{damping.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.01"
                      max="0.5"
                      step="0.01"
                      value={damping}
                      onChange={(e) => setDamping(Number(e.target.value))}
                      className="w-full accent-cyan-400 bg-zinc-900 rounded-lg appearance-none h-1.5 cursor-pointer"
                    />
                    <p className="text-[9px] text-zinc-500 font-mono">Controls how fast temporal excitation levels decay over sequence context.</p>
                  </div>

                  {/* Frequency slider */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-300">Phase frequency (ω)</span>
                      <span className="text-cyan-400 font-bold">{frequency.toFixed(2)} Hz</span>
                    </div>
                    <input
                      type="range"
                      min="1.0"
                      max="12.0"
                      step="0.1"
                      value={frequency}
                      onChange={(e) => setFrequency(Number(e.target.value))}
                      className="w-full accent-cyan-400 bg-zinc-900 rounded-lg appearance-none h-1.5 cursor-pointer"
                    />
                    <p className="text-[9px] text-zinc-500 font-mono">Modulates rhythmic sensory recall intervals in SNN layer pools.</p>
                  </div>

                  {/* Phase offset slider */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-300">Wave phase offset (φ)</span>
                      <span className="text-cyan-400 font-bold">{phase.toFixed(2)} rad</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="6.28"
                      step="0.1"
                      value={phase}
                      onChange={(e) => setPhase(Number(e.target.value))}
                      className="w-full accent-cyan-400 bg-zinc-900 rounded-lg appearance-none h-1.5 cursor-pointer"
                    />
                    <p className="text-[9px] text-zinc-500 font-mono">Defines lead-in attention latency triggers during early visual hook exposure.</p>
                  </div>

                  {/* Show Detailed Math button */}
                  <div className="pt-2">
                    <button
                      id="show-detailed-math-btn"
                      onClick={() => setShowMathModal(true)}
                      className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-950/60 to-indigo-950/40 hover:from-cyan-900/80 hover:to-indigo-900/60 text-cyan-300 font-mono text-xs font-semibold rounded-xl border border-cyan-500/30 hover:border-cyan-400/50 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(6,182,212,0.15)] hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] active:scale-[0.98]"
                    >
                      <BookOpen size={13} className="text-cyan-400" />
                      <span>Show Detailed Math</span>
                    </button>
                  </div>

                </div>

              </div>

              {/* Real-time wave canvas plotter plot (6 cols) */}
              <div className="lg:col-span-6 bg-black/60 border border-white/5 rounded-2xl p-5 flex flex-col items-center justify-center">
                <div className="w-full flex items-center justify-between border-b border-white/5 pb-2.5 mb-4">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
                    <span className="text-[10px] font-mono uppercase text-zinc-400 font-bold">Simulated Multi-Wave Oscilloscope Output</span>
                  </div>
                  <span className="text-[9px] bg-cyan-900/40 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded font-mono select-none">
                    O(N log N) Waveform Plotted
                  </span>
                </div>

                <canvas
                  ref={waveCanvasRef}
                  role="img"
                  aria-label="Crumb LLM damped harmonic attention waveform compared to transformer attention decay"
                  width={420}
                  height={220}
                  className="w-full max-w-full aspect-[21/11] bg-black/40 rounded-xl border border-white/5"
                />

                <div className="w-full grid grid-cols-2 gap-3 mt-4 text-[11px] font-mono text-zinc-400">
                  <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-white/5">
                    <div className="flex items-center gap-1 text-[#00f5ff] mb-1 font-semibold text-[10px] uppercase">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
                      Crumb SNN Attention
                    </div>
                    <span>Damped harmonic oscillation prevents long-context memory fragmentation or explosion.</span>
                  </div>
                  <div className="p-2.5 bg-zinc-950/60 rounded-lg border border-white/10">
                    <div className="flex items-center gap-1 text-purple-400 mb-1 font-semibold text-[10px] uppercase">
                      <span className="h-1.5 w-1.5 rounded-full bg-purple-500 border border-purple-400"></span>
                      Standard Transformer
                    </div>
                    <span>Linear or sudden severe context cutoff leading to massive key-value cache bloat.</span>
                  </div>
                </div>

              </div>

            </div>

            {/* Benchmarks table component built cleanly */}
            <BenchmarksTable />

          </div>
        )}

        {/* 3. FLEXIBLE PRICING MONETIZATION DECK */}
        {activeTab === 'pricing' && (
          <div className="space-y-8 animate-fadeIn" id="pricing-section-target">
            
            <div className="text-center max-w-2xl mx-auto space-y-3">
              <span className="bg-gradient-to-r from-cyan-400 to-indigo-500 text-black font-semibold text-[10px] px-2.5 py-1 rounded uppercase tracking-widest font-mono">
                Decentralized Neural Networks API Access
              </span>
              <h2 className="text-3xl font-extrabold text-white font-sans tracking-tight">
                Flexible subscription tiers and instant production APIs
              </h2>
              <p className="text-zinc-400 text-xs sm:text-sm">
                Scale your narrative audit integrations with zero setup friction. Subscribe to unlocks unlimited video framework processing with direct callback handles.
              </p>
            </div>

            {/* Three Pillar Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {pricingTiers.map((plan) => (
                <div 
                  key={plan.id}
                  className={`bg-[#0d0d17]/90 border rounded-2xl p-6 flex flex-col justify-between relative shadow-xl hover:-translate-y-1 transition-all ${
                    plan.popular 
                      ? "border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.15)] ring-1 ring-purple-600/30" 
                      : "border-white/5 hover:border-white/10"
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute top-0 right-6 -translate-y-1/2 bg-gradient-to-r from-[#00f5ff] to-[#a855f7] text-black font-bold uppercase tracking-widest font-mono text-[9px] px-3 py-1 rounded-full shadow-[0_0_15px_rgba(0,245,255,0.4)]">
                      COMMERCIAL BEST
                    </span>
                  )}

                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-bold text-white font-sans">{plan.name}</h3>
                      <p className="text-zinc-400 text-xs mt-1 min-h-8 leading-snug">{plan.description}</p>
                    </div>

                    <div className="flex items-baseline gap-1 py-2 border-y border-white/5">
                      <span className="text-3xl font-extrabold text-white font-mono">{plan.price}</span>
                      {plan.period !== "forever" && plan.period !== "quote" && (
                        <span className="text-xs text-zinc-500 font-mono">/ {plan.period}</span>
                      )}
                    </div>

                    <ul className="space-y-2.5 pt-2">
                      {plan.features.map((feat, fIdx) => (
                        <li key={fIdx} className="flex items-start gap-2 text-xs text-zinc-300">
                          <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    onClick={() => setSelectedPlan(plan)}
                    className={`w-full py-2.5 mt-6 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      plan.popular 
                        ? "bg-purple-600 hover:bg-purple-500 text-white shadow-[0_5px_15px_rgba(168,85,247,0.25)]" 
                        : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800"
                    }`}
                  >
                    {plan.cta}
                  </button>
                </div>
              ))}
            </div>

            {/* Simulated Stripe Checkout Dialog Backdrop overlay */}
            {selectedPlan && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="w-full max-w-md bg-[#0d0d17] border border-purple-500/30 rounded-2xl p-6 shadow-[0_0_40px_rgba(168,85,247,0.25)] relative animate-scaleUp">
                  
                  {/* Close button */}
                  <button 
                    onClick={() => setSelectedPlan(null)}
                    className="absolute top-4 right-4 text-zinc-500 hover:text-white font-mono text-xs hover:bg-white/5 py-1 px-2 rounded cursor-pointer"
                  >
                    ✕
                  </button>

                  <div className="space-y-4">
                    <div className="border-b border-white/5 pb-3">
                      <span className="text-[10px] font-mono text-purple-300 uppercase tracking-widest leading-none block">
                        BrainSNN Secure Gateway (Static / simulated sand)
                      </span>
                      <h4 className="text-xl font-bold text-white font-sans mt-1.5">
                        Claim {selectedPlan.name} Plan
                      </h4>
                      <p className="text-xs text-zinc-500">Upgrade secure routing to physical Crumb networks instantly.</p>
                    </div>

                    {checkoutComplete ? (
                      <div className="py-8 text-center space-y-3">
                        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/30 border border-emerald-500/40 text-emerald-300 animate-bounce">
                          ✓
                        </div>
                        <h5 className="text-base font-bold text-white uppercase tracking-wider font-mono">
                          Synapse Pipeline Enabled!
                        </h5>
                        <p className="text-xs text-zinc-400">
                          API key and local container access keys issued to <span className="text-cyan-400 font-bold">{checkoutEmail || (selectedPlan.id === "tier_free" ? "your explorer inbox" : "your registered email")}</span>.
                        </p>
                      </div>
                    ) : (
                      <form onSubmit={handleSimulatePayment} className="space-y-4">
                        <div className="space-y-1">
                          <label htmlFor="checkout-email" className="text-[10px] font-mono text-zinc-400 uppercase">Registered user email:</label>
                          <input
                            id="checkout-email"
                            type="email"
                            required
                            placeholder="you@company.com"
                            value={checkoutEmail}
                            onChange={(e) => setCheckoutEmail(e.target.value)}
                            className="w-full bg-black/60 border border-white/10 rounded-lg p-2.5 text-xs text-cyan-300 font-mono focus:ring-1 focus:ring-cyan-500 focus:outline-none"
                          />
                        </div>

                        {selectedPlan.price !== "$0" && (
                          <div className="space-y-1">
                            <label className="text-[10px] font-mono text-zinc-400 uppercase">Simulated Sandbox Stripe Card Number</label>
                            <input 
                              type="text" 
                              required
                              placeholder="4242 •••• •••• 4242 (Stripe test pattern)" 
                              value={creditCardNum}
                              onChange={(e) => setCreditCardNum(e.target.value)}
                              className="w-full bg-black/60 border border-white/10 rounded-lg p-2.5 text-xs text-cyan-300 font-mono focus:ring-1 focus:ring-cyan-500 focus:outline-none"
                            />
                            <p className="text-[9px] text-zinc-600 font-mono">Enter any Stripe trigger code to instantiate subscription tokens safely.</p>
                          </div>
                        )}

                        <div className="bg-black/40 border border-white/5 p-3 rounded-lg text-[10px] font-mono text-zinc-500 leading-snug">
                          By accepting this scan profile subscription sandbox, we assign you 10,000,000 synaptic nodes within our edge router systems without manual operational overheads.
                        </div>

                        <div className="flex gap-2 justify-end pt-3">
                          <button
                            type="button"
                            onClick={() => setSelectedPlan(null)}
                            className="px-4 py-2 border border-zinc-800 hover:bg-zinc-900 rounded-lg text-xs font-semibold text-zinc-400 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-indigo-500 text-black font-extrabold uppercase rounded-lg text-xs tracking-wider hover:opacity-95 shadow-md cursor-pointer"
                          >
                            {selectedPlan.price === "$0" ? "Instantiate Free Key" : `Authorize Payment (${selectedPlan.price})`}
                          </button>
                        </div>
                      </form>
                    )}

                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* 4. COGNITIVE FIREWALL & SCAN HISTORIES LAB */}
        {activeTab === 'lab' && (
          <div className="space-y-6 animate-fadeIn" id="active-tab-container-anchor">
            <div className="bg-gradient-to-r from-indigo-950/20 via-black/85 to-purple-950/20 border border-purple-500/10 p-6 md:p-8 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
              <div className="space-y-3 max-w-xl">
                <span className="text-[10px] bg-red-950/40 text-red-400 border border-red-500/30 px-2.5 py-1 rounded font-mono font-bold uppercase tracking-wider">
                  Edge Cognitive Firewall active
                </span>
                <h3 className="text-xl sm:text-2xl font-bold text-white font-sans">
                  Audit and intercept manipulatory outrage-trig campaigns
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                  The SNN Cognitive Firewall profiles digital messaging flows directly at social ingestion borders, evaluating emotional triggers to prevent panic escalation spirals. Use our REST callbacks to keep community channels ethically centered.
                </p>
              </div>

              <div className="flex flex-col gap-2 shrink-0">
                <div className="p-3.5 bg-black/40 border border-white/5 rounded-xl text-center font-mono text-xs">
                  <p className="text-zinc-500 uppercase">Integrity Score</p>
                  <p className="text-2xl font-black text-white mt-1">94.8%</p>
                  <p className="text-[9px] text-[#00f5ff] mt-0.5">High Brand Safety</p>
                </div>
              </div>
            </div>

            {/* Scan History list */}
            <div className="space-y-3.5 pt-4">
              <div className="flex justify-between items-center px-1">
                <h4 className="text-xs font-mono font-bold text-zinc-400 tracking-wider uppercase">
                  Continuous Audit Lab Log (Scan History)
                </h4>
                <p className="text-[10px] font-mono text-purple-400">Showing the last {Math.max(1, scanHistory.length)} SNN operations</p>
              </div>

              {scanHistory.length === 0 ? (
                <div className="text-center py-10 bg-[#0d0d17]/40 border border-white/5 rounded-2xl text-zinc-500 font-mono text-xs">
                  No previous scans stored in local session. Run the SNN scan above to record audit logs.
                </div>
              ) : (
                <div className="space-y-3">
                  {scanHistory.map((scan) => (
                    <div 
                      key={scan.id}
                      onClick={() => {
                        setAnalysisResult(scan);
                        setContentInput(scan.rawContent);
                        setContentType(scan.contentType);
                        setActiveTab('demo');
                        const specSection = document.getElementById("demo-hub-anchor");
                        if (specSection) specSection.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="bg-[#0c0c14]/90 border border-white/5 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-purple-950/10 hover:border-purple-500/20 transition-all cursor-pointer group"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${
                            scan.riskRating === 'High' ? "bg-red-500" : scan.riskRating === 'Medium' ? "bg-amber-400" : "bg-emerald-500"
                          }`} />
                          <h5 className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors font-sans truncate">
                            {scan.title}
                          </h5>
                          <span className="text-[9px] bg-zinc-950/60 text-zinc-500 font-mono px-1.5 py-0.5 rounded uppercase select-none">
                            {scan.contentType}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 line-clamp-1 italic font-sans max-w-3xl">
                          \"{scan.rawContent}\"
                        </p>
                      </div>

                      <div className="flex items-center gap-4 shrink-0 font-mono text-xs text-zinc-400 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-white/5 pt-2.5 md:pt-0">
                        <div>
                          <span>SNN Rate: </span>
                          <span className="text-cyan-400 font-bold">{scan.metrics.firingRate}Hz</span>
                        </div>
                        <div>
                          <span>Viral Indicator: </span>
                          <span className="text-[#a855f7] font-bold">{scan.viralScore}%</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-[#00f5ff] transition-colors" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* Corporate detailed Use Cases Footer Deck (Generates beautiful visual density) */}
      <section className="bg-gradient-to-b from-black to-[#06060a] border-t border-white/10 py-12 px-4 md:px-8 z-10" id="usecases-grid-deck">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="border-b border-white/5 pb-4">
            <h3 className="text-xs font-mono font-bold tracking-widest text-[#00f5ff] uppercase">
              Brand Alignment & Tactical Use-Cases
            </h3>
            <p className="text-lg font-bold font-sans text-white tracking-tight mt-1">
              Engineered for neuromarketing analytics, agency planners, and brand safety compliance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-2 bg-white/[0.01] border border-white/5 p-4 py-5 rounded-xl hover:border-white/10 transition-colors">
              <span className="text-[#00f5ff] font-mono text-xs font-bold block">01 / BRAND SAFETY DECK</span>
              <h4 className="text-sm font-bold text-zinc-100">Audit Sensationalist Cascades</h4>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                Flag panic-arousal cascades in real time. Safeguard digital media assets from association with outrage vortices.
              </p>
            </div>

            <div className="space-y-2 bg-white/[0.01] border border-white/5 p-4 py-5 rounded-xl hover:border-white/10 transition-colors">
              <span className="text-[#a855f7] font-mono text-xs font-bold block">02 / AGENCY CAMPAIGNS</span>
              <h4 className="text-sm font-bold text-zinc-100">Optimize Attention Timelines</h4>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                Predict first-exposure dopamine triggers using custom damping wave formulas before expensive ad distribution buy-ins.
              </p>
            </div>

            <div className="space-y-2 bg-white/[0.01] border border-white/5 p-4 py-5 rounded-xl hover:border-white/10 transition-colors">
              <span className="text-amber-400 font-mono text-xs font-bold block">03 / CREATOR ANALYTICS</span>
              <h4 className="text-sm font-bold text-zinc-100">Viral Hook Optimization</h4>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                Refine early headline words to activate cognitive insula engagement without losing high-credibility organic trust baselines.
              </p>
            </div>

            <div className="space-y-2 bg-white/[0.01] border border-white/5 p-4 py-5 rounded-xl hover:border-white/10 transition-colors">
              <span className="text-emerald-400 font-mono text-xs font-bold block">04 / POLITICAL COMPLIANCE</span>
              <h4 className="text-sm font-bold text-zinc-100">GaugeGap Balance Audits</h4>
              <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                Detect emotional manipulation levels in public-record logs, ensuring fair expression and robust discourse baselines.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Absolute Bottom Margins Tech-Indicator Status Footer */}
      <footer className="w-full border-t border-white/10 bg-[#0a0a0f] py-4 px-4 md:px-8 text-[9px] tracking-widest font-mono text-zinc-500 uppercase flex flex-col sm:flex-row items-center justify-between gap-4 z-10" id="footer-main-status">
        <div className="flex flex-wrap justify-center sm:justify-start gap-4 md:gap-8">
          <span>CRUMB-CORE-SNN-ENGINE-01</span>
          <span className="hidden md:inline">GAUGE-GAP RESEARCH FOUNDRY</span>
          <span>LATENCY: 12MS</span>
          <span>COMPLEXITY: O(N log N)</span>
        </div>
        <div className="flex gap-4">
          <span className="text-[#00f5ff]">System: Optimal</span>
          <span>© 2026 BrainSNN • Neuromarketing Standards Foundation</span>
        </div>
      </footer>

      {/* 🚀 CRUMB SNN MATHEMATICAL BREAKDOWN MODAL */}
      {showMathModal && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto animate-fadeIn">
          <div className="w-full max-w-2xl bg-[#09090f] border border-cyan-500/30 rounded-2xl p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.2)] relative my-8 font-sans">
            
            {/* Close Button */}
            <button 
              id="close-math-modal-btn"
              onClick={() => setShowMathModal(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white font-mono text-xs hover:bg-white/5 py-1.5 px-3 rounded-lg border border-white/5 transition-all cursor-pointer"
            >
              ✕ CLOSE
            </button>

            {/* Header */}
            <div className="space-y-2 border-b border-white/10 pb-4 mb-6">
              <div className="flex items-center gap-2 text-cyan-400 font-mono text-[10px] tracking-widest uppercase font-bold">
                <Sparkles size={12} className="animate-pulse" />
                <span>Advanced Synaptic Physics Core</span>
              </div>
              <h4 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-tight">
                Crumb LLM Wave Decay & SNN Layer Dynamics
              </h4>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                By modeling attentional weight as a continuous propagating wave function over Spiking Neural Network (SNN) nodes rather than a fixed static lookup, we preserve memory integrity with native O(N log N) complexity.
              </p>
            </div>

            {/* Mathematical Equation Area */}
            <div className="space-y-6">
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">The Governing Attentional Wave Equation:</span>
                <div className="p-4 bg-zinc-950 border border-white/5 rounded-xl text-center space-y-2 select-none relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>
                  <p className="text-xl sm:text-2xl font-serif text-cyan-300 font-bold py-1">
                    S(t, x) = w<sub>s</sub> · sin(ωt - kx + φ) · e<sup>-αt</sup>
                  </p>
                  <p className="text-[10px] text-zinc-500 font-mono">
                    Describes spike potential wave amplitude (S) at temporal step (t) and vertical spiking layer depth (x).
                  </p>
                </div>
              </div>

              {/* Dynamic Diagnostics Bento Sub-Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-zinc-950/60 border border-white/5 p-3.5 rounded-xl space-y-1">
                  <div className="text-[9px] font-mono text-zinc-500 uppercase font-bold text-zinc-400">Resonance Quality (Q)</div>
                  <div className="text-lg font-mono font-bold text-cyan-400">{(frequency / (2 * damping || 0.01)).toFixed(2)}</div>
                  <p className="text-[10px] text-zinc-400 leading-tight font-sans">Focus selectivity. Higher values imply intense, narrow recurring neural fixation.</p>
                </div>
                <div className="bg-zinc-950/60 border border-white/5 p-3.5 rounded-xl space-y-1">
                  <div className="text-[9px] font-mono text-zinc-500 uppercase font-bold text-zinc-400">Attention Half-Life (t½)</div>
                  <div className="text-lg font-mono font-bold text-indigo-400">{(Math.log(2) / (damping || 0.01)).toFixed(2)} <span className="text-[10px] text-zinc-500">steps</span></div>
                  <p className="text-[10px] text-zinc-400 leading-tight font-sans">Sequence steps before the primary dopamine attention decay reduces by 50%.</p>
                </div>
                <div className="bg-zinc-950/60 border border-white/5 p-3.5 rounded-xl space-y-1">
                  <div className="text-[9px] font-mono text-zinc-500 uppercase font-bold text-zinc-400">Oscillatory Period (T)</div>
                  <div className="text-lg font-mono font-bold text-pink-400">{(2 * Math.PI / (frequency || 1.0)).toFixed(2)} <span className="text-[10px] text-zinc-500">steps</span></div>
                  <p className="text-[10px] text-zinc-400 leading-tight font-sans">Wavelength cycle distance governing the rhythm of cognitive processing intervals.</p>
                </div>
              </div>

              {/* Decay Constants Explanations & SNN Layer Impacts */}
              <div className="space-y-4">
                <h5 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-wider block">Decay Constants & Specific SNN Layer Impacts</h5>
                
                <div className="space-y-3">
                  
                  {/* Damping Constant Alpha */}
                  <div className="p-4 bg-zinc-900/40 border border-white/5 hover:border-cyan-500/10 rounded-xl transition-all flex flex-col sm:flex-row gap-3">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-cyan-950/60 border border-cyan-500/20 text-cyan-400 font-mono text-base font-bold shrink-0 self-start">
                      α
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h6 className="text-xs font-bold text-zinc-200">Damping Coefficient (Alpha)</h6>
                        <span className="text-[9px] bg-cyan-950 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded font-mono">Current Live: {damping.toFixed(3)}</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                        Governs the exponentially decaying component <span className="font-mono text-[11px] text-cyan-400">e<sup>-αt</sup></span>. Controls how quickly temporal sensory excitation signals disperse over continuous context.
                      </p>
                      <div className="text-[10px] text-cyan-400/80 font-mono pt-1 flex items-start gap-1">
                        <span className="h-1 w-1 rounded-full bg-cyan-400 mt-1 shrink-0"></span>
                        <span className="font-sans"><strong>SNN SENSOR LAYER IMPACT:</strong> Regulates the leakage potential inside Layer 1 (Input Sensory Encoders). Fast leak rates filter out long-term prose context, while slow leak values ensure deeper narrative correlation.</span>
                      </div>
                    </div>
                  </div>

                  {/* Frequency Constant Omega */}
                  <div className="p-4 bg-zinc-900/40 border border-white/5 hover:border-indigo-500/10 rounded-xl transition-all flex flex-col sm:flex-row gap-3">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-indigo-950/60 border border-indigo-500/20 text-indigo-400 font-mono text-base font-bold shrink-0 self-start">
                      ω
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h6 className="text-xs font-bold text-zinc-200">Phase Frequency (Omega)</h6>
                        <span className="text-[9px] bg-indigo-950 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded font-mono">Current Live: {frequency.toFixed(2)} Hz</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                        Defines the cyclical oscillation speed within the periodic sinus function. Dictates how frequently the attention levels cycle or fluctuate over text sequences.
                      </p>
                      <div className="text-[10px] text-indigo-400/80 font-mono pt-1 flex items-start gap-1">
                        <span className="h-1 w-1 rounded-full bg-indigo-400 mt-1 shrink-0"></span>
                        <span className="font-sans"><strong>SNN PROCESSOR LAYER IMPACT:</strong> Synced with Spike-Timing-Dependent Plasticity (STDP) frequencies in Layer 2 (Recurrent Hubs). High frequency creates hyper-bursts associated with panic arousal cascades.</span>
                      </div>
                    </div>
                  </div>

                  {/* Phase Offset Constant Phi */}
                  <div className="p-4 bg-zinc-900/40 border border-white/5 hover:border-pink-500/10 rounded-xl transition-all flex flex-col sm:flex-row gap-3">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-pink-950/60 border border-pink-500/20 text-pink-400 font-mono text-base font-bold shrink-0 self-start">
                      φ
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h6 className="text-xs font-bold text-zinc-200">Wave Phase Offset (Phi)</h6>
                        <span className="text-[9px] bg-pink-950 text-pink-400 border border-pink-500/20 px-1.5 py-0.5 rounded font-mono">Current Live: {phase.toFixed(2)} rad</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                        Determines the starting horizontal alignment or delay shift of the wave envelope as it travels across SNN nodes.
                      </p>
                      <div className="text-[10px] text-pink-400/80 font-mono pt-1 flex items-start gap-1">
                        <span className="h-1 w-1 rounded-full bg-pink-400 mt-1 shrink-0"></span>
                        <span className="font-sans"><strong>SNN MEMORY LAYER IMPACT:</strong> Controls early temporal delay matching in Layer 3 (Cortico-predictive synapses), determining hook impact right on primary input ingestion.</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Dynamic SNN Summary Footer */}
              <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between text-[11px] text-zinc-500 font-mono gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Matrix Status: Operational SNN Simulation
                </span>
                <span className="text-zinc-600">Model Ref: Crumb-Phi-SNN3.5</span>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* 🚀 VIRAL SOCIAL CARD EXPORTER & GIF DISTRIBUTION DECK */}
      {showGifModal && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto animate-fadeIn">
          <div className="w-full max-w-3xl bg-[#09090f] border border-[#00f5ff]/30 rounded-2xl p-6 sm:p-8 shadow-[0_0_50px_rgba(0,245,255,0.2)] relative my-8 font-sans">
            
            {/* Close Button */}
            <button 
              id="close-gif-modal-btn"
              onClick={() => setShowGifModal(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white font-mono text-xs hover:bg-white/5 py-1.5 px-3 rounded-lg border border-white/5 transition-all cursor-pointer"
            >
              ✕ CLOSE
            </button>

            {/* Header */}
            <div className="space-y-2 border-b border-white/10 pb-4 mb-6">
              <div className="flex items-center gap-2 text-cyan-400 font-mono text-[10px] tracking-widest uppercase font-bold">
                <Share2 size={12} className="animate-pulse" />
                <span>Viral SNN Export & Distribution Terminal</span>
              </div>
              <h4 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-tight">
                Compile & Distribute NeuroGlow Social Cards
              </h4>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Generate high-conversion, dynamic preview cards embedded with verified emotional SNN vector watermarks to command maximum feed algorithm focus on and off social platform streams.
              </p>
            </div>

            {/* Main grid inside modal */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Left Side: Live Preview Canvas card (7 Cols) */}
              <div className="md:col-span-7 space-y-4">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">Live Social Feed Card Preview:</span>
                
                {/* Platform select tabs */}
                <div className="flex bg-black/50 border border-white/5 rounded-lg p-1">
                  {(['x', 'linkedin', 'tiktok'] as const).map((platform) => (
                    <button
                      key={platform}
                      onClick={() => setActiveExportPlatform(platform)}
                      className={`flex-1 py-1 text-[10px] font-mono font-bold uppercase rounded-md transition-all cursor-pointer ${
                        activeExportPlatform === platform 
                          ? "bg-[#00f5ff]/10 text-[#00f5ff] border border-cyan-500/25" 
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {platform === 'x' ? "𝕏 / Twitter" : platform === 'linkedin' ? "💼 LinkedIn" : "🎵 TikTok Feed"}
                    </button>
                  ))}
                </div>

                {/* Simulated Device Frame mockup container */}
                <div className="bg-[#050508] border border-white/10 rounded-xl p-5 relative overflow-hidden space-y-4 min-h-[220px] shadow-2xl flex flex-col justify-between">
                  {/* Cyber Matrix Aura behind */}
                  <div className="absolute inset-0 bg-radial-gradient from-purple-500/5 to-transparent pointer-events-none" />
                  
                  {/* Card Header */}
                  <div className="flex items-center justify-between z-10 relative">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-[#a855f7] flex items-center justify-center font-bold font-sans text-[10px] text-white">
                        SNN
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-white">Cerebral Analyst</h5>
                        <p className="text-[8px] text-zinc-500 font-mono">@BrainsnnScan</p>
                      </div>
                    </div>
                    
                    {/* Floating Emotional Rating Badge */}
                    <div className="bg-cyan-950/60 border border-cyan-500/30 rounded-lg px-2 py-1 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                      <span className="text-[9px] font-mono font-bold text-[#00f5ff]">
                        VIRAL Potential: {analysisResult?.viralScore || 72}%
                      </span>
                    </div>
                  </div>

                  {/* Text Content snippet inside mockup */}
                  <div className="z-10 relative py-2 border-y border-white/[0.04]">
                    <p className="text-xs text-zinc-200 leading-relaxed font-sans line-clamp-3">
                      {contentInput || "Please paste your hook text first."}
                    </p>
                    <p className="text-[10px] text-cyan-400 font-mono mt-2 flex flex-wrap gap-1.5">
                      {activeExportPlatform === 'x' && (
                        <><span>#Neuromarketing</span> <span>#SpikingNeural</span> <span>#DopamineEngine</span> <span>#BrainsSNN</span></>
                      )}
                      {activeExportPlatform === 'linkedin' && (
                        <><span>#B2BThoughtLeadership</span> <span>#ArtificialIntelligence</span> <span>#Neuroscience</span> <span>#Analytics</span></>
                      )}
                      {activeExportPlatform === 'tiktok' && (
                        <><span>#FYPHack</span> <span>#Cerebral</span> <span>#MindBlown</span> <span>#ViralTrends</span></>
                      )}
                    </p>
                  </div>

                  {/* Card Footer Indicators */}
                  <div className="flex justify-between items-center text-[8px] font-mono text-zinc-500 pt-1 z-10 relative">
                    <div className="flex gap-3">
                      <span>⚡ FIRING F: {analysisResult?.metrics.firingRate || 45}Hz</span>
                      <span>🧬 PLASTICITY: {analysisResult?.metrics.plasticity || 50}%</span>
                    </div>
                    <span className="text-purple-400/80 font-bold select-none uppercase tracking-widest text-[7px] border border-purple-500/20 px-1 rounded animate-pulse">
                      AUTHENTIC SNN DECODER
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Side: Prerendering Progress bar & controls (5 Cols) */}
              <div className="md:col-span-5 flex flex-col justify-between space-y-6">
                
                {/* Simulated processing steps panel */}
                <div className="bg-zinc-950/60 border border-white/5 rounded-xl p-4.5 space-y-4">
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">WebM & GIF compilation status:</span>
                    <div className="w-full bg-zinc-900 border border-white/5 rounded-full h-3.5 relative overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-cyan-400 via-indigo-500 to-[#a855f7] h-full rounded-full transition-all duration-300"
                        style={{ width: `${gifProgress}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-bold text-white leading-none">
                        {gifProgress}% {gifProgress === 100 ? "Ready" : "Compiling..."}
                      </span>
                    </div>
                  </div>

                  {/* Processing Sub-phases with active highlights */}
                  <div className="space-y-2 font-mono text-[10px] text-zinc-400">
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${gifProgress >= 20 ? "bg-cyan-400 animate-pulse" : "bg-zinc-700"}`} />
                      <span className={gifProgress >= 20 ? "text-cyan-300 font-bold" : "text-zinc-500"}>
                        [OK] Vectorizing synapse positions (35 cortex nodes)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${gifProgress >= 50 ? "bg-cyan-400 animate-pulse" : "bg-zinc-700"}`} />
                      <span className={gifProgress >= 50 ? "text-cyan-300 font-bold" : "text-zinc-500"}>
                        [OK] Layering aesthetic NeuroGlow aura waves
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${gifProgress >= 80 ? "bg-[#a855f7] animate-pulse" : "bg-zinc-700"}`} />
                      <span className={gifProgress >= 80 ? "text-purple-300 font-bold" : "text-zinc-500"}>
                        [OK] Applying O(N log N) security watermark
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action CTA Buttons */}
                <div className="space-y-3">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest block">Distribution actions:</span>
                  
                  <button
                    onClick={() => {
                      if (gifProgress < 100) return;
                      const hashtagsStr = activeExportPlatform === 'x' 
                        ? '#Neuromarketing #SpikingNeural #DopamineEngine #BrainsSNN'
                        : activeExportPlatform === 'linkedin'
                        ? '#B2BThoughtLeadership #ArtificialIntelligence #Neuroscience #Analytics'
                        : '#FYPHack #Cerebral #MindBlown #ViralTrends';

                      const postText = `🔥 Brand Neuromarketing Scan processed! My SNN emotional analysis score: ${analysisResult?.viralScore || 72}% computed live in @BrainSNN. Highly targeted emotional spike levels. ${hashtagsStr}\n\nCheckout visual: ${window.location.origin}/share/${analysisResult?.id || "demo"}`;
                      copyToClipboard(postText);
                      setPostCopied(true);
                      setTimeout(() => setPostCopied(false), 2000);
                    }}
                    disabled={gifProgress < 100}
                    className={`w-full py-2.5 rounded-xl text-xs font-mono font-bold uppercase transition-all tracking-wider flex items-center justify-center gap-1.5 ${
                      gifProgress < 100
                        ? "bg-zinc-900 border border-zinc-800 text-zinc-500 cursor-not-allowed"
                        : "bg-[#00f5ff]/15 hover:bg-[#00f5ff]/25 text-[#00f5ff] border border-cyan-500/35 cursor-pointer shadow-[0_0_15px_rgba(0,245,255,0.15)]"
                    }`}
                  >
                    {postCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{postCopied ? "Copied!" : "Copy Post & Hashtags"}</span>
                  </button>

                  <button
                    onClick={() => {
                      if (gifProgress < 100) return;
                      downloadNeuroGlowFrame();
                    }}
                    disabled={gifProgress < 100}
                    className={`w-full py-2.5 rounded-xl text-xs font-mono font-bold uppercase transition-all tracking-wider flex items-center justify-center gap-1.5 ${
                      gifProgress < 100 
                        ? "bg-zinc-900 border border-zinc-800 text-zinc-500 cursor-not-allowed"
                        : "bg-purple-600 hover:bg-[#a855f7] text-white cursor-pointer shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                    }`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download NeuroGlow Frame</span>
                  </button>
                </div>

                <div className="text-[9px] font-mono text-zinc-500 leading-normal border-t border-white/5 pt-2">
                  * The NeuroGlow frame is rendered client-side from your live scan and downloaded as a PNG card.
                </div>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
}
