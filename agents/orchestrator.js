import Anthropic from '@anthropic-ai/sdk'
import { executeFileTool } from './utils.js'
import { runCoderAgent } from './coder.js'
import { runTestWriterAgent } from './test-writer.js'
import { runSecurityAgent } from './security.js'
import { runReviewerAgent } from './reviewer.js'

const REPO_ROOT = '/home/user/Sentra'

const ORCHESTRATOR_TOOLS = [
  {
    name: 'dispatch_coder',
    description: 'Send a task to the Coder agent. Use for: implementing features, fixing bugs, refactoring, adding routes, modifying existing files.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Full task description with all context the Coder needs — file paths, expected behavior, conventions to follow.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'dispatch_test_writer',
    description: 'Send a task to the Test Writer agent. Use for: writing Vitest unit or integration tests for any module or route.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to test — include the target file path and any specific scenarios to cover.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'dispatch_security',
    description: 'Send a task to the Security Auditor agent. Use for: OWASP audits, finding auth gaps, checking input validation, COPPA compliance review.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to audit — include specific file paths or "full codebase" for a broad audit.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'dispatch_reviewer',
    description: 'Send a task to the Code Reviewer agent. Use for: reviewing recent changes, validating a new implementation, checking convention compliance.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What to review — include file paths and what was recently changed.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file to understand the codebase before dispatching to agents.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory to understand structure.',
    input_schema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Absolute directory path' },
      },
      required: ['dir'],
    },
  },
  {
    name: 'run_bash',
    description: 'Run a read-only bash command (grep, find, git log, etc.) to explore the codebase.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Bash command' },
      },
      required: ['command'],
    },
  },
]

const SYSTEM_PROMPT = `You are the orchestrator of a dev agent team working on Sentra — a Node.js parental AI monitoring SaaS at ${REPO_ROOT}.

Your team:
- Coder agent: implements features, fixes bugs, reads/writes files
- Test Writer agent: writes Vitest unit tests for any module
- Security agent: OWASP audits, auth gap detection, COPPA compliance checks
- Reviewer agent: code review, convention validation

You also have read_file, list_files, and run_bash tools to explore the repo yourself.

Process:
1. Explore the relevant parts of the codebase to understand the task fully
2. Break complex tasks into subtasks — assign each to the right specialist
3. Dispatch independent subtasks in PARALLEL (multiple dispatch calls in one response)
4. Synthesize results into a clear summary of what was done

Always explore before dispatching. Give each agent enough context so it doesn't have to re-read things you already know.
Be the senior engineer who delegates intelligently, not the one who throws tasks over the wall.`

export async function runOrchestrator(task) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const messages = [{ role: 'user', content: task }]

  while (true) {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: ORCHESTRATOR_TOOLS,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text')
      return textBlock?.text ?? ''
    }

    if (response.stop_reason === 'tool_use') {
      const toolBlocks = response.content.filter(b => b.type === 'tool_use')

      // Run all tool calls in parallel — agent dispatches run concurrently
      const results = await Promise.all(
        toolBlocks.map(async block => {
          let content
          try {
            content = String(await dispatchTool(block.name, block.input))
          } catch (err) {
            content = `Error: ${err.message}`
          }
          return { type: 'tool_result', tool_use_id: block.id, content }
        })
      )

      messages.push({ role: 'user', content: results })
    }
  }
}

async function dispatchTool(name, input) {
  switch (name) {
    case 'dispatch_coder':
      console.log('\n[Coder] →', input.task.slice(0, 80) + '...')
      return runCoderAgent(input.task)

    case 'dispatch_test_writer':
      console.log('\n[Test Writer] →', input.task.slice(0, 80) + '...')
      return runTestWriterAgent(input.task)

    case 'dispatch_security':
      console.log('\n[Security] →', input.task.slice(0, 80) + '...')
      return runSecurityAgent(input.task)

    case 'dispatch_reviewer':
      console.log('\n[Reviewer] →', input.task.slice(0, 80) + '...')
      return runReviewerAgent(input.task)

    // File exploration tools handled by shared executor
    default:
      return executeFileTool(name, input)
  }
}
