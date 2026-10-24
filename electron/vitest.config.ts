import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __VN_FLAVOR__: JSON.stringify('normal') },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
