import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

export function loadExtensionManifest(): string {
  return readFileSync(resolve(__dirname, 'src/extension/manifest.json'), 'utf8');
}

function emitManifest(): Plugin {
  return {
    name: 'emit-extension-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: loadExtensionManifest(),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), emitManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'app.html'),
        serviceWorker: resolve(__dirname, 'src/extension/service-worker.ts'),
      },
      output: {
        entryFileNames: ({ name }) => name === 'serviceWorker' ? 'service-worker.js' : 'assets/[name].js',
      },
    },
  },
});
