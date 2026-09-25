import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 47195,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:47191',
        changeOrigin: true,
      },
      // Product image uploads are served by the backend from /uploads
      '/uploads': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:47191',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
