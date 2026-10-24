#!/usr/bin/env node

import { runMcpCli } from '../lib/mcp.js'

runMcpCli().catch(() => {
  process.stderr.write('mobile-mirror MCP server failed to start\n')
  process.exitCode = 1
})
