import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

export const extensionRoutes = [{ path: '/app.html', element: App }];

export function mountApplication(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

const root = document.getElementById('root');
if (root) mountApplication(root);
