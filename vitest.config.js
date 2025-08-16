import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  globals: true,
    include: [
      '**/__tests__/**/*.{js,jsx,ts,tsx}',
      '**/*.{spec,test}.{js,jsx,ts,tsx}',
      '**/test_*.js'
    ],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['js/**/*.js', 'app.js'],
      exclude: ['js/**/*.test.js', 'js/node_modules/**']
    }
  }
})
