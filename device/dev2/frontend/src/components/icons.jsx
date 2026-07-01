import React from 'react'

// Inline transport icons so per-state color works (CSS mask failed: these Figma SVGs
// are width/height 100% with no intrinsic size, so mask-size:contain collapses).
// Stroke icons take `color` on the stroke; the heart is a fill glyph.

export function PlayIcon({ color = '#838295', size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18.0012 20.0012" fill="none" aria-hidden>
      <path d="M1 3.00059C0.999896 2.64868 1.09265 2.30298 1.26888 1.99838C1.44512 1.69379 1.69861 1.44108 2.00375 1.26579C2.30889 1.09049 2.65488 0.998817 3.00679 1.00001C3.3587 1.00121 3.70406 1.09523 4.008 1.27259L16.005 8.27059C16.3078 8.44627 16.5591 8.69834 16.7339 9.0016C16.9088 9.30486 17.0009 9.64869 17.0012 9.99873C17.0015 10.3488 16.91 10.6928 16.7357 10.9963C16.5614 11.2999 16.3105 11.5524 16.008 11.7286L4.008 18.7286C3.70406 18.906 3.3587 19 3.00679 19.0012C2.65488 19.0024 2.30889 18.9107 2.00375 18.7354C1.69861 18.5601 1.44512 18.3074 1.26888 18.0028C1.09265 17.6982 0.999896 17.3525 1 17.0006V3.00059Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function WaveIcon({ color = '#838295', size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M1 12C1.53043 12 2.03914 11.7893 2.41421 11.4142C2.78929 11.0391 3 10.5304 3 10V6C3 5.46957 3.21071 4.96086 3.58579 4.58579C3.96086 4.21071 4.46957 4 5 4C5.53043 4 6.03914 4.21071 6.41421 4.58579C6.78929 4.96086 7 5.46957 7 6V19C7 19.5304 7.21071 20.0391 7.58579 20.4142C7.96086 20.7893 8.46957 21 9 21C9.53043 21 10.0391 20.7893 10.4142 20.4142C10.7893 20.0391 11 19.5304 11 19V3C11 2.46957 11.2107 1.96086 11.5858 1.58579C11.9609 1.21071 12.4696 1 13 1C13.5304 1 14.0391 1.21071 14.4142 1.58579C14.7893 1.96086 15 2.46957 15 3V16C15 16.5304 15.2107 17.0391 15.5858 17.4142C15.9609 17.7893 16.4696 18 17 18C17.5304 18 18.0391 17.7893 18.4142 17.4142C18.7893 17.0391 19 16.5304 19 16V12C19 11.4696 19.2107 10.9609 19.5858 10.5858C19.9609 10.2107 20.4696 10 21 10" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ShuffleIcon({ color = '#838295', size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28.6667 28.6667" fill="none" aria-hidden>
      <path d="M22.3333 27.6667L27.6667 22.3333L22.3333 17M27.6667 22.3333H19.6121C18.7382 22.3244 17.8798 22.1009 17.1126 21.6824C16.3453 21.2639 15.6927 20.6633 15.2121 19.9333L14.7334 19.3333M22.3333 11.6667L27.6667 6.33333L22.3333 1M27.6667 6.33333L19.7027 6.33346C18.8407 6.32757 17.9901 6.53071 17.2238 6.92547C16.4575 7.32023 15.7983 7.89485 15.3027 8.60012L8.03067 20.0668C7.53503 20.7721 6.87583 21.3467 6.10953 21.7414C5.34323 22.1362 4.49265 22.3393 3.63067 22.3335H1M1 6.33346H3.62933C4.62328 6.32654 5.59938 6.59752 6.44752 7.11583C7.29565 7.63414 7.98207 8.37914 8.42933 9.26679" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function RepeatIcon({ color = '#838295', size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 28.6667" fill="none" aria-hidden>
      <path d="M19.6667 11.6667L25 6.33333L19.6667 1M25 6.33333H6.33333C4.91885 6.33333 3.56229 6.89524 2.5621 7.89543C1.5619 8.89562 1 10.2522 1 11.6667V13M6.33333 17L1 22.3333L6.33333 27.6667M1 22.3333H19.6667C21.0812 22.3333 22.4377 21.7714 23.4379 20.7712C24.4381 19.771 25 18.4145 25 17V15.6667" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function RepeatOneIcon({ color = '#838295', size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 28.6667" fill="none" aria-hidden>
      <path d="M19.6667 11.6667L25 6.33333L19.6667 1M25 6.33333H6.33333C4.91885 6.33333 3.56229 6.89524 2.5621 7.89543C1.5619 8.89562 1 10.2522 1 11.6667V13M6.33333 17L1 22.3333L6.33333 27.6667M1 22.3333H19.6667C21.0812 22.3333 22.4377 21.7714 23.4379 20.7712C24.4381 19.771 25 18.4145 25 17V15.6667M11.6667 11.6667H13V17" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function HeartIcon({ color = '#838295', size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="17 35 30 26" aria-hidden>
      <path fillRule="evenodd" fill={color} d="M36.4961 36.2197C38.013 35.8477 39.6066 35.9498 41.0645 36.5127C42.5224 37.0756 43.7756 38.0729 44.6572 39.3711C45.5388 40.6693 46.0074 42.2073 46 43.7803C46 47.0102 43.8998 49.4224 41.7998 51.5381L34.1113 59.0312C33.8505 59.3331 33.5289 59.5762 33.168 59.7432C32.8071 59.9101 32.4147 59.9974 32.0176 60C31.6203 60.0025 31.2264 59.9202 30.8633 59.7578C30.5003 59.5955 30.1757 59.357 29.9111 59.0586L22.2002 51.5381C20.1002 49.4224 18 47.0243 18 43.7803C18 42.2107 18.4727 40.678 19.3555 39.3848C20.2382 38.0915 21.4897 37.0988 22.9443 36.5371C24.399 35.9754 25.9884 35.8708 27.5029 36.2383C29.0175 36.6058 30.3865 37.4282 31.4277 38.5957C31.5009 38.6744 31.5893 38.7373 31.6875 38.7803C31.786 38.8233 31.8926 38.8457 32 38.8457C32.1074 38.8457 32.214 38.8233 32.3125 38.7803C32.4107 38.7373 32.4991 38.6744 32.5723 38.5957C33.6102 37.4207 34.9791 36.5918 36.4961 36.2197ZM29.5 42C27.567 42 26 43.567 26 45.5V47C26 47.5523 26.4477 48 27 48C27.5523 48 28 47.5523 28 47V45.5C28 44.6716 28.6716 44 29.5 44C30.3284 44 31 44.6716 31 45.5V48.5C31 50.433 32.567 52 34.5 52C36.433 52 38 50.433 38 48.5V47C38 46.4477 37.5523 46 37 46C36.4477 46 36 46.4477 36 47V48.5C36 49.3284 35.3284 50 34.5 50C33.6716 50 33 49.3284 33 48.5V45.5C33 43.567 31.433 42 29.5 42Z" />
    </svg>
  )
}

// Animated sine wave for the play/pause button's "playing" state — a flowing audio wave
// that scrolls one wavelength (16 user units) on loop. Paused shows the static ▷ instead.
export function PlayingWave({ color = '#f0581f', size = 34 }) {
  // Scrolling sine for the "playing" state. NOTE: on this Pi the GPU won't composite the transform
  // animation (same flaky-GPU path as the boot white-screen), so it re-paints on the CPU (~18% while
  // playing) no matter how it's structured — SVG-layer and div-background both measured identical.
  // It's harmless with the heatsink (56°C, no throttle). To cut it: `animation: … steps(15)` (~4%,
  // choppier) or drop the animation for a static ∿ (0%). Left smooth — Daniel's call.
  return (
    <span className="playing-wave" style={{ width: size + 14, height: size }} aria-hidden>
      <svg viewBox="0 0 48 24" width={size + 14} height={size} fill="none">
        <g className="pw-wave">
          <path
            d="M-16 12 Q-12 4 -8 12 T0 12 T8 12 T16 12 T24 12 T32 12 T40 12 T48 12 T56 12 T64 12"
            stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          />
        </g>
      </svg>
    </span>
  )
}
