import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Flame, Medal, Star, Trophy } from 'lucide-react';

const STORAGE_KEY = 'gaugegap-arcade-progress-v1';

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function yesterdayKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return dateKey(date);
}

function readProgress() {
  if (typeof window === 'undefined') return { visited: [], xp: 0, streak: 0, lastVisit: '', dailyWins: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      visited: Array.isArray(parsed.visited) ? parsed.visited : [],
      xp: Number(parsed.xp) || 0,
      streak: Number(parsed.streak) || 0,
      lastVisit: parsed.lastVisit || '',
      dailyWins: Array.isArray(parsed.dailyWins) ? parsed.dailyWins : [],
    };
  } catch {
    return { visited: [], xp: 0, streak: 0, lastVisit: '', dailyWins: [] };
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
    const today = dateKey();
    setProgress((current) => {
      const firstVisit = !current.visited.includes(id);
      const firstToday = current.lastVisit !== today;
      const dailyWin = id === dailyLab?.id && !current.dailyWins.includes(today);
      let streak = current.streak;
      if (firstToday) streak = current.lastVisit === yesterdayKey() ? Math.max(1, current.streak + 1) : 1;
      return {
        visited: firstVisit ? [...current.visited, id] : current.visited,
        xp: current.xp + (firstVisit ? 25 : 2) + (dailyWin ? 50 : 0),
        streak,
        lastVisit: today,
        dailyWins: dailyWin ? [...current.dailyWins.slice(-29), today] : current.dailyWins,
      };
    });
  }, [dailyLab?.id]);

  const level = Math.floor(progress.xp / 125) + 1;
  const levelProgress = progress.xp % 125;
  const achievements = useMemo(() => [
    { id: 'first', label: 'First Contact', unlocked: progress.visited.length >= 1 },
    { id: 'sampler', label: 'System Sampler', unlocked: progress.visited.length >= 4 },
    { id: 'polymath', label: 'Arcade Polymath', unlocked: progress.visited.length >= 8 },
    { id: 'completionist', label: 'Foundry Completionist', unlocked: progress.visited.length >= experiments.length },
    { id: 'streak', label: 'Three-Day Signal', unlocked: progress.streak >= 3 },
    { id: 'daily', label: 'Daily Challenger', unlocked: progress.dailyWins.length >= 3 },
  ], [experiments.length, progress.dailyWins.length, progress.streak, progress.visited.length]);

  return { progress, recordVisit, dailyLab, level, levelProgress, achievements };
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
