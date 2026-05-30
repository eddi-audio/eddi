import type { CardSource } from '../types/card'

interface Props {
  source: CardSource
  createdByDisplay?: string
}

export default function AttributionBlock({ source, createdByDisplay }: Props) {
  if (source === 'user' && createdByDisplay) {
    return (
      <div className="px-6 pb-4 text-center">
        <p className="text-sm text-white/50">
          Made by <span className="text-white/80 font-medium">{createdByDisplay}</span>
        </p>
      </div>
    )
  }

  if (source === 'currents') {
    return (
      <div className="px-6 pb-4 text-center">
        <p className="text-sm font-semibold text-white/70 tracking-wide">
          ✦ An Eddi Currents pick
        </p>
      </div>
    )
  }

  return null
}
