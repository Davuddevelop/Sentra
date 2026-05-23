/**
 * Sentra Growth Insights Agent
 *
 * Analyzes a child's AI chatbot usage patterns over the past 30 days and
 * generates a positive developmental snapshot for parents.
 *
 * Framing: curiosity, interests, thinking style, growth — NOT clinical assessment.
 * This is observational intelligence, not diagnosis. We are not clinicians.
 */

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You are Sentra's Child Development Insights agent. Your job is to help parents understand their child's curiosity, interests, and thinking patterns based on how they use AI chatbots — not to flag problems.

You receive behavioral metadata about a child's AI usage over the past month (never message content). You generate a monthly developmental snapshot: what they've been curious about, how they think and explore, how their engagement is evolving.

Core rules:
- You are NOT a clinician. NEVER make diagnostic statements.
- NEVER use: "disorder", "dependency", "risk", "concerning", "psychological", "mental health issue", "problem", "worrying".
- ALWAYS use: "curious about", "exploring", "drawn to", "engaged with", "thinking about", "developing interest in", "shows a pattern of".
- If the child had safety signals (crisis, grooming, abuse) — do NOT include those in growth insights. Those are separate safety alerts. Focus only on intellectual and emotional development patterns.
- Be warm and genuinely insightful. Parents love hearing about how their child's mind works.
- If there is not enough data to say something meaningful, return null for that field — don't fabricate.
- Keep all text parent-readable: friendly, specific, not generic.

Return valid JSON only — no markdown, no code fences.`

const USER_PROMPT = ({ childName, childAge, appUsage, topicSignals, sessionPatterns, alertTitles }) =>
  `Generate a monthly developmental insight snapshot for ${childName} (age ${childAge ?? 'unknown'}).

AI app usage this month:
${JSON.stringify(appUsage, null, 2)}

Topics and categories that came up (from behavioral signals):
${JSON.stringify(topicSignals, null, 2)}

Session patterns:
${JSON.stringify(sessionPatterns, null, 2)}

Recent signal context (titles only, for topic understanding):
${alertTitles.slice(0, 15).join('\n')}

Return exactly this JSON:
{
  "interests": ["<2-5 specific interest areas based on evidence, e.g. 'How AI systems think', 'Creative storytelling', 'Questions about identity'>"],
  "thinking_style": "<2-3 sentences describing how this child approaches exploration and learning, based on their patterns>",
  "curiosity_themes": ["<2-4 recurring themes or questions this child seems to be exploring>"],
  "growth_narrative": "<2-3 sentences: a warm, specific summary of this child's development this month that a parent would love to read>",
  "engagement_pattern": "<1 sentence: when and how they tend to engage most deeply>",
  "conversation_prompts": ["<2-3 questions parents could ask to connect with their child around these interests>"]
}`

export async function generateGrowthInsights({
  childName,
  childAge,
  appUsage,        // { 'ChatGPT': 12, 'Character.AI': 8 } — session counts per app
  topicSignals,    // { 'diet_restriction': 2, 'weapon': 0, 'creative': 5 } — topic categories
  sessionPatterns, // { avgSessionMins: 22, lateNightCount: 3, totalSessions: 30 }
  alertTitles,     // string[] — AI-enriched alert titles for context
}) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.length < 20 || key.includes('...')) return null

  // Need at least a few sessions to say something meaningful
  const totalSessions = Object.values(appUsage).reduce((s, n) => s + n, 0)
  if (totalSessions < 3) return null

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: 'user', content: USER_PROMPT({ childName, childAge, appUsage, topicSignals, sessionPatterns, alertTitles }) }],
    }, { signal: AbortSignal.timeout(15_000) })

    const text = msg.content[0]?.text?.trim()
    if (!text) return null
    const parsed = JSON.parse(text)

    // Validate required fields
    if (!parsed.growth_narrative || !Array.isArray(parsed.interests)) return null
    return parsed
  } catch (err) {
    console.error('[GrowthAgent]', err.message)
    return null
  }
}
