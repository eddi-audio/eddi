import type { ServiceKey } from '../types/card'

interface ServiceConfig {
  label: string
  color: string      // button background
  textColor: string
  logo: string       // inline SVG path data or component
}

const SERVICES: Record<ServiceKey, ServiceConfig> = {
  spotify: {
    label: 'Listen on Spotify',
    color: '#1DB954',
    textColor: '#000000',
    logo: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 01-.857.208c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 01-.277-1.216c3.809-.87 7.079-.496 9.712 1.115a.623.623 0 01.207.857zm1.223-2.723a.78.78 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 01-.973-.519.781.781 0 01.52-.974c3.632-1.102 8.147-.568 11.233 1.33a.78.78 0 01.257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.937.937 0 11-.543-1.794c3.532-1.072 9.404-.865 13.115 1.338a.937.937 0 01-.955 1.612z',
  },
  apple_music: {
    label: 'Open in Apple Music',
    color: '#fc3c44',
    textColor: '#ffffff',
    logo: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm2.5 5.5v6.25a2.25 2.25 0 11-1.5-2.121V9.5l-3 .75v4.5a2.25 2.25 0 11-1.5-2.121V7.25L14.5 6.5V7.5z',
  },
  youtube_music: {
    label: 'Open in YouTube Music',
    color: '#FF0000',
    textColor: '#ffffff',
    logo: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1.5 5.5l6 4.5-6 4.5V7.5z',
  },
  amazon_music: {
    label: 'Open in Amazon Music',
    color: '#25D1DA',
    textColor: '#000000',
    logo: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm5.5 12.5c-1.5 1-3.5 1.5-5.5 1.5s-4-.5-5.5-1.5l.5-.75C8.5 14.5 10 15 12 15s3.5-.5 5-.75l.5.75zM8.5 9.5a1 1 0 100 2 1 1 0 000-2zm7 0a1 1 0 100 2 1 1 0 000-2z',
  },
  tidal: {
    label: 'Open in Tidal',
    color: '#000000',
    textColor: '#ffffff',
    logo: 'M12 2L8 7l4 5-4 5 4 5 4-5-4-5 4-5z',
  },
}

const SERVICE_ORDER: ServiceKey[] = ['spotify', 'apple_music', 'youtube_music', 'tidal', 'amazon_music']

interface Props {
  serviceKey: ServiceKey
  url: string
  onSelect: (key: ServiceKey) => void
}

function ServiceButtonItem({ serviceKey, url, onSelect }: Props) {
  const config = SERVICES[serviceKey]
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onSelect(serviceKey)}
      className="flex items-center gap-3 w-full px-5 py-4 rounded-2xl font-semibold text-sm transition-opacity active:opacity-75"
      style={{ backgroundColor: config.color, color: config.textColor }}
    >
      <svg viewBox="0 0 24 24" className="w-6 h-6 flex-shrink-0" fill="currentColor">
        <path d={config.logo} />
      </svg>
      <span>{config.label}</span>
    </a>
  )
}

interface ServiceButtonsProps {
  serviceUris: Partial<Record<ServiceKey, string>>
  preferred: ServiceKey | null
  onSelect: (key: ServiceKey) => void
}

export default function ServiceButtons({ serviceUris, preferred, onSelect }: ServiceButtonsProps) {
  const available = SERVICE_ORDER.filter(k => serviceUris[k])
  const ordered = preferred && available.includes(preferred)
    ? [preferred, ...available.filter(k => k !== preferred)]
    : available

  if (ordered.length === 0) return null

  return (
    <div className="flex flex-col gap-3 px-6 pb-6">
      {ordered.map(key => (
        <ServiceButtonItem
          key={key}
          serviceKey={key}
          url={serviceUris[key]!}
          onSelect={onSelect}
        />
      ))}
      <p className="text-center text-xs text-white/30 mt-1">
        Tap a service to open it in your app
      </p>
    </div>
  )
}
