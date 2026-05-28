import type { ContentType } from '../types/card'

const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  track: 'Track',
  album: 'Album',
  playlist: 'Playlist',
  artist: 'Artist',
  show: 'Podcast',
  episode: 'Episode',
}

interface Props {
  title: string
  artworkUrl: string
  contentType: ContentType
  trackCount?: number
}

export default function CardHero({ title, artworkUrl, contentType, trackCount }: Props) {
  const badge = trackCount
    ? `${CONTENT_TYPE_LABEL[contentType]} · ${trackCount} tracks`
    : CONTENT_TYPE_LABEL[contentType]

  return (
    <div className="flex flex-col items-center px-6 pt-10 pb-6">
      <div className="w-56 h-56 rounded-2xl overflow-hidden shadow-2xl shadow-black/60 mb-6 flex-shrink-0">
        <img
          src={artworkUrl}
          alt={title}
          className="w-full h-full object-cover"
          loading="eager"
        />
      </div>
      <span className="text-xs font-semibold uppercase tracking-widest text-white/50 mb-2">
        {badge}
      </span>
      <h1 className="text-2xl font-bold text-white text-center leading-tight max-w-xs">
        {title}
      </h1>
    </div>
  )
}
