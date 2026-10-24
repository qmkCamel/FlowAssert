import { existsSync } from 'node:fs'
import { chromium, defineConfig } from '@playwright/test'

const bundledChromium = chromium.executablePath()
const macOsChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const fallbackExecutable = existsSync(bundledChromium)
  ? undefined
  : existsSync(macOsChrome)
    ? macOsChrome
    : undefined

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      args: ['--disable-gpu'],
      ...((process.env.MM_BROWSER_EXECUTABLE ?? fallbackExecutable) ? { executablePath: process.env.MM_BROWSER_EXECUTABLE ?? fallbackExecutable! } : {}),
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
})
