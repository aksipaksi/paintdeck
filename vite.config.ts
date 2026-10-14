import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100_000_000 },
  server: { port: 5199 },
  preview: { port: 5198 },
});
