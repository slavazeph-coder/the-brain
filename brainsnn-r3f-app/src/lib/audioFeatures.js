function clamp100(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

export function unavailableAudioTimeline(reason = 'Audio analysis unavailable in this browser or for this file.') {
  return {
    schemaVersion: 'brainsnn.audio-local.v0.2',
    status: 'unavailable',
    reason,
    points: [],
    tracks: [],
    summary: null,
    disclaimer: 'No audio-derived signal was used. BrainSNN does not invent speech, speaker, emotion, or semantic audio information.',
  };
}

export function deriveAudioEnvelope(channelData, sampleRate, duration, targetHz = 2) {
  if (!channelData || !Number.isFinite(channelData.length) || channelData.length < 2) {
    return unavailableAudioTimeline('Decoded audio contained no usable samples.');
  }
  const rate = Math.max(1, Number(sampleRate) || 44100);
  const resolvedDuration = Math.max(0.01, Number(duration) || (channelData.length / rate));
  const hz = Math.max(0.5, Math.min(8, Number(targetHz) || 2));
  const pointCount = Math.max(1, Math.ceil(resolvedDuration * hz));
  const samplesPerPoint = Math.max(1, Math.floor(channelData.length / pointCount));
  const raw = [];

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const startIndex = pointIndex * samplesPerPoint;
    const endIndex = pointIndex === pointCount - 1
      ? channelData.length
      : Math.min(channelData.length, startIndex + samplesPerPoint);
    let sumSquares = 0;
    let peak = 0;
    let crossings = 0;
    let previous = channelData[startIndex] || 0;
    const count = Math.max(1, endIndex - startIndex);

    for (let i = startIndex; i < endIndex; i += 1) {
      const sample = Number(channelData[i]) || 0;
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      if ((sample >= 0 && previous < 0) || (sample < 0 && previous >= 0)) crossings += 1;
      previous = sample;
    }

    const rms = Math.sqrt(sumSquares / count);
    raw.push({
      timestamp: Number(Math.min(resolvedDuration, pointIndex / hz).toFixed(3)),
      rms,
      peak,
      zeroCrossingRate: crossings / count,
    });
  }

  const maxRms = Math.max(...raw.map((point) => point.rms), 0.000001);
  const noiseFloor = Math.max(0.0025, maxRms * 0.055);
  let previousEnergy = 0;
  let silentPoints = 0;

  const points = raw.map((point) => {
    const normalized = Math.sqrt(point.rms / maxRms);
    const energy = clamp100(Math.round(normalized * 100));
    if (point.rms <= noiseFloor) silentPoints += 1;
    const activityProxy = point.rms <= noiseFloor
      ? clamp100(Math.round((point.rms / noiseFloor) * 18))
      : clamp100(Math.round(24 + ((point.rms - noiseFloor) / Math.max(0.000001, maxRms - noiseFloor)) * 76));
    const dynamics = clamp100(Math.round(Math.abs(energy - previousEnergy) * 1.35));
    previousEnergy = energy;
    return {
      timestamp: point.timestamp,
      energy,
      activityProxy,
      dynamics,
      peak: Number(point.peak.toFixed(5)),
      zeroCrossingRate: Number(point.zeroCrossingRate.toFixed(5)),
    };
  });

  const meanEnergy = points.reduce((sum, point) => sum + point.energy, 0) / points.length;
  const maxEnergy = Math.max(...points.map((point) => point.energy), 0);
  const meanDynamics = points.reduce((sum, point) => sum + point.dynamics, 0) / points.length;

  return {
    schemaVersion: 'brainsnn.audio-local.v0.2',
    status: 'ready',
    points,
    tracks: [
      {
        id: 'audio-energy',
        label: 'Audio energy',
        provenance: 'Browser-local decoded PCM RMS envelope',
        values: points.map(({ timestamp, energy }) => ({ timestamp, value: energy })),
      },
      {
        id: 'audio-activity',
        label: 'Audio activity proxy',
        provenance: 'Adaptive energy-floor heuristic; not speech recognition',
        values: points.map(({ timestamp, activityProxy }) => ({ timestamp, value: activityProxy })),
      },
      {
        id: 'audio-dynamics',
        label: 'Audio dynamics',
        provenance: 'Change in local normalized audio energy',
        values: points.map(({ timestamp, dynamics }) => ({ timestamp, value: dynamics })),
      },
    ],
    summary: {
      sampleRate: rate,
      pointCount: points.length,
      meanEnergy: Number(meanEnergy.toFixed(1)),
      maxEnergy,
      meanDynamics: Number(meanDynamics.toFixed(1)),
      silentFraction: Number((silentPoints / points.length).toFixed(3)),
      noiseFloorRms: Number(noiseFloor.toFixed(6)),
    },
    disclaimer: 'Audio features are browser-local energy/dynamics measurements only. They do not transcribe speech, identify speakers, infer emotion, or measure human response.',
  };
}

export function audioPointAtTime(audioTimeline, time) {
  const points = audioTimeline?.points || [];
  if (!points.length) return null;
  const seconds = Math.max(0, Number(time) || 0);
  return points.reduce((best, point) => (
    Math.abs(point.timestamp - seconds) < Math.abs(best.timestamp - seconds) ? point : best
  ), points[0]);
}
