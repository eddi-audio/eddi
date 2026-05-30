import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ServiceKey } from '../types/card'

const KEY = 'eddi_service_pref'

export function useServicePref() {
  const [pref, setPref] = useState<ServiceKey | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(KEY).then(v => {
      if (v) setPref(v as ServiceKey)
    })
  }, [])

  const setPreference = async (service: ServiceKey) => {
    setPref(service)
    await AsyncStorage.setItem(KEY, service)
  }

  return { pref, setPreference }
}
