import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:      'index.html',
        dashboard: 'dashboard.html',
      }
    }
  },
  server: {
    port: 8000,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true }
    }
  }
})
