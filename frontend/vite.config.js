import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // ESP32-CAM photos (Phase 10) are served by Express. Proxying them the
      // same way keeps the browser on one origin in development, so the
      // relative /uploads/... URL works in dev and on a deployed same-origin
      // backend without the frontend ever knowing the difference.
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Dev requests to /api are forwarded to the Express server. This keeps the
      // browser on a single origin, so CORS cannot break development -- the most
      // common "it worked yesterday" failure in a split frontend/backend setup.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        // Forward cookies properly through the proxy
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Remove the host header so the backend doesn't get confused
            proxyReq.removeHeader('x-forwarded-for');
          });
        },
      },
    },
  },
});
