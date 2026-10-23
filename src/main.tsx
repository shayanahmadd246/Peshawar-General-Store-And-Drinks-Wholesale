import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ConnectivityBanner, ConnectivityProvider } from './ux/connectivity';
import { registerShellWorker } from './ux/registerShellWorker';

registerShellWorker();

createRoot(document.getElementById('root')!).render(
  <ConnectivityProvider>
    <ConnectivityBanner />
    <App />
  </ConnectivityProvider>
);
