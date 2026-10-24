#!/usr/bin/env node

import { runOnboardingCli } from '../lib/onboarding-cli.js'

process.exitCode = await runOnboardingCli()
