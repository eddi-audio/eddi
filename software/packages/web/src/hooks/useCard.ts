import { useQuery } from '@tanstack/react-query'
import { getCard } from '../api/cards'
import type { CardError } from '../types/card'

function errorCode(err: unknown): CardError {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: string }).code
    if (code === 'NOT_FOUND' || code === 'DEACTIVATED' || code === 'NO_URIS') return code
  }
  return 'SERVER_ERROR'
}

export function useCard(id: string) {
  const query = useQuery({
    queryKey: ['card', id],
    queryFn: () => getCard(id),
    retry: (count, err) => {
      // Don't retry 404s or deactivated cards
      if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status: number }).status
        if (status === 404) return false
      }
      return count < 2
    },
    staleTime: 30_000,
  })

  return {
    card: query.data,
    isLoading: query.isPending,
    error: query.error ? errorCode(query.error) : null,
  }
}
