import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

// Confirms the Vitest + jsdom + Testing Library harness is wired up.
function Hello() {
  return <div>eddi harness ok</div>
}

describe('test harness', () => {
  it('renders a component in jsdom', () => {
    render(<Hello />)
    expect(screen.getByText('eddi harness ok')).toBeInTheDocument()
  })
})
