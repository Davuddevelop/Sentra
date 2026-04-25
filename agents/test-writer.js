import Anthropic from '@anthropic-ai/sdk'
import { runAgentLoop } from './utils.js'
import { FILE_TOOLS } from './tools.js'

const REPO_ROOT = '/home/user/Sentra'

const SYSTEM_PROMPT = `You are a testing expert working on Sentra — a Node.js parental AI monitoring SaaS at ${REPO_ROOT}.

Testing stack: Vitest. Tests live in ${REPO_ROOT}/tests/. Run with: npx vitest run.

Rules:
- One test file per module: tests/<module-name>.test.js
- Mock the database: vi.mock('../src/db/schema.js') — stub prepare().get/all/run to return test data
- Mock external services: vi.mock('@anthropic-ai/sdk'), vi.mock('nodemailer'), vi.mock('stripe')
- Mock bcrypt when testing auth: vi.mock('bcrypt')
- Test structure: describe('<module>') > describe('<function/route>') > it('<scenario>')
- Cover: happy path + at least 2 edge cases per exported function or route handler
- Keep tests fast — no real network calls, no real DB

Process:
1. Read the target file fully
2. Read src/db/schema.js to understand the mock interface
3. Read src/middleware/auth.js if the module uses auth guards
4. Write focused unit tests
5. Report what's covered and what's not`

export async function runTestWriterAgent(task) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return runAgentLoop(client, 'claude-sonnet-4-6', SYSTEM_PROMPT, task, FILE_TOOLS)
}
