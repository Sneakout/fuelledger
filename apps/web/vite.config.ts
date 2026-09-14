import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  envDir: '../..',
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Tesseract appends `eng.traineddata.gz` to langPath at runtime.
        // Keep the directory versioned so this fixed filename can be cached immutably.
        assetFileNames: asset => asset.name === 'eng.traineddata.gz'
          ? 'assets/ocr/v1/eng.traineddata.gz'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: { environment: 'jsdom', setupFiles: './src/test-setup.ts' },
});
