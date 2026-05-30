import React, { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Linking, Alert, ActivityIndicator,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation'
import { readEddiCard } from '../hooks/useEddiNfc'
import { useServicePref } from '../hooks/useServicePref'
import { getCard, logEvent } from '../api/cards'
import type { ServiceKey } from '../types/card'

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>

const SERVICE_ORDER: ServiceKey[] = ['spotify', 'apple_music', 'tidal', 'youtube_music', 'amazon_music']

export default function HomeScreen({ navigation }: Props) {
  const [scanning, setScanning] = useState(false)
  const { pref, setPreference } = useServicePref()

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const urls = await readEddiCard()
      if (!urls.length) return

      // Record 0 is always the eddi card URL
      const eddiUrl = urls[0]
      const cardId = eddiUrl.split('/c/')[1]

      // Records 1..n are service URLs — pick preferred or first available
      const serviceUrls = urls.slice(1)

      // Try to match preferred service
      let targetUrl: string | undefined
      let usedService: ServiceKey | undefined

      if (pref) {
        targetUrl = serviceUrls.find(u => u.includes(serviceKeyToDomain(pref)))
        if (targetUrl) usedService = pref
      }

      // Fall back to first available service
      if (!targetUrl) {
        targetUrl = serviceUrls[0]
        usedService = serviceUrls[0] ? domainToServiceKey(serviceUrls[0]) : undefined
      }

      // Log the tap
      if (cardId) {
        logEvent(cardId, 'tap', usedService).catch(() => {})
      }

      if (targetUrl) {
        await Linking.openURL(targetUrl)
        if (usedService) setPreference(usedService)
      } else if (cardId) {
        // No service URL on tag — show card page to pick service
        navigation.navigate('Card', { id: cardId })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('cancel') && !msg.includes('UserCancel')) {
        Alert.alert('Scan failed', msg)
      }
    } finally {
      setScanning(false)
    }
  }, [pref, navigation, setPreference])

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.top}>
        <Text style={styles.wordmark}>eddi</Text>
      </View>

      <View style={styles.center}>
        <TouchableOpacity
          style={[styles.scanButton, scanning && styles.scanButtonActive]}
          onPress={handleScan}
          disabled={scanning}
          activeOpacity={0.8}
        >
          {scanning ? (
            <>
              <ActivityIndicator color="white" style={{ marginBottom: 12 }} />
              <Text style={styles.scanLabel}>Hold phone to card…</Text>
            </>
          ) : (
            <>
              <Text style={styles.scanIcon}>⟡</Text>
              <Text style={styles.scanLabel}>Tap to scan</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.bottom}>
        <TouchableOpacity
          style={styles.writeButton}
          onPress={() => navigation.navigate('Write', {})}
          activeOpacity={0.7}
        >
          <Text style={styles.writeButtonText}>Write a card</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function serviceKeyToDomain(key: ServiceKey): string {
  const map: Record<ServiceKey, string> = {
    spotify: 'open.spotify.com',
    apple_music: 'music.apple.com',
    tidal: 'tidal.com',
    youtube_music: 'music.youtube.com',
    amazon_music: 'music.amazon.com',
  }
  return map[key] ?? ''
}

function domainToServiceKey(url: string): ServiceKey | undefined {
  if (url.includes('spotify')) return 'spotify'
  if (url.includes('apple')) return 'apple_music'
  if (url.includes('tidal')) return 'tidal'
  if (url.includes('youtube')) return 'youtube_music'
  if (url.includes('amazon')) return 'amazon_music'
  return undefined
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  top: { paddingTop: 64, paddingHorizontal: 24 },
  wordmark: { fontSize: 28, fontWeight: '700', color: 'white', letterSpacing: -1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanButton: {
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  scanButtonActive: { borderColor: 'rgba(255,255,255,0.6)' },
  scanIcon: { fontSize: 48, color: 'rgba(255,255,255,0.4)' },
  scanLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  bottom: { paddingHorizontal: 24, paddingBottom: 48 },
  writeButton: {
    padding: 16, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  writeButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
})
