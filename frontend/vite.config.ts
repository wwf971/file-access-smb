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

const appBasePath = normalizeBasePath(process.env.VITE_APP_BASE_PATH)

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
