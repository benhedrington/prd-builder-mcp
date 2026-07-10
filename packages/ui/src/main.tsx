/**
 * UI entry point — renders the App into the iframe's DOM.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('prd-builder-root');
if (!container) {
  throw new Error('Root element #prd-builder-root not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
