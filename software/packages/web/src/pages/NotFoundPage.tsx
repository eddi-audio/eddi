import BrandBlock from '../components/BrandBlock'

export default function NotFoundPage() {
  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center gap-3">
        <h1 className="text-xl font-bold text-white">Page not found</h1>
        <p className="text-sm text-white/50">This page doesn't exist.</p>
        <a href="https://eddi.audio" className="mt-4 px-6 py-3 rounded-full bg-white text-black text-sm font-semibold">
          Go to eddi.audio
        </a>
      </div>
      <BrandBlock />
    </div>
  )
}
