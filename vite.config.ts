import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs/dist',
    emptyOutDir: true,
  },
});
