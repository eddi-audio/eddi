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
type Step = 'paste' | 'preview' | 'write' | 'success'

export default function WriteScreen({ route, navigation }: Props) {
  const cloneId = route.params?.cloneId

  const [step, setStep] = useState<Step>('paste')
  const [url, setUrl] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState<ResolveResult | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [writing, setWriting] = useState(false)
  const [newCardId, setNewCardId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Pre-load clone source
  useEffect(() => {
    if (cloneId) {
      getCard(cloneId).then(card => {
        setResolved({
          title: card.title,
          artwork_url: card.artwork_url,
          content_type: card.content_type,
          track_count: card.track_count,
          service_uris: card.service_uris,
        })
        setStep('preview')
      }).catch(() => {})
    }
  }, [cloneId])

  const handleResolve = async () => {
    if (!url.trim()) return
    setResolving(true)
    setError(null)
    try {
      const result = await resolveUrl(url.trim())
      setResolved(result)
      setStep('preview')
    } catch {
      setError("Couldn't find that link. Paste a Spotify, Apple Music, or Tidal URL.")
    } finally {
      setResolving(false)
    }
  }

  const handleWrite = async () => {
    if (!resolved) return
    setWriting(true)
    setError(null)
    try {
      const { id } = await createCard({ ...resolved, display_name: displayName || undefined })
      await writeEddiCard(id, resolved.service_uris as Record<string, string>)
      setNewCardId(id)
      setStep('success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('cancel') || msg.includes('UserCancel')) {
        setError('Write cancelled. Try again.')
      } else {
        setError(`Write failed: ${msg}`)
      }
    } finally {
      setWriting(false)
    }
  }

  const reset = () => {
    setStep('paste')
    setUrl('')
    setResolved(null)
    setDisplayName('')
    setNewCardId(null)
    setError(null)
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
        {(['paste', 'preview', 'write'] as const).map((s, i) => (
          <View
            key={s}
            style={[styles.stepDot, (step === 'success' || ['paste', 'preview', 'write'].indexOf(step) >= i) && styles.stepDotActive]}
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
              onSubmitEditing={handleResolve}
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
              onPress={handleResolve}
              disabled={!url.trim() || resolving}
            >
              {resolving ? <ActivityIndicator color="black" /> : <Text style={styles.primaryBtnText}>Continue</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Preview */}
        {step === 'preview' && resolved && (
          <View style={styles.section}>
            {resolved.artwork_url && (
              <Image source={{ uri: resolved.artwork_url }} style={styles.artwork} />
            )}
            <Text style={styles.resolvedType}>{resolved.content_type.toUpperCase()}</Text>
            <Text style={styles.resolvedTitle}>{resolved.title}</Text>
            {resolved.track_count && (
              <Text style={styles.resolvedMeta}>{resolved.track_count} tracks</Text>
            )}
            <Text style={[styles.label, { marginTop: 20 }]}>Your name (optional)</Text>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="e.g. @daniel"
              placeholderTextColor="rgba(255,255,255,0.25)"
              maxLength={40}
            />
            <Text style={styles.hint}>Shows as "Made by [name]" on the card page</Text>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => { setResolved(null); setStep('paste') }}>
                <Text style={styles.secondaryBtnText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 2 }]} onPress={() => setStep('write')}>
                <Text style={styles.primaryBtnText}>Looks good →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Write */}
        {step === 'write' && (
          <View style={[styles.section, styles.centered]}>
            <View style={[styles.nfcRing, writing && styles.nfcRingActive]}>
              <Text style={styles.nfcIcon}>⟡</Text>
            </View>
            <Text style={styles.writeTitle}>
              {writing ? 'Hold phone to the card…' : 'Ready to write'}
            </Text>
            <Text style={styles.writeSubtitle}>
              {writing
                ? 'Keep your phone still until the write completes'
                : 'Tap the button below, then hold your phone to the blank NFC card'}
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity
              style={[styles.primaryBtn, writing && styles.btnDisabled, { width: '100%' }]}
              onPress={handleWrite}
              disabled={writing}
            >
              {writing ? <ActivityIndicator color="black" /> : <Text style={styles.primaryBtnText}>Write to card</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep('preview')}>
              <Text style={styles.ghostBtn}>Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Success */}
        {step === 'success' && newCardId && (
          <View style={[styles.section, styles.centered]}>
            <View style={styles.successRing}>
              <Text style={styles.successIcon}>✓</Text>
            </View>
            <Text style={styles.writeTitle}>Card written!</Text>
            <Text style={styles.writeSubtitle}>Your NFC card is ready to share</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { width: '100%' }]}
              onPress={() => navigation.navigate('Card', { id: newCardId })}
            >
              <Text style={styles.primaryBtnText}>View card</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={reset}>
              <Text style={styles.ghostBtn}>Write another card</Text>
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
  resolvedTitle: { fontSize: 22, fontWeight: '700', color: 'white', letterSpacing: -0.5 },
  resolvedMeta: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  nfcRing: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  nfcRingActive: { borderColor: 'rgba(255,255,255,0.7)' },
  nfcIcon: { fontSize: 40, color: 'rgba(255,255,255,0.4)' },
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
