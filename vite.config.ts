import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function emitManifest(): Plugin {
  return {
    name: 'emit-extension-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify({
          manifest_version: 3,
          name: 'Chrome Excel Transformer',
          version: '0.1.0',
          action: {
            default_title: 'Abrir Chrome Excel Transformer',
          },
          background: {
            service_worker: 'service-worker.js',
          },
        }, null, 2),
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
