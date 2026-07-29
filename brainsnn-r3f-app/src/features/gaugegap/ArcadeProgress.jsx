import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Flame, Medal, Star, Trophy } from 'lucide-react';
import {
  ACHIEVEMENT_XP,
  applyAchievement,
  applyVisit,
  dateKey,
  emptyProgress,
  levelFor,
  normalizeProgress,
  STORAGE_KEY,
  yesterdayKey,
} from './arcadeProgressCore.js';


function readProgress() {
  if (typeof window === 'undefined') return emptyProgress();
  try {
    return normalizeProgress(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return emptyProgress();
  }
}

function dailyIndex(length) {
  const key = dateKey();
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return length ? hash % length : 0;
}

export function useArcadeProgress(experiments) {
  const [progress, setProgress] = useState(readProgress);
  const dailyLab = experiments[dailyIndex(experiments.length)] || experiments[0];

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

  const recordVisit = useCallback((id) => {
    setProgress((current) => applyVisit(current, {
      id,
      dailyLabId: dailyLab?.id,
      today: dateKey(),
      yesterday: yesterdayKey(),
    }));
  }, [dailyLab?.id]);

  // Pay XP for something the player actually did inside a lab. Idempotent:
  // re-earning an achievement never pays twice.
  const recordAchievement = useCallback((id, options = {}) => {
    setProgress((current) => applyAchievement(current, id, options));
  }, []);

  const { level, levelProgress } = levelFor(progress.xp);
  const achievements = useMemo(() => [
    { id: 'first', label: 'First Contact', unlocked: progress.visited.length >= 1 },
    { id: 'sampler', label: 'System Sampler', unlocked: progress.visited.length >= 4 },
    { id: 'polymath', label: 'Arcade Polymath', unlocked: progress.visited.length >= 8 },
    { id: 'completionist', label: 'Foundry Completionist', unlocked: progress.visited.length >= experiments.length },
    { id: 'streak', label: 'Three-Day Signal', unlocked: progress.streak >= 3 },
    { id: 'daily', label: 'Daily Challenger', unlocked: progress.dailyWins.length >= 3 },
    { id: 'defender', label: 'Held the Line', unlocked: progress.unlocked.includes('defender') },
    { id: 'efficient-defender', label: 'Minimal Intervention', unlocked: progress.unlocked.includes('efficient-defender') },
  ], [experiments.length, progress.dailyWins.length, progress.streak, progress.visited.length, progress.unlocked]);

  return { progress, recordVisit, recordAchievement, dailyLab, level, levelProgress, achievements };
}

export function ArcadeProgress({ progress, level, levelProgress, achievements, dailyLab, onOpenDaily }) {
  const unlocked = achievements.filter((achievement) => achievement.unlocked).length;
  const dailyDone = progress.dailyWins.includes(dateKey());
  return (
    <section className="gg-passport" aria-label="GaugeGap arcade passport">
      <div className="gg-passport-main">
        <div className="gg-passport-level"><Trophy size={20} /><span>Level {level}</span><strong>{progress.xp} XP</strong></div>
        <div className="gg-passport-progress"><span style={{ width: `${Math.max(4, levelProgress / 1.25)}%` }} /></div>
        <small>{125 - levelProgress} XP until the next level · {progress.visited.length} labs explored</small>
      </div>
      <button type="button" className={`gg-daily-card ${dailyDone ? 'complete' : ''}`} onClick={onOpenDaily}>
        <CalendarDays size={19} />
        <span><small>{dailyDone ? 'Daily mission complete' : 'Today’s mission'}</small><strong>{dailyLab?.title || 'Surprise lab'}</strong></span>
        <em>{dailyDone ? 'Done' : '+50 XP'}</em>
      </button>
      <div className="gg-passport-stat"><Flame size={18} /><span><strong>{progress.streak}</strong><small>day streak</small></span></div>
      <div className="gg-passport-stat"><Medal size={18} /><span><strong>{unlocked}/{achievements.length}</strong><small>badges</small></span></div>
      <details className="gg-achievements">
        <summary><Star size={16} /> Achievements</summary>
        <div>{achievements.map((achievement) => <span key={achievement.id} className={achievement.unlocked ? 'unlocked' : ''}>{achievement.label}</span>)}</div>
      </details>
    </section>
  );
}
