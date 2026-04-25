import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { execSync } from 'child_process'

/**
 * Runs the standard agentic loop for a Claude agent.
 * Keeps calling the API, executing tools, and feeding results back
 * until the model returns stop_reason === 'end_turn'.
 */
export async function runAgentLoop(client, model, systemPrompt, userMessage, tools) {
  const messages = [{ role: 'user', content: userMessage }]

  while (true) {
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      tools,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text')
      return textBlock?.text ?? ''
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(block => {
          let content
          try {
            content = String(executeFileTool(block.name, block.input))
          } catch (err) {
            content = `Error: ${err.message}`
          }
          return { type: 'tool_result', tool_use_id: block.id, content }
        })

      messages.push({ role: 'user', content: toolResults })
    }
  }
}

export function executeFileTool(name, input) {
  switch (name) {
    case 'read_file':
      return readFileSync(input.path, 'utf-8')

    case 'write_file':
      writeFileSync(input.path, input.content, 'utf-8')
      return `Written: ${input.path}`

    case 'run_bash':
      return execSync(input.command, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      })

    case 'list_files':
      return readdirSync(input.dir).join('\n')

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
