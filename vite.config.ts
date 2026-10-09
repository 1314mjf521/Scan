import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const httpsEnabled = env.DEV_HTTPS === 'true'
  const certPath = env.DEV_HTTPS_CERT || 'certs/local/server.crt'
  const keyPath = env.DEV_HTTPS_KEY || 'certs/local/server.key'

  return {
    plugins: [react()],
    server: {
      host: env.DEV_HOST || 'localhost',
      // EN: Development HTTPS is opt-in so local setup works without private certificates.
      // 中文：开发 HTTPS 采用显式启用，避免本地没有私有证书时无法启动。
      https: httpsEnabled ? { cert: readFileSync(resolve(certPath)), key: readFileSync(resolve(keyPath)) } : undefined,
      proxy: { '/api': 'http://localhost:3001' },
    },
  }
})
