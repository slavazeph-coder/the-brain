import React, { useEffect, useState } from 'react';
import { AppShell } from './app/AppShell.jsx';
import { WorldHome } from './world/WorldHome.jsx';
function isWorldRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return (path === '/' && new URLSearchParams(window.location.search).get('classic') !== '1') || path === '/world';
}
export default function App() {
  const [world, setWorld] = useState(isWorldRoute);
  useEffect(() => { const sync = () => setWorld(isWorldRoute()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  return world ? <WorldHome /> : <AppShell />;
}
