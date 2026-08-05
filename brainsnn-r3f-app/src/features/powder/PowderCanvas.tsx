// The canvas: render loop, pointer and touch.
//
// Everything mutable lives in refs. The simulation runs at 60 Hz inside one
// requestAnimationFrame loop and publishes stats to React on a ~220 ms cadence,
// which is the house pattern across this repo's labs — driving React at frame
// rate would cost more than the simulation does.
import React, { useEffect, useRef } from 'react';
import { PowderEngine } from './powderEngine.ts';
import { NeuroLayer, type NeuroParams } from './neuroLayer.ts';
import { renderGrid } from './renderGrid.ts';
import { Material } from './materials.ts';

export interface PowderStats {
  fps: number;
  particles: number;
  neurons: number;
  synapses: number;
  /** Neuron firings per second, averaged over the publish window. */
  spikesPerSecond: number;
  meanWeight: number;
  dopamineCells: number;
}

export interface PowderCanvasProps {
  engine: PowderEngine;
  layer: NeuroLayer;
  /** Read through a ref so changing it never restarts the loop. */
  material: Material;
  brush: number;
  paused: boolean;
  params: NeuroParams;
  onStats?: (stats: PowderStats) => void;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  ariaLabel?: string;
  /** Fired once the visitor draws, so an intro demo can stand down. */
  onFirstDraw?: () => void;
}

const PUBLISH_MS = 220;

export function PowderCanvas({
  engine,
  layer,
  material,
  brush,
  paused,
  params,
  onStats,
  canvasRef: externalRef,
  ariaLabel = 'Neuro Powder Lab simulation grid',
  onFirstDraw,
}: PowderCanvasProps) {
  const internalRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = externalRef ?? internalRef;

  // Mirrors, so the loop reads current values without being re-created.
  const materialRef = useRef(material);
  const brushRef = useRef(brush);
  const pausedRef = useRef(paused);
  const paramsRef = useRef(params);
  const statsRef = useRef(onStats);
  materialRef.current = material;
  brushRef.current = brush;
  pausedRef.current = paused;
  paramsRef.current = params;
  statsRef.current = onStats;

  const drawingRef = useRef(false);
  const erasingRef = useRef(false);
  const lastCellRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    // The backing store IS the simulation grid. CSS scales it up; see
    // .powder-canvas { image-rendering: pixelated }.
    canvas.width = engine.width;
    canvas.height = engine.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return undefined;

    const image = context.createImageData(engine.width, engine.height);
    let frame = 0;
    let lastPublish = 0;
    let framesSincePublish = 0;
    let firedSincePublish = 0;
    let latest = { neurons: 0, synapses: 0, meanWeight: 0, dopamineCells: 0 };

    function loop(now: number) {
      if (!pausedRef.current) {
        engine.tick();
        const neuro = layer.step(engine, paramsRef.current);
        firedSincePublish += neuro.fired;
        latest = neuro;
      }

      renderGrid(engine, layer, image);
      context.putImageData(image, 0, 0);

      framesSincePublish += 1;
      if (now - lastPublish > PUBLISH_MS) {
        const elapsed = (now - lastPublish) / 1000;
        statsRef.current?.({
          fps: Math.round(framesSincePublish / elapsed),
          particles: engine.countNonEmpty(),
          neurons: latest.neurons,
          synapses: latest.synapses,
          spikesPerSecond: Math.round(firedSincePublish / elapsed),
          meanWeight: latest.meanWeight,
          dopamineCells: latest.dopamineCells,
        });
        lastPublish = now;
        framesSincePublish = 0;
        firedSincePublish = 0;
      }

      frame = requestAnimationFrame(loop);
    }

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [engine, layer, canvasRef]);

  /** Pointer position to a grid cell. The 0.999 clamp keeps the right/bottom
   *  edge from indexing one past the end. */
  function toCell(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
    const fy = Math.min(0.999, Math.max(0, (event.clientY - rect.top) / rect.height));
    return { x: Math.floor(fx * engine.width), y: Math.floor(fy * engine.height) };
  }

  function paint(event: React.PointerEvent<HTMLCanvasElement>) {
    onFirstDraw?.();
    const cell = toCell(event);
    const chosen = erasingRef.current ? Material.AIR : materialRef.current;
    const previous = lastCellRef.current;
    if (previous) {
      // Interpolate: pointer samples arrive ~16 ms apart and a fast drag would
      // otherwise leave a dotted line.
      engine.brushStroke(previous.x, previous.y, cell.x, cell.y, brushRef.current, chosen);
    } else {
      engine.brushDraw(cell.x, cell.y, brushRef.current, chosen);
    }
    lastCellRef.current = cell;
  }

  return (
    <canvas
      ref={canvasRef}
      className="powder-canvas"
      aria-label={ariaLabel}
      data-testid="powder-canvas"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drawingRef.current = true;
        // Right button, or two-finger/secondary, erases.
        erasingRef.current = event.button === 2 || event.buttons === 2;
        lastCellRef.current = null;
        paint(event);
      }}
      onPointerMove={(event) => {
        if (!drawingRef.current) return;
        paint(event);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        drawingRef.current = false;
        erasingRef.current = false;
        lastCellRef.current = null;
      }}
      onPointerCancel={() => {
        drawingRef.current = false;
        erasingRef.current = false;
        lastCellRef.current = null;
      }}
    />
  );
}
