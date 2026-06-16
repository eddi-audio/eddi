import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity,
  ScrollView, Image, ActivityIndicator, Alert,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation'
import { resolveUrl, createCard, getCard } from '../api/cards'
import { writeEddiCard } from '../hooks/useEddiNfc'
import type { ResolveResult } from '../types/card'

type Props = NativeStackScreenProps<RootStackParamList, 'Write'>
type Step = 'paste' | 'write' | 'success'

export default function WriteScreen({ route, navigation }: Props) {
  const cloneId = route.params?.cloneId
  const sharedUrl = route.params?.sharedUrl

  const [step, setStep] = useState<Step>('paste')
  const [url, setUrl] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState<ResolveResult | null>(null)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create the card record + arm the NFC write. Pass the resolved data in
  // directly so we can fire immediately after a resolve without waiting on a
  // state update.
  const handleWrite = async (data?: ResolveResult) => {
    const card = data ?? resolved
    if (!card) return
    setWriting(true)
    setError(null)
    try {
      const { id } = await createCard({ ...card })
      await writeEddiCard(id, card.service_uris as Record<string, string>)
      setStep('success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('cancel') || msg.includes('UserCancel')) {
        setError('Write cancelled — tap the card again.')
      } else {
        setError(`Write failed: ${msg}`)
      }
    } finally {
      setWriting(false)
    }
  }

  const handleResolve = async (rawUrl?: string) => {
    const target = (rawUrl ?? url).trim()
    if (!target) return
    setResolving(true)
    setError(null)
    try {
      const result = await resolveUrl(target)
      setResolved(result)
      // Shortened flow: no name/confirm step — resolve straight into the write.
      setStep('write')
      handleWrite(result)
    } catch {
      setError("Couldn't find that link. Paste a Spotify, Apple Music, or Tidal URL.")
    } finally {
      setResolving(false)
    }
  }

  // Pre-load a clone source, then go straight to writing.
  useEffect(() => {
    if (cloneId) {
      getCard(cloneId).then(card => {
        const result: ResolveResult = {
          title: card.title,
          artwork_url: card.artwork_url,
          content_type: card.content_type,
          track_count: card.track_count,
          service_uris: card.service_uris,
        }
        setResolved(result)
        setStep('write')
        handleWrite(result)
      }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloneId])

  // A link shared into Eddi from another app lands here with its URL prefilled —
  // auto-resolve it, which then flows straight into the write.
  useEffect(() => {
    if (sharedUrl) {
      setUrl(sharedUrl)
      handleResolve(sharedUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedUrl])

  // After a successful write, show the confirmation briefly, then return home.
  useEffect(() => {
    if (step !== 'success') return
    const t = setTimeout(() => navigation.popToTop(), 2600)
    return () => clearTimeout(t)
  }, [step, navigation])

  const editLink = () => {
    setError(null)
    setResolved(null)
    setStep('paste')
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Write a card</Text>
        <Text style={styles.subtitle}>Turn a blank NFC tag into an Eddi card</Text>
      </View>

      {/* Step indicators */}
      <View style={styles.steps}>
        {(['paste', 'write'] as const).map((s, i) => (
          <View
            key={s}
            style={[styles.stepDot, (step === 'success' || ['paste', 'write'].indexOf(step) >= i) && styles.stepDotActive]}
          />
        ))}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">

        {/* Paste */}
        {step === 'paste' && (
          <View style={styles.section}>
            <Text style={styles.label}>Paste a music link</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              onSubmitEditing={() => handleResolve()}
              placeholder="https://open.spotify.com/..."
              placeholderTextColor="rgba(255,255,255,0.25)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
            />
            <Text style={styles.hint}>Supports Spotify, Apple Music, and Tidal</Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity
              style={[styles.primaryBtn, (!url.trim() || resolving) && styles.btnDisabled]}
              onPress={() => handleResolve()}
              disabled={!url.trim() || resolving}
            >
              {resolving ? <ActivityIndicator color="black" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Write — the tap-to-write graphic stands in for the album art until
            the real write animation lands. */}
        {step === 'write' && resolved && (
          <View style={[styles.section, styles.centered]}>
            <View style={[styles.tapSlot, writing && styles.tapSlotActive]}>
              <Text style={styles.tapIcon}>⟡</Text>
            </View>
            <Text style={styles.resolvedType}>{resolved.content_type.toUpperCase()}</Text>
            <Text style={styles.resolvedTitle} numberOfLines={2}>{resolved.title}</Text>
            <Text style={[styles.writeTitle, { marginTop: 16 }]}>
              {error ? 'Write failed' : 'Tap card to write'}
            </Text>
            {error ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <Text style={styles.writeSubtitle}>Hold your phone to the blank NFC card</Text>
            )}
            {error && (
              <>
                <TouchableOpacity
                  style={[styles.primaryBtn, { width: '100%' }]}
                  onPress={() => handleWrite()}
                >
                  <Text style={styles.primaryBtnText}>Try again</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={editLink}>
                  <Text style={styles.ghostBtn}>Use a different link</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Success — confirm + a little card preview, then auto-return home. */}
        {step === 'success' && resolved && (
          <View style={[styles.section, styles.centered]}>
            <View style={styles.successRing}>
              <Text style={styles.successIcon}>✓</Text>
            </View>
            <Text style={styles.writeTitle}>Card written!</Text>
            <View style={styles.previewCard}>
              {resolved.artwork_url ? (
                <Image source={{ uri: resolved.artwork_url }} style={styles.previewArt} />
              ) : (
                <View style={[styles.previewArt, styles.previewArtEmpty]} />
              )}
              <View style={styles.previewMeta}>
                <Text style={styles.previewType}>{resolved.content_type.toUpperCase()}</Text>
                <Text style={styles.previewTitle} numberOfLines={2}>{resolved.title}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => navigation.popToTop()}>
              <Text style={styles.ghostBtn}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 8 },
  back: { color: 'rgba(255,255,255,0.6)', fontSize: 22, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '700', color: 'white', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  steps: { flexDirection: 'row', gap: 6, paddingHorizontal: 24, paddingVertical: 16 },
  stepDot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  stepDotActive: { backgroundColor: 'white' },
  body: { flex: 1 },
  bodyContent: { padding: 24, gap: 12 },
  section: { gap: 12 },
  centered: { alignItems: 'center' },
  label: { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16,
    padding: 16, color: 'white', fontSize: 15,
  },
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.25)' },
  error: { fontSize: 13, color: '#f87171' },
  primaryBtn: {
    backgroundColor: 'white', borderRadius: 18,
    padding: 16, alignItems: 'center',
  },
  primaryBtnText: { color: 'black', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.4 },
  secondaryBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18,
    padding: 16, alignItems: 'center',
  },
  secondaryBtnText: { color: 'white', fontSize: 15, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 10 },
  artwork: { width: '100%', aspectRatio: 1, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)' },
  resolvedType: { fontSize: 11, fontWeight: '600', letterSpacing: 1.5, color: 'rgba(255,255,255,0.4)' },
  resolvedTitle: { fontSize: 22, fontWeight: '700', color: 'white', letterSpacing: -0.5, textAlign: 'center' },
  resolvedMeta: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  // Tap-to-write graphic — stands in for album art at the same footprint until
  // the real write animation lands.
  tapSlot: {
    width: '100%', aspectRatio: 1, borderRadius: 16,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  tapSlotActive: { borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.08)' },
  tapIcon: { fontSize: 72, color: 'rgba(255,255,255,0.45)' },
  // Little card preview on the success screen.
  previewCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16,
    padding: 12, width: '100%', marginTop: 4,
  },
  previewArt: { width: 64, height: 64, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  previewArtEmpty: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  previewMeta: { flex: 1, gap: 4 },
  previewType: { fontSize: 10, fontWeight: '600', letterSpacing: 1.2, color: 'rgba(255,255,255,0.4)' },
  previewTitle: { fontSize: 15, fontWeight: '600', color: 'white' },
  writeTitle: { fontSize: 20, fontWeight: '700', color: 'white', textAlign: 'center' },
  writeSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 20, maxWidth: 280 },
  successRing: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(22,163,74,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  successIcon: { fontSize: 48, color: '#4ade80' },
  ghostBtn: { color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 4 },
})
