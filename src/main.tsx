import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { StartupLoader } from './components/StartupLoader';
import './index.css';

const hidePreSplash = () => {
  const pre = document.getElementById('pre-splash');
  if (!pre) return;
  pre.classList.add('hidden');
  window.setTimeout(() => {
    pre.style.display = 'none';
  }, 200);
};

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(
  <StartupLoader>
    <App />
  </StartupLoader>
);

hidePreSplash();
