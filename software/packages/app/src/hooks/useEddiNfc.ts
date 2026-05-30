import { Platform } from 'react-native'
import NfcManager, { NfcTech, Ndef, NfcError } from 'react-native-nfc-manager'
import type { TagEvent, NdefRecord } from 'react-native-nfc-manager'
import { WEB_ORIGIN } from '../config'

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

// NDEF record `type` comes back as a byte array on Android and a string on iOS
function recordTypeName(type: NdefRecord['type']): string {
  return typeof type === 'string' ? type : String.fromCharCode(...type)
}

// Parse NDEF URL records from a scanned tag
// Returns [eddi card URL, ...service URLs]
export function parseEddiTag(tag: TagEvent | null): string[] {
  return (tag?.ndefMessage ?? [])
    .filter(r => r.tnf === Ndef.TNF_WELL_KNOWN)
    .filter(r => recordTypeName(r.type) === 'U')
    .map(r => Ndef.uri.decodePayload(new Uint8Array(r.payload)))
    .filter(Boolean)
}

// Read one Eddi card tap — resolves with [eddiUrl, ...serviceUrls]
export async function readEddiCard(): Promise<string[]> {
  await NfcManager.requestTechnology(NfcTech.Ndef)
  try {
    const tag = await NfcManager.getTag()
    return parseEddiTag(tag)
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }
}

// Write NDEF records to a blank or formatted tag
// Handles both pre-formatted (NDEF) and blank (NdefFormatable) tags
export async function writeEddiCard(cardId: string, serviceUris: Record<string, string>): Promise<void> {
  const records = [
    Ndef.uriRecord(`${WEB_ORIGIN}/c/${cardId}`),
    serviceUris.spotify       ? Ndef.uriRecord(serviceUris.spotify)       : null,
    serviceUris.apple_music   ? Ndef.uriRecord(serviceUris.apple_music)   : null,
    serviceUris.tidal         ? Ndef.uriRecord(serviceUris.tidal)         : null,
    serviceUris.youtube_music ? Ndef.uriRecord(serviceUris.youtube_music) : null,
  ].filter(Boolean) as NdefRecord[]

  const bytes = Ndef.encodeMessage(records)
  if (!bytes) throw new Error('Failed to encode NDEF message')

  // Try writing as a pre-formatted NDEF tag first.
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef)
    await NfcManager.ndefHandler.writeNdefMessage(bytes)
    return
  } catch (e) {
    if (e instanceof NfcError.UserCancel) throw e
    // Blank/unformatted tags fail the NDEF write on Android — fall through to format.
    // iOS Core NFC formats blank tags automatically, so there's nothing more to try.
    if (Platform.OS !== 'android') throw e
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }

  // Android blank tag — format and write in a single step.
  try {
    await NfcManager.requestTechnology(NfcTech.NdefFormatable)
    await NfcManager.ndefFormatableHandlerAndroid.formatNdef(bytes)
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }
}
