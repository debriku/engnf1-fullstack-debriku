import { useCallback, useEffect, useState } from 'react';
import { api, token } from './api.js';
import { feed } from './feed.js';

const CATEGORIES = ['BILLING', 'BUG', 'FEATURE_REQUEST', 'LOGIN', 'DELIVERY'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const TYPES = ['ROOM', 'LAB', 'EQUIPMENT'];
const B_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const label = (s) => s.replace(/_/g, ' ').toLowerCase();
const fmt = (d) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const Chip = ({ v }) => <span className={`chip ${v}`}>{label(v)}</span>;
const Select = ({ value, onChange, options, all, ...p }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} {...p}>
    {all && <option value="">{all}</option>}
    {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
  </select>
);
const Pager = ({ data, page, setPage }) => data && data.totalPages > 1 && (
  <div className="row"><button className="btn ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
    <span className="muted">Page {data.page} of {data.totalPages}</span>
    <button className="btn ghost" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Next</button></div>
);
const State = ({ data, err, empty, retry }) => err
  ? <div className="err" role="alert">{err} {retry && <button className="btn ghost" onClick={retry}>Try again</button>}</div>
  : !data ? <p className="muted">Loading…</p> : data.length === 0 ? <p className="muted">{empty}</p> : null;

// ---------------- auth ----------------
function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'register') await api('/auth/register', { method: 'POST', body: f });
      const out = await api('/auth/login', { method: 'POST', body: { email: f.email, password: f.password } });
      token.set(out.token); onAuth(out.user);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="auth card"><h1>TriageSync</h1><p className="muted">Sort support tickets and book the rooms, labs and kit needed to fix them.</p>
      <form onSubmit={submit}>
        {mode === 'register' && <input placeholder="Full name" value={f.name} onChange={set('name')} required />}
        <input type="email" placeholder="Email" value={f.email} onChange={set('email')} required />
        <input type="password" placeholder="Password" value={f.password} onChange={set('password')} required />
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
      </form>
      <p><button className="btn ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>{mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}</button></p>
    </div>
  );
}

// ---------------- triage queue ----------------
function Queue({ user, notify }) {
  const [f, setF] = useState({ status: '', category: '', priority: '', q: '' });
  const [qDebounced, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState(null); const [err, setErr] = useState('');
  const [stats, setStats] = useState(null);
  const [sel, setSel] = useState(null); const [events, setEvents] = useState([]); const [editErr, setEditErr] = useState('');
  useEffect(() => { const t = setTimeout(() => { setQ(f.q); setPage(1); }, 250); return () => clearTimeout(t); }, [f.q]);
  const loadStats = () => api('/stats').then(setStats).catch(() => {});
  const load = useCallback(async () => {
    setErr('');
    try {
      const p = new URLSearchParams({ page, limit: 20 });
      ['status', 'category', 'priority'].forEach((k) => f[k] && p.set(k, f[k]));
      if (qDebounced) p.set('q', qDebounced);
      setList(await api(`/tickets?${p}`));
    } catch (e) { setErr(e.message); }
  }, [f.status, f.category, f.priority, qDebounced, page]);
  useEffect(() => { load(); }, [load]); useEffect(() => { loadStats(); }, []);

  async function open(id) {
    setEditErr('');
    try { const o = await api(`/tickets/${id}`); setSel(o.ticket); setEvents(o.events); } catch (e) { setEditErr(e.message); }
  }
  // Optimistic update: apply locally, call API, roll back and show the server's message if it fails.
  async function patch(changes) {
    const prev = sel, next = { ...sel, ...changes };
    setEditErr(''); setSel(next); setList((l) => ({ ...l, data: l.data.map((t) => (t.id === prev.id ? next : t)) }));
    try {
      const o = await api(`/tickets/${prev.id}`, { method: 'PATCH', body: changes, headers: { 'X-Agent': user.email } });
      setSel(o.ticket); setEvents(o.events); setList((l) => ({ ...l, data: l.data.map((t) => (t.id === prev.id ? o.ticket : t)) })); loadStats();
    } catch (e) {
      setSel(prev); setList((l) => ({ ...l, data: l.data.map((t) => (t.id === prev.id ? prev : t)) }));
      setEditErr(`Change rolled back: ${e.message}`);
    }
  }
  async function reimport() {
    try { const r = await api('/tickets/import', { method: 'POST', body: { tickets: feed } });
      notify(`Imported ${r.importedCount}, updated ${r.updatedCount}, kept ${r.skippedOverrideCount} human overrides.`); load(); loadStats();
    } catch (e) { notify(e.message, true); }
  }
  const S = (k, v) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}><h2>Triage queue</h2><button className="btn" onClick={reimport}>Re-import feed</button></div>
      {stats && <div className="stats">
        <div className="card stat"><b>{stats.byStatus.OPEN}</b><span>Open</span></div>
        <div className="card stat"><b>{stats.byPriority.URGENT}</b><span>Urgent</span></div>
        <div className="card stat"><b>{stats.reviewedCount}</b><span>Reviewed</span></div>
        <div className="card stat"><b>{stats.modelAgreementRate}%</b><span>Model agreement</span></div>
      </div>}
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input type="search" placeholder="Search subject or body" aria-label="Search tickets" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select value={f.status} onChange={(v) => S('status', v)} options={STATUSES} all="Any status" aria-label="Status" />
        <Select value={f.category} onChange={(v) => S('category', v)} options={CATEGORIES} all="Any category" aria-label="Category" />
        <Select value={f.priority} onChange={(v) => S('priority', v)} options={PRIORITIES} all="Any priority" aria-label="Priority" />
      </div>
      <div className="split">
        <div>
          <State data={list?.data} err={err} empty="No tickets match these filters." retry={load} />
          {list?.data.map((t) => (
            <button key={t.id} className={`item ${t.priority} ${sel?.id === t.id ? 'sel' : ''}`} onClick={() => open(t.id)}>
              <strong>{t.subject}</strong><br /><Chip v={t.priority} /><Chip v={t.category} /><Chip v={t.status} />{t.isReviewed && <span className="chip">reviewed</span>}
            </button>
          ))}
          <Pager data={list} page={page} setPage={setPage} />
        </div>
        <div className="card">
          {!sel ? <p className="muted">Select a ticket to review it.</p> : (
            <div>
              <h3>{sel.subject}</h3><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{sel.body}</p>
              <p className="muted">Auto category: {label(sel.autoCategory)}{sel.isHumanOverride ? ' · changed by an agent' : ''}</p>
              {editErr && <div className="err" role="alert">{editErr}</div>}
              <div className="row">
                <Select value={sel.category} onChange={(v) => patch({ category: v })} options={CATEGORIES} aria-label="Category" />
                <Select value={sel.priority} onChange={(v) => patch({ priority: v })} options={PRIORITIES} aria-label="Priority" />
                <Select value={sel.status} onChange={(v) => patch({ status: v })} options={STATUSES} aria-label="Status" />
                <button className="btn ghost" onClick={() => patch({ assigneeId: sel.assigneeId === user.id ? null : user.id })}>{sel.assigneeId === user.id ? 'Unassign me' : 'Assign to me'}</button>
              </div>
              <h3 style={{ marginTop: '1rem' }}>History</h3>
              {events.length === 0 ? <p className="muted">No changes yet.</p> : events.map((e) => (
                <p key={e.id} className="muted" style={{ margin: '.25rem 0', overflowWrap: 'anywhere' }}>{fmt(e.createdAt)} · {e.actor} changed {e.field}: {e.oldValue ?? 'none'} → {e.newValue ?? 'none'}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- resources & booking ----------------
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const dayStr = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function Resources({ notify }) {
  const [f, setF] = useState({ search: '', type: '', minCapacity: '' }); const [page, setPage] = useState(1);
  const [list, setList] = useState(null); const [err, setErr] = useState(''); const [sel, setSel] = useState(null);
  const load = useCallback(async () => {
    setErr('');
    try { const p = new URLSearchParams({ page }); Object.entries(f).forEach(([k, v]) => v && p.set(k, v)); setList(await api(`/resources?${p}`)); } catch (e) { setErr(e.message); }
  }, [f, page]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const S = (k, v) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <div><h2>Resources</h2>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <input type="search" placeholder="Search by name" aria-label="Search resources" value={f.search} onChange={(e) => S('search', e.target.value)} />
        <Select value={f.type} onChange={(v) => S('type', v)} options={TYPES} all="Any type" aria-label="Type" />
        <input type="number" min="1" placeholder="Min capacity" aria-label="Minimum capacity" value={f.minCapacity} onChange={(e) => S('minCapacity', e.target.value)} style={{ width: 130 }} />
      </div>
      <div className="split">
        <div>
          <State data={list?.data} err={err} empty="No resources match. Try clearing a filter." retry={load} />
          {list?.data.map((r) => (
            <button key={r.id} className={`item ${sel?.id === r.id ? 'sel' : ''}`} onClick={() => setSel(r)}>
              <strong>{r.name}</strong> <Chip v={r.type} />{!r.isActive && <span className="chip">inactive</span>}<br /><span className="muted">Capacity {r.capacity}{r.description ? ` · ${r.description}` : ''}</span>
            </button>
          ))}
          <Pager data={list} page={page} setPage={setPage} />
        </div>
        <div className="card">{sel ? <Slots key={sel.id} resource={sel} notify={notify} /> : <p className="muted">Select a resource to see its availability and book a slot.</p>}</div>
      </div>
    </div>
  );
}

function Slots({ resource, notify }) {
  const [date, setDate] = useState(dayStr(new Date(Date.now() + 864e5)));
  const [start, setStart] = useState('09:00'); const [end, setEnd] = useState('09:30');
  const [purpose, setPurpose] = useState(''); const [ticketId, setTicketId] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [slots, setSlots] = useState(null);
  const loadSlots = useCallback(async () => {
    setErr('');
    try {
      const from = new Date(`${date}T00:00`), to = new Date(from.getTime() + 864e5);
      const o = await api(`/resources/${resource.id}/availability?from=${from.toISOString()}&to=${to.toISOString()}`); setSlots(o.bookings);
    } catch (e) { setErr(e.message); }
  }, [date, resource.id]);
  useEffect(() => { loadSlots(); }, [loadSlots]);
  async function book(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api('/bookings', { method: 'POST', body: { resourceId: resource.id, startTime: new Date(`${date}T${start}`).toISOString(), endTime: new Date(`${date}T${end}`).toISOString(), purpose, ...(ticketId ? { ticketId: Number(ticketId) } : {}) } });
      notify('Booking requested. An admin will review it.'); setPurpose(''); loadSlots();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div><h3>{resource.name}</h3>
      <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <h3 style={{ marginTop: '.75rem' }}>Booked that day</h3>
      {slots === null && !err ? <p className="muted">Loading…</p> : slots?.length === 0 ? <p className="muted">Nothing booked. The whole day is free.</p> : slots?.map((s, i) => (
        <p key={i} className="muted" style={{ margin: '.2rem 0' }}>{new Date(s.startTime).toLocaleTimeString([], { timeStyle: 'short' })} – {new Date(s.endTime).toLocaleTimeString([], { timeStyle: 'short' })} <Chip v={s.status} /></p>
      ))}
      {resource.isActive ? (
        <form className="grid" style={{ marginTop: '1rem' }} onSubmit={book}>
          <div className="row">
            <label>Start <select value={start} onChange={(e) => setStart(e.target.value)}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>End <select value={end} onChange={(e) => setEnd(e.target.value)}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <input placeholder="Purpose (5+ characters)" value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
          <input type="number" min="1" placeholder="Linked ticket ID (optional)" value={ticketId} onChange={(e) => setTicketId(e.target.value)} />
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn" disabled={busy}>{busy ? 'Booking…' : 'Request booking'}</button>
        </form>
      ) : <p className="err">This resource is inactive and cannot be booked.</p>}
    </div>
  );
}

// ---------------- bookings ----------------
function MyBookings({ notify }) {
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const [list, setList] = useState(null); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr(''); try { const p = new URLSearchParams({ page }); if (status) p.set('status', status); setList(await api(`/bookings/mine?${p}`)); } catch (e) { setErr(e.message); }
  }, [status, page]);
  useEffect(() => { load(); }, [load]);
  async function cancel(b) {
    if (!window.confirm('Cancel this booking? The slot becomes free for others.')) return;
    try { await api(`/bookings/${b.id}/cancel`, { method: 'PATCH' }); notify('Booking cancelled.'); load(); } catch (e) { notify(e.message, true); }
  }
  return (
    <div><h2>My bookings</h2>
      <div className="row" style={{ marginBottom: '1rem' }}><Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={B_STATUSES} all="Any status" aria-label="Status" /></div>
      <State data={list?.data} err={err} empty="No bookings yet. Pick a resource to book your first slot." retry={load} />
      {list?.data.map((b) => (
        <div key={b.id} className="card" style={{ marginBottom: '.5rem' }}>
          <strong>Resource #{b.resourceId}</strong> <Chip v={b.status} /><br />{fmt(b.startTime)} – {new Date(b.endTime).toLocaleTimeString([], { timeStyle: 'short' })}
          <p style={{ margin: '.25rem 0', overflowWrap: 'anywhere' }}>{b.purpose}</p>{b.decisionNote && <p className="muted">Admin note: {b.decisionNote}</p>}
          {['PENDING', 'APPROVED'].includes(b.status) && new Date(b.startTime) > new Date() && <button className="btn ghost" onClick={() => cancel(b)}>Cancel booking</button>}
        </div>
      ))}
      <Pager data={list} page={page} setPage={setPage} />
    </div>
  );
}

// ---------------- admin ----------------
function AdminResources({ notify }) {
  const [list, setList] = useState(null); const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', type: 'ROOM', capacity: 4, description: '' }); const [formErr, setFormErr] = useState('');
  const load = useCallback(async () => { try { setList((await api('/resources?limit=100')).data); } catch (e) { setErr(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  async function create(e) {
    e.preventDefault(); setFormErr('');
    try { await api('/resources', { method: 'POST', body: { ...f, capacity: Number(f.capacity), description: f.description || undefined } }); setF({ ...f, name: '', description: '' }); load(); }
    catch (x) { setFormErr(x.message); }
  }
  async function patch(r, body) { try { await api(`/resources/${r.id}`, { method: 'PATCH', body }); load(); } catch (e) { notify(e.message, true); } }
  return (
    <div className="split">
      <div><State data={list} err={err} empty="No resources yet." retry={load} />
        {list?.map((r) => (
          <div key={r.id} className="card" style={{ marginBottom: '.5rem' }}>
            <strong>{r.name}</strong> <Chip v={r.type} /> <span className="muted">cap {r.capacity}</span>
            <div className="row" style={{ marginTop: '.4rem' }}>
              <button className="btn ghost" onClick={() => patch(r, { isActive: !r.isActive })}>{r.isActive ? 'Deactivate' : 'Activate'}</button>
              <button className="btn ghost" onClick={() => { const n = window.prompt('New name', r.name); if (n) patch(r, { name: n }); }}>Rename</button>
              <button className="btn ghost" onClick={() => { const c = window.prompt('New capacity (1-500)', r.capacity); if (c) patch(r, { capacity: Number(c) }); }}>Set capacity</button>
            </div>
          </div>
        ))}
      </div>
      <form className="card grid" onSubmit={create}><h3>Add resource</h3>
        <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <Select value={f.type} onChange={(v) => setF({ ...f, type: v })} options={TYPES} />
        <input type="number" min="1" max="500" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        <input placeholder="Description (optional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        {formErr && <div className="err" role="alert">{formErr}</div>}<button className="btn">Add resource</button>
      </form>
    </div>
  );
}

function AdminBookings({ notify }) {
  const [status, setStatus] = useState('PENDING'); const [page, setPage] = useState(1);
  const [list, setList] = useState(null); const [err, setErr] = useState(''); const [rejecting, setRejecting] = useState(null); const [note, setNote] = useState('');
  const load = useCallback(async () => {
    setErr(''); try { const p = new URLSearchParams({ page }); if (status) p.set('status', status); setList(await api(`/bookings?${p}`)); } catch (e) { setErr(e.message); }
  }, [status, page]);
  useEffect(() => { load(); }, [load]);
  async function act(b, kind, body) {
    try { await api(`/bookings/${b.id}/${kind}`, { method: 'PATCH', body }); setRejecting(null); setNote(''); load(); } catch (e) { notify(e.message, true); }
  }
  return (
    <div><div className="row" style={{ marginBottom: '1rem' }}><Select value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={B_STATUSES} all="Any status" aria-label="Status" /></div>
      <State data={list?.data} err={err} empty="No bookings with this status." retry={load} />
      {list?.data.map((b) => (
        <div key={b.id} className="card" style={{ marginBottom: '.5rem' }}>
          <strong>Resource #{b.resourceId}</strong> by user #{b.userId} <Chip v={b.status} /><br />{fmt(b.startTime)} – {new Date(b.endTime).toLocaleTimeString([], { timeStyle: 'short' })}
          <p style={{ margin: '.25rem 0', overflowWrap: 'anywhere' }}>{b.purpose}</p>
          {b.status === 'PENDING' && (rejecting === b.id
            ? <div className="row"><input placeholder="Reason (5+ characters)" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn danger" onClick={() => act(b, 'reject', { note })}>Confirm reject</button><button className="btn ghost" onClick={() => setRejecting(null)}>Back</button></div>
            : <div className="row"><button className="btn" onClick={() => act(b, 'approve')}>Approve</button><button className="btn ghost" onClick={() => setRejecting(b.id)}>Reject</button></div>)}
        </div>
      ))}
      <Pager data={list} page={page} setPage={setPage} />
    </div>
  );
}

function Analytics() {
  const [s, setS] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/admin/stats').then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="err" role="alert">{err}</div>;
  if (!s) return <p className="muted">Loading…</p>;
  return (
    <div className="grid">
      <div className="stats">
        <div className="card stat"><b>{s.activeResources}</b><span>Active resources</span></div>
        {Object.entries(s.bookingsByStatus).map(([k, v]) => <div key={k} className="card stat"><b>{v}</b><span>{label(k)} bookings</span></div>)}
        <div className="card stat"><b>{s.ticketStats.total}</b><span>Tickets</span></div>
        <div className="card stat"><b>{s.ticketStats.reviewedCount}</b><span>Reviewed tickets</span></div>
      </div>
      <div className="card"><h3>Most booked resources</h3>
        {s.topResources.length === 0 ? <p className="muted">No bookings yet.</p> : s.topResources.map((t) => <p key={t.id} style={{ margin: '.2rem 0' }}>{t.name} <span className="muted">· {t.bookingCount} bookings</span></p>)}</div>
    </div>
  );
}

function Admin({ notify }) {
  const [tab, setTab] = useState('bookings');
  return (
    <div><h2>Admin</h2>
      <div className="row" style={{ marginBottom: '1rem' }}>
        {[['bookings', 'Bookings'], ['resources', 'Resources'], ['analytics', 'Analytics']].map(([k, l]) => <button key={k} className={`btn ${tab === k ? '' : 'ghost'}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'bookings' && <AdminBookings notify={notify} />}{tab === 'resources' && <AdminResources notify={notify} />}{tab === 'analytics' && <Analytics />}
    </div>
  );
}

// ---------------- shell ----------------
export default function App() {
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false);
  const [view, setView] = useState('queue'); const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!token.get()) { setReady(true); return; }
    api('/auth/me').then((o) => setUser(o.user)).catch(() => token.clear()).finally(() => setReady(true));
  }, []);
  const notify = (message, isErr) => { setToast({ message, isErr }); setTimeout(() => setToast(null), 5000); };
  if (!ready) return <p className="muted" style={{ padding: '1rem' }}>Loading…</p>;
  if (!user) return <Auth onAuth={setUser} />;
  const tabs = [['queue', 'Triage queue'], ['resources', 'Resources'], ['mine', 'My bookings'], ...(user.role === 'ADMIN' ? [['admin', 'Admin']] : [])];
  return (
    <div className="shell">
      <nav className="rail"><h1>TriageSync</h1>
        {tabs.map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
        <button onClick={() => { token.clear(); setUser(null); }}>Log out</button>
        <div className="who">{user.name}<br />{user.email}<br />{label(user.role)}</div>
      </nav>
      <main>
        {view === 'queue' && <Queue user={user} notify={notify} />}{view === 'resources' && <Resources notify={notify} />}
        {view === 'mine' && <MyBookings notify={notify} />}{view === 'admin' && user.role === 'ADMIN' && <Admin notify={notify} />}
      </main>
      {toast && <div className={`toast ${toast.isErr ? 'err' : 'ok'}`} role="status">{toast.message}</div>}
    </div>
  );
}
