// Input payload for the "Re-import feed" button. It is sent to POST /api/tickets/import; nothing here is rendered directly.
// SEED-001 and SEED-010 already exist, so re-importing them demonstrates idempotency and override protection.
export const feed = [
  { externalId: 'SEED-001', subject: 'Refund for double charge', body: 'I was charged twice for my March invoice and need a refund.' },
  { externalId: 'SEED-010', subject: 'My package has not arrived', body: 'Ordered two weeks ago and the package has not arrived.' },
  { externalId: 'FEED-101', subject: 'Cannot sign in on mobile', body: 'Sign in fails with a spinner on iOS.' },
  { externalId: 'FEED-102', subject: 'Invoice PDF is broken', body: 'The invoice download returns a broken file.' },
  { externalId: 'FEED-103', subject: 'Request: Slack integration', body: 'Could you post new urgent tickets into Slack?' },
];
