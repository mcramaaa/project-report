import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // SWC emits the decorator metadata Nest DI needs; esbuild does not.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
