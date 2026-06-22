import React, { useRef, useEffect, useState } from "react";
import { BrainMetrics } from "../types";
import { Play, Pause, RefreshCw, ZoomIn, ZoomOut, RotateCcw, Shield, Zap, Sparkles, Download } from "lucide-react";

interface BrainVisualizerProps {
  metrics: BrainMetrics;
  payloadType: string;
  isProcessing: boolean;
}

interface BrainNode {
  name: string;
  x: number; // 3D local coordinates
  y: number;
  z: number;
  color: string;
  weight: number;
  label: string;
}

function BrainVisualizer({ metrics, payloadType, isProcessing }: BrainVisualizerProps) {
  if (!metrics) {
    return null;
  }

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rotation, setRotation] = useState({ x: 0.5, y: 0.8 });
  const [zoom, setZoom] = useState(1.1);
  const [isRotating, setIsRotating] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const isDragging = useRef(false);
  const previousMousePosition = useRef({ x: 0, y: 0 });

  const fearColor = "rgba(239, 68, 68, ";     // red
  const angerColor = "rgba(249, 115, 22, ";    // orange
  const trustColor = "rgba(34, 197, 94, ";     // green
  const excitementColor = "rgba(6, 182, 212, ";// cyan
  const empathyColor = "rgba(168, 85, 247, ";  // purple
  const urgencyColor = "rgba(234, 179, 8, ";    // yellow

  // Set up logical 3D node points for key cognitive centers
  const [nodes, setNodes] = useState<BrainNode[]>([]);

  useEffect(() => {
    // Dynamic weights linked to current SNN values
    setNodes([
      { name: "amygdala", x: -0.2, y: -0.1, z: -0.15, color: fearColor, weight: metrics.fear, label: "Amygdala (Fear/Arousal)" },
      { name: "prefrontal", x: 0.45, y: 0.25, z: 0.0, color: urgencyColor, weight: metrics.urgency, label: "Prefrontal Cortex (Urgency/Control)" },
      { name: "temporal", x: 0.1, y: -0.05, z: 0.35, color: trustColor, weight: metrics.trust, label: "Temporal Lobe (Trust/Semantics)" },
      { name: "sensory", x: 0.05, y: 0.35, z: -0.1, color: excitementColor, weight: metrics.excitement, label: "Sensory Cortex (Salience/Excitement)" },
      { name: "insula", x: -0.1, y: 0.05, z: 0.15, color: empathyColor, weight: metrics.empathy, label: "Insula (Empathy/Affect)" },
      { name: "motor", x: -0.15, y: 0.3, z: -0.2, color: angerColor, weight: metrics.anger, label: "Pre-motor Complex (Anger/Agressiveness)" },
    ]);
  }, [metrics]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let localYAngle = rotation.y;
    let localXAngle = rotation.x;
    let pulses: { nodeIndex: number; progress: number; speed: number }[] = [];

    // Animation variables
    let frame = 0;

    const render = () => {
      frame++;
      
      const width = canvas.width;
      const height = canvas.height;
      const hWidth = width / 2;
      const hHeight = height / 2;

      ctx.clearRect(0, 0, width, height);

      if (nodes.length === 0) {
        animationId = requestAnimationFrame(render);
        return;
      }

      // Rotate automatically if requested
      if (isRotating && !isDragging.current) {
        localYAngle += 0.004;
      }

      // Add synaptic spikes/pulses based on firing rate (Hz)
      const maxPulses = Math.floor(metrics.firingRate / 10);
      if (pulses.length < maxPulses && Math.random() < 0.1) {
        pulses.push({
          nodeIndex: Math.floor(Math.random() * nodes.length),
          progress: 0,
          speed: 0.015 + Math.random() * 0.02
        });
      }

      // Progress existing pulses
      pulses = pulses.filter(p => {
        p.progress += p.speed;
        return p.progress < 1;
      });

      // Draw background emotional aura glow based on key metrics
      const metricEntries = [
        { name: "fear", val: metrics.fear || 0, color: "rgba(239, 68, 68, 0.08)" },
        { name: "anger", val: metrics.anger || 0, color: "rgba(249, 115, 22, 0.08)" },
        { name: "trust", val: metrics.trust || 0, color: "rgba(34, 197, 94, 0.08)" },
        { name: "excitement", val: metrics.excitement || 0, color: "rgba(6, 182, 212, 0.08)" },
        { name: "empathy", val: metrics.empathy || 0, color: "rgba(168, 85, 247, 0.08)" },
        { name: "urgency", val: metrics.urgency || 0, color: "rgba(234, 179, 8, 0.08)" }
      ];
      const primaryMetric = metricEntries.reduce((max, current) => current.val > max.val ? current : max, metricEntries[0]);
      
      const glowGrad = ctx.createRadialGradient(hWidth, hHeight, 30, hWidth, hHeight, 190 * zoom);
      glowGrad.addColorStop(0, primaryMetric.color);
      glowGrad.addColorStop(0.5, "rgba(168, 85, 247, 0.02)");
      glowGrad.addColorStop(1, "transparent");
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, width, height);

      // Draw aesthetic outer scope targeting brackets
      ctx.strokeStyle = "rgba(0, 245, 255, 0.12)";
      ctx.lineWidth = 1;
      // Top left corner bracket
      ctx.beginPath();
      ctx.moveTo(15, 15); ctx.lineTo(35, 15);
      ctx.moveTo(15, 15); ctx.lineTo(15, 35);
      ctx.stroke();
      // Top right
      ctx.beginPath();
      ctx.moveTo(width - 15, 15); ctx.lineTo(width - 35, 15);
      ctx.moveTo(width - 15, 15); ctx.lineTo(width - 15, 35);
      ctx.stroke();
      // Bottom left
      ctx.beginPath();
      ctx.moveTo(15, height - 15); ctx.lineTo(35, height - 15);
      ctx.moveTo(15, height - 15); ctx.lineTo(15, height - 35);
      ctx.stroke();
      // Bottom right
      ctx.beginPath();
      ctx.moveTo(width - 15, height - 15); ctx.lineTo(width - 35, height - 15);
      ctx.moveTo(width - 15, height - 15); ctx.lineTo(width - 15, height - 35);
      ctx.stroke();

      // Realtime EEG Oscilloscopes left and right margins
      ctx.strokeStyle = "rgba(6, 182, 212, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 40; y < height - 40; y += 4) {
        const xOffsetLeft = 20 + Math.sin(y * 0.05 + frame * 0.08) * 8 * ((metrics.firingRate || 45) / 60);
        if (y === 40) ctx.moveTo(xOffsetLeft, y);
        else ctx.lineTo(xOffsetLeft, y);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(168, 85, 247, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 40; y < height - 40; y += 4) {
        const xOffsetRight = (width - 20) + Math.cos(y * 0.04 - frame * 0.06) * 8 * ((metrics.plasticity || 50) / 60);
        if (y === 40) ctx.moveTo(xOffsetRight, y);
        else ctx.lineTo(xOffsetRight, y);
      }
      ctx.stroke();

      // Holographic grid / back ticks
      ctx.strokeStyle = "rgba(168, 85, 247, 0.04)";
      ctx.lineWidth = 1;
      for (let i = -100; i <= 100; i += 20) {
        ctx.beginPath();
        ctx.arc(hWidth, hHeight, 140 * zoom + i * (zoom * 0.2), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Glass Brain mesh connections (projected 3D points)
      const cosY = Math.cos(localYAngle);
      const sinY = Math.sin(localYAngle);
      const cosX = Math.cos(localXAngle);
      const sinX = Math.sin(localXAngle);

      const project = (x: number, y: number, z: number) => {
        // Rotate around Y
        let x1 = x * cosY - z * sinY;
        let z1 = x * sinY + z * cosY;
        
        // Rotate around X
        let y2 = y * cosX - z1 * sinX;
        let z2 = y * sinX + z1 * cosX;

        // Apply scale & zoom
        const scale = 220 * zoom;
        const projX = hWidth + x1 * scale;
        const projY = hHeight - y2 * scale;
        return { x: projX, y: projY, z: z2 };
      };

      // Draw glass brain outline shell (multiple circles offset in 3D)
      ctx.beginPath();
      ctx.strokeStyle = isProcessing 
        ? "rgba(6, 182, 212, 0.25)" 
        : "rgba(168, 85, 247, 0.15)";
      ctx.lineWidth = 2;
      
      const shellPoints = 36;
      for (let s = 0; s < 5; s++) {
        // Draw shell plates
        ctx.beginPath();
        ctx.strokeStyle = `rgba(168, 85, 247, ${0.03 + s * 0.02})`;
        const rOffset = s * 0.15 - 0.3;
        for (let i = 0; i <= shellPoints; i++) {
          const theta = (i / shellPoints) * Math.PI * 2;
          // Flatten/elongate to make realistic cerebral lobes
          const x = Math.cos(theta) * 0.65;
          const y = Math.sin(theta) * 0.45 + (Math.cos(theta) > 0 ? 0.05 : 0);
          const z = rOffset;
          const proj = project(x, y, z);
          if (i === 0) ctx.moveTo(proj.x, proj.y);
          else ctx.lineTo(proj.x, proj.y);
        }
        ctx.stroke();
      }

      // Draw brain hemispheres connecting skeleton
      ctx.strokeStyle = "rgba(168, 85, 247, 0.06)";
      ctx.lineWidth = 1;
      const skeletonSteps = 12;
      for (let i = 0; i < skeletonSteps; i++) {
        const theta = (i / skeletonSteps) * Math.PI;
        // Longitudinal fissure
        ctx.beginPath();
        for (let j = 0; j <= 20; j++) {
          const phi = (j / 20) * Math.PI * 2;
          const x = Math.sin(theta) * Math.cos(phi) * 0.55;
          const y = Math.cos(theta) * 0.4 + 0.1;
          const z = Math.sin(theta) * Math.sin(phi) * 0.6;
          const proj = project(x, y, z);
          if (j === 0) ctx.moveTo(proj.x, proj.y);
          else ctx.lineTo(proj.x, proj.y);
        }
        ctx.stroke();
      }

      const projectedNodes = nodes.map(n => project(n.x, n.y, n.z));

      // Draw synthetic synapse pathways between regions
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const p1 = projectedNodes[i];
          const p2 = projectedNodes[j];
          
          if (!p1 || !p2) continue;
          
          // Connect check
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          const maxDist = 320 * zoom;
          if (dist < maxDist) {
            const isPathHovered = activeRegion === nodes[i].name || activeRegion === nodes[j].name;
            const baseAlpha = (1 - dist / maxDist) * 0.12 * (1 + (metrics.firingRate / 100));
            const finalAlpha = isPathHovered ? Math.min(baseAlpha * 4.0, 0.8) : baseAlpha;
            
            ctx.lineWidth = isPathHovered ? 2.0 : 0.8;
            ctx.strokeStyle = isPathHovered 
              ? `rgba(6, 182, 212, ${finalAlpha})` 
              : `rgba(103, 232, 249, ${finalAlpha})`;
              
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      // Draw traveling action potential pulses
      pulses.forEach(p => {
        const sourceIndex = p.nodeIndex;
        // Connect to a neighboring node
        const destIndex = (p.nodeIndex + 1) % nodes.length;
        const p1 = projectedNodes[sourceIndex];
        const p2 = projectedNodes[destIndex];

        if (!p1 || !p2) return;

        const pX = p1.x + (p2.x - p1.x) * p.progress;
        const pY = p1.y + (p2.y - p1.y) * p.progress;

        const isPulseHovered = activeRegion === nodes[sourceIndex].name || activeRegion === nodes[destIndex].name;
        const pulseSize = isPulseHovered ? 24 : 16;
        const particleSize = isPulseHovered ? 3.5 : 2;

        const grad = ctx.createRadialGradient(pX, pY, 0, pX, pY, pulseSize);
        const nodeColorBase = nodes[sourceIndex].color;
        grad.addColorStop(0, nodeColorBase + "0.9)");
        grad.addColorStop(0.3, nodeColorBase + "0.4)");
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pX, pY, pulseSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Spike particle core
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(pX, pY, particleSize, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw cortical region node hulls
      nodes.forEach((node, i) => {
        const proj = projectedNodes[i];
        if (!proj) return;
        const rawWeight = node.weight;
        const nodeRadius = 8 + (rawWeight / 100) * 18 * zoom;

        // Interactive hover pulsing mechanics
        const isHovered = activeRegion === node.name;
        const timeFactor = Date.now() / 1000;
        
        // Gentle background breathing pulse
        const basePulse = 1 + Math.sin(timeFactor * 3.5 + i) * 0.08;
        
        // Intense targeted hover response
        const hoverPulseMultiplier = isHovered ? (1.35 + Math.sin(timeFactor * 9) * 0.15) : 1;
        
        const finalRadius = nodeRadius * basePulse * hoverPulseMultiplier;
        const glowRadius = finalRadius * (isHovered ? 2.8 : 2.0);
        
        // Double concentric glowing circles
        const gradient = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, glowRadius);
        const alphaGlow = isHovered ? "0.95)" : "0.65)";
        const alphaMid = isHovered ? "0.45)" : "0.2)";
        
        gradient.addColorStop(0, node.color + alphaGlow);
        gradient.addColorStop(0.5, node.color + alphaMid);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // High gloss outer rings for highlighted region
        if (isHovered) {
          ctx.strokeStyle = node.color + "0.9)";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, finalRadius * 1.4, 0, Math.PI * 2);
          ctx.stroke();

          // Dotted orbit indicator
          ctx.strokeStyle = "rgba(0, 245, 255, 0.45)";
          ctx.lineWidth = 1.2;
          ctx.setLineDash([2, 5]);
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, finalRadius * 1.8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.strokeStyle = node.color + (isHovered ? "1.0)" : "0.85)");
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, finalRadius * 0.6, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = isHovered ? "#00f5ff" : "#ffffff";
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, isHovered ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fill();

        // Check if mouse is hover/active
        if (isHovered) {
          ctx.font = "bold 11px monospace";
          ctx.fillStyle = "#00f5ff";
          const textMargin = finalRadius + 14;
          ctx.fillText(node.label.toUpperCase(), proj.x + textMargin, proj.y - 4);
          ctx.font = "10px monospace";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(`Activation Potential: ${rawWeight.toFixed(0)}%`, proj.x + textMargin, proj.y + 8);

          // Connection indicator to HUD callout
          ctx.strokeStyle = "rgba(0, 245, 255, 0.75)";
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(proj.x, proj.y);
          ctx.lineTo(proj.x + 10, proj.y - 12);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      // Neural spike flash effect if firing rate is high
      if (Math.random() < (metrics.firingRate / 200) - 0.2) {
        ctx.fillStyle = "rgba(0, 245, 255, 0.03)";
        ctx.fillRect(0, 0, width, height);
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [nodes, zoom, isRotating, activeRegion, metrics, isProcessing, rotation]);

  // Handle Drag / Rotation controls
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDragging.current = true;
    previousMousePosition.current = { x: e.clientX, y: e.clientY };
    // Keep tracking the drag even if the pointer leaves the canvas (and let touch drag rotate).
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) {
      // Find nearest active region block for hover interactivity
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Reverse projection approximation to check mouse collision
      const index = nodes.findIndex((n, idx) => {
        // Quick 2D proximity checking
        const width = canvas.width;
        const height = canvas.height;
        const cosY = Math.cos(rotation.y);
        const sinY = Math.sin(rotation.y);
        const cosX = Math.cos(rotation.x);
        const sinX = Math.sin(rotation.x);
        
        const x1 = n.x * cosY - n.z * sinY;
        const y2 = n.y * cosX - (n.x * sinY + n.z * cosY) * sinX;
        
        const scale = 220 * zoom;
        const projX = (width / 2) + x1 * scale;
        const projY = (height / 2) - y2 * scale;
        
        return Math.hypot(x - projX, y - projY) < 32;
      });

      if (index !== -1) {
        setActiveRegion(nodes[index].name);
      } else {
        setActiveRegion(null);
      }
      return;
    }

    const deltaX = e.clientX - previousMousePosition.current.x;
    const deltaY = e.clientY - previousMousePosition.current.y;

    setRotation(prev => ({
      x: Math.min(Math.max(prev.x + deltaY * 0.007, -1.2), 1.2),
      y: prev.y + deltaX * 0.007
    }));

    previousMousePosition.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = () => {
    isDragging.current = false;
  };

  const resetViewport = () => {
    setRotation({ x: 0.5, y: 0.8 });
    setZoom(1.1);
    setIsRotating(true);
  };

  const captureSimulation = () => {
    setIsRecording(true);
    setTimeout(() => {
      setIsRecording(false);
      // Simulate snapshot download file trigger
      const link = document.createElement('a');
      link.download = 'brainsnn_affective_scan.png';
      link.href = canvasRef.current?.toDataURL() || '';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, 1500);
  };

  return (
    <div className="relative flex flex-col items-center bg-radial-gradient from-purple-950/20 to-black/80 border border-purple-500/10 rounded-2xl p-4 md:p-6 overflow-hidden backdrop-blur-xl" id="neural-visualizer-container">
      {/* Background cyber grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(168,85,247,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(168,85,247,0.02)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

      {/* Visualizer HUD Header */}
      <div className="w-full flex flex-wrap justify-between items-center gap-2 mb-4 z-10 border-b border-purple-500/15 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isProcessing ? "bg-cyan-400" : "bg-purple-400"}`}></span>
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isProcessing ? "bg-cyan-500" : "bg-purple-500"}`}></span>
            </span>
            <span className="text-xs font-mono tracking-widest text-purple-300 uppercase">
              {isProcessing ? "SNN Spiking Wave Synthesis" : "Spiking Neural Engine"}
            </span>
          </div>
          <h3 className="text-base font-semibold font-sans text-white tracking-tight flex items-center gap-1.5 mt-0.5">
            <Sparkles className="w-4.5 h-4.5 text-cyan-400" />
            {isProcessing ? "Recalculating Wave-Functions..." : payloadType}
          </h3>
        </div>

        <div className="flex items-center gap-2 bg-black/40 border border-white/5 rounded-lg px-3 py-1 font-mono text-[11px] text-zinc-400 backdrop-blur-sm">
          <span>Firing: </span>
          <span className="text-cyan-400 font-bold max-w-16 animate-pulse select-none">
            {metrics.firingRate} Hz
          </span>
          <span className="text-zinc-600">|</span>
          <span>Plasticity: </span>
          <span className="text-purple-400 font-bold select-none">{metrics.plasticity}%</span>
        </div>
      </div>

      {/* Canvas Layer */}
      <div className="relative w-full aspect-square max-w-[380px] flex items-center justify-center">
        {isRecording && (
          <div className="absolute inset-0 bg-cyan-950/20 backdrop-blur-md flex flex-col items-center justify-center z-20 rounded-xl border border-cyan-500/30">
            <div className="relative flex items-center justify-center mb-2">
              <span className="absolute animate-ping h-8 w-8 rounded-full bg-cyan-500/30"></span>
              <span className="h-4 w-4 rounded-full bg-cyan-500"></span>
            </div>
            <p className="text-sm font-mono text-cyan-300 tracking-wider">COMPILING WEBM SCAN WATERMARK</p>
            <p className="text-xs font-mono text-zinc-500 mt-1">Crumb Wave Tensor (O(N log N) connections)</p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          role="img"
          aria-label={`3D spiking neural network brain visualization. Payload type ${payloadType}. Mean firing rate ${metrics.firingRate} hertz.`}
          className="cursor-grab active:cursor-grabbing touch-none w-full h-full max-w-full z-10 transition-transform duration-300"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {/* Floating Scenarios HUD Info */}
        <div className="absolute bottom-1 right-2 bg-black/60 border border-purple-500/10 rounded px-2 py-1 z-10 max-w-36 pointer-events-none">
          <p className="text-[9px] font-mono leading-tight text-purple-300">
            * Drag brain to orbit & inspect activation centers. Override scenario configs below.
          </p>
        </div>
      </div>

      {/* Control Actions Panel */}
      <div className="w-full grid grid-cols-2 sm:flex items-center justify-center gap-2 mt-4 pt-4 border-t border-purple-500/10 z-10">
        <button
          onClick={() => setIsRotating(!isRotating)}
          className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all ${
            isRotating 
              ? "bg-purple-950/40 border-purple-500/30 text-purple-300" 
              : "bg-zinc-900 border-zinc-800 text-zinc-500"
          }`}
          title="Toggle Auto Rotation"
          id="btn-toggle-rotate"
        >
          {isRotating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isRotating ? "Auto Spin" : "Static View"}</span>
        </button>

        <button
          onClick={() => setZoom(z => Math.min(z + 0.1, 1.8))}
          className="flex items-center justify-center gap-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors"
          title="Zoom-In Lattice"
          id="btn-zoom-in"
        >
          <ZoomIn className="w-3.5 h-3.5" />
          <span>Zoom +</span>
        </button>

        <button
          onClick={() => setZoom(z => Math.max(z - 0.1, 0.6))}
          className="flex items-center justify-center gap-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors"
          title="Zoom-Out Lattice"
          id="btn-zoom-out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
          <span>Zoom -</span>
        </button>

        <button
          onClick={resetViewport}
          className="flex items-center justify-center gap-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors"
          title="Reset Viewport Position"
          id="btn-reset-view"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>

        <button
          onClick={captureSimulation}
          className="col-span-2 sm:col-span-1 sm:ml-auto flex items-center justify-center gap-1.5 bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 text-white font-medium px-4 py-1.5 rounded-lg text-xs font-mono transition-all shadow-[0_0_15px_rgba(6,182,212,0.15)] hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:-translate-y-0.5"
          title="Export brain analysis to PNG"
          id="btn-export-brain"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Record Scan</span>
        </button>
      </div>
    </div>
  );
}

export default React.memo(BrainVisualizer);
