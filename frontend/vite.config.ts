import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const normalizeBasePath = (rawBasePath: string | undefined): string => {
  const trimmed = `${rawBasePath ?? ''}`.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

const APP_BASE_ASSET_PLACEHOLDER = '/__APP_BASE__/'
const appBasePath = process.env.VITE_APP_BASE_PATH
  ? normalizeBasePath(process.env.VITE_APP_BASE_PATH)
  : APP_BASE_ASSET_PLACEHOLDER

export default defineConfig({
  base: appBasePath,
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    proxy: {
      '/file-access-point': {
        target: 'http://127.0.0.1:9400',
        changeOrigin: true,
        ws: true,
      },
      '/login': {
        target: 'http://127.0.0.1:9400',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:9400',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../build',
    emptyOutDir: true,
  },
})
