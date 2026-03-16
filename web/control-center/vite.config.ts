import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist-web/control-center'),
    emptyOutDir: true,
  },
});
