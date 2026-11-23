import React, { Suspense, lazy, useEffect, useState } from 'react';
import { FrontDoor } from './app/FrontDoor.jsx';
import { WorldHome } from './world/WorldHome.jsx';
import { appRoute } from './world/worldRoute.js';

// The front door and World Builder are small; the rest of the site loads on demand.
const AppShell = lazy(() => import('./app/AppShell.jsx').then(m => ({ default: m.AppShell })));

function currentRoute() {
  return appRoute(window.location.pathname, window.location.search, window.location.hash);
}

export default function App() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const sync = () => setRoute(currentRoute());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  if (route === 'home') return <FrontDoor />;
  if (route === 'world') return <WorldHome />;
  return <Suspense fallback={null}><AppShell /></Suspense>;
}
