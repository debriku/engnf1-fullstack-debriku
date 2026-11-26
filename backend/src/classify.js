// Deterministic auto-triage (T-B1). Category rules are checked in the order listed in the brief.
const has = (t, words) => words.some((w) => t.includes(w));
export function classify(subject, body) {
  const t = `${subject} ${body}`.toLowerCase();
  let category = 'FEATURE_REQUEST';
  if (has(t, ['refund', 'invoice', 'charge', 'payment'])) category = 'BILLING';
  else if (has(t, ['password', '2fa', 'sign in', 'locked out', 'login'])) category = 'LOGIN';
  else if (has(t, ['package', 'arrived', 'shipping', 'tracking', 'delivery'])) category = 'DELIVERY';
  else if (has(t, ['crash', 'error', '500', 'exception', 'broken'])) category = 'BUG';
  let priority = 'MEDIUM';
  if (has(t, ['urgent', 'production down', 'locked out'])) priority = 'URGENT';
  else if (has(t, ['error', 'refund', 'not arrived'])) priority = 'HIGH';
  return { category, priority };
}
