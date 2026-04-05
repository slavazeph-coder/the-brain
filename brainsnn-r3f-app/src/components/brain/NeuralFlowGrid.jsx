import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { LINKS, POSITIONS, REGION_INFO } from '../../data/network';
import { findCrossLinks, getEdgeActivity, getCrossLinkActivity } from './flowGridUtils';
import FlowTube from './FlowTube';
import PulseWave from './PulseWave';

const PULSE_THRESHOLD = 0.6;
const MAX_PULSES = 3;

export default function NeuralFlowGrid({ regions, weights, quality }) {
  const [pulses, setPulses] = useState([]);
  const prevRegionsRef = useRef({});
  const pulseIdRef = useRef(0);

  // Generate cross-links once
  const crossLinks = useMemo(() => {
    if (quality === 'low') return [];
    return findCrossLinks();
  }, [quality]);

  // Track which regions to pulse
  const activePulseRegions = useRef(new Set());

  // Remove completed pulse
  const removePulse = useCallback((id) => {
    setPulses((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Detect region activity spikes and trigger pulses
  useFrame(() => {
    const prev = prevRegionsRef.current;
    const newPulses = [];

    Object.keys(regions).forEach((regionId) => {
      const current = regions[regionId] ?? 0;
      const previous = prev[regionId] ?? 0;
      const delta = current - previous;

      // Trigger pulse when activity spikes above threshold
      if (current > PULSE_THRESHOLD && delta > 0.05 && !activePulseRegions.current.has(regionId)) {
        activePulseRegions.current.add(regionId);
        newPulses.push({
          id: ++pulseIdRef.current,
          regionId,
          time: Date.now()
        });

        // Clear from active set after 1 second cooldown
        setTimeout(() => {
          activePulseRegions.current.delete(regionId);
        }, 1000);
      }
    });

    if (newPulses.length > 0) {
      setPulses((prev) => [...prev, ...newPulses].slice(-MAX_PULSES));
    }

    prevRegionsRef.current = { ...regions };
  });

  // Determine which links should show a pulse
  const pulsingRegions = useMemo(() => {
    const set = new Set();
    pulses.forEach((p) => set.add(p.regionId));
    return set;
  }, [pulses]);

  return (
    <group>
      {/* Primary pathway tubes */}
      {LINKS.map(([fromId, toId], i) => {
        const key = `${fromId}\u2192${toId}`;
        const edgeActivity = getEdgeActivity(fromId, toId, regions, weights);
        const w = weights[key] ?? 0.2;
        const color = REGION_INFO[fromId]?.color || '#4fa8b3';
        const colorArr = hexToRgbNorm(color);

        const isPulsing = pulsingRegions.has(fromId);

        return (
          <FlowTube
            key={key}
            from={POSITIONS[fromId]}
            to={POSITIONS[toId]}
            activity={edgeActivity}
            weight={w}
            baseColor={colorArr}
            quality={quality}
            pulseActive={isPulsing}
            pulseOrigin={0}
          />
        );
      })}

      {/* Secondary cross-link tubes (web mesh) */}
      {crossLinks.map((cl) => {
        const crossActivity = getCrossLinkActivity(cl, regions, weights);
        return (
          <FlowTube
            key={cl.id}
            from={cl.from}
            to={cl.to}
            activity={crossActivity * 0.6}
            weight={0.15}
            baseColor={[0.25, 0.55, 0.6]}
            pulseColor={[0.6, 0.85, 0.9]}
            quality={quality}
            isSecondary
          />
        );
      })}

      {/* Radial pulse waves at firing regions */}
      {pulses.map((pulse) => (
        <PulseWave
          key={pulse.id}
          regionId={pulse.regionId}
          onComplete={() => removePulse(pulse.id)}
        />
      ))}
    </group>
  );
}

function hexToRgbNorm(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}
