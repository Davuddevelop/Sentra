import db from '../db/schema.js'

// AI call caps per plan per calendar month
const PLAN_CAPS = {
  starter:       0,    // rule-based only — Claude API never called
  family:        400,  // ~3 kids × 2 devices × 60 signals/mo, generous headroom
  'family-plus': 1500, // unlimited device families, includes growth insights
}

/**
 * Returns true if this family is allowed one more AI call this month.
 * Increments the counter atomically before returning.
 * Returns false if the plan has no AI access or the monthly cap is reached.
 */
export async function checkAndIncrementAiCap(familyId, plan) {
  const cap = PLAN_CAPS[plan] ?? 400
  if (cap === 0) return false

  const currentMonth = new Date().toISOString().slice(0, 7) // YYYY-MM

  const row = await db.prepare(
    'SELECT ai_calls_month, ai_calls_reset_date FROM families WHERE id = ?'
  ).get(familyId)
  if (!row) return false

  let calls = row.ai_calls_month ?? 0
  const storedMonth = (row.ai_calls_reset_date ?? '').slice(0, 7)

  if (storedMonth !== currentMonth) {
    // New month — reset counter
    calls = 0
    await db.prepare(
      'UPDATE families SET ai_calls_month = 0, ai_calls_reset_date = ? WHERE id = ?'
    ).run(currentMonth + '-01', familyId)
  }

  if (calls >= cap) return false

  await db.prepare(
    'UPDATE families SET ai_calls_month = ai_calls_month + 1 WHERE id = ?'
  ).run(familyId)
  return true
}
