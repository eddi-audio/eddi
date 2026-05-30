# software/secrets/ — ⚠️ BACK THESE UP, NEVER COMMIT

This folder holds the **Android production signing secrets**. Everything here
except this README is git-ignored (see root `.gitignore`), so it stays in the
project — discoverable, beside the code — without ever reaching git.

## Files that belong here

- **`eddi-release.jks`** — the production signing keystore.
- **`signing.properties`** — the keystore alias + passwords. Read at build time
  by `software/packages/app/android/app/build.gradle`.

## 🔑 Why backup is non-negotiable

If you lose **either** file (the `.jks` or its passwords), you can **never
publish an update** to the Eddi Android app again — Google permanently ties the
published app to this key. There is no recovery.

**Back up both** to:
1. A password manager (attach the `.jks`, store `signing.properties` as a secure note), AND
2. One offsite/encrypted location.

## How signing works

`build.gradle` looks for `signing.properties` here. If present, release builds are
signed with the production cert. If absent (e.g. a fresh clone on another
machine), it falls back to debug signing so the project still builds — but that
build is **not** Play-uploadable.

Recorded prod cert SHA-256:
`B7:E7:03:8A:ED:E4:4F:AD:35:85:E6:AD:93:D9:95:93:51:F1:23:BB:E0:60:CC:05:EB:7C:F5:22:CF:28:6D:F4`
