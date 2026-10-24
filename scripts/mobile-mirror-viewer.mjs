#!/usr/bin/env node

import { startLocalViewerCli } from '../lib/local-viewer-cli.js'

try {
  const handle = await startLocalViewerCli()
  if (handle) {
    const shutdown = async () => {
      await handle.close()
      process.exit(0)
    }
    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
  }
} catch {
  process.stderr.write('FlowAssert Viewer could not start. Check the local configuration and port.\n')
  process.exitCode = 1
}
