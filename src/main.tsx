import './utils/preBootstrap';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { StartupLoader } from './components/StartupLoader';
import { FirebaseProvider } from './contexts/FirebaseContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <FirebaseProvider>
    <StartupLoader>
      <App />
    </StartupLoader>
  </FirebaseProvider>
);
