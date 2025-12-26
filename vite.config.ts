import { defineConfig } from 'vite';

export default defineConfig({
  base: '/injecute/',
  build: {
    outDir: 'docs/dist',
    emptyOutDir: true,
  },
});
