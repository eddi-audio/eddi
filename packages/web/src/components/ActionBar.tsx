import { logEvent } from '../api/cards'

interface Props {
  cardId: string
  tapCount: number
}

export default function ActionBar({ cardId, tapCount }: Props) {
  const isAndroidChrome = /android/i.test(navigator.userAgent) && /chrome/i.test(navigator.userAgent)

  async function handleShare() {
    const url = `https://eddi.audio/c/${cardId}`
    if (navigator.share) {
      await navigator.share({ url })
    } else {
      await navigator.clipboard.writeText(url)
      // Could show a toast here; keeping it minimal for v1
    }
    logEvent({ card_id: cardId, event_type: 'share' }).catch(() => {})
  }

  function handleDuplicate() {
    logEvent({ card_id: cardId, event_type: 'duplicate' }).catch(() => {})
    if (isAndroidChrome) {
      window.location.href = `/write?clone=${cardId}`
    } else {
      // Deep-link to Eddi app; falls back to /write on iOS
      window.location.href = `eddi://card/${cardId}?action=clone`
    }
  }

  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
      <button
        onClick={handleShare}
        className="flex flex-col items-center gap-1 text-white/60 active:text-white transition-colors"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zm9.566 0a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zm-4.783 6.857a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zm4.783-6.857L7.217 6.782m9.566 10.564L7.217 10.907" />
        </svg>
        <span className="text-xs">Share</span>
      </button>

      <div className="flex flex-col items-center gap-1 text-white/30">
        <span className="text-xl font-bold text-white/70">{tapCount.toLocaleString()}</span>
        <span className="text-xs">taps</span>
      </div>

      <button
        onClick={handleDuplicate}
        className="flex flex-col items-center gap-1 text-white/60 active:text-white transition-colors"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
        </svg>
        <span className="text-xs">Duplicate</span>
      </button>
    </div>
  )
}
