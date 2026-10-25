import React from 'react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';

const TASKS = [
  {
    id: 'tabletop-pick',
    title: 'Tabletop Pick & Place',
    robot: 'Franka Panda / SO-101',
    description: 'Grasp a target block under randomised pose offsets and place it inside the goal fixture.',
  },
  {
    id: 'deformable-rope',
    title: 'Deformable Cable Routing',
    robot: 'ALOHA Bimanual',
    description: 'Guide a compliant rope through two retaining clips without exceeding tension limits.',
  },
  {
    id: 'mobile-fetch',
    title: 'Warehouse Aisle Navigation',
    robot: 'Unitree Go2 / Stretch 3',
    description: 'Navigate dynamic obstacles and dock at the designated inspection waypoint.',
  },
];

export function ArenaTasks() {
  return (
    <div className="bh-site" data-testid="arena-tasks">
      <PublicNav active="arena" />
      <main className="lab-index">
        <p className="bh-kicker">ROBOT ARENA BENCHMARKS</p>
        <h1>Arena Evaluation Tasks</h1>
        <p>Standardised robot manipulation and locomotion tasks with deterministic episode seeds and replay verification.</p>
        <div className="lab-cards">
          {TASKS.map((task) => (
            <article key={task.id} className="lab-card">
              <p className="bh-kicker">{task.robot}</p>
              <h2>{task.title}</h2>
              <p>{task.description}</p>
              <a href="/arena/">Launch in Arena →</a>
            </article>
          ))}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
