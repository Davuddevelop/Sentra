import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are Sentra's Insights Agent. You analyze a child's weekly behavioral signal data.

Give parents an honest, calibrated picture of the week — not alarming, not dismissive.

Rules:
- trend must be exactly: "escalating", "stable", or "improving"
- patterns: 2-3 short, specific observations (what changed, what's new, what's consistent)
- summary: 2-3 sentence plain-English paragraph — what the parent most needs to know
- Don't catastrophize normal teen curiosity
- Always return valid JSON only, no markdown, no code fences`

export async function generateInsights({ childName, childAge, typeCounts, criticalCount, warnCount, totalSignals }) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-...')) return null
  if (totalSignals === 0) return null
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Weekly data for ${childName} (age ${childAge ?? 'unknown'}):
Signal counts by type: ${JSON.stringify(typeCounts)}
Critical alerts this week: ${criticalCount}
Warning alerts this week: ${warnCount}
Total signals: ${totalSignals}

Return exactly this JSON:
{
  "trend": "<escalating|stable|improving>",
  "patterns": ["<observation 1>", "<observation 2>"],
  "summary": "<2-3 sentence plain-English summary for a parent>"
}`,
      }],
    })
    const text = msg.content[0]?.text?.trim()
    if (!text) return null
    const parsed = JSON.parse(text)
    if (!['escalating', 'stable', 'improving'].includes(parsed.trend)) return null
    return parsed
  } catch (err) {
    console.error('[InsightsAgent]', err.message)
    return null
  }
}
