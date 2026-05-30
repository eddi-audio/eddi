# NFC NDEF Tag Writing: Native iOS, Android, and React Native

Research for the Eddi native app NFC write flow. Goal: replicate what `eddi.audio/write` does via Web NFC (NDEFReader) on Chrome Android — writing 2 NDEF URL records to a blank NFC tag.

**Write payload:**
1. Record 1 (URL): `https://eddi.audio/c/{cardId}` — the linktree page
2. Record 2 (URL): `https://open.spotify.com/...` — the Spotify URI

---

## iOS — Core NFC (Swift/SwiftUI)

### iOS Version & Device Requirements

- **Minimum iOS**: 13.0 (writing added in iOS 13; iOS 11–12 read-only)
- **Minimum device**: iPhone 7 (iOS 13+) — Apple confirmed all iPhone 7 and later support NDEF writing via `NFCNDEFTag.writeNDEF()`
- Background tag reading (without opening app) requires iPhone XS / XR or later — not relevant for the write flow
- NFC hardware not available on simulators; a physical device is required for all testing

### Entitlements & Xcode Setup

**Step 1 — Enable NFC capability in Xcode:**
Go to Target > Signing & Capabilities > "+ Capability" > "Near Field Communication Tag Reading"

This automatically adds the entitlement to your `.entitlements` file:

```xml
<!-- YourApp.entitlements -->
<key>com.apple.developer.nfc.readersession.formats</key>
<array>
    <string>TAG</string>
</array>
```

**Step 2 — Info.plist usage description (required):**

```xml
<!-- Info.plist -->
<key>NFCReaderUsageDescription</key>
<string>Eddi uses NFC to write your music card so it plays the right song when tapped.</string>
```

Note: `NFCReaderUsageDescription` covers both reading AND writing — there is no separate `NFCWriterUsageDescription` key.

**Step 3 — Import CoreNFC in your target.**

### App Store Review Considerations

- The NFC entitlement (`com.apple.developer.nfc.readersession.formats`) for reading NDEF tags is a standard capability available to any developer enrolled in the Apple Developer Program — no special approval needed beyond the normal entitlement.
- Apps must have a genuine use case for NFC (writing music cards is valid).
- The `NFCReaderUsageDescription` string must clearly describe why NFC access is needed; vague descriptions risk rejection.
- NFC payment/transaction APIs (Apple Pay, Secure Element) require a separate entitlement agreement with Apple and are unrelated to NDEF tag writing.
- NFC tag writing for consumer use cases (like Eddi) goes through standard App Review — no special pre-approval process.

### Swift Code: Writing 2 NDEF URL Records

This is the full pattern for the Eddi write flow. Key points:
- Use `invalidateAfterFirstRead: false` — required for write sessions (the session stays open until you explicitly call `invalidate()`)
- Use `readerSession(_:didDetect:)` (plural `tags`) — this is the delegate method for the write API (iOS 13+), not `didDetectNDEFs`
- Always call `session.connect(to:)` before querying or writing
- Use `tag.queryNDEFStatus` to verify the tag is writable before attempting write

```swift
import CoreNFC
import SwiftUI

class NFCWriteCoordinator: NSObject, NFCNDEFReaderSessionDelegate {
    private var session: NFCNDEFReaderSession?
    private var cardURL: URL
    private var spotifyURL: URL
    private var onComplete: (Result<Void, Error>) -> Void

    init(cardURL: URL, spotifyURL: URL, onComplete: @escaping (Result<Void, Error>) -> Void) {
        self.cardURL = cardURL
        self.spotifyURL = spotifyURL
        self.onComplete = onComplete
    }

    func beginSession() {
        guard NFCNDEFReaderSession.readingAvailable else {
            onComplete(.failure(NFCError.notSupported))
            return
        }
        session = NFCNDEFReaderSession(
            delegate: self,
            queue: DispatchQueue.main,
            invalidateAfterFirstRead: false   // MUST be false for writing
        )
        session?.alertMessage = "Hold your iPhone near the Eddi card to write it."
        session?.begin()
    }

    // MARK: - NFCNDEFReaderSessionDelegate

    // This delegate method is called when a tag is detected (iOS 13+ write API)
    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else {
            session.invalidate(errorMessage: "No NFC tag found.")
            return
        }

        // Step 1: Connect to the tag
        session.connect(to: tag) { [weak self] error in
            guard let self = self else { return }

            if let error = error {
                session.invalidate(errorMessage: "Connection failed: \(error.localizedDescription)")
                self.onComplete(.failure(error))
                return
            }

            // Step 2: Query NDEF status
            tag.queryNDEFStatus { status, capacity, error in
                if let error = error {
                    session.invalidate(errorMessage: "Failed to query tag: \(error.localizedDescription)")
                    self.onComplete(.failure(error))
                    return
                }

                switch status {
                case .notSupported:
                    session.invalidate(errorMessage: "This tag doesn't support NDEF.")
                    self.onComplete(.failure(NFCError.notNDEF))

                case .readOnly:
                    session.invalidate(errorMessage: "This tag is read-only.")
                    self.onComplete(.failure(NFCError.readOnly))

                case .readWrite:
                    self.writeEddiRecords(to: tag, session: session)

                @unknown default:
                    session.invalidate(errorMessage: "Unknown tag status.")
                    self.onComplete(.failure(NFCError.unknown))
                }
            }
        }
    }

    private func writeEddiRecords(to tag: NFCNDEFTag, session: NFCNDEFReaderSession) {
        // Build Record 1: eddi.audio/c/{cardId}
        guard let record1 = NFCNDEFPayload.wellKnownTypeURIPayload(url: cardURL) else {
            session.invalidate(errorMessage: "Failed to create card URL record.")
            onComplete(.failure(NFCError.encodingFailed))
            return
        }

        // Build Record 2: Spotify URL
        guard let record2 = NFCNDEFPayload.wellKnownTypeURIPayload(url: spotifyURL) else {
            session.invalidate(errorMessage: "Failed to create Spotify URL record.")
            onComplete(.failure(NFCError.encodingFailed))
            return
        }

        // NDEF message with both records
        let message = NFCNDEFMessage(records: [record1, record2])

        // Step 3: Write
        tag.writeNDEF(message) { [weak self] error in
            if let error = error {
                session.invalidate(errorMessage: "Write failed: \(error.localizedDescription)")
                self?.onComplete(.failure(error))
            } else {
                session.alertMessage = "Card written successfully!"
                session.invalidate()
                self?.onComplete(.success(()))
            }
        }
    }

    // Required delegate method — not used for write flow
    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        let nsError = error as NSError
        // Code 200 = user cancelled — not a real error
        if nsError.code != 200 {
            onComplete(.failure(error))
        }
    }
}

// MARK: - SwiftUI Integration

struct WriteCardView: View {
    let cardId: String
    let spotifyURL: String
    @State private var writeStatus: String = "Ready"
    @State private var coordinator: NFCWriteCoordinator?

    var body: some View {
        Button("Write NFC Card") {
            startWrite()
        }
        .disabled(coordinator != nil)

        Text(writeStatus)
    }

    private func startWrite() {
        guard
            let cardURL = URL(string: "https://eddi.audio/c/\(cardId)"),
            let spotify = URL(string: spotifyURL)
        else { return }

        coordinator = NFCWriteCoordinator(
            cardURL: cardURL,
            spotifyURL: spotify
        ) { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    writeStatus = "Written!"
                case .failure(let error):
                    writeStatus = "Error: \(error.localizedDescription)"
                }
                coordinator = nil
            }
        }
        coordinator?.beginSession()
    }
}

// MARK: - Error types

enum NFCError: LocalizedError {
    case notSupported
    case notNDEF
    case readOnly
    case encodingFailed
    case unknown

    var errorDescription: String? {
        switch self {
        case .notSupported: return "NFC is not available on this device."
        case .notNDEF: return "This tag does not support NDEF."
        case .readOnly: return "This tag is read-only."
        case .encodingFailed: return "Failed to encode NFC data."
        case .unknown: return "An unknown NFC error occurred."
        }
    }
}
```

### Notes on `wellKnownTypeURIPayload`

- `NFCNDEFPayload.wellKnownTypeURIPayload(url: URL)` — preferred; takes a `URL`
- `NFCNDEFPayload.wellKnownTypeURIPayload(string: String)` — also available; takes a `String`
- Both return `NFCNDEFPayload?` (optional) — guard against nil
- These encode the URI abbreviation prefix correctly per the NDEF URI spec (e.g., `https://` = 0x04), minimizing tag storage

---

## Android — Kotlin / Jetpack Compose

### Permissions & Manifest

```xml
<!-- AndroidManifest.xml -->
<uses-permission android:name="android.permission.NFC" />

<!-- If NFC is required for the app to function: -->
<uses-feature android:name="android.hardware.nfc" android:required="true" />

<!-- Optional: only install on NFC devices but still run without it: -->
<!-- <uses-feature android:name="android.hardware.nfc" android:required="false" /> -->
```

No runtime permission request is needed — `android.permission.NFC` is a normal permission granted at install time.

### Android Version Requirements

- NFC NDEF write: Android 4.0 (API 14) and above — effectively all modern Android devices
- `NdefRecord.createUri()` helper: available since API 14
- `PendingIntent.FLAG_MUTABLE` required for Android 12 (API 31+) — use a compat pattern

### Foreground Dispatch System

The foreground dispatch system lets your Activity intercept NFC tag intents before the system dispatches them elsewhere. This is the correct pattern for a "tap to write" UX — the system shows your UI and when the user taps a tag, your Activity receives it via `onNewIntent`.

### Complete Kotlin Implementation

```kotlin
// NfcWriteActivity.kt
import android.app.PendingIntent
import android.content.Intent
import android.content.IntentFilter
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import java.io.IOException

class NfcWriteActivity : ComponentActivity() {

    private var nfcAdapter: NfcAdapter? = null
    private var pendingWrite: NdefMessage? = null

    companion object {
        private const val TAG = "EddiNFC"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        nfcAdapter = NfcAdapter.getDefaultAdapter(this)

        setContent {
            WriteCardScreen(
                isNfcAvailable = nfcAdapter != null && nfcAdapter!!.isEnabled,
                onStartWrite = { cardId, spotifyUrl ->
                    prepareWrite(cardId, spotifyUrl)
                }
            )
        }
    }

    /**
     * Call this BEFORE enabling foreground dispatch.
     * Builds the NdefMessage that will be written when the user taps a tag.
     */
    private fun prepareWrite(cardId: String, spotifyUrl: String) {
        val record1 = NdefRecord.createUri("https://eddi.audio/c/$cardId")
        val record2 = NdefRecord.createUri(spotifyUrl)
        pendingWrite = NdefMessage(arrayOf(record1, record2))
        // Now the app is "listening" — show "Tap your card" UI
    }

    override fun onResume() {
        super.onResume()
        enableForegroundDispatch()
    }

    override fun onPause() {
        super.onPause()
        disableForegroundDispatch()
    }

    /**
     * Called when a tag is tapped while the activity is in the foreground.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (NfcAdapter.ACTION_TAG_DISCOVERED == intent.action ||
            NfcAdapter.ACTION_NDEF_DISCOVERED == intent.action ||
            NfcAdapter.ACTION_TECH_DISCOVERED == intent.action
        ) {
            val tag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
            }
            tag?.let { writeToTag(it) }
        }
    }

    private fun enableForegroundDispatch() {
        val intent = Intent(this, javaClass).apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(this, 0, intent, flags)

        // Null filters = intercept ALL NFC tag intents
        nfcAdapter?.enableForegroundDispatch(this, pendingIntent, null, null)
    }

    private fun disableForegroundDispatch() {
        try {
            nfcAdapter?.disableForegroundDispatch(this)
        } catch (e: IllegalStateException) {
            Log.e(TAG, "Error disabling foreground dispatch", e)
        }
    }

    /**
     * Writes the pendingWrite NdefMessage to the tapped tag.
     * Handles both already-formatted (Ndef) and blank (NdefFormatable) tags.
     */
    private fun writeToTag(tag: Tag) {
        val message = pendingWrite ?: run {
            Log.w(TAG, "No pending write — ignoring tag tap")
            return
        }

        // Run on a background thread — NFC I/O is blocking
        Thread {
            val success = try {
                val ndef = Ndef.get(tag)
                if (ndef != null) {
                    // Tag already has NDEF data (or is pre-formatted blank)
                    writeToNdef(ndef, message)
                } else {
                    // Tag is blank / unformatted — needs formatting first
                    val ndefFormatable = NdefFormatable.get(tag)
                    if (ndefFormatable != null) {
                        writeToNdefFormatable(ndefFormatable, message)
                    } else {
                        Log.e(TAG, "Tag does not support NDEF")
                        false
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Write failed", e)
                false
            }

            runOnUiThread {
                if (success) {
                    // Update UI: "Card written!"
                    pendingWrite = null
                } else {
                    // Update UI: "Write failed — try again"
                }
            }
        }.start()
    }

    private fun writeToNdef(ndef: Ndef, message: NdefMessage): Boolean {
        return try {
            ndef.connect()
            if (!ndef.isWritable) {
                Log.e(TAG, "Tag is read-only")
                return false
            }
            val size = message.toByteArray().size
            if (ndef.maxSize < size) {
                Log.e(TAG, "Tag too small: needs $size bytes, has ${ndef.maxSize}")
                return false
            }
            ndef.writeNdefMessage(message)
            Log.d(TAG, "Write successful (Ndef)")
            true
        } finally {
            try { ndef.close() } catch (e: IOException) { /* ignore */ }
        }
    }

    private fun writeToNdefFormatable(ndefFormatable: NdefFormatable, message: NdefMessage): Boolean {
        return try {
            ndefFormatable.connect()
            ndefFormatable.format(message)   // format + write in one call
            Log.d(TAG, "Write successful (NdefFormatable)")
            true
        } finally {
            try { ndefFormatable.close() } catch (e: IOException) { /* ignore */ }
        }
    }
}
```

### Jetpack Compose UI Pattern

```kotlin
@Composable
fun WriteCardScreen(
    isNfcAvailable: Boolean,
    onStartWrite: (cardId: String, spotifyUrl: String) -> Unit
) {
    var isWaiting by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (!isNfcAvailable) {
            Text("NFC is not available or disabled on this device.")
            return@Column
        }

        if (isWaiting) {
            Text("Hold your phone near the Eddi card...", style = MaterialTheme.typography.headlineSmall)
            CircularProgressIndicator()
        } else {
            Button(onClick = {
                // In practice, cardId and spotifyUrl come from your ViewModel
                onStartWrite("abc123", "https://open.spotify.com/track/...")
                isWaiting = true
            }) {
                Text("Write NFC Card")
            }
        }
    }
}
```

### Key Android Notes

- **`NdefRecord.createUri(String)`** — use this for URL records; it automatically picks the correct NDEF URI identifier code (e.g., `0x03` for `https://`, `0x04` for `https://www.`, etc.)
- **Blank tags** (`NdefFormatable`) — use `.format(message)` which formats and writes atomically. Do NOT call `.writeNdefMessage()` on a formatable tag.
- **Already-formatted tags** — use `Ndef.get(tag)` then `.writeNdefMessage(message)`
- **Threading** — NFC I/O is blocking; always do it off the main thread
- **`FLAG_MUTABLE`** — required for Android 12 (API 31+) when creating a mutable `PendingIntent`
- **Foreground dispatch with `null` filters** — catches all tag types; acceptable for a dedicated write screen

---

## React Native / Expo — `react-native-nfc-manager`

### Library

**`react-native-nfc-manager`** by revtel is the canonical cross-platform NFC library for React Native. It abstracts iOS Core NFC and Android NFC APIs behind a unified JS interface.

- npm: `react-native-nfc-manager`
- GitHub: `https://github.com/revtel/react-native-nfc-manager`
- Current stable: v3.x (legacy architecture) | v4.x beta (new architecture / Fabric)
- **Expo managed workflow: NOT supported** — requires bare React Native or Expo bare workflow (ejected). NFC is a native module that cannot run in Expo Go.

### Installation

```bash
npm install react-native-nfc-manager
# iOS
cd ios && pod install
```

**iOS setup — Info.plist:**
```xml
<key>NFCReaderUsageDescription</key>
<string>Eddi uses NFC to write your music card.</string>
```

**iOS setup — Xcode Capabilities:**
Enable "Near Field Communication Tag Reading" under Signing & Capabilities.

**Android setup — AndroidManifest.xml:**
```xml
<uses-permission android:name="android.permission.NFC" />
<uses-feature android:name="android.hardware.nfc" android:required="true" />
```

Also bump `compileSdkVersion` to 31+ for Android 12 compatibility.

### Writing 2 NDEF URL Records to a Blank Tag

The Eddi write flow needs to handle both `NfcTech.Ndef` (pre-formatted tags) and `NfcTech.NdefFormatable` (brand-new blank tags). The strategy: try Ndef first, fall back to NdefFormatable.

```javascript
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';

// Call once at app startup (e.g. in App.js useEffect)
NfcManager.start();

/**
 * Write two URL records to an NFC tag.
 * Handles both pre-formatted and blank (NdefFormatable) tags.
 *
 * @param {string} cardId  - The Eddi card ID (e.g. "abc123")
 * @param {string} spotifyUrl - Full Spotify URL (e.g. "https://open.spotify.com/track/...")
 * @returns {Promise<boolean>} true on success
 */
async function writeEddiTag(cardId, spotifyUrl) {
  const cardUrl = `https://eddi.audio/c/${cardId}`;

  // Build the 2-record NDEF message as a byte array
  const bytes = Ndef.encodeMessage([
    Ndef.uriRecord(cardUrl),       // Record 1: linktree page
    Ndef.uriRecord(spotifyUrl),    // Record 2: Spotify URL
  ]);

  let success = false;

  // Strategy: try Ndef (works on pre-formatted tags and iOS)
  // If that fails, try NdefFormatable (blank Android tags)
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef);
    await NfcManager.ndefHandler.writeNdefMessage(bytes);
    success = true;
  } catch (ndefError) {
    // Ndef tech not available — try NdefFormatable (Android blank tags only)
    NfcManager.cancelTechnologyRequest().catch(() => {});
    try {
      await NfcManager.requestTechnology(NfcTech.NdefFormatable);
      await NfcManager.ndefFormatableHandler.formatNdef(bytes);
      success = true;
    } catch (formatError) {
      console.warn('NFC write failed:', formatError);
    } finally {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
    return success;
  } finally {
    if (success) {
      NfcManager.cancelTechnologyRequest().catch(() => {});
    }
  }

  return success;
}
```

### React Hook Pattern

```javascript
import { useState, useCallback } from 'react';
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';

export function useEddiNfcWrite() {
  const [status, setStatus] = useState('idle'); // 'idle' | 'waiting' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState(null);

  const writeTag = useCallback(async (cardId, spotifyUrl) => {
    setStatus('waiting');
    setErrorMessage(null);

    const cardUrl = `https://eddi.audio/c/${cardId}`;
    const bytes = Ndef.encodeMessage([
      Ndef.uriRecord(cardUrl),
      Ndef.uriRecord(spotifyUrl),
    ]);

    let techRequested = false;
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      techRequested = true;
      await NfcManager.ndefHandler.writeNdefMessage(bytes);
      setStatus('success');
    } catch (e) {
      if (techRequested) {
        await NfcManager.cancelTechnologyRequest().catch(() => {});
        techRequested = false;
      }
      // Fallback: blank tag (Android only)
      try {
        await NfcManager.requestTechnology(NfcTech.NdefFormatable);
        techRequested = true;
        await NfcManager.ndefFormatableHandler.formatNdef(bytes);
        setStatus('success');
      } catch (formatError) {
        setStatus('error');
        setErrorMessage(formatError?.message ?? 'Write failed');
      }
    } finally {
      if (techRequested) {
        await NfcManager.cancelTechnologyRequest().catch(() => {});
      }
    }
  }, []);

  const cancel = useCallback(() => {
    NfcManager.cancelTechnologyRequest().catch(() => {});
    setStatus('idle');
  }, []);

  return { status, errorMessage, writeTag, cancel };
}
```

### `Ndef.uriRecord()` vs `Ndef.textRecord()`

| Method | Use for |
|--------|---------|
| `Ndef.uriRecord(url)` | URL records (TNF=0x01, type=U) — correct for Eddi |
| `Ndef.textRecord(text)` | Plain text records |
| `Ndef.encodeMessage([...])` | Wraps records into a byte array for writing |

Use `Ndef.uriRecord()` for both the eddi.audio URL and the Spotify URL.

### Platform Differences

| Concern | iOS | Android |
|---------|-----|---------|
| Blank tag handling | iOS presents formatted tags; blank tags may show as `Ndef` with empty message | Blank tags appear as `NdefFormatable` — need `.formatNdef()` |
| Multi-record in one session | Supported | Tag must be removed and re-tapped for a new session |
| "Tap to write" UX | System sheet appears when `requestTechnology` is called | Foreground dispatch handled by the library; no extra setup needed |
| NdefFormatable | Not applicable (handled as Ndef) | Required for brand-new blank tags |
| iOS minimum | iOS 13, iPhone 7+ | Android 4.0+ |

### Known Limitation: Multiple Records

There have been reports (GitHub issue #274) that `Ndef.encodeMessage()` with multiple records can fail on some Android hardware/tags. If this becomes an issue in testing:
- Verify the tag has enough storage (most NTAG213 tags have 137 bytes usable; two short URLs should fit easily)
- Test with NTAG213 or NTAG215 tags which are the most broadly compatible
- As a fallback, consider writing only Record 1 (the eddi.audio URL) if storage is tight, since that's the one the iPhone/Android system will follow on tap

---

## Recommendation for Eddi

| Approach | Pros | Cons |
|----------|------|------|
| **Native iOS (Swift) + Native Android (Kotlin)** | Full control, best UX, no library risk | Two codebases |
| **React Native + react-native-nfc-manager** | One codebase, faster to ship | Expo managed not supported; NdefFormatable edge cases; library maintenance risk |

If Eddi ships a React Native app (not Expo managed), `react-native-nfc-manager` is the fastest path. The write flow is ~20 lines of JS and the library handles platform differences.

If Eddi ships fully native apps, the iOS Swift and Android Kotlin patterns above are production-ready and give full control over UX (iOS system sheet text, Android haptics, etc.).

---

## Sources

- [Core NFC | Apple Developer Documentation](https://developer.apple.com/documentation/corenfc)
- [Near Field Communication Tag Reader Session Formats Entitlement | Apple Developer](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.nfc.readersession.formats)
- [Core NFC Enhancements — WWDC19 | Apple](https://developer.apple.com/videos/play/wwdc2019/715/)
- [Apple Expands NFC Tag Functionality on iPhone in iOS 13 — GoToTags](https://gototags.com/articles/apple-expands-nfc-tag-functionality-on-iphone-in-ios-13)
- [Working with Core NFC in iOS: Reading and Writing NFC Tags — CloudDevs](https://clouddevs.com/ios/reading-and-writing-nfc-tags/)
- [Advanced NFC overview | Android Developers](https://developer.android.com/develop/connectivity/nfc/advanced-nfc)
- [NdefRecord API reference | Android Developers](https://developer.android.com/reference/android/nfc/NdefRecord)
- [NdefFormatable API reference | Android Developers](https://developer.android.com/reference/android/nfc/tech/NdefFormatable)
- [Working with NFC tags on Android — Vivek Maskara](https://www.maskaravivek.com/post/working-with-nfc-tags-on-android/)
- [react-native-nfc-manager — GitHub (revtel)](https://github.com/revtel/react-native-nfc-manager)
- [react-native-nfc-manager Wiki: Examples](https://github.com/revtel/react-native-nfc-manager/wiki/Examples)
- [Using NFC tags in React Native — LogRocket](https://blog.logrocket.com/using-nfc-tags-react-native/)
- [NFC Tags, NDEF and Android with Kotlin — andreasjakl.com](https://www.andreasjakl.com/nfc-tags-ndef-and-android-with-kotlin/)
