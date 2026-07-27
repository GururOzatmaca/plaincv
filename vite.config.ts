import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Renamed off /assets once: clients that cached an HTML fallback under the old
  // immutable asset URLs can only recover through a URL they have never seen.
  build: { assetsDir: 'static' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
