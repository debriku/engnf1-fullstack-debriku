import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, tx } from './db.js';
import { classify } from './classify.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-secret';
const CATEGORIES = ['BILLING', 'BUG', 'FEATURE_REQUEST', 'LOGIN', 'DELIVERY'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const TYPES = ['ROOM', 'LAB', 'EQUIPMENT'];
const B_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

// ---------- helpers ----------
class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const bad = (m) => new HttpError(400, 'VALIDATION_ERROR', m);
const notFound = (m = 'Not found') => new HttpError(404, 'NOT_FOUND', m);
const conflict = (m) => new HttpError(409, 'CONFLICT', m);
const forbidden = (m = 'Forbidden') => new HttpError(403, 'FORBIDDEN', m);
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const str = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const pid = (req) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n < 1) throw notFound(); return n; };
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`${name} must be one of ${list.join(', ')}`); return v; };
const like = (s) => `%${s.replace(/[\\%_]/g, '\\$&')}%`; // escape LIKE wildcards; value is still bound as a parameter
const isoUtc = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]00:00)$/.test(v)) return null;
  const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d;
};
function paging(q, def = 10, max = 100) {
  const page = q.page === undefined ? 1 : Number(q.page);
  const size = q.limit === undefined ? def : Number(q.limit);
  if (!Number.isInteger(page) || page < 1) throw bad('page must be a positive integer');
  if (!Number.isInteger(size) || size < 1 || size > max) throw bad(`limit must be 1-${max}`);
  return { page, size, offset: (page - 1) * size };
}
const paginated = (data, total, { page, size }) => ({ data, page, pageSize: size, total, totalPages: Math.ceil(total / size) });
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt });
const counts = async (table, col, values) => {
  const [rows] = await pool.query(`SELECT ${col} k, COUNT(*) n FROM ${table} GROUP BY ${col}`);
  const out = Object.fromEntries(values.map((v) => [v, 0])); rows.forEach((r) => { out[r.k] = Number(r.n); }); return out;
};

const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), SECRET); next(); }
  catch { next(new HttpError(401, 'UNAUTHENTICATED', 'Login required')); }
};
const admin = (req, res, next) => (req.user.role === 'ADMIN' ? next() : next(forbidden('Admin only')));

export const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '1mb' }));
const r = express.Router();
app.use('/api', r);

// ---------- auth ----------
r.post('/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  const em = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!str(name, 2, 50)) throw bad('name must be 2-50 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) || em.length > 254) throw bad('email is invalid');
  if (typeof password !== 'string' || password.length < 8 || password.length > 64 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw bad('password must be 8-64 characters with a letter and a digit');
  try {
    const [ins] = await pool.query('INSERT INTO users (name,email,passwordHash,role) VALUES (?,?,?,?)', [name.trim(), em, await bcrypt.hash(password, 10), 'USER']);
    const [[u]] = await pool.query('SELECT * FROM users WHERE id=?', [ins.insertId]);
    res.status(201).json({ user: publicUser(u) });
  } catch (e) { if (e.code === 'ER_DUP_ENTRY') throw conflict('Email already registered'); throw e; }
}));

r.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) throw bad('email and password are required');
  const [[u]] = await pool.query('SELECT * FROM users WHERE email=?', [email.trim().toLowerCase()]);
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, 'UNAUTHENTICATED', 'Wrong email or password');
  const token = jwt.sign({ id: u.id, email: u.email, role: u.role, name: u.name }, SECRET, { expiresIn: '12h' });
  res.json({ token, user: publicUser(u) });
}));

r.get('/auth/me', auth, wrap(async (req, res) => {
  const [[u]] = await pool.query('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Account no longer exists');
  res.json({ user: publicUser(u) });
}));

// ---------- tickets ----------
r.post('/tickets/import', auth, wrap(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : req.body?.tickets;
  if (!Array.isArray(list) || !list.length || list.length > 1000) throw bad('tickets must be a non-empty array (max 1000)');
  list.forEach((t, i) => {
    if (!t || !str(t.externalId, 1, 100) || !str(t.subject, 3, 150) || !str(t.body, 5, 2000)) throw bad(`tickets[${i}] needs externalId, subject (3-150) and body (5-2000)`);
  });
  const out = { importedCount: 0, updatedCount: 0, skippedOverrideCount: 0, total: list.length };
  await tx(async (c) => {
    for (const t of list) {
      const ext = t.externalId.trim(), subject = t.subject.trim(), body = t.body.trim();
      const { category, priority } = classify(subject, body);
      // INSERT IGNORE on the UNIQUE externalId makes "create if new" atomic even across concurrent imports.
      const [ins] = await c.query('INSERT IGNORE INTO tickets (externalId,subject,body,autoCategory,category,priority) VALUES (?,?,?,?,?,?)', [ext, subject, body, category, category, priority]);
      if (ins.affectedRows) { out.importedCount++; continue; }
      const [[row]] = await c.query('SELECT * FROM tickets WHERE externalId=? FOR UPDATE', [ext]);
      const textChanged = row.subject !== subject || row.body !== body;
      if (row.isHumanOverride) { // T-B2: never reclassify an agent-corrected ticket
        out.skippedOverrideCount++;
        if (textChanged) await c.query('UPDATE tickets SET subject=?, body=? WHERE id=?', [subject, body, row.id]);
      } else if (textChanged || row.autoCategory !== category || row.priority !== priority) {
        await c.query('UPDATE tickets SET subject=?, body=?, autoCategory=?, category=?, priority=? WHERE id=?', [subject, body, category, category, priority, row.id]);
        out.updatedCount++;
      }
    }
  });
  res.json(out);
}));

r.get('/tickets', auth, wrap(async (req, res) => {
  const q = req.query, p = paging(q), where = [], args = [];
  if (q.status !== undefined) { where.push('status=?'); args.push(oneOf(q.status, STATUSES, 'status')); }
  if (q.category !== undefined) { where.push('category=?'); args.push(oneOf(q.category, CATEGORIES, 'category')); }
  if (q.priority !== undefined) { where.push('priority=?'); args.push(oneOf(q.priority, PRIORITIES, 'priority')); }
  if (q.q !== undefined) {
    if (typeof q.q !== 'string') throw bad('q must be a string');
    if (q.q.trim()) { where.push('(subject LIKE ? OR body LIKE ?)'); args.push(like(q.q.trim()), like(q.q.trim())); }
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM tickets ${w}`, args);
  const [rows] = await pool.query(`SELECT * FROM tickets ${w} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`, [...args, p.size, p.offset]);
  res.json(paginated(rows, Number(n), p));
}));

const ticketWithEvents = async (c, id) => {
  const [[ticket]] = await c.query('SELECT * FROM tickets WHERE id=?', [id]);
  const [events] = await c.query('SELECT * FROM ticket_events WHERE ticketId=? ORDER BY id DESC', [id]);
  return { ticket, events };
};

r.get('/tickets/:id', auth, wrap(async (req, res) => {
  const out = await ticketWithEvents(pool, pid(req));
  if (!out.ticket) throw notFound('Ticket not found');
  res.json(out);
}));

r.patch('/tickets/:id', auth, wrap(async (req, res) => {
  const id = pid(req);
  const [[exists]] = await pool.query('SELECT id FROM tickets WHERE id=?', [id]);
  if (!exists) throw notFound('Ticket not found');
  const b = req.body || {}, ch = {};
  if ('category' in b) ch.category = oneOf(b.category, CATEGORIES, 'category');
  if ('priority' in b) ch.priority = oneOf(b.priority, PRIORITIES, 'priority');
  if ('status' in b) ch.status = oneOf(b.status, STATUSES, 'status');
  if ('assigneeId' in b) {
    if (b.assigneeId !== null && (!Number.isInteger(b.assigneeId) || b.assigneeId < 1)) throw bad('assigneeId must be an integer or null');
    ch.assigneeId = b.assigneeId;
  }
  if (!Object.keys(ch).length) throw bad('Provide at least one of category, priority, status, assigneeId');
  if (ch.assigneeId != null) {
    const [[u]] = await pool.query('SELECT id FROM users WHERE id=?', [ch.assigneeId]);
    if (!u) throw notFound('Assignee not found');
  }
  const actor = (req.get('X-Agent') || '').trim().slice(0, 254) || req.user.email;
  const out = await tx(async (c) => {
    const [[cur]] = await c.query('SELECT * FROM tickets WHERE id=? FOR UPDATE', [id]);
    const changed = Object.keys(ch).filter((f) => (cur[f] ?? null) !== ch[f]);
    if (changed.length) {
      const set = changed.map((f) => `${f}=?`), args = changed.map((f) => ch[f]);
      if (changed.includes('category')) set.push('isHumanOverride=1'); // T-B3.1
      // "Reviewed" = an agent changed the category, or moved the ticket out of OPEN (T-B3.2)
      if (changed.includes('category') || (changed.includes('status') && cur.status === 'OPEN')) set.push('isReviewed=1');
      await c.query(`UPDATE tickets SET ${set.join(',')} WHERE id=?`, [...args, id]);
      for (const f of changed)
        await c.query('INSERT INTO ticket_events (ticketId,field,oldValue,newValue,actor) VALUES (?,?,?,?,?)', [id, f, cur[f] == null ? null : String(cur[f]), ch[f] == null ? null : String(ch[f]), actor]);
    }
    return ticketWithEvents(c, id);
  });
  res.json(out);
}));

r.get('/stats', auth, wrap(async (req, res) => {
  const [[agg]] = await pool.query('SELECT COALESCE(SUM(isReviewed),0) reviewed, COALESCE(SUM(isReviewed AND category=autoCategory),0) agree FROM tickets');
  const reviewedCount = Number(agg.reviewed);
  res.json({
    byCategory: await counts('tickets', 'category', CATEGORIES), byPriority: await counts('tickets', 'priority', PRIORITIES),
    byStatus: await counts('tickets', 'status', STATUSES), reviewedCount,
    modelAgreementRate: reviewedCount ? Math.round((Number(agg.agree) / reviewedCount) * 1000) / 10 : 0,
  });
}));

// ---------- resources ----------
const findResource = async (req, id) => {
  const [[row]] = await pool.query('SELECT * FROM resources WHERE id=?', [id]);
  if (!row || (!row.isActive && req.user.role !== 'ADMIN')) throw notFound('Resource not found');
  return row;
};

r.get('/resources', auth, wrap(async (req, res) => {
  const q = req.query, p = paging(q), where = [], args = [];
  if (req.user.role !== 'ADMIN') where.push('isActive=1');
  if (q.search !== undefined) { if (typeof q.search !== 'string') throw bad('search must be a string'); if (q.search.trim()) { where.push('name LIKE ?'); args.push(like(q.search.trim())); } }
  if (q.type !== undefined) { where.push('type=?'); args.push(oneOf(q.type, TYPES, 'type')); }
  if (q.minCapacity !== undefined) {
    const m = Number(q.minCapacity); if (!Number.isInteger(m) || m < 1) throw bad('minCapacity must be a positive integer');
    where.push('capacity>=?'); args.push(m);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM resources ${w}`, args);
  const [rows] = await pool.query(`SELECT * FROM resources ${w} ORDER BY name ASC LIMIT ? OFFSET ?`, [...args, p.size, p.offset]);
  res.json(paginated(rows, Number(n), p));
}));

r.get('/resources/:id', auth, wrap(async (req, res) => res.json(await findResource(req, pid(req)))));

function resourceFields(b, partial) {
  const o = {};
  if (!partial || 'name' in b) { if (!str(b.name, 3, 60)) throw bad('name must be 3-60 characters'); o.name = b.name.trim(); }
  if (!partial || 'type' in b) o.type = oneOf(b.type, TYPES, 'type');
  if (!partial || 'capacity' in b) { if (!Number.isInteger(b.capacity) || b.capacity < 1 || b.capacity > 500) throw bad('capacity must be an integer 1-500'); o.capacity = b.capacity; }
  if ('description' in b) { if (b.description !== null && (typeof b.description !== 'string' || b.description.length > 300)) throw bad('description must be at most 300 characters'); o.description = b.description; }
  if (partial && 'isActive' in b) { if (typeof b.isActive !== 'boolean') throw bad('isActive must be a boolean'); o.isActive = b.isActive ? 1 : 0; }
  return o;
}
const dupGuard = (e) => { if (e.code === 'ER_DUP_ENTRY') throw conflict('A resource with that name already exists'); throw e; };

r.post('/resources', auth, admin, wrap(async (req, res) => {
  const o = resourceFields(req.body || {}, false);
  try {
    const [ins] = await pool.query('INSERT INTO resources (name,type,capacity,description) VALUES (?,?,?,?)', [o.name, o.type, o.capacity, o.description ?? null]);
    const [[row]] = await pool.query('SELECT * FROM resources WHERE id=?', [ins.insertId]);
    res.status(201).json(row);
  } catch (e) { dupGuard(e); }
}));

r.patch('/resources/:id', auth, admin, wrap(async (req, res) => {
  const id = pid(req); await findResource(req, id);
  const o = resourceFields(req.body || {}, true);
  if (!Object.keys(o).length) throw bad('Provide at least one field to update');
  try {
    await pool.query(`UPDATE resources SET ${Object.keys(o).map((k) => `${k}=?`).join(',')} WHERE id=?`, [...Object.values(o), id]);
    res.json(await findResource(req, id));
  } catch (e) { dupGuard(e); }
}));

r.get('/resources/:id/availability', auth, wrap(async (req, res) => {
  const id = pid(req); await findResource(req, id);
  const from = isoUtc(req.query.from), to = isoUtc(req.query.to);
  if (!from || !to || to <= from) throw bad('from and to must be ISO 8601 UTC with to after from');
  if (to - from > 7 * 864e5) throw bad('Range cannot exceed 7 days');
  const [rows] = await pool.query("SELECT startTime,endTime,status FROM bookings WHERE resourceId=? AND status IN ('PENDING','APPROVED') AND startTime<? AND endTime>? ORDER BY startTime", [id, to, from]);
  res.json({ resourceId: id, from: from.toISOString(), to: to.toISOString(), bookings: rows });
}));

// ---------- bookings ----------
r.post('/bookings', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!Number.isInteger(b.resourceId) || b.resourceId < 1) throw bad('resourceId is required');
  const s = isoUtc(b.startTime), e = isoUtc(b.endTime);
  if (!s || !e) throw bad('startTime and endTime must be ISO 8601 UTC');
  const grid = (d) => [0, 30].includes(d.getUTCMinutes()) && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (!grid(s) || !grid(e)) throw bad('Times must fall on :00 or :30 UTC');
  const mins = (e - s) / 60000, now = Date.now();
  if (mins < 30 || mins > 240) throw bad('Duration must be 30-240 minutes');
  if (s.getTime() <= now || s.getTime() > now + 30 * 864e5) throw bad('startTime must be in the future and within 30 days');
  if (!str(b.purpose, 5, 200)) throw bad('purpose must be 5-200 characters');
  if (b.ticketId != null && (!Number.isInteger(b.ticketId) || b.ticketId < 1)) throw bad('ticketId must be an integer');
  const [[res0]] = await pool.query('SELECT id FROM resources WHERE id=?', [b.resourceId]);
  if (!res0) throw notFound('Resource not found');
  if (b.ticketId != null) { const [[t]] = await pool.query('SELECT id FROM tickets WHERE id=?', [b.ticketId]); if (!t) throw notFound('Ticket not found'); }
  const booking = await tx(async (c) => {
    // Lock order is always user -> resource, so concurrent requests serialize without deadlocking.
    await c.query('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    const [[rs]] = await c.query('SELECT isActive FROM resources WHERE id=? FOR UPDATE', [b.resourceId]);
    if (!rs.isActive) throw conflict('Resource is inactive');
    const [[{ n }]] = await c.query("SELECT COUNT(*) n FROM bookings WHERE userId=? AND status IN ('PENDING','APPROVED') AND startTime>?", [req.user.id, new Date()]);
    if (n >= 3) throw conflict('You already have 3 upcoming bookings');
    const [[{ k }]] = await c.query("SELECT COUNT(*) k FROM bookings WHERE resourceId=? AND status IN ('PENDING','APPROVED') AND ?<endTime AND ?>startTime", [b.resourceId, s, e]);
    if (k) throw conflict('That slot overlaps an existing booking');
    const [ins] = await c.query('INSERT INTO bookings (resourceId,userId,ticketId,startTime,endTime,purpose) VALUES (?,?,?,?,?,?)', [b.resourceId, req.user.id, b.ticketId ?? null, s, e, b.purpose.trim()]);
    const [[row]] = await c.query('SELECT * FROM bookings WHERE id=?', [ins.insertId]);
    return row;
  });
  res.status(201).json(booking);
}));

r.get('/bookings/mine', auth, wrap(async (req, res) => {
  const p = paging(req.query), where = ['userId=?'], args = [req.user.id];
  if (req.query.status !== undefined) { where.push('status=?'); args.push(oneOf(req.query.status, B_STATUSES, 'status')); }
  const w = `WHERE ${where.join(' AND ')}`;
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM bookings ${w}`, args);
  const [rows] = await pool.query(`SELECT * FROM bookings ${w} ORDER BY startTime DESC LIMIT ? OFFSET ?`, [...args, p.size, p.offset]);
  res.json(paginated(rows, Number(n), p));
}));

r.get('/bookings', auth, admin, wrap(async (req, res) => {
  const q = req.query, p = paging(q), where = [], args = [];
  if (q.status !== undefined) { where.push('status=?'); args.push(oneOf(q.status, B_STATUSES, 'status')); }
  if (q.resourceId !== undefined) { const n = Number(q.resourceId); if (!Number.isInteger(n) || n < 1) throw bad('resourceId must be an integer'); where.push('resourceId=?'); args.push(n); }
  if (q.from !== undefined) { const d = isoUtc(q.from); if (!d) throw bad('from must be ISO 8601 UTC'); where.push('endTime>?'); args.push(d); }
  if (q.to !== undefined) { const d = isoUtc(q.to); if (!d) throw bad('to must be ISO 8601 UTC'); where.push('startTime<?'); args.push(d); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM bookings ${w}`, args);
  const [rows] = await pool.query(`SELECT * FROM bookings ${w} ORDER BY startTime DESC LIMIT ? OFFSET ?`, [...args, p.size, p.offset]);
  res.json(paginated(rows, Number(n), p));
}));

const loadBooking = async (id) => {
  const [[row]] = await pool.query('SELECT * FROM bookings WHERE id=?', [id]);
  if (!row) throw notFound('Booking not found');
  return row;
};

r.get('/bookings/:id', auth, wrap(async (req, res) => {
  const row = await loadBooking(pid(req));
  if (req.user.role !== 'ADMIN' && row.userId !== req.user.id) throw forbidden('Not your booking');
  res.json(row);
}));

// Guarded transition: the UPDATE only matches rows still in an allowed state, so races fall through to 409.
async function transition(row, allowed, to, note = null) {
  if (!allowed.includes(row.status) || new Date(row.startTime) <= new Date()) throw conflict(`Cannot move a ${row.status} booking to ${to}`);
  const [u] = await pool.query(`UPDATE bookings SET status=?, decisionNote=? WHERE id=? AND status IN (${allowed.map(() => '?').join(',')})`, [to, note, row.id, ...allowed]);
  if (!u.affectedRows) throw conflict('Booking changed while processing');
  return loadBooking(row.id);
}

r.patch('/bookings/:id/cancel', auth, wrap(async (req, res) => {
  const row = await loadBooking(pid(req));
  if (row.userId !== req.user.id) throw forbidden('Only the owner can cancel');
  res.json(await transition(row, ['PENDING', 'APPROVED'], 'CANCELLED'));
}));
r.patch('/bookings/:id/approve', auth, admin, wrap(async (req, res) => {
  res.json(await transition(await loadBooking(pid(req)), ['PENDING'], 'APPROVED'));
}));
r.patch('/bookings/:id/reject', auth, admin, wrap(async (req, res) => {
  const row = await loadBooking(pid(req));
  if (!str(req.body?.note, 5, 200)) throw bad('note is required (5-200 characters)');
  res.json(await transition(row, ['PENDING'], 'REJECTED', req.body.note.trim()));
}));

// ---------- admin ----------
r.get('/admin/stats', auth, admin, wrap(async (req, res) => {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM resources WHERE isActive=1');
  const [top] = await pool.query('SELECT r.id, r.name, COUNT(b.id) bookingCount FROM resources r LEFT JOIN bookings b ON b.resourceId=r.id GROUP BY r.id, r.name ORDER BY bookingCount DESC, r.name ASC LIMIT 3');
  const [[agg]] = await pool.query('SELECT COUNT(*) total, COALESCE(SUM(isReviewed),0) reviewed FROM tickets');
  res.json({
    activeResources: Number(n), bookingsByStatus: await counts('bookings', 'status', B_STATUSES),
    topResources: top.map((t) => ({ ...t, bookingCount: Number(t.bookingCount) })),
    ticketStats: { total: Number(agg.total), reviewedCount: Number(agg.reviewed), byStatus: await counts('tickets', 'status', STATUSES), byPriority: await counts('tickets', 'priority', PRIORITIES), byCategory: await counts('tickets', 'category', CATEGORIES) },
  });
}));

// ---------- errors ----------
r.use((req, res, next) => next(notFound('Route not found')));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } });
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
});
