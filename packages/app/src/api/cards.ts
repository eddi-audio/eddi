import type { Card, ResolveResult, ServiceKey } from '../types/card'

const API_BASE = 'https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw Object.assign(new Error(body.error ?? 'API error'), { status: res.status, code: body.error })
  }
  return res.json() as Promise<T>
}

export const getCard = (id: string): Promise<Card> =>
  apiFetch<Card>(`/cards/${id}`)

export const resolveUrl = (url: string): Promise<ResolveResult> =>
  apiFetch<ResolveResult>('/resolve', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })

export const createCard = (data: ResolveResult & { display_name?: string }): Promise<{ id: string }> =>
  apiFetch<{ id: string }>('/cards', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const logEvent = (cardId: string, eventType: string, service?: ServiceKey): Promise<void> =>
  apiFetch(`/cards/${cardId}/events`, {
    method: 'POST',
    body: JSON.stringify({ event_type: eventType, service_selected: service }),
  })
