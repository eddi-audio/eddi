import { useCallback, useEffect } from 'react'
import NfcManager, { NfcTech, Ndef, NfcError } from 'react-native-nfc-manager'

// Call once at app startup
export async function initNfc(): Promise<boolean> {
  try {
    const supported = await NfcManager.isSupported()
    if (supported) await NfcManager.start()
    return supported
  } catch {
    return false
  }
}

// Parse NDEF URL records from a scanned tag
// Returns [eddi card URL, ...service URLs]
export function parseEddiTag(tag: { ndefMessage?: Array<{ tnf: number; type: number[]; payload: number[] }> }): string[] {
  return (tag.ndefMessage ?? [])
    .filter(r => r.tnf === Ndef.TNF_WELL_KNOWN)
    .filter(r => String.fromCharCode(...r.type) === 'U')
    .map(r => Ndef.uri.decodePayload(new Uint8Array(r.payload) as unknown as number[]))
    .filter(Boolean) as string[]
}

// Read one Eddi card tap — resolves with [eddiUrl, ...serviceUrls]
export async function readEddiCard(): Promise<string[]> {
  await NfcManager.requestTechnology(NfcTech.Ndef)
  try {
    const tag = await NfcManager.getTag()
    return parseEddiTag(tag ?? {})
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }
}

// Write NDEF records to a blank or formatted tag
// Handles both blank (NdefFormatable) and pre-formatted tags
export async function writeEddiCard(cardId: string, serviceUris: Record<string, string>): Promise<void> {
  const records = [
    Ndef.uriRecord(`https://eddi.audio/c/${cardId}`),
    serviceUris.spotify      ? Ndef.uriRecord(serviceUris.spotify)      : null,
    serviceUris.apple_music  ? Ndef.uriRecord(serviceUris.apple_music)  : null,
    serviceUris.tidal        ? Ndef.uriRecord(serviceUris.tidal)        : null,
    serviceUris.youtube_music ? Ndef.uriRecord(serviceUris.youtube_music) : null,
  ].filter(Boolean) as ReturnType<typeof Ndef.uriRecord>[]

  const bytes = Ndef.encodeMessage(records)

  // Try pre-formatted first
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef)
    await NfcManager.ndefHandler.writeNdefMessage(bytes)
    return
  } catch (e) {
    await NfcManager.cancelTechnologyRequest().catch(() => {})
    if ((e as NfcError).type !== 'fail') throw e
  }

  // Blank tag — format first
  await NfcManager.requestTechnology(NfcTech.NdefFormatable)
  try {
    await NfcManager.ndefFormatableHandler.formatNdef(bytes)
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }
}
