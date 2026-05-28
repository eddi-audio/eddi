import { useState } from 'react'
import type { ServiceKey } from '../types/card'

const COOKIE_KEY = 'eddi_service_pref'

function readCookie(): ServiceKey | null {
  const match = document.cookie.split('; ').find(r => r.startsWith(COOKIE_KEY + '='))
  return match ? (match.split('=')[1] as ServiceKey) : null
}

function writeCookie(service: ServiceKey) {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${COOKIE_KEY}=${service}; expires=${expires}; path=/; SameSite=Lax`
}

export function useServicePref() {
  const [pref, setPref] = useState<ServiceKey | null>(() => readCookie())

  function setPreference(service: ServiceKey) {
    writeCookie(service)
    setPref(service)
  }

  return { pref, setPreference }
}
