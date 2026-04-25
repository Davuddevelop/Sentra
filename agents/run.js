#!/usr/bin/env node
import 'dotenv/config'
import { runOrchestrator } from './orchestrator.js'

const task = process.argv.slice(2).join(' ').trim()

if (!task) {
  console.error(`
Usage: node agents/run.js "<task>"

Examples:
  node agents/run.js "write Vitest tests for src/routes/auth.js"
  node agents/run.js "add rate limiting to POST /api/signal — max 100 per device per minute"
  node agents/run.js "audit src/routes/dashboard.js for IDOR vulnerabilities"
  node agents/run.js "create extension/content/discord.js following the chatgpt.js pattern"
  node agents/run.js "review the signals route for missing input validation"
`)
  process.exit(1)
}

const key = process.env.ANTHROPIC_API_KEY
if (!key || key.startsWith('sk-ant-...')) {
  console.error('Error: ANTHROPIC_API_KEY is not set in .env')
  console.error('Get your key at console.anthropic.com and add it to .env')
  process.exit(1)
}

console.log(`\nTask: "${task}"`)
console.log('─'.repeat(60))

try {
  const result = await runOrchestrator(task)
  console.log('\n' + '─'.repeat(60))
  console.log(result)
} catch (err) {
  console.error('\n[Error]', err.message)
  if (err.status === 401) {
    console.error('→ Invalid ANTHROPIC_API_KEY')
  } else if (err.status === 429) {
    console.error('→ Rate limit hit — wait a moment and retry')
  }
  process.exit(1)
}
