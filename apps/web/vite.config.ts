import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 18931,
    proxy: {
      '/health': {
        target: 'http://127.0.0.1:18930',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:18930',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
