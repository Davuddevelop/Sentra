import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are Sentra's AI safety engine. You analyze behavioral signals from children's AI chatbot usage and help parents understand what's happening — without making clinical or diagnostic statements.

You receive signal metadata (never message content). You return a structured assessment for parents.

Framing rules:
- You are NOT a clinician. Never diagnose. Never use terms like "disorder", "dependency", "psychological risk", or "mental health crisis".
- Use observational language: "shows a pattern of", "has been engaging with", "appears drawn to", "worth a conversation about"
- "ok" = normal, no concern
- "info" = worth noting, no action needed
- "warn" = parent should check in with their child
- "critical" = parent should act today (safety concern: grooming, crisis, abuse)

Critical signals (crisis language, grooming, abuse) should be flagged clearly but as a SAFETY alert, not a diagnosis.

Keep title under 60 chars. Keep body under 120 chars, plain language for non-technical parents.
Always return valid JSON only — no markdown, no explanation outside the JSON.`

const USER_PROMPT = (type, payload, context) => `Analyze this behavioral signal and return a JSON risk assessment.

Signal type: ${type}
Payload: ${JSON.stringify(payload, null, 2)}
Context: ${JSON.stringify(context, null, 2)}

Return this exact JSON shape:
{
  "risk_score": <integer 0-100>,
  "level": "<ok|info|warn|critical>",
  "title": "<short title for the parent>",
  "body": "<one sentence for the parent, observational not diagnostic>",
  "reasoning": "<internal reasoning, 1-2 sentences>"
}`

export async function analyzeSignal(type, payload = {}, context = {}) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.length < 20 || key.includes('...')) {
    return null // fall back to rule-based scoring
  }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT(type, payload, context) }],
    }, { signal: AbortSignal.timeout(10_000) })

    const text = message.content[0]?.text?.trim()
    if (!text) throw new Error('Empty AI response')
    const parsed = JSON.parse(text)

    const VALID_LEVELS = ['ok', 'info', 'warn', 'critical']
    if (
      typeof parsed.risk_score !== 'number' ||
      !VALID_LEVELS.includes(parsed.level) ||
      !parsed.title ||
      !parsed.body
    ) {
      throw new Error('Invalid AI response shape')
    }
    parsed.risk_score = Math.max(0, Math.min(100, parsed.risk_score))

    return parsed
  } catch (err) {
    console.error('[AI analyzer]', err.message)
    return null
  }
}
