import Anthropic from '@anthropic-ai/sdk'
import { runAgentLoop } from './utils.js'
import { FILE_TOOLS } from './tools.js'

const REPO_ROOT = '/home/user/Sentra'

const SYSTEM_PROMPT = `You are a senior Node.js engineer working on Sentra — a parental AI monitoring SaaS at ${REPO_ROOT}.

Stack: Express 5, Vanilla JS + Vite frontend, LibSQL/Turso (via @libsql/client), @anthropic-ai/sdk, Stripe, Nodemailer. Pure ESM.

Conventions you must follow:
- All DB calls use the async compatibility wrapper: db.prepare(sql).get/all/run(...args) — all return Promises
- Routes always use requireAuth / requireFamily middleware from src/middleware/auth.js
- Plan limits live in src/config/plans.js — import from there, never hardcode
- No TypeScript. No comments unless explaining a non-obvious invariant.
- Error responses: res.status(4xx).json({ error: 'message' })
- Background work (email, push): fire with setImmediate(() => fn().catch(console.error))

Process:
1. Read the relevant files first — understand the existing pattern
2. Implement following that pattern exactly
3. Write the file
4. Report exactly what changed and why`

export async function runCoderAgent(task) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return runAgentLoop(client, 'claude-sonnet-4-6', SYSTEM_PROMPT, task, FILE_TOOLS)
}
