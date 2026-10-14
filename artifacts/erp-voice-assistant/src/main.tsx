import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import { appBasePath } from '@/lib/app-path';
import { registerServiceWorker } from '@/lib/pwa';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

setBaseUrl(appBasePath || null);
registerServiceWorker(appBasePath);

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
