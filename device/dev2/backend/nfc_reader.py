#!/usr/bin/env python3
# NFC card reader for Cardcast.
# Runs as a systemd service (nfc-reader.service) on the Raspberry Pi.
# Continuously polls the PN532 NFC reader via SPI, parses NDEF records
# from NTAG215 cards, and posts the card state to the Flask backend.

import board
import busio
import digitalio
from adafruit_pn532.spi import PN532_SPI
import requests
import time
import re

# URL prefix codes from NFC Forum URI Record Type Definition spec.
# The first byte of a URI record payload is an identifier code that expands
# to a common URL prefix, saving space on the small NFC card memory.
_URL_PREFIXES = {
    0x00: '',
    0x01: 'http://www.',
    0x02: 'https://www.',
    0x03: 'http://',
    0x04: 'https://',
    0x05: 'tel:',
    0x06: 'mailto:',
    0x07: 'ftp://anonymous:anonymous@',
    0x08: 'ftp://ftp.',
    0x09: 'ftps://',
    0x0A: 'sftp://',
    0x0B: 'smb://',
    0x0C: 'nfs://',
    0x0D: 'ftp://',
    0x0E: 'dav://',
    0x0F: 'news:',
    0x10: 'telnet://',
    0x11: 'imap:',
    0x12: 'rtsp://',
    0x13: 'urn:',
    0x14: 'pop:',
    0x15: 'sip:',
    0x16: 'sips:',
    0x17: 'tftp:',
    0x18: 'btspp://',
    0x19: 'btl2cap://',
    0x1A: 'btgoep://',
    0x1B: 'tcpobex://',
    0x1C: 'irdaobex://',
    0x1D: 'file://',
    0x1E: 'urn:epc:id:',
    0x1F: 'urn:epc:tag:',
    0x20: 'urn:epc:pat:',
    0x21: 'urn:epc:raw:',
    0x22: 'urn:epc:',
    0x23: 'urn:nfc:',
}


def init_pn532():
    """
    Initialise the PN532 NFC reader over SPI.
    GPIO 25 (board.D25) is used as the software chip-select line instead of
    the hardware CE0 (GPIO 8) to avoid a conflict with the merus-amp overlay.
    """
    spi = busio.SPI(board.SCK, board.MOSI, board.MISO)
    cs = digitalio.DigitalInOut(board.D25)
    pn532 = PN532_SPI(spi, cs, debug=False)
    ic, ver, rev, support = pn532.firmware_version
    print(f"PN532 ready. Firmware v{ver}.{rev}", flush=True)
    # Put the PN532 into normal operating mode (Security Access Module config)
    pn532.SAM_configuration()
    return pn532


def read_ndef_pages(pn532):
    """
    Read NTAG215 user-memory pages 4–39 (144 bytes total) and return raw bytes.
    Each page is 4 bytes. Retries each page up to 3 times with a short delay
    because the PN532 can occasionally fail a single block read due to RF noise.
    Stops early if the NDEF terminator byte (0xFE) is found, avoiding
    unnecessary reads of blank pages.
    """
    raw = []
    for page in range(4, 40):
        data = None
        for attempt in range(3):  # retry each block read up to 3 times
            data = pn532.ntag2xx_read_block(page)
            if data is not None:
                break
            time.sleep(0.02)  # brief pause before retrying the same block
        if data is None:
            # Block failed after all retries — card likely moved away
            break
        raw.extend(data)
        if 0xFE in data:
            # NDEF terminator TLV — all records have been read
            break
    return bytes(raw)


def parse_ndef_url(data):
    """
    Walk the NDEF TLV structure in the raw page bytes and extract a URL.
    Handles NULL TLVs (0x00), the NDEF Message TLV (0x03), and the
    Terminator TLV (0xFE). Returns the URL string or None if not found.
    """
    i = 0
    while i < len(data):
        tlv_tag = data[i]
        i += 1

        if tlv_tag == 0x00:   # NULL TLV — padding byte, skip
            continue
        if tlv_tag == 0xFE:   # Terminator TLV — end of NDEF data
            break

        # All non-null TLVs are followed by a length field
        if i >= len(data):
            break
        length = data[i]
        i += 1
        if length == 0xFF:    # 3-byte length form (for payloads > 254 bytes)
            if i + 2 > len(data):
                break
            length = (data[i] << 8) | data[i + 1]
            i += 2

        if tlv_tag != 0x03:   # Not an NDEF Message TLV — skip its payload
            i += length
            continue

        # Found an NDEF Message TLV — parse the NDEF records inside it
        ndef = data[i:i + length]
        i += length

        url = _parse_ndef_record(ndef)
        if url:
            return url

    return None


def _parse_ndef_record(ndef):
    """
    Parse the first NDEF record from a raw NDEF message byte string.
    Supports URI records (type 'U') and Text records (type 'T').
    Returns the URL/text string, or None if the record type is unsupported.
    """
    if len(ndef) < 3:
        return None

    # First byte is the record flags
    flags = ndef[0]
    sr = (flags >> 4) & 1   # Short Record bit: payload length is 1 byte instead of 4
    il = (flags >> 3) & 1   # ID Length bit: an ID field is present
    tnf = flags & 0x07       # Type Name Format (not used here, we check type bytes)

    type_len = ndef[1]
    offset = 2

    # Read the payload length (1 byte if SR set, 4 bytes otherwise)
    if sr:
        if offset >= len(ndef):
            return None
        payload_len = ndef[offset]
        offset += 1
    else:
        if offset + 4 > len(ndef):
            return None
        payload_len = (ndef[offset] << 24 | ndef[offset+1] << 16 |
                       ndef[offset+2] << 8 | ndef[offset+3])
        offset += 4

    # Skip the optional ID field
    if il:
        if offset >= len(ndef):
            return None
        id_len = ndef[offset]
        offset += 1
    else:
        id_len = 0

    rec_type = ndef[offset:offset + type_len]
    offset += type_len + id_len
    payload = ndef[offset:offset + payload_len]

    # If the record claims more payload than we actually read, a partial page
    # read truncated it mid-URL. Reject so the caller re-reads — an accepted
    # truncated eddi id (e.g. 8jp548kq -> 8jp5) 404s and hangs the player.
    if len(payload) < payload_len:
        return None

    if rec_type == b'U':   # URI record — first payload byte is a prefix code
        prefix = _URL_PREFIXES.get(payload[0], '')
        return prefix + payload[1:].decode('utf-8', errors='ignore')

    if rec_type == b'T':   # Text record — skip the language tag
        lang_len = payload[0] & 0x3F
        return payload[1 + lang_len:].decode('utf-8', errors='ignore')

    return None


def spotify_url_to_uri(url_or_uri):
    """
    Convert a Spotify share URL or existing URI to spotify:type:id format.
    Examples:
      https://open.spotify.com/playlist/37i9dQZF1DX... → spotify:playlist:37i9dQZF1DX...
      spotify:album:abc123                             → spotify:album:abc123 (unchanged)
    Returns None if the input doesn't match a known Spotify URL pattern.
    """
    if url_or_uri.startswith('spotify:'):
        return url_or_uri
    match = re.search(
        r'open\.spotify\.com/(album|playlist|track|show|episode)/([a-zA-Z0-9]+)',
        url_or_uri
    )
    if match:
        return f"spotify:{match.group(1)}:{match.group(2)}"
    return None


def eddi_card_id_from_url(url):
    """
    Extract the card id from a new-format Eddi "linktree" card URL.
    New cards write an NDEF URI record of the form https://eddi.audio/c/{id}
    as their first record. We pull {id} out and hand it to the backend, which
    resolves it through the Eddi API (GET /cards/{id}) to a playable URI.
    Returns the card id string, or None if the URL isn't an Eddi card link.
    """
    match = re.search(r'eddi\.audio/c/([A-Za-z0-9_-]+)', url)
    return match.group(1) if match else None


def notify_backend(card_uid, spotify_uri, eddi_card_id=None):
    """
    POST the current card state to the Flask backend.
    Called with card_uid=None and spotify_uri=None when the card is removed.
    When eddi_card_id is set (new-format card), the backend resolves it via the
    Eddi API, so the timeout is a bit longer to allow that round-trip.
    """
    payload = {'card_uid': card_uid, 'spotify_uri': spotify_uri}
    if eddi_card_id:
        payload['eddi_card_id'] = eddi_card_id
    try:
        requests.post(
            'http://localhost:5000/nfc/update',
            json=payload,
            timeout=6 if eddi_card_id else 2
        )
        return True
    except Exception as e:
        print(f"Backend error (will retry): {e}", flush=True)
        return False


def main():
    pn532 = init_pn532()
    print("NFC reader ready. Tap a card...", flush=True)

    last_uid = None      # UID of the card seen on the previous poll iteration
    absent_count = 0     # consecutive polls with no card detected
    retry_uid = None     # a present card whose read burst failed — keep re-reading it
    retry_count = 0      # consecutive failed read bursts for retry_uid

    # RF flicker fix: the PN532 field can briefly re-detect a card that was just
    # pulled away. We require 2 consecutive absent polls (~1s) before treating a
    # removal as real. This eliminates flicker re-plays without blocking intentional
    # re-placement — once 2 polls confirm the card is gone, the next detection is
    # treated as a fresh placement immediately.
    ABSENT_THRESHOLD = 2

    # If a card's read burst fails but the card is still present, re-read it on the
    # next poll rather than giving up — a one-off weak/truncated read (a single flaky
    # page) then self-heals without the user re-tapping. Only after this many failed
    # bursts (~3s) do we conclude the tag is genuinely unreadable/unlinked and surface
    # that to the UI as "card not recognized".
    MAX_READ_RETRIES = 4

    # RF keep-alive: SAM_configuration() enables normal RF mode at startup, but the
    # PN532's RF field can silently die after SPI glitches or prolonged idle periods.
    # Re-calling it periodically costs nothing and keeps the field active.
    SAM_KEEPALIVE_INTERVAL = 30  # seconds of idle before refreshing RF
    idle_since = time.monotonic()  # tracks when we last confirmed RF was working

    while True:
        # Periodic RF keep-alive when reader has been idle
        if last_uid is None and (time.monotonic() - idle_since) > SAM_KEEPALIVE_INTERVAL:
            try:
                pn532.SAM_configuration()
                print("[PN532] RF keep-alive OK", flush=True)
            except Exception as e:
                print(f"[PN532] Keep-alive error: {e} — reinitialising", flush=True)
                try:
                    pn532 = init_pn532()
                except Exception as e2:
                    print(f"[PN532] Reinit failed: {e2}", flush=True)
                    time.sleep(2)
            idle_since = time.monotonic()  # reset regardless of success/fail

        # Poll for a card with a 0.5s RF field timeout
        try:
            uid = pn532.read_passive_target(timeout=0.5)
        except Exception as e:
            print(f"[PN532] Poll error: {e} — reinitialising", flush=True)
            try:
                pn532 = init_pn532()
                idle_since = time.monotonic()
            except Exception as e2:
                print(f"[PN532] Reinit failed: {e2}", flush=True)
                time.sleep(2)
            continue

        if uid is not None:
            absent_count = 0  # card is present — reset removal counter
            idle_since = time.monotonic()  # RF is confirmed working
            uid_str = ''.join(f'{b:02x}' for b in uid)

            # Only process if this is a newly presented card (different UID from last time)
            if uid_str != last_uid:
                # New placement, or one whose previous read burst failed and we're
                # re-reading it. Only announce a genuinely new card so retry polls
                # don't spam the log.
                if uid_str != retry_uid:
                    retry_uid = uid_str
                    retry_count = 0
                    print(f"\n=== CARD DETECTED ===", flush=True)
                    print(f"UID: {uid_str}", flush=True)

                # Brief pause to let the RF field stabilise before reading pages
                time.sleep(0.05)

                # Attempt to read a valid Spotify URI from the card, retrying up to 3 times.
                # Retries are needed because the PN532 occasionally returns partial data.
                # Between attempts we re-target (re-activate) the card so the PN532 has
                # a fresh connection before the next read sequence.
                uri = None
                eddi_id = None
                for attempt in range(3):
                    try:
                        raw = read_ndef_pages(pn532)
                        url = parse_ndef_url(raw)
                    except Exception as e:
                        print(f"Read attempt {attempt+1} error: {e}", flush=True)
                        url = None

                    if url:
                        print(f"URL: {url}", flush=True)
                        # New-format Eddi "linktree" card: first record is
                        # https://eddi.audio/c/{id}. Hand the id to the backend,
                        # which resolves it via the Eddi API to a playable URI.
                        candidate_id = eddi_card_id_from_url(url)
                        # Eddi ids are exactly 8 chars (nanoid alphabet, length 8).
                        # A shorter capture means the read truncated mid-id
                        # (8jp548kq -> 8jp5); discard and retry rather than ship a
                        # bad id that 404s and leaves the player stuck loading.
                        if candidate_id and len(candidate_id) == 8:
                            eddi_id = candidate_id
                            print(f"Eddi card id: {eddi_id}", flush=True)
                            break  # clean, full-length read — backend resolves it
                        if candidate_id:
                            print(f"Attempt {attempt+1}: truncated eddi id "
                                  f"'{candidate_id}' ({len(candidate_id)} chars), "
                                  f"retrying...", flush=True)
                        else:
                            # Legacy card: a direct Spotify share URL on the tag.
                            # Spotify IDs are 22 Base62 chars — a shorter ID means
                            # the read truncated mid-URL, so discard and retry.
                            candidate = spotify_url_to_uri(url)
                            if candidate and len(candidate.split(':')[-1]) >= 20:
                                uri = candidate
                                print(f"URI: {uri}", flush=True)
                                break  # clean read — stop retrying
                            else:
                                print(f"Attempt {attempt+1}: partial/truncated, retrying...", flush=True)
                    else:
                        print(f"Attempt {attempt+1}: no NDEF data, retrying...", flush=True)

                    if attempt < 2:
                        time.sleep(0.15)
                        # Re-target the card: without this the PN532 loses the card's
                        # activation state and subsequent block reads return nothing
                        try:
                            pn532.read_passive_target(timeout=0.3)
                        except Exception:
                            pass

                if eddi_id:
                    if notify_backend(uid_str, None, eddi_card_id=eddi_id):
                        last_uid = uid_str           # handled — backend got the id
                        retry_uid = None; retry_count = 0
                elif uri:
                    if notify_backend(uid_str, uri):
                        last_uid = uid_str           # handled — else retry next poll
                        retry_uid = None; retry_count = 0
                else:
                    # The burst produced nothing usable (truncated / weak / blank tag).
                    # If the card was pulled away mid-read, register removal. If it's
                    # still sitting there, re-read on the next poll (a flaky read
                    # self-heals) up to MAX_READ_RETRIES before giving up — so we never
                    # ship a bad id, and a weak read never needs a manual re-tap.
                    try:
                        still_present = pn532.read_passive_target(timeout=0.3)
                    except Exception:
                        still_present = None
                    if still_present is None:
                        print("Card removed during read", flush=True)
                        notify_backend(None, None)
                        retry_uid = None; retry_count = 0   # last_uid stays None
                    else:
                        retry_count += 1
                        if retry_count < MAX_READ_RETRIES:
                            # Leave last_uid unset so the next poll re-reads this card.
                            print(f"Read burst {retry_count}/{MAX_READ_RETRIES} failed "
                                  f"for {uid_str}; re-reading next poll...", flush=True)
                        else:
                            # Genuinely unreadable: blank tag, or a real card whose
                            # backend record is gone. Hand the UID over so the UI shows
                            # "card not recognized", and stop retrying this placement.
                            print(f"Giving up on {uid_str} after {retry_count} bursts", flush=True)
                            if notify_backend(uid_str, None):
                                last_uid = uid_str
                            retry_uid = None; retry_count = 0

        else:
            # No card detected — increment counter and notify only after threshold
            if last_uid is not None:
                absent_count += 1
                if absent_count >= ABSENT_THRESHOLD:
                    print("\n=== CARD REMOVED ===", flush=True)
                    if notify_backend(None, None):  # else keep retrying the removal next poll
                        last_uid = None
                        absent_count = 0
            else:
                absent_count = 0
            # Card gone — drop any in-progress read-retry so a re-tap starts fresh.
            if retry_uid is not None:
                retry_uid = None
                retry_count = 0


if __name__ == '__main__':
    main()
