const BASE = import.meta.env.VITE_API_URL || '/api';
export const token = { get: () => localStorage.getItem('ts_token'), set: (t) => localStorage.setItem('ts_token', t), clear: () => localStorage.removeItem('ts_token') };

export async function api(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(BASE + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token.get() ? { Authorization: `Bearer ${token.get()}` } : {}), ...headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error?.message || 'Request failed'); e.status = res.status; throw e; }
  return data;
}
