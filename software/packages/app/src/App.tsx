import React, { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Navigation from './navigation'
import { initNfc } from './hooks/useEddiNfc'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

export default function App() {
  useEffect(() => {
    initNfc()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <Navigation />
    </QueryClientProvider>
  )
}
