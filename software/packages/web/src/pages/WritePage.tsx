import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { resolveUrl, createCard, getCard } from '../api/cards'
import type { ResolveResult } from '../types/card'
import CardHero from '../components/CardHero'
import BrandBlock from '../components/BrandBlock'

type Step = 'paste' | 'preview' | 'write' | 'success' | 'unsupported'

const NFC_SUPPORTED = 'NDEFReader' in window

function detectPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

function AppStoreBadge() {
  return (
    <a href="https://apps.apple.com/app/eddi/id0000000000" className="block">
      <svg viewBox="0 0 120 40" className="h-12 w-auto" xmlns="http://www.w3.org/2000/svg">
        <rect width="120" height="40" rx="6" fill="black" stroke="white" strokeOpacity="0.3" strokeWidth="1"/>
        <text x="38" y="13" fontFamily="system-ui" fontSize="8" fill="white" fillOpacity="0.7">Download on the</text>
        <text x="34" y="27" fontFamily="system-ui" fontSize="14" fontWeight="600" fill="white">App Store</text>
        <text x="14" y="27" fontFamily="system-ui" fontSize="22" fill="white"></text>
      </svg>
    </a>
  )
}

function PlayStoreBadge() {
  return (
    <a href="https://play.google.com/store/apps/details?id=audio.eddi" className="block">
      <svg viewBox="0 0 135 40" className="h-12 w-auto" xmlns="http://www.w3.org/2000/svg">
        <rect width="135" height="40" rx="6" fill="black" stroke="white" strokeOpacity="0.3" strokeWidth="1"/>
        <text x="38" y="13" fontFamily="system-ui" fontSize="8" fill="white" fillOpacity="0.7">GET IT ON</text>
        <text x="34" y="27" fontFamily="system-ui" fontSize="14" fontWeight="600" fill="white">Google Play</text>
        <text x="12" y="28" fontFamily="system-ui" fontSize="20" fill="white">▷</text>
      </svg>
    </a>
  )
}

function UnsupportedState() {
  const platform = detectPlatform()

  return (
    <div className="min-h-dvh flex flex-col bg-[#0a0a0a]">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
          <svg className="w-8 h-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 0 1 0-5.303m5.304 0a3.75 3.75 0 0 1 0 5.303m-7.425 2.122a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.789M12 12h.008v.008H12V12Z" />
          </svg>
        </div>

        {platform === 'ios' ? (
          <>
            <h1 className="text-xl font-bold text-white">Write cards with the Eddi app</h1>
            <p className="text-sm text-white/50 max-w-xs leading-relaxed">
              NFC writing isn't available in iOS browsers. Download the Eddi app to write cards directly from your iPhone.
            </p>
            <AppStoreBadge />
          </>
        ) : platform === 'android' ? (
          <>
            <h1 className="text-xl font-bold text-white">Use Chrome to write cards</h1>
            <p className="text-sm text-white/50 max-w-xs leading-relaxed">
              NFC writing requires Chrome on Android. Open this page in Chrome, or download the Eddi app.
            </p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <a
                href="googlechrome://navigate?url=https://eddi.audio/write"
                className="py-3 rounded-2xl bg-white text-black text-sm font-semibold text-center"
              >
                Open in Chrome
              </a>
              <PlayStoreBadge />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-white">Write cards from your phone</h1>
            <p className="text-sm text-white/50 max-w-xs leading-relaxed">
              NFC writing works on Android with Chrome, or use the Eddi app on iOS or Android.
            </p>
            <div className="flex gap-3 justify-center">
              <AppStoreBadge />
              <PlayStoreBadge />
            </div>
          </>
        )}
      </div>
      <BrandBlock />
    </div>
  )
}

export default function WritePage() {
  const [searchParams] = useSearchParams()
  const cloneId = searchParams.get('clone')

  const [step, setStep] = useState<Step>(NFC_SUPPORTED ? 'paste' : 'unsupported')
  const [url, setUrl] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState<ResolveResult | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [writing, setWriting] = useState(false)
  const [newCardId, setNewCardId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Auto-load clone source on mount
  useEffect(() => {
    if (cloneId && NFC_SUPPORTED) {
      getCard(cloneId).then(card => {
        setResolved({
          title: card.title,
          artwork_url: card.artwork_url,
          content_type: card.content_type,
          track_count: card.track_count,
          service_uris: card.service_uris,
        })
        setStep('preview')
      }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleResolve() {
    if (!url.trim()) return
    setResolving(true)
    setError(null)
    try {
      const result = await resolveUrl(url.trim())
      setResolved(result)
      setStep('preview')
    } catch {
      setError('Could not find that URL. Make sure it\'s a Spotify, Apple Music, or YouTube Music link.')
    } finally {
      setResolving(false)
    }
  }

  async function handleWrite() {
    if (!resolved) return
    setWriting(true)
    setError(null)

    try {
      // 1. Save card to DynamoDB first — get the ID
      const { id } = await createCard({ ...resolved, display_name: displayName || undefined })

      // 2. Write NDEF records to tag
      // @ts-expect-error — NDEFReader not yet in TS lib
      const ndef = new NDEFReader()
      await ndef.write({
        records: [
          { recordType: 'url', data: `https://eddi.audio/c/${id}` },
          ...(resolved.service_uris.spotify
            ? [{ recordType: 'url', data: resolved.service_uris.spotify }]
            : []),
          ...(resolved.service_uris.apple_music
            ? [{ recordType: 'url', data: resolved.service_uris.apple_music }]
            : []),
        ],
      })

      setNewCardId(id)
      setStep('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Write failed'
      if (msg.includes('AbortError') || msg.includes('cancelled')) {
        setError('Write cancelled. Try again.')
      } else {
        setError(`Write failed: ${msg}`)
      }
    } finally {
      setWriting(false)
    }
  }

  if (step === 'unsupported') return <UnsupportedState />

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--card-bg)' }}>
      {/* Header */}
      <div className="px-6 pt-10 pb-4">
        <h1 className="text-2xl font-bold text-white">Write a card</h1>
        <p className="text-sm text-white/50 mt-1">Turn a blank NFC tag into an Eddi card</p>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 px-6 mb-6">
        {(['paste', 'preview', 'write'] as const).map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${
              step === 'success' || i <= ['paste', 'preview', 'write'].indexOf(step)
                ? 'bg-white'
                : 'bg-white/20'
            }`}
          />
        ))}
      </div>

      <div className="flex-1 px-6">
        {/* Step 1: Paste URL */}
        {step === 'paste' && (
          <div className="flex flex-col gap-4">
            <label className="text-sm font-medium text-white/70">Paste a music link</label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleResolve()}
              placeholder="https://open.spotify.com/playlist/..."
              className="w-full px-4 py-4 rounded-2xl bg-white/10 text-white placeholder-white/30 text-sm outline-none focus:bg-white/15 transition-colors"
              autoFocus
            />
            <p className="text-xs text-white/30">Supports Spotify, Apple Music, and YouTube Music</p>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleResolve}
              disabled={!url.trim() || resolving}
              className="w-full py-4 rounded-2xl bg-white text-black font-semibold disabled:opacity-40 active:opacity-80 transition-opacity"
            >
              {resolving ? 'Looking up...' : 'Continue'}
            </button>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && resolved && (
          <div className="flex flex-col gap-4">
            <CardHero
              title={resolved.title}
              artworkUrl={resolved.artwork_url}
              contentType={resolved.content_type}
              trackCount={resolved.track_count}
            />
            <label className="text-sm font-medium text-white/70">Your name (optional)</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. @daniel"
              maxLength={40}
              className="w-full px-4 py-4 rounded-2xl bg-white/10 text-white placeholder-white/30 text-sm outline-none focus:bg-white/15 transition-colors"
            />
            <p className="text-xs text-white/30">Shows as "Made by [name]" on the card page</p>
            <div className="flex gap-3">
              <button
                onClick={() => { setResolved(null); setStep('paste') }}
                className="flex-1 py-4 rounded-2xl bg-white/10 text-white font-medium active:bg-white/20"
              >
                Back
              </button>
              <button
                onClick={() => setStep('write')}
                className="flex-1 px-8 py-4 rounded-2xl bg-white text-black font-semibold active:opacity-80 transition-opacity"
              >
                Looks good →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Write */}
        {step === 'write' && resolved && (
          <div className="flex flex-col items-center gap-6 py-8 text-center">
            <div className={`w-24 h-24 rounded-full border-2 flex items-center justify-center transition-all ${writing ? 'border-white animate-pulse' : 'border-white/30'}`}>
              <svg className="w-10 h-10 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 0 1 0-5.303m5.304 0a3.75 3.75 0 0 1 0 5.303m-7.425 2.122a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.789M12 12h.008v.008H12V12Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">
                {writing ? 'Hold your phone to the card...' : 'Ready to write'}
              </h2>
              <p className="text-sm text-white/50">
                {writing
                  ? 'Keep your phone still until the write completes'
                  : 'Tap the button below, then hold your phone to the blank NFC card'
                }
              </p>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleWrite}
              disabled={writing}
              className="w-full py-4 rounded-2xl bg-white text-black font-semibold disabled:opacity-40 active:opacity-80 transition-opacity"
            >
              {writing ? 'Writing...' : 'Write to card'}
            </button>
            <button
              onClick={() => setStep('preview')}
              className="text-sm text-white/40"
            >
              Back
            </button>
          </div>
        )}

        {/* Success */}
        {step === 'success' && newCardId && (
          <div className="flex flex-col items-center gap-6 py-8 text-center">
            <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Card written!</h2>
              <p className="text-sm text-white/50">Your NFC card is ready to share</p>
            </div>
            <a
              href={`/c/${newCardId}`}
              className="w-full py-4 rounded-2xl bg-white text-black font-semibold text-center"
            >
              View card page
            </a>
            <button
              onClick={() => { setStep('paste'); setUrl(''); setResolved(null); setDisplayName(''); setNewCardId(null) }}
              className="text-sm text-white/40"
            >
              Write another card
            </button>
            <div className="pt-4 border-t border-white/10 w-full flex flex-col items-center gap-3">
              <p className="text-xs text-white/30">Write cards faster with the Eddi app</p>
              <PlayStoreBadge />
            </div>
          </div>
        )}
      </div>

      <BrandBlock />
    </div>
  )
}
