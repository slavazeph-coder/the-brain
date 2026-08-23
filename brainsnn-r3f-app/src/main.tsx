import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/tokens.css';
import './styles/utilities.css';
import './styles/arcade-home.css';
import './styles/multimodal.css';
import './styles/creative-readout.css';
import './styles/client-multimodal.css';
import './styles/belief-report.css';
import './styles/outcome-learning.css';
import './styles/neural-visual-pass.css';
import './styles/neural-visual-motion.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
