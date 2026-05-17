import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are Sentra's AI safety engine. Your job is to analyze behavioral signals from children's devices and assess risk for parents.

You receive a signal type and payload describing a behavioral pattern (never message content — only metadata and usage patterns). You return a structured risk assessment.

Rules:
- Be objective and calibrated. Not every signal is serious.
- "ok" = normal behavior, no concern
- "info" = worth noting, no immediate action
- "warn" = parent should be aware and may want to check in
- "critical" = requires immediate parent attention

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
  "body": "<one sentence explanation for the parent>",
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
    })

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
    // Clamp risk_score to valid range
    parsed.risk_score = Math.max(0, Math.min(100, parsed.risk_score))

    return parsed
  } catch (err) {
    console.error('[AI analyzer]', err.message)
    return null // fall back to rule-based scoring on any error
  }
}
