import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state/AppState';
import { ErrorBoundary } from './components/ErrorBoundary';
import { attachGlobalErrorHandlers, logger } from './lib/logger';
import './index.css';

attachGlobalErrorHandlers();
logger.info('app', 'started');

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
