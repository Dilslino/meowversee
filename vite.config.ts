import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/magnific': {
        target: 'https://api.magnific.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/magnific/, ''),
      },
    },
  },
});
