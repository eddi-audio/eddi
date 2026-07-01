export const API = 'http://localhost:5000'

// fetch JSON, throwing on non-2xx so TanStack Query treats failures as errors
// (real isLoading/error) instead of silently serving stale/empty data — which was
// the old `.catch(() => {})` anti-pattern. 204 → null.
export async function fetchJson(path, opts) {
  const res = await fetch(`${API}${path}`, opts)
  if (!res.ok) throw new Error(`${opts?.method || 'GET'} ${path} → ${res.status}`)
  return res.status === 204 ? null : res.json()
}

export function putJson(path) {
  return fetchJson(path, { method: 'PUT' })
}

export function postJson(path, body) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
