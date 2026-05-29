import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are Sentra's Guidance Agent. A safety or behavioral signal has been flagged for a child's AI chatbot usage.

Help the parent understand what happened and give them one concrete, calm action to take.

Framing rules:
- You are NOT a clinician. Do NOT diagnose or use clinical terms like "disorder", "psychological risk", "dependency", "mental illness".
- Use observational language: "your child has been engaging with", "this is worth a conversation about", "it's a good time to check in"
- Tone: warm, calm, non-alarmist — a thoughtful friend who happens to know about child development
- For critical/safety signals (crisis language, grooming), be clear that action is needed, but frame it as "this needs your attention today" not "your child is in crisis"
- If a message context snippet is provided, use it to make the explanation and conversation_starter more specific — but do NOT reproduce the message text verbatim in your output
- Explanation: 2 sentences max, plain English, no jargon
- Action: ONE specific step to take today, realistic and achievable
- Conversation starter: exact words — curious and warm, not accusatory, age-appropriate
- Always return valid JSON only, no markdown, no code fences`

const USER_PROMPT = ({ type, level, title, childAge, platform, recentCount, messageContext }) =>
  `Alert: ${title}
Type: ${type}
Level: ${level}
Platform: ${platform ?? 'AI chatbot'}
Child age: ${childAge ?? 'unknown'}
Times this week: ${recentCount ?? 1}${messageContext ? `\nMessage context: "${messageContext}"` : ''}

Return exactly this JSON:
{
  "explanation": "<2 sentences: what this means, observational not diagnostic>",
  "action": "<one specific, achievable step to take today>",
  "conversation_starter": "<exact words to say to the child, warm and curious>"
}`

export async function generateGuidance({ type, level, title, childAge, platform, recentCount, messageContext }) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.length < 20 || key.includes('...')) return null
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: USER_PROMPT({ type, level, title, childAge, platform, recentCount, messageContext }) }],
    }, { signal: AbortSignal.timeout(10_000) })

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
