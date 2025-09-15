import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    port: 4173,
    host: true
  },
  server: {
    port: 5173,
    host: true
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  define: {
    global: 'globalThis',
  },
  // Configuration pour l'API widget-status
  configureServer(server) {
    server.middlewares.use('/api/widget-status', async (req, res, next) => {
      if (req.method === 'GET') {
        try {
          // Local function to avoid importing client-side code during build
          const getWidgetStatus = async () => {
            return { enabled: true };
          };
          
          const status = await getWidgetStatus();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify(status));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ enabled: true, error: error.message }));
        }
      } else {
        next();
      }
    });
  }
});