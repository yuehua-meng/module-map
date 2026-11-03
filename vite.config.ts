import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./apps/web', import.meta.url)),
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
