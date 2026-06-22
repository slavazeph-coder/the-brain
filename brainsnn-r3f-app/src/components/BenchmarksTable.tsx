import React, { useState } from "react";
import { Zap, Cpu, Database, Award, Info, Sparkles } from "lucide-react";

interface BenchmarkRow {
  metric: string;
  description: string;
  crumbLLM: string;
  transformer: string;
  impact: string;
  improved: boolean;
}

function BenchmarksTable() {
  const [activeTab, setActiveTab] = useState<'scaling' | 'speed' | 'accuracy'>('scaling');

  const benchmarksData: Record<'scaling' | 'speed' | 'accuracy', BenchmarkRow[]> = {
    scaling: [
      {
        metric: "Attention Complexity",
        description: "Computational load relative to sequence length (N tokens)",
        crumbLLM: "O(N log N) Waveform",
        transformer: "O(N²) Quadratic",
        impact: "Exponential memory savings on massive social feeds",
        improved: true,
      },
      {
        metric: "KV Cache Size",
        description: "Memory required to handle conversational history",
        crumbLLM: "Fixed-Size Wave Tensor",
        transformer: "Infinity linear increase (O(N))",
        impact: "94% lower operational costs at scale",
        improved: true,
      },
      {
        metric: "Context Window Limits",
        description: "Maximum sequence capability before decay",
        crumbLLM: "Unbounded (Damped Wave)",
        transformer: "Hard Limits (Needs Retraining)",
        impact: "Support real-time streams without segment chunking",
        improved: true,
      },
    ],
    speed: [
      {
        metric: "Inference Latency",
        description: "Average milliseconds per affective payload token",
        crumbLLM: "1.2 ms / token",
        transformer: "8.5 ms / token",
        impact: "Instant pre-testing for live stream overlays",
        improved: true,
      },
      {
        metric: "Throughput (Concurrency)",
        description: "Simultaneous social feed scans handled per standard container",
        crumbLLM: "2,400 feeds / sec",
        transformer: "180 feeds / sec",
        impact: "Highly scalable API infrastructure",
        improved: true,
      },
      {
        metric: "Cold-Start Compilation",
        description: "Time to load neural state into local device SRAM",
        crumbLLM: "24 ms",
        transformer: "450 ms",
        impact: "Ultra-fast edge browser-extension activations",
        improved: true,
      },
    ],
    accuracy: [
      {
        metric: "Affect Perplexity",
        description: "Degree of success predicting psychological trigger points",
        crumbLLM: "5.4 perplexity (Lower = Better)",
        transformer: "9.2 perplexity",
        impact: "40% tighter cognitive alignment on anger triggers",
        improved: true,
      },
      {
        metric: "GaugeGap Alignment",
        description: "Emotional manipulation and bias detection confidence",
        crumbLLM: "98.2% validation",
        transformer: "84.1% validation",
        impact: "Virtually eliminates false-positive clickbait alerts",
        improved: true,
      },
      {
        metric: "SNN Mean Firing Resolution",
        description: "Resolution of temporal spiking synaptic delays",
        crumbLLM: "0.1 ms steps",
        transformer: "N/A (Static attention)",
        impact: "Simulates human neurological reactions in 2026",
        improved: true,
      },
    ],
  };

  return (
    <div className="bg-gradient-to-b from-[#0e0e17] to-[#0a0a0f] border border-white/5 rounded-2xl p-6 relative overflow-hidden" id="benchmarks-table-root">
      <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/5 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-cyan-500/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/5 pb-5 mb-6">
        <div>
          <span className="bg-purple-950/40 text-purple-300 font-mono text-[10px] px-2.5 py-1 rounded bg-gradient-to-r from-purple-500/10 to-indigo-500/10 border border-purple-500/20 uppercase tracking-widest font-semibold inline-flex items-center gap-1">
            <Zap className="w-3 h-3 text-cyan-400" />
            CRUMB LLM vs TRANSFORMERS
          </span>
          <h3 className="text-xl font-bold font-sans text-white tracking-tight mt-2">
            Physics-Based wave Attention Performance
          </h3>
          <p className="text-zinc-400 text-xs mt-1">
            How physics-inspired wave mechanics replace quadratic $O(N^2)$ scaling to deliver real-time neuromarketing insights.
          </p>
        </div>

        {/* Tab selection */}
        <div className="flex bg-black/40 border border-white/5 p-1 rounded-lg self-stretch sm:self-auto">
          <button
            onClick={() => setActiveTab('scaling')}
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-xs font-mono transition-all ${
              activeTab === 'scaling' ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            Complexity
          </button>
          <button
            onClick={() => setActiveTab('speed')}
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-xs font-mono transition-all ${
              activeTab === 'speed' ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            Throughput
          </button>
          <button
            onClick={() => setActiveTab('accuracy')}
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-xs font-mono transition-all ${
              activeTab === 'accuracy' ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            Fidelity
          </button>
        </div>
      </div>

      {/* Responsive comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse" id="performance-table">
          <thead>
            <tr className="border-b border-white/5 text-[11px] font-mono text-zinc-500 uppercase tracking-widest">
              <th className="py-3 px-4">Evaluation Dim</th>
              <th className="py-3 px-4">Metric Scope</th>
              <th className="py-3 px-4 text-cyan-300">Crumb SNN ($O(N \log N)$)</th>
              <th className="py-3 px-4 text-zinc-400">Meta TRIBE / Transf.</th>
              <th className="py-3 px-4 hidden md:table-cell">ROI Optimization</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            {benchmarksData[activeTab].map((row, index) => (
              <tr key={index} className="hover:bg-white/[0.01] transition-colors group">
                <td className="py-4 px-4">
                  <div className="font-semibold text-sm text-zinc-200 flex items-center gap-1.5">
                    {activeTab === 'scaling' && <Database className="w-3.5 h-3.5 text-purple-400" />}
                    {activeTab === 'speed' && <Cpu className="w-3.5 h-3.5 text-cyan-400" />}
                    {activeTab === 'accuracy' && <Award className="w-3.5 h-3.5 text-amber-500" />}
                    {row.metric}
                  </div>
                </td>
                <td className="py-4 px-4 text-xs text-zinc-400 leading-normal max-w-[180px]">
                  {row.description}
                </td>
                <td className="py-4 px-4">
                  <span className="text-xs font-mono bg-cyan-950/40 text-cyan-300 border border-cyan-500/25 px-2.5 py-1 rounded inline-block font-semibold shadow-[0_0_10px_rgba(6,182,212,0.1)]">
                    {row.crumbLLM}
                  </span>
                </td>
                <td className="py-4 px-4">
                  <span className="text-xs font-mono text-zinc-400">
                    {row.transformer}
                  </span>
                </td>
                <td className="py-4 px-4 hidden md:table-cell">
                  <div className="text-xs text-purple-300 font-mono bg-purple-950/20 border border-purple-500/10 px-2 py-1 rounded inline-block">
                    {row.impact}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 p-4 bg-zinc-950/40 border border-white/5 rounded-xl flex items-start gap-3">
        <Info className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-400 leading-relaxed font-mono">
          <span className="text-zinc-200 font-semibold">GaugeGap Research Insights:</span> Traditional Transformer mechanisms decay in perplexity when reading emotionally highly charged texts (such as fear cascades). By modeling attention using the <span className="text-cyan-300">damped physics wave-equation</span> (a · sin(ωt + φ) · e^(-αt)), Crumb LLM registers synaptic patterns representing authentic human memory decay without losing historical reference.
        </div>
      </div>
    </div>
  );
}

export default React.memo(BenchmarksTable);
