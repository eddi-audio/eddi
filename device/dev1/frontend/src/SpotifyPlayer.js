import React, { useState, useEffect, useRef } from 'react';

function SpotifyPlayer({ token, currentCard }) {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPaused, setIsPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activated, setActivated] = useState(false);
  const [volume, setVolume] = useState(0.15);
  const [queue, setQueue] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [toast, setToast] = useState(null);
  const [trackInPlaylist, setTrackInPlaylist] = useState(false);
  const [addedToPlaylist, setAddedToPlaylist] = useState(new Set());

  // Refs persist across renders without triggering re-renders
  const lastCardRef = useRef(null);
  const intervalRef = useRef(null);
  const playerRef = useRef(null);
  const deviceIdRef = useRef(null);
  const toastTimerRef = useRef(null);
  const lastFetchedTrackRef = useRef(null);
  const queueFetchTimerRef = useRef(null); // delayed queue fetch after new card play
  const currentTrackRef = useRef(null);    // always-current track (avoids stale closures)
  const positionRef = useRef(0);           // always-current position in ms
  const lastPlaybackStateRef = useRef(null); // { cardUri, trackUri, positionMs } saved on removal

  // ─── Spotify Web Playback SDK Initialisation ────────────────────────────────
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'NFC Spotify Player',
        getOAuthToken: async cb => {
          const res = await fetch('http://localhost:5000/spotify/token');
          const data = await res.json();
          cb(data.access_token);
        },
        volume: 0.15
      });

      player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setDeviceId(device_id);
        deviceIdRef.current = device_id;
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.log('Device went offline:', device_id);
        deviceIdRef.current = null;
        setTimeout(() => {
          if (playerRef.current) {
            console.log('Reconnecting player...');
            playerRef.current.connect();
          }
        }, 3000);
      });

      player.addListener('initialization_error', ({ message }) => console.error('Initialization Error:', message));
      player.addListener('authentication_error', ({ message }) => console.error('Authentication Error:', message));
      player.addListener('account_error', ({ message }) => console.error('Account Error:', message));
      player.addListener('playback_error', ({ message }) => console.error('Playback Error:', message));

      player.addListener('player_state_changed', state => {
        if (!state) return;
        currentTrackRef.current = state.track_window.current_track;
        positionRef.current = state.position;
        setCurrentTrack(state.track_window.current_track);
        setIsPaused(state.paused);
        setPosition(state.position);
        setDuration(state.duration);

        if (intervalRef.current) clearInterval(intervalRef.current);
        if (!state.paused) {
          intervalRef.current = setInterval(() => {
            positionRef.current += 1000;
            setPosition(prev => prev + 1000);
          }, 1000);
        }
      });

      player.connect();
      setPlayer(player);
      playerRef.current = player;
    };

    return () => {
      if (player) player.disconnect();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Reconnect Watchdog ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!activated) return;
    const reconnectCheck = setInterval(() => {
      if (playerRef.current && !deviceIdRef.current) {
        console.log('Watchdog: no device ID, reconnecting...');
        playerRef.current.connect();
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(reconnectCheck);
  }, [activated]);

  // ─── Card Play Trigger ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!deviceId || !currentCard) return;
    const cardUri = currentCard.spotify_uri;
    if (cardUri && cardUri !== lastCardRef.current) {
      console.log('[Card] New card detected:', currentCard.name, '|', cardUri);
      lastCardRef.current = cardUri;
      lastFetchedTrackRef.current = null;
      playUri(cardUri);
    }
  }, [currentCard, deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Card Removal Handler ────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentCard) {
      console.log('[Card] Removed — pausing');
      if (queueFetchTimerRef.current) clearTimeout(queueFetchTimerRef.current);

      // Save position so the same card can resume where it left off
      if (lastCardRef.current && currentTrackRef.current) {
        lastPlaybackStateRef.current = {
          cardUri: lastCardRef.current,
          trackUri: currentTrackRef.current.uri,
          positionMs: positionRef.current,
        };
        console.log('[Card] Saved state for resume:', lastPlaybackStateRef.current.cardUri, '@', positionRef.current);
      }

      lastCardRef.current = null;
      lastFetchedTrackRef.current = null;
      setQueue([]);
      setSuggestions([]);

      // Primary: pause via Spotify Web API — authoritative, works regardless of SDK state.
      // The SDK's player.pause() is a local command that silently fails when the
      // WebSocket connection is degraded. The Web API goes directly to Spotify's server.
      fetch('http://localhost:5000/spotify/token')
        .then(r => r.json())
        .then(({ access_token }) =>
          fetch('https://api.spotify.com/v1/me/player/pause', {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${access_token}` }
          })
        )
        .then(r => console.log('[Card] Web API pause status:', r.status))
        .catch(e => console.error('[Card] Web API pause error:', e));

      // Secondary: also pause via SDK to keep local state in sync.
      if (playerRef.current) playerRef.current.pause();
    }
  }, [currentCard]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Fetch Queue & Suggestions on Track Change ───────────────────────────────
  useEffect(() => {
    if (!currentTrack || currentTrack.id === lastFetchedTrackRef.current) return;
    lastFetchedTrackRef.current = currentTrack.id;
    setTrackInPlaylist(false);
    setAddedToPlaylist(new Set());
    fetchQueue();
    fetchSuggestions(currentTrack);
  }, [currentTrack]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Token Helper ─────────────────────────────────────────────────────────────
  const getFreshToken = async () => {
    const res = await fetch('http://localhost:5000/spotify/token');
    const data = await res.json();
    return data.access_token;
  };

  // ─── Playback ────────────────────────────────────────────────────────────────
  const playUri = async (uri) => {
    // Check if we have a saved position for this exact card URI
    const saved = lastPlaybackStateRef.current;
    const resuming = saved?.cardUri === uri;
    lastPlaybackStateRef.current = null; // consume — only resume once

    // Tracks must be played via `uris`; context_uri only works for
    // playlists/albums/artists/shows (Spotify rejects a track context_uri).
    const isTrack = uri.startsWith('spotify:track:');
    const body = isTrack
      ? (resuming ? { uris: [uri], position_ms: saved.positionMs } : { uris: [uri] })
      : (resuming ? { context_uri: uri, offset: { uri: saved.trackUri }, position_ms: saved.positionMs } : { context_uri: uri });

    console.log('[Play]', resuming ? `Resuming ${saved.trackUri} @${saved.positionMs}ms` : `Starting: ${uri}`, '| device:', deviceId);
    try {
      const freshToken = await getFreshToken();
      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` }
      });
      if (response.ok) {
        console.log('[Play] Success — scheduling queue fetch in 2s');
        // Delay the queue fetch so Spotify's server has time to populate the
        // new context's queue before we ask for it. Fetching immediately on
        // player_state_changed races against Spotify's backend and returns stale data.
        if (queueFetchTimerRef.current) clearTimeout(queueFetchTimerRef.current);
        queueFetchTimerRef.current = setTimeout(() => fetchQueue(), 2000);
      } else {
        const error = await response.text();
        console.error('[Play] Failed:', response.status, error);
        if (lastCardRef.current === uri) lastCardRef.current = null;
      }
    } catch (err) {
      console.error('[Play] Error:', err);
      if (lastCardRef.current === uri) lastCardRef.current = null;
    }
  };

  // ─── Queue Fetch ─────────────────────────────────────────────────────────────
  const fetchQueue = async () => {
    console.log('[Queue] Fetching...');
    try {
      const token = await getFreshToken();
      const res = await fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('[Queue] Response status:', res.status);
      if (res.ok) {
        const data = await res.json();
        console.log('[Queue] Tracks received:', data.queue?.length ?? 0);
        setQueue(data.queue || []);
      } else {
        console.error('[Queue] Error response:', await res.text());
      }
    } catch (err) {
      console.error('[Queue] Fetch error:', err);
    }
  };

  // ─── Suggestions Fetch ───────────────────────────────────────────────────────
  // /v1/recommendations is deprecated for apps created after Nov 2024 (returns 404).
  // Instead, fetch the current artist's top tracks and exclude the playing track.
  const fetchSuggestions = async (track) => {
    const artistId = track.artists?.[0]?.uri?.split(':')[2];
    console.log('[Suggest] Fetching top tracks for artist:', track.artists?.[0]?.name, artistId);
    if (!artistId) return;
    try {
      const token = await getFreshToken();
      const res = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('[Suggest] Response status:', res.status);
      if (res.ok) {
        const data = await res.json();
        const filtered = (data.tracks || []).filter(t => t.uri !== track.uri).slice(0, 8);
        console.log('[Suggest] Tracks received:', filtered.length);
        setSuggestions(filtered);
      } else {
        console.error('[Suggest] Error response:', await res.text());
      }
    } catch (err) {
      console.error('[Suggest] Fetch error:', err);
    }
  };

  // ─── Toast ────────────────────────────────────────────────────────────────────
  const showToast = (message, onUndo) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, onUndo });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  // ─── Playlist Management ─────────────────────────────────────────────────────
  const addTrackToPlaylist = async (playlistId, trackUri, trackName) => {
    try {
      const token = await getFreshToken();
      const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [trackUri] })
      });
      if (res.ok) {
        if (trackUri === currentTrack?.uri) setTrackInPlaylist(true);
        setAddedToPlaylist(prev => new Set(prev).add(trackUri));
        showToast(`Added "${trackName}"`, () => removeTrackFromPlaylist(playlistId, trackUri, trackName));
      }
    } catch (err) {
      console.error('Failed to add track:', err);
    }
  };

  const removeTrackFromPlaylist = async (playlistId, trackUri, trackName) => {
    try {
      const token = await getFreshToken();
      const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: [{ uri: trackUri }] })
      });
      if (res.ok) {
        if (trackUri === currentTrack?.uri) setTrackInPlaylist(false);
        setAddedToPlaylist(prev => { const next = new Set(prev); next.delete(trackUri); return next; });
        showToast(`Removed "${trackName}"`, () => addTrackToPlaylist(playlistId, trackUri, trackName));
      }
    } catch (err) {
      console.error('Failed to remove track:', err);
    }
  };

  // ─── Play Track from Queue (within current context) ─────────────────────────
  const playQueueTrack = async (track) => {
    if (!currentCard?.spotify_uri) return;
    console.log('[Queue] Playing track:', track.name);
    try {
      const token = await getFreshToken();
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ context_uri: currentCard.spotify_uri, offset: { uri: track.uri } }),
      });
    } catch (err) {
      console.error('[Queue] Play track error:', err);
    }
  };

  // ─── Play Single Track (suggestions — not within a context) ──────────────────
  const playSingleTrack = async (track) => {
    console.log('[Suggest] Playing:', track.name);
    try {
      const token = await getFreshToken();
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ uris: [track.uri] }),
      });
    } catch (err) {
      console.error('[Suggest] Play error:', err);
    }
  };

  // ─── Player Controls ─────────────────────────────────────────────────────────
  const togglePlay = () => { if (player) player.togglePlay(); };
  const skipNext = () => { if (player) player.nextTrack(); };
  const skipPrevious = () => { if (player) player.previousTrack(); };

  const handleVolume = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (player) player.setVolume(val);
  };

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
  };

  // ─── Screens ──────────────────────────────────────────────────────────────────
  if (!activated) {
    return (
      <div className="no-card-screen" onClick={() => {
        if (playerRef.current) playerRef.current.activateElement();
        setActivated(true);
      }} style={{ cursor: 'pointer' }}>
        <div className="nfc-icon">👆</div>
        <h2>Tap to activate</h2>
      </div>
    );
  }

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

  // Playlist ID is only non-null for playlist cards; album cards can't be modified
  const playlistId = currentCard.spotify_uri?.startsWith('spotify:playlist:')
    ? currentCard.spotify_uri.split(':')[2]
    : null;

  // ─── Main Player UI ───────────────────────────────────────────────────────────
  return (
    <div className="player-container">

      {/* ── Column 1: Player ── */}
      <div className="player-section">
        <img
          src={currentTrack.album?.images?.[0]?.url}
          alt={currentTrack.album?.name}
          className="album-art"
        />
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
          <button onClick={togglePlay} className="control-btn play-btn">
            {isPaused ? '▶' : '⏸'}
          </button>
          <button onClick={skipNext} className="control-btn">⏭</button>
        </div>
        <div className="volume-control">
          <span className="volume-icon">🔈</span>
          <input
            type="range" min="0" max="1" step="0.01"
            value={volume} onChange={handleVolume}
            className="volume-slider"
          />
          <span className="volume-icon">🔊</span>
        </div>
        {playlistId && (
          <button
            className={`playlist-btn${trackInPlaylist ? ' in-playlist' : ''}`}
            onClick={() => trackInPlaylist
              ? removeTrackFromPlaylist(playlistId, currentTrack.uri, currentTrack.name)
              : addTrackToPlaylist(playlistId, currentTrack.uri, currentTrack.name)
            }
          >
            {trackInPlaylist ? '♥ In playlist' : '♡ Add to playlist'}
          </button>
        )}
      </div>

      {/* ── Column 2: Lyrics ── */}
      <div className="lyrics-section">
        <div className="section-header">Lyrics</div>
        <div className="lyrics-content">
          <p className="lyrics-placeholder">Lyrics coming soon...</p>
          <p className="lyrics-note">Now playing from: {currentCard.name}</p>
        </div>
      </div>

      {/* ── Column 3: Queue ── */}
      <div className="queue-section">
        <div className="section-header">Up Next</div>
        <div className="queue-list">
          {queue.length > 0 ? queue.slice(0, 5).map((track, i) => (
            <div key={i} className="queue-item queue-item-playable" onClick={() => playQueueTrack(track)}>
              <img
                src={track.album?.images?.slice(-1)[0]?.url}
                alt=""
                className="queue-item-art"
              />
              <div className="queue-item-info">
                <div className="queue-item-name">{track.name}</div>
                <div className="queue-item-artist">{track.artists?.map(a => a.name).join(', ')}</div>
              </div>
            </div>
          )) : (
            <p className="queue-empty">No upcoming tracks</p>
          )}
        </div>
        {suggestions.length > 0 && (
          <div className="suggestions-area">
            <hr className="queue-suggestions-divider" />
            <div className="section-header suggestions-divider">Suggested</div>
            {suggestions.map((track, i) => {
              const alreadyAdded = addedToPlaylist.has(track.uri);
              return (
                <div
                  key={i}
                  className="queue-item suggestion-item clickable"
                  onClick={() => playSingleTrack(track)}
                >
                  <img
                    src={track.album?.images?.slice(-1)[0]?.url}
                    alt=""
                    className="queue-item-art"
                  />
                  <div className="queue-item-info">
                    <div className="queue-item-name">{track.name}</div>
                    <div className="queue-item-artist">{track.artists?.map(a => a.name).join(', ')}</div>
                  </div>
                  {playlistId && (
                    <span
                      className={`add-btn${alreadyAdded ? ' added' : ''}`}
                      onClick={e => { e.stopPropagation(); !alreadyAdded && addTrackToPlaylist(playlistId, track.uri, track.name); }}
                    >
                      {alreadyAdded ? '✓' : '+'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Toast ── */}
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
