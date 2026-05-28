export default function BrandBlock() {
  return (
    <div className="px-6 py-8 flex flex-col items-center gap-4 border-t border-white/10">
      <div className="flex items-center gap-2">
        {/* Logo placeholder — replace with <img src="/assets/logo.svg" /> once brand assets are added */}
        <span className="text-lg font-bold tracking-tight text-white">eddi</span>
      </div>

      <p className="text-sm text-white/50 text-center max-w-xs leading-relaxed">
        A music player that plays cards, not algorithms.
      </p>

      <div className="flex flex-col items-center gap-2 w-full max-w-xs">
        <a
          href="https://eddi.audio"
          className="text-sm text-white/60 hover:text-white transition-colors"
        >
          Learn more →
        </a>
        <div className="flex gap-6 text-sm text-white/40">
          <a href="https://eddi.audio/player" className="hover:text-white/80 transition-colors">
            Get the player
          </a>
          <a href="https://eddi.audio/currents" className="hover:text-white/80 transition-colors">
            Currents
          </a>
        </div>
      </div>
    </div>
  )
}
