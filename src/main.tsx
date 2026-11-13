import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { StartupLoader } from './components/StartupLoader';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StartupLoader>
    <App />
  </StartupLoader>
);
