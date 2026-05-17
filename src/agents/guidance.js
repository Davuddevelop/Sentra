import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are Sentra's Guidance Agent. A behavioral alert has been triggered for a child's AI chatbot usage.

Help the parent understand what happened and give them one concrete action.

Rules:
- Warm, calm, non-alarmist tone — parents are worried, not adversaries
- Explanation: 2 sentences max, plain English, no jargon
- Action: ONE specific step to take today, not generic advice
- Conversation starter: exact words — curious, not accusatory, age-appropriate
- Always return valid JSON only, no markdown, no code fences`

const USER_PROMPT = ({ type, level, title, childAge, platform, recentCount }) =>
  `Alert: ${title}
Type: ${type}
Level: ${level}
Platform: ${platform ?? 'AI chatbot'}
Child age: ${childAge ?? 'unknown'}
Times this week: ${recentCount ?? 1}

Return exactly this JSON:
{
  "explanation": "<2 sentences: what this means for a parent>",
  "action": "<one specific step to take today>",
  "conversation_starter": "<exact words to say to the child>"
}`

export async function generateGuidance({ type, level, title, childAge, platform, recentCount }) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.length < 20 || key.includes('...')) return null
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: USER_PROMPT({ type, level, title, childAge, platform, recentCount }) }],
    })
    const text = msg.content[0]?.text?.trim()
    if (!text) return null
    const parsed = JSON.parse(text)
    if (!parsed.explanation || !parsed.action || !parsed.conversation_starter) return null
    return parsed
  } catch (err) {
    console.error('[GuidanceAgent]', err.message)
    return null
  }
}
