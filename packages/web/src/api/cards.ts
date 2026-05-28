import type { Card, CardEvent, ResolveResult } from '../types/card'

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://api.eddi.audio'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.error ?? 'API error'), { status: res.status, code: body.error })
  }
  return res.json() as Promise<T>
}

export function getCard(id: string): Promise<Card> {
  return apiFetch<Card>(`/cards/${id}`)
}

export function logEvent(event: CardEvent): Promise<void> {
  return apiFetch(`/cards/${event.card_id}/events`, {
    method: 'POST',
    body: JSON.stringify(event),
  })
}

export function resolveUrl(url: string): Promise<ResolveResult> {
  return apiFetch<ResolveResult>('/resolve', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
}

export function createCard(data: ResolveResult & { display_name?: string }): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/cards', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
