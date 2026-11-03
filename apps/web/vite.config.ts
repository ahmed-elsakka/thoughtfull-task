import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api':
        mode === 'e2e' ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:3000',
    },
  },
}));
