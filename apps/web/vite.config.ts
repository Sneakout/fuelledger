import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  envDir: '../..',
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: asset => asset.name === 'eng.traineddata.gz'
          ? 'assets/ocr/eng.traineddata.gz'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: './src/test-setup.ts' },
});
