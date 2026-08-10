import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

export const extensionRoutes = [{ path: '/app.html', element: App }];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
