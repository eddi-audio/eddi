import React, { useEffect } from 'react'
import {
  View, Text, Image, StyleSheet, TouchableOpacity,
  ScrollView, Linking, ActivityIndicator, Share,
} from 'react-native'
import { useQuery } from '@tanstack/react-query'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation'
import { getCard, logEvent } from '../api/cards'
import { useServicePref } from '../hooks/useServicePref'
import type { ServiceKey } from '../types/card'

type Props = NativeStackScreenProps<RootStackParamList, 'Card'>

const SERVICE_LABELS: Record<ServiceKey, string> = {
  spotify: 'Listen on Spotify',
  apple_music: 'Listen on Apple Music',
  tidal: 'Listen on Tidal',
  youtube_music: 'Listen on YouTube Music',
  amazon_music: 'Listen on Amazon Music',
}

const SERVICE_COLORS: Record<ServiceKey, string> = {
  spotify: '#1db954',
  apple_music: '#fc3c44',
  tidal: '#000000',
  youtube_music: '#ff0000',
  amazon_music: '#00a8e1',
}

export default function CardScreen({ route, navigation }: Props) {
  const { id } = route.params
  const { pref, setPreference } = useServicePref()

  const { data: card, isLoading, error } = useQuery({
    queryKey: ['card', id],
    queryFn: () => getCard(id),
  })

  useEffect(() => {
    if (card) logEvent(id, 'view').catch(() => {})
  }, [card, id])

  const handleServicePress = async (key: ServiceKey, url: string) => {
    setPreference(key)
    logEvent(id, 'service_open', key).catch(() => {})
    await Linking.openURL(url)
  }

  const handleShare = async () => {
    await Share.share({ url: `https://eddi.audio/c/${id}`, message: card?.title ?? '' })
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="white" />
      </View>
    )
  }

  if (error || !card) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Card not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const services = Object.entries(card.service_uris) as [ServiceKey, string][]
  const sorted = pref
    ? [...services].sort(([a]) => (a === pref ? -1 : 1))
    : services

  const bgColor = card.artwork_palette.background

  return (
    <ScrollView style={[styles.container, { backgroundColor: bgColor }]}
      contentContainerStyle={styles.content}>

      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>

      {card.artwork_url ? (
        <Image source={{ uri: card.artwork_url }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.artworkPlaceholder]} />
      )}

      <Text style={styles.contentType}>{card.content_type.toUpperCase()}</Text>
      <Text style={styles.title}>{card.title}</Text>
      {card.track_count && (
        <Text style={styles.subtitle}>{card.track_count} tracks</Text>
      )}

      {card.source === 'user' && card.created_by_display && (
        <Text style={styles.attribution}>Made by {card.created_by_display}</Text>
      )}

      <View style={styles.services}>
        {sorted.map(([key, url]) => (
          <TouchableOpacity
            key={key}
            style={[styles.serviceBtn, { backgroundColor: SERVICE_COLORS[key] }]}
            onPress={() => handleServicePress(key, url)}
            activeOpacity={0.8}
          >
            <Text style={styles.serviceBtnText}>{SERVICE_LABELS[key]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
          <Text style={styles.actionLabel}>Share</Text>
        </TouchableOpacity>
        <View style={styles.tapCount}>
          <Text style={styles.tapCountNum}>{card.tap_count.toLocaleString()}</Text>
          <Text style={styles.tapCountLabel}>taps</Text>
        </View>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Write', { cloneId: id })}
        >
          <Text style={styles.actionLabel}>Duplicate</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 60 },
  center: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', gap: 16 },
  backButton: { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 16 },
  backIcon: { color: 'rgba(255,255,255,0.6)', fontSize: 22 },
  artwork: { width: '100%', aspectRatio: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  artworkPlaceholder: { backgroundColor: 'rgba(255,255,255,0.05)' },
  contentType: { marginTop: 24, marginHorizontal: 24, fontSize: 11, fontWeight: '600', letterSpacing: 1.5, color: 'rgba(255,255,255,0.4)' },
  title: { marginTop: 6, marginHorizontal: 24, fontSize: 26, fontWeight: '700', color: 'white', letterSpacing: -0.5 },
  subtitle: { marginTop: 4, marginHorizontal: 24, fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  attribution: { marginTop: 8, marginHorizontal: 24, fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  services: { marginTop: 24, paddingHorizontal: 24, gap: 10 },
  serviceBtn: { borderRadius: 18, padding: 16, alignItems: 'center' },
  serviceBtnText: { fontSize: 15, fontWeight: '700', color: 'white' },
  actions: { marginTop: 24, marginHorizontal: 24, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 20 },
  actionBtn: { flex: 1, alignItems: 'center' },
  actionLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  tapCount: { flex: 1, alignItems: 'center' },
  tapCountNum: { color: 'white', fontSize: 20, fontWeight: '700' },
  tapCountLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  errorText: { color: 'white', fontSize: 16 },
  backLink: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 8 },
})
