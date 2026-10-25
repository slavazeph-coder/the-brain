import React, { useEffect, useRef } from 'react';
import { Material } from './materials.ts';
import type { PowderEngine } from './powderEngine.ts';
import type { NeuroLayer, NeuroParams } from './neuroLayer.ts';
import { renderGrid } from './renderGrid.ts';
import type { RegimeRecorder, RegimeReadout } from './regime.ts';
import type { Mission, MissionTracker } from './missions.ts';

export type PowderTool = 'paint' | 'spark';

export interface PowderStats {
  fps: number;
  particles: number;
  neurons: number;
  synapses: number;
  spikesPerSecond: number;
  meanWeight: number;
  dopamineCells: number;
  regime: RegimeReadout;
}

export interface PowderCanvasProps {
  engine: PowderEngine;
  layer: NeuroLayer;
  tool: PowderTool;
  material: Material;
  brush: number;
  paused: boolean;
  params: NeuroParams;
  onStats?: (stats: PowderStats) => void;
  canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
  recorder?: RegimeRecorder;
  missions?: MissionTracker;
  onMissionComplete?: (mission: Mission) => void;
  onFirstDraw?: () => void;
}

export function PowderCanvas({
  engine,
  layer,
  tool,
  material,
  brush,
  paused,
  params,
  onStats,
  canvasRef,
  recorder,
  missions,
  onMissionComplete,
  onFirstDraw,
}: PowderCanvasProps) {
  const internalRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ active: boolean; button: number; x: number; y: number }>({
    active: false,
    button: 0,
    x: 0,
    y: 0,
  });

  const setCanvas = (el: HTMLCanvasElement | null) => {
    internalRef.current = el;
    if (canvasRef) canvasRef.current = el;
  };

  const applyPointer = (clientX: number, clientY: number, button: number) => {
    const canvas = internalRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.floor(((clientX - rect.left) / rect.width) * engine.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * engine.height);
    onFirstDraw?.();
    if (button === 2) {
      engine.paintBrush(x, y, brush, Material.AIR);
    } else if (tool === 'spark') {
      engine.sparkAt(x, y, brush, params.threshold);
    } else {
      engine.paintBrush(x, y, brush, material);
    }
  };

  useEffect(() => {
    const canvas = internalRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.createImageData(engine.width, engine.height);
    let animId = 0;
    let frames = 0;
    let spikeAccum = 0;
    let lastReport = performance.now();

    const loop = (now: number) => {
      frames += 1;
      if (!paused) {
        engine.tick();
        const stepStats = layer.step(engine, params);
        spikeAccum += stepStats.spikes;
        if (recorder) {
          recorder.observe(layer, params, stepStats.neurons, stepStats.synapses);
        }
        if (missions) {
          const fallbackRegime: RegimeReadout = recorder
            ? recorder.current()
            : {
                ready: false,
                reason: 'Measuring…',
                cvIsi: 0,
                fano: 0,
                synchrony: 0,
                rateHz: null,
                regime: null,
                neurons: stepStats.neurons,
                spikes: stepStats.spikes,
                windowTicks: 300,
              };
          const completed = missions.observe({
            engine,
            layer,
            regime: fallbackRegime,
          });
          if (onMissionComplete) {
            for (const m of completed) onMissionComplete(m);
          }
        }

        if (now - lastReport >= 250 && onStats) {
          const elapsedSec = (now - lastReport) / 1000;
          let particles = 0;
          for (let i = 0; i < engine.size; i += 1) {
            if ((engine.cells[i] & 0x1f) !== Material.AIR) particles += 1;
          }
          onStats({
            fps: Math.round(frames / elapsedSec),
            particles,
            neurons: stepStats.neurons,
            synapses: stepStats.synapses,
            spikesPerSecond: Math.round(spikeAccum / elapsedSec),
            meanWeight: stepStats.meanWeight,
            dopamineCells: stepStats.dopamineCells,
            regime: recorder
              ? recorder.current()
              : {
                  ready: false,
                  reason: 'Measuring…',
                  cvIsi: 0,
                  fano: 0,
                  synchrony: 0,
                  rateHz: null,
                  regime: null,
                  neurons: stepStats.neurons,
                  spikes: stepStats.spikes,
                  windowTicks: 300,
                },
          });
          frames = 0;
          spikeAccum = 0;
          lastReport = now;
        }
      }

      renderGrid(engine, layer, imageData);
      ctx.putImageData(imageData, 0, 0);
      animId = window.requestAnimationFrame(loop);
    };

    animId = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(animId);
  }, [engine, layer, paused, params, onStats, recorder, missions, onMissionComplete]);

  return (
    <canvas
      ref={setCanvas}
      width={engine.width}
      height={engine.height}
      className="powder-canvas"
      data-testid="powder-canvas"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawingRef.current = { active: true, button: e.button, x: e.clientX, y: e.clientY };
        applyPointer(e.clientX, e.clientY, e.button);
      }}
      onPointerMove={(e) => {
        if (!drawingRef.current.active) return;
        applyPointer(e.clientX, e.clientY, drawingRef.current.button);
      }}
      onPointerUp={() => {
        drawingRef.current.active = false;
      }}
      onPointerCancel={() => {
        drawingRef.current.active = false;
      }}
    />
  );
}
