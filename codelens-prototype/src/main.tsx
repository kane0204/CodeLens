import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state/AppState';
import { ErrorBoundary } from './components/ErrorBoundary';
import { attachGlobalErrorHandlers } from './lib/logger';
import './index.css';

attachGlobalErrorHandlers();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
