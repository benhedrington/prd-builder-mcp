import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'packages/ui'),
  build: {
    outDir: resolve(__dirname, 'packages/ui/dist'),
    lib: {
      entry: resolve(__dirname, 'packages/ui/src/main.tsx'),
      formats: ['es'],
      fileName: 'main',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'assets/main.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@prd-builder/shared': resolve(__dirname, 'packages/shared/src/types.ts'),
      '@prd-builder/engine': resolve(__dirname, 'packages/prd-engine/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
