// Idempotent seed: every insert is keyed on a UNIQUE column and uses INSERT IGNORE, so re-running creates no duplicates.
// Usage: npm run seed   |   npm run seed:bulk  (adds 600 extra tickets for latency measurement)
import bcrypt from 'bcryptjs';
import { pool, init } from './db.js';
import { classify } from './classify.js';

await init();
const users = [['Admin Lead', 'admin@triagesync.test', 'Admin@123', 'ADMIN'], ['Agent Demo', 'user@triagesync.test', 'User@123', 'USER']];
for (const [name, email, pw, role] of users)
  await pool.query('INSERT IGNORE INTO users (name,email,passwordHash,role) VALUES (?,?,?,?)', [name, email, await bcrypt.hash(pw, 10), role]);

const resources = [
  ['Orion Meeting Room', 'ROOM', 12, 'Glass-walled room with a wall display'], ['Atrium Huddle Room', 'ROOM', 4, 'Quiet room for quick calls'],
  ['Network Lab', 'LAB', 20, 'Bench seating with managed switches'], ['Device Test Lab', 'LAB', 8, 'Phones and tablets for repro work'],
  ['Packet Analyzer Kit', 'EQUIPMENT', 1, 'Portable network analyzer'], ['Legacy Oscilloscope', 'EQUIPMENT', 1, 'Out for calibration'],
];
for (const [name, type, cap, desc] of resources)
  await pool.query('INSERT IGNORE INTO resources (name,type,capacity,description,isActive) VALUES (?,?,?,?,?)', [name, type, cap, desc, name === 'Legacy Oscilloscope' ? 0 : 1]);

// [subject, body, overrides]. overrides can force priority/category/status/reviewed.
const tickets = [
  ['Refund for double charge', 'I was charged twice for my March invoice and need a refund.'],
  ['Invoice shows wrong company name', 'Please correct the billing name on invoice 4471.', { priority: 'LOW', reviewed: true }],
  ['Payment page throws error', 'Checkout shows an error after I enter my card details.'],
  ['App crashes on startup', 'The mobile app crash happens right after the splash screen.', { reviewed: true, status: 'IN_PROGRESS' }],
  ['Exception in export job', 'Nightly export fails with an unhandled exception in the log.'],
  ['URGENT: production down', 'Our integration returns 500 for every request, production down since 9am.'],
  ['Locked out of my account', 'I am locked out after too many password attempts.'],
  ['Reset my password', 'The password reset email never comes.', { priority: 'LOW' }],
  ['2FA code not accepted', 'My 2fa code is rejected on every sign in.', { reviewed: true, category: 'LOGIN' }],
  ['My package has not arrived', 'Ordered two weeks ago and the package has not arrived.'],
  ['Tracking number does not work', 'The tracking link says the shipment does not exist.'],
  ['Delivery to wrong address', 'The delivery went to my old address.', { status: 'RESOLVED' }],
  ['Add dark mode', 'It would be great to have a dark theme in the dashboard.', { priority: 'LOW' }],
  ['Export tickets to CSV', 'Please let us download a CSV of all tickets.'],
  ['Bulk edit tickets', 'Support for editing many tickets at once would save time.', { status: 'CLOSED' }],
  ['<script>alert("xss")</script> in subject', 'Body with <b>bold</b> and <img src=x onerror=alert(1)> to test escaping.'],
  ['Webhook retries missing', 'We need retry support for failed webhook deliveries.'],
];
let i = 0;
for (const [subject, body, o = {}] of tickets) {
  i++;
  const a = classify(subject, body), category = o.category || a.category;
  await pool.query(
    'INSERT IGNORE INTO tickets (externalId,subject,body,autoCategory,category,isHumanOverride,priority,status,isReviewed) VALUES (?,?,?,?,?,?,?,?,?)',
    [`SEED-${String(i).padStart(3, '0')}`, subject, body, a.category, category, category !== a.category ? 1 : 0, o.priority || a.priority, o.status || 'OPEN', o.reviewed ? 1 : 0]);
}

if (process.argv.includes('--bulk')) {
  const topics = ['refund', 'login', 'package', 'crash', 'feature idea'];
  for (let n = 1; n <= 600; n++) {
    const t = topics[n % topics.length], subject = `Bulk ticket ${n}: ${t}`, body = `Generated ticket ${n} about ${t} for load testing.`, a = classify(subject, body);
    await pool.query('INSERT IGNORE INTO tickets (externalId,subject,body,autoCategory,category,priority) VALUES (?,?,?,?,?,?)', [`BULK-${n}`, subject, body, a.category, a.category, a.priority]);
  }
}
console.log('Seed complete');
await pool.end();
