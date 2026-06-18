import React, { useState, useEffect, useRef } from 'react';

// Official Spotify Web Playback SDK player. We use the OFFICIAL SDK (not
// librespot) because librespot — an unofficial client — is refused audio keys
// on the new eddi.audio account. The SDK runs in this kiosk browser, registers
// as a Connect device, and renders audio (Chromium → PipeWire → amp).
//
// Architecture: this component makes ZERO direct api.spotify.com REST calls.
//  - STATE comes from the SDK's `player_state_changed` push events (no polling).
//    (The 1s /me/player poll the display-only build used is what tripped the
//    Web-API rate-limit lockout — gone now.)
//  - CONTROLS are local SDK methods (togglePlay/next/previous/setVolume).
//  - Everything else (the device id, play-a-chosen-track, queue, suggestions,
//    playlist edits) goes through OUR backend at localhost:5000, which is the
//    single, rate-limit-aware talker to Spotify. Card taps are played by the
//    backend onto the device id we register below.

const API = 'http://localhost:5000';

function SpotifyPlayer({ currentCard }) {
  const [deviceId, setDeviceId] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPaused, setIsPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.5);
  const [queue, setQueue] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [toast, setToast] = useState(null);
  const [trackInPlaylist, setTrackInPlaylist] = useState(false);
  const [addedToPlaylist, setAddedToPlaylist] = useState(new Set());

  const playerRef = useRef(null);
  const deviceIdRef = useRef(null);
  const tickRef = useRef(null);
  const toastTimerRef = useRef(null);
  const lastFetchedTrackRef = useRef(null);

  // ─── Register/clear our SDK device id with the backend ──────────────────────
  const registerDevice = (id) => {
    fetch(`${API}/spotify/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: id }),
    }).catch(() => {});
  };

  // ─── Web Playback SDK init ──────────────────────────────────────────────────
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Eddi',
        getOAuthToken: async cb => {
          try {
            const res = await fetch(`${API}/spotify/token`);
            const data = await res.json();
            cb(data.access_token);
          } catch (e) { console.error('token fetch failed', e); }
        },
        volume: 0.5,
      });

      player.addListener('ready', ({ device_id }) => {
        console.log('SDK ready, device', device_id);
        setDeviceId(device_id);
        deviceIdRef.current = device_id;
        registerDevice(device_id);           // backend will play card taps here
        try { player.activateElement(); } catch (e) {}  // satisfy autoplay (kiosk allows it)
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.log('SDK not_ready', device_id);
        deviceIdRef.current = null;
        registerDevice(null);
        setTimeout(() => { if (playerRef.current) playerRef.current.connect(); }, 3000);
      });

      ['initialization_error', 'authentication_error', 'account_error', 'playback_error']
        .forEach(ev => player.addListener(ev, ({ message }) => console.error(ev, message)));

      player.addListener('player_state_changed', state => {
        if (!state) return;
        const track = state.track_window.current_track;
        setCurrentTrack(track);
        setIsPaused(state.paused);
        setPosition(state.position);
        setDuration(state.duration);

        if (tickRef.current) clearInterval(tickRef.current);
        if (!state.paused) {
          tickRef.current = setInterval(() => {
            setPosition(prev => (state.duration ? Math.min(prev + 1000, state.duration) : prev + 1000));
          }, 1000);
        }
      });

      player.connect();
      playerRef.current = player;

      // On reload/close, proactively disconnect so this device drops out of
      // Spotify's Connect list immediately instead of lingering as an offline
      // "Eddi" zombie (which is what stacks up to "2 Eddis" across reloads).
      window.addEventListener('beforeunload', () => {
        registerDevice(null);
        try { player.disconnect(); } catch (e) {}
      });
    };

    return () => {
      if (playerRef.current) playerRef.current.disconnect();
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Liveness watchdog ──────────────────────────────────────────────────────
  // The browser SDK device is the audio renderer; recover if it silently goes
  // offline. Every minute, if we've LOST the device id, try to reconnect; if it
  // stays gone for ~5 min, reload the page to fully re-init the SDK. Recovery is
  // keyed on the device being GONE — never on "no recent events", because
  // player_state_changed is silent during steady playback, so an events-based
  // check would false-trigger a reload mid-podcast and cut the audio. Empty deps
  // so the streak persists (it isn't reset by re-rendering on card changes).
  useEffect(() => {
    let deadMinutes = 0;
    const id = setInterval(() => {
      if (deviceIdRef.current) { deadMinutes = 0; return; }
      deadMinutes += 1;
      if (playerRef.current) playerRef.current.connect();
      if (deadMinutes >= 5) window.location.reload();
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ─── Queue + suggestions on track change (via backend proxy) ────────────────
  useEffect(() => {
    if (!currentTrack || currentTrack.id === lastFetchedTrackRef.current) return;
    lastFetchedTrackRef.current = currentTrack.id;
    setTrackInPlaylist(false);
    setAddedToPlaylist(new Set());
    fetchQueue();
    fetchSuggestions(currentTrack);
  }, [currentTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchQueue = async () => {
    try {
      const res = await fetch(`${API}/spotify/queue`);
      const data = await res.json();
      setQueue(data.queue || []);
    } catch (e) { /* backend serves cached/last-known */ }
  };

  const fetchSuggestions = async (track) => {
    const artistId = track.artists?.[0]?.uri?.split(':')[2];
    if (!artistId) return;
    try {
      const res = await fetch(`${API}/spotify/suggestions?artist_id=${artistId}`);
      const data = await res.json();
      setSuggestions((data.tracks || []).filter(t => t.uri !== track.uri).slice(0, 8));
    } catch (e) { /* ignore */ }
  };

  // ─── Controls — local SDK methods (no REST) ─────────────────────────────────
  const togglePlay = () => { setIsPaused(p => !p); if (playerRef.current) playerRef.current.togglePlay(); };
  const skipNext = () => { if (playerRef.current) playerRef.current.nextTrack(); };
  const skipPrevious = () => { if (playerRef.current) playerRef.current.previousTrack(); };
  const handleVolume = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (playerRef.current) playerRef.current.setVolume(val);
  };

  // ─── Play a chosen track (queue/suggestion clicks) — via backend proxy ──────
  const backendPlay = (body) => {
    fetch(`${API}/spotify/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(e => console.error('play proxy error', e));
  };
  const playQueueTrack = (track) => {
    if (!currentCard?.spotify_uri) return;
    backendPlay({ context_uri: currentCard.spotify_uri, offset: { uri: track.uri } });
  };
  const playSingleTrack = (track) => backendPlay({ uris: [track.uri] });

  // ─── Toast ────────────────────────────────────────────────────────────────
  const showToast = (message, onUndo) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, onUndo });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  // ─── Playlist add/remove — via backend proxy ────────────────────────────────
  const playlistEdit = async (method, playlistId, trackUri, trackName, onDone) => {
    try {
      const res = await fetch(`${API}/spotify/playlist/${playlistId}/tracks`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'DELETE' ? { tracks: [{ uri: trackUri }] } : { uris: [trackUri] }),
      });
      if (res.ok || res.status === 200 || res.status === 201) onDone();
    } catch (e) { console.error('playlist edit error', e); }
  };
  const addTrackToPlaylist = (playlistId, trackUri, trackName) =>
    playlistEdit('POST', playlistId, trackUri, trackName, () => {
      if (trackUri === currentTrack?.uri) setTrackInPlaylist(true);
      setAddedToPlaylist(prev => new Set(prev).add(trackUri));
      showToast(`Added "${trackName}"`, () => removeTrackFromPlaylist(playlistId, trackUri, trackName));
    });
  const removeTrackFromPlaylist = (playlistId, trackUri, trackName) =>
    playlistEdit('DELETE', playlistId, trackUri, trackName, () => {
      if (trackUri === currentTrack?.uri) setTrackInPlaylist(false);
      setAddedToPlaylist(prev => { const n = new Set(prev); n.delete(trackUri); return n; });
      showToast(`Removed "${trackName}"`, () => addTrackToPlaylist(playlistId, trackUri, trackName));
    });

  const formatTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  // ─── Screens ──────────────────────────────────────────────────────────────
  if (!currentCard) {
    return (
      <div className="no-card-screen">
        <div className="nfc-icon">📱</div>
        <h2>Place an NFC card to start playing</h2>
      </div>
    );
  }
  if (!currentTrack) {
    return (
      <div className="loading-screen">
        <h2>Loading {currentCard.name}...</h2>
      </div>
    );
  }

  const playlistId = currentCard.spotify_uri?.startsWith('spotify:playlist:')
    ? currentCard.spotify_uri.split(':')[2]
    : null;

  // ─── Main player UI ─────────────────────────────────────────────────────────
  return (
    <div className="player-container">
      <div className="player-section">
        <img src={currentTrack.album?.images?.[0]?.url} alt={currentTrack.album?.name} className="album-art" />
        <div className="track-info">
          <h2 className="track-name">{currentTrack.name}</h2>
          <p className="artist-name">{currentTrack.artists?.map(a => a.name).join(', ')}</p>
        </div>
        <div className="progress-bar">
          <span className="time">{formatTime(position)}</span>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${(position / duration) * 100}%` }} />
          </div>
          <span className="time">{formatTime(duration)}</span>
        </div>
        <div className="controls">
          <button onClick={skipPrevious} className="control-btn">⏮</button>
          <button onClick={togglePlay} className="control-btn play-btn">{isPaused ? '▶' : '⏸'}</button>
          <button onClick={skipNext} className="control-btn">⏭</button>
        </div>
        <div className="volume-control">
          <span className="volume-icon">🔈</span>
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolume} className="volume-slider" />
          <span className="volume-icon">🔊</span>
        </div>
        {playlistId && (
          <button
            className={`playlist-btn${trackInPlaylist ? ' in-playlist' : ''}`}
            onClick={() => trackInPlaylist
              ? removeTrackFromPlaylist(playlistId, currentTrack.uri, currentTrack.name)
              : addTrackToPlaylist(playlistId, currentTrack.uri, currentTrack.name)}
          >
            {trackInPlaylist ? '♥ In playlist' : '♡ Add to playlist'}
          </button>
        )}
      </div>

      <div className="lyrics-section">
        <div className="section-header">Lyrics</div>
        <div className="lyrics-content">
          <p className="lyrics-placeholder">Lyrics coming soon...</p>
          <p className="lyrics-note">Now playing from: {currentCard.name}</p>
        </div>
      </div>

      <div className="queue-section">
        <div className="section-header">Up Next</div>
        <div className="queue-list">
          {queue.length > 0 ? queue.slice(0, 5).map((track, i) => (
            <div key={i} className="queue-item queue-item-playable" onClick={() => playQueueTrack(track)}>
              <img src={track.album?.images?.slice(-1)[0]?.url} alt="" className="queue-item-art" />
              <div className="queue-item-info">
                <div className="queue-item-name">{track.name}</div>
                <div className="queue-item-artist">{track.artists?.map(a => a.name).join(', ')}</div>
              </div>
            </div>
          )) : (<p className="queue-empty">No upcoming tracks</p>)}
        </div>
        {suggestions.length > 0 && (
          <div className="suggestions-area">
            <hr className="queue-suggestions-divider" />
            <div className="section-header suggestions-divider">Suggested</div>
            {suggestions.map((track, i) => {
              const alreadyAdded = addedToPlaylist.has(track.uri);
              return (
                <div key={i} className="queue-item suggestion-item clickable" onClick={() => playSingleTrack(track)}>
                  <img src={track.album?.images?.slice(-1)[0]?.url} alt="" className="queue-item-art" />
                  <div className="queue-item-info">
                    <div className="queue-item-name">{track.name}</div>
                    <div className="queue-item-artist">{track.artists?.map(a => a.name).join(', ')}</div>
                  </div>
                  {playlistId && (
                    <span
                      className={`add-btn${alreadyAdded ? ' added' : ''}`}
                      onClick={e => { e.stopPropagation(); !alreadyAdded && addTrackToPlaylist(playlistId, track.uri, track.name); }}
                    >{alreadyAdded ? '✓' : '+'}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className="toast">
          <span className="toast-message">{toast.message}</span>
          <button className="toast-undo" onClick={() => {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            setToast(null);
            toast.onUndo();
          }}>Undo</button>
        </div>
      )}
    </div>
  );
}

export default SpotifyPlayer;
