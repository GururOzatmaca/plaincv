import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Renamed off /assets once: clients that cached an HTML fallback under the old
  // immutable asset URLs can only recover through a URL they have never seen.
  build: { assetsDir: 'static' },
  // The exporter loads these lazily, so vite would only meet them mid-session and force a
  // full reload to pre-bundle them - which kills whatever the page was doing at the time.
  optimizeDeps: { include: ['pdf-lib', '@pdf-lib/fontkit'] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
