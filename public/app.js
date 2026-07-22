// SyncPulse — Cross-Device Synced Music Player Client Logic

const socket = io();

// DOM Elements
const connPill = document.getElementById('connPill');
const connStatusText = document.getElementById('connStatusText');
const clockSyncText = document.getElementById('clockSyncText');

const presetSelect = document.getElementById('presetSelect');
const presetTabBtn = document.getElementById('presetTabBtn');
const uploadTabBtn = document.getElementById('uploadTabBtn');
const presetContainer = document.getElementById('presetContainer');
const uploadContainer = document.getElementById('uploadContainer');
const audioFileInput = document.getElementById('audioFileInput');
const dropzone = document.getElementById('dropzone');

const createRoomBtn = document.getElementById('createRoomBtn');
const hostRoomBox = document.getElementById('hostRoomBox');
const hostCodeDisplay = document.getElementById('hostCodeDisplay');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const listenerCountText = document.getElementById('listenerCountText');
const toggleQrBtn = document.getElementById('toggleQrBtn');
const qrWrapper = document.getElementById('qrWrapper');
const qrCanvas = document.getElementById('qrCanvas');

const joinCodeInput = document.getElementById('joinCodeInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');

const enableMicBtn = document.getElementById('enableMicBtn');
const disableMicBtn = document.getElementById('disableMicBtn');
const micStatusBanner = document.getElementById('micStatusBanner');
const micStatusText = document.getElementById('micStatusText');
const micStatusDot = document.getElementById('micStatusDot');
const micRmsText = document.getElementById('micRmsText');
const micVizCanvas = document.getElementById('micVizCanvas');
const micVizCtx = micVizCanvas.getContext('2d');

const vinylDisc = document.getElementById('vinylDisc');
const audioSpectrumCanvas = document.getElementById('audioSpectrumCanvas');
const audioSpectrumCtx = audioSpectrumCanvas.getContext('2d');
const trackTitleDisplay = document.getElementById('trackTitleDisplay');
const trackArtistDisplay = document.getElementById('trackArtistDisplay');
const playerCoverImg = document.getElementById('playerCoverImg');
const syncDriftBadge = document.getElementById('syncDriftBadge');
const syncDriftText = document.getElementById('syncDriftText');
const joinFormGroup = document.getElementById('joinFormGroup');
const joinedRoomBanner = document.getElementById('joinedRoomBanner');
const joinedCodeText = document.getElementById('joinedCodeText');
const leaveRoomBtnIndex = document.getElementById('leaveRoomBtnIndex');

const audio = document.getElementById('mainAudioPlayer');
const currentTimeDisplay = document.getElementById('currentTimeDisplay');
const durationDisplay = document.getElementById('durationDisplay');
const seekSlider = document.getElementById('seekSlider');
const masterPlayBtn = document.getElementById('masterPlayBtn');
const playPauseIcon = document.getElementById('playPauseIcon');
const rewindBtn = document.getElementById('rewindBtn');
const forwardBtn = document.getElementById('forwardBtn');
const muteBtn = document.getElementById('muteBtn');
const volumeSlider = document.getElementById('volumeSlider');
const roleIndicator = document.getElementById('roleIndicator');

// State Variables
let currentRole = 'standalone'; // 'standalone' | 'host' | 'listener'
let currentRoomCode = '';
let clockOffsetMs = 0; // serverTime - clientTime
let rttMs = 0;
let hostBroadcastTimer = null;
let lastRemoteState = null;
let presetsList = [];
let serverBaseUrl = window.location.origin; // updated after fetching local IP
let currentCoverUrl = '';

// Fetch the server's LAN IP so share links work across devices
fetch('/api/server-info')
  .then(r => r.json())
  .then(info => {
    if (info?.ip && info?.port) {
      serverBaseUrl = `http://${info.ip}:${info.port}`;
    }
  })
  .catch(() => { /* fallback to window.location.origin */ });

// Web Audio API State
let audioCtx = null;
let playerSourceNode = null;
let playerAnalyser = null;
let audioContextAttached = false; // prevent double-wrapping the audio element

let micStream = null;
let micAudioCtx = null;
let micAnalyser = null;
let micSourceNode = null;
let micAnimFrame = null;
let micEnergyLevel = 0;
let isMicActive = false;

// -------------------------------------------------------------
// 1. Connection & NTP Clock Sync Logic
// -------------------------------------------------------------
socket.on('connect', () => {
  connPill.className = 'pill pill-online';
  connStatusText.textContent = 'Connected';
  performNtpClockSync();
});

socket.on('disconnect', () => {
  connPill.className = 'pill pill-offline';
  connStatusText.textContent = 'Disconnected';
});

function performNtpClockSync(samples = 5) {
  let count = 0;
  let offsets = [];
  let rtts = [];

  const ping = () => {
    const t0 = Date.now();
    socket.emit('ntp_ping', t0, (data) => {
      const t3 = Date.now();
      if (data && data.serverTimestamp) {
        const t1 = data.serverTimestamp;
        const rtt = t3 - t0;
        const offset = t1 - (t0 + rtt / 2);
        rtts.push(rtt);
        offsets.push(offset);
      }
      count++;
      if (count < samples) {
        setTimeout(ping, 100);
      } else {
        // Average measurements
        clockOffsetMs = Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length);
        rttMs = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length);
        clockSyncText.textContent = `Clock: ${clockOffsetMs >= 0 ? '+' : ''}${clockOffsetMs}ms (RTT: ${rttMs}ms)`;
      }
    });
  };

  ping();
}

// Periodically resync clock
setInterval(() => {
  if (socket.connected) performNtpClockSync(3);
}, 15000);

// -------------------------------------------------------------
// 2. Preset & File Upload Handling
// -------------------------------------------------------------
async function fetchPresets() {
  try {
    const res = await fetch('/api/presets');
    const data = await res.json();
    if (data.ok && data.tracks.length > 0) {
      presetsList = data.tracks;
      presetSelect.innerHTML = '';
      data.tracks.forEach((track) => {
        const opt = document.createElement('option');
        opt.value = track.url;
        opt.textContent = `${track.title} — ${track.artist}`;
        presetSelect.appendChild(opt);
      });
      // Load initial track if in standalone mode
      if (currentRole === 'standalone' && !audio.src) {
        loadTrack(data.tracks[0].url, data.tracks[0].title, data.tracks[0].artist);
      }
    }
  } catch (err) {
    console.error('Failed to load preset tracks:', err);
  }
}
fetchPresets();

// Tab switching
presetTabBtn.addEventListener('click', () => {
  presetTabBtn.classList.add('active');
  uploadTabBtn.classList.remove('active');
  presetContainer.classList.add('active');
  uploadContainer.classList.remove('active');
});

uploadTabBtn.addEventListener('click', () => {
  uploadTabBtn.classList.add('active');
  presetTabBtn.classList.remove('active');
  uploadContainer.classList.add('active');
  presetContainer.classList.remove('active');
});

// Preset selection change
presetSelect.addEventListener('change', () => {
  const selectedTrack = presetsList.find((t) => t.url === presetSelect.value);
  if (selectedTrack) {
    loadTrack(selectedTrack.url, selectedTrack.title, selectedTrack.artist);
    if (currentRole === 'host') {
      broadcastHostState({ resetPosition: true });
    }
  }
});

// Local file upload handling
dropzone.addEventListener('click', () => audioFileInput.click());

audioFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    uploadAudioFile(e.target.files[0]);
  }
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = 'var(--accent-cyan)';
});

dropzone.addEventListener('dragleave', () => {
  dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    uploadAudioFile(e.dataTransfer.files[0]);
  }
});

async function uploadAudioFile(file) {
  const formData = new FormData();
  formData.append('audio', file);

  dropzone.querySelector('span').textContent = 'Uploading audio file...';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (data.ok) {
      dropzone.querySelector('span').textContent = `Uploaded: ${data.title}`;
      loadTrack(data.fileUrl, data.title, data.artist, data.coverUrl);
      if (currentRole === 'host') {
        broadcastHostState({ resetPosition: true });
      }
    } else {
      alert('Upload failed: ' + (data.error || 'Unknown error'));
      dropzone.querySelector('span').textContent = 'Click or drag local audio file here';
    }
  } catch (err) {
    console.error('Upload error:', err);
    alert('Failed to upload file.');
    dropzone.querySelector('span').textContent = 'Click or drag local audio file here';
  }
}

let currentTrackUrl = '';

const mobileUnlockBox = document.getElementById('mobileUnlockBox');
const mobilePlayUnlockBtn = document.getElementById('mobilePlayUnlockBtn');

function unlockMobileAudio() {
  initPlayerAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  audio.play().then(() => {
    mobileUnlockBox.classList.add('hidden');
    updatePlayPauseIcon(true);
  }).catch((err) => console.error('Unlock play error:', err));
}

mobilePlayUnlockBtn.addEventListener('click', unlockMobileAudio);
document.addEventListener('touchstart', () => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}, { once: true });

function loadTrack(url, title, artist, coverUrl) {
  currentTrackUrl = url;
  currentCoverUrl = coverUrl || '';

  if (playerCoverImg) {
    if (currentCoverUrl) {
      playerCoverImg.src = currentCoverUrl;
      playerCoverImg.classList.remove('hidden');
    } else {
      playerCoverImg.classList.add('hidden');
    }
  }

  // crossOrigin needed for Web Audio API to avoid CORS tainting
  audio.crossOrigin = 'anonymous';
  audio.preload = 'auto';
  audio.preservesPitch = true;
  if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
  if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
  audio.src = url;
  trackTitleDisplay.textContent = title || 'Unknown Title';
  trackArtistDisplay.textContent = artist || 'Unknown Artist';
  audio.load();
}

// -------------------------------------------------------------
// 3. Host Mode Logic
// -------------------------------------------------------------
createRoomBtn.addEventListener('click', () => {
  socket.emit('create_room', {
    initialState: {
      trackUrl: currentTrackUrl || presetSelect.value,
      trackTitle: trackTitleDisplay.textContent,
      trackArtist: trackArtistDisplay.textContent,
      coverUrl: currentCoverUrl,
      position: audio.currentTime,
      playing: !audio.paused
    }
  }, (res) => {
    if (res && res.ok) {
      currentRole = 'host';
      currentRoomCode = res.roomCode;

      roleIndicator.textContent = 'Host';
      roleIndicator.className = 'badge badge-host';

      hostCodeDisplay.textContent = currentRoomCode;
      hostRoomBox.classList.remove('hidden');

      // Generate QR Code
      generateQrCode(currentRoomCode);

      startHostHeartbeat();
      broadcastHostState();
    }
  });
});

const qrImage = document.getElementById('qrImage');

function generateQrCode(code) {
  const joinUrl = `${serverBaseUrl}${window.location.pathname}?room=${code}`;
  qrImage.src = `/api/qrcode?text=${encodeURIComponent(joinUrl)}`;
}

toggleQrBtn.addEventListener('click', () => {
  qrWrapper.classList.toggle('hidden');
  toggleQrBtn.textContent = qrWrapper.classList.contains('hidden') ? 'Show QR Code' : 'Hide QR Code';
});

copyLinkBtn.addEventListener('click', () => {
  const joinUrl = `${serverBaseUrl}${window.location.pathname}?room=${currentRoomCode}`;
  navigator.clipboard.writeText(joinUrl).then(() => {
    copyLinkBtn.style.color = 'var(--accent-cyan)';
    setTimeout(() => (copyLinkBtn.style.color = '#fff'), 1500);
  });
});

function broadcastHostState(extra = {}) {
  if (currentRole !== 'host' || !currentRoomCode) return;

  const payload = {
    trackUrl: currentTrackUrl || presetSelect.value,
    trackTitle: trackTitleDisplay.textContent,
    trackArtist: trackArtistDisplay.textContent,
    coverUrl: currentCoverUrl,
    position: extra.resetPosition ? 0 : audio.currentTime,
    playing: !audio.paused,
    volume: audio.volume
  };

  socket.emit('host_update_state', payload);
}

function startHostHeartbeat() {
  clearInterval(hostBroadcastTimer);
  // 1500ms heartbeat — frequent enough to stay in sync, slow enough to avoid
  // flooding the socket and triggering audio micro-seeks that cause pops.
  hostBroadcastTimer = setInterval(() => {
    if (currentRole === 'host' && !audio.paused) {
      broadcastHostState();
    }
  }, 1500);
}

socket.on('room_info', (info) => {
  if (info && info.listenerCount !== undefined) {
    listenerCountText.textContent = `${info.listenerCount} connected listener${info.listenerCount === 1 ? '' : 's'}`;
  }
});

// -------------------------------------------------------------
// 4. Listener Mode Logic & Audio Sync Engine
// -------------------------------------------------------------
joinRoomBtn.addEventListener('click', () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code) {
    alert('Please enter a room code.');
    return;
  }
  joinRoom(code);
});

function joinRoom(code) {
  socket.emit('join_room', { roomCode: code }, (res) => {
    if (res && res.ok) {
      currentRole = 'listener';
      currentRoomCode = res.roomCode;
      joinCodeInput.value = currentRoomCode;

      if (joinFormGroup) joinFormGroup.classList.add('hidden');
      if (joinedRoomBanner) joinedRoomBanner.classList.remove('hidden');
      if (joinedCodeText) joinedCodeText.textContent = currentRoomCode;

      roleIndicator.textContent = 'Listener';
      roleIndicator.className = 'badge badge-listener';

      if (res.state) {
        applyRemoteState(res.state);
      }
    } else {
      alert(res?.error || 'Could not join room.');
    }
  });
}

socket.on('sync_state', (state) => {
  if (currentRole === 'listener') {
    applyRemoteState(state);
  }
});

socket.on('host_disconnected', () => {
  if (currentRole === 'listener') {
    audio.pause();
    syncDriftText.textContent = 'Host disconnected. Playback paused.';
    updatePlayPauseIcon(false);
  }
});

if (leaveRoomBtnIndex) {
  leaveRoomBtnIndex.addEventListener('click', () => {
    if (audio) audio.pause();
    if (socket.connected && currentRoomCode) {
      socket.emit('leave_room');
    }
    currentRole = 'standalone';
    currentRoomCode = '';
    joinCodeInput.value = '';
    if (joinedRoomBanner) joinedRoomBanner.classList.add('hidden');
    if (joinFormGroup) joinFormGroup.classList.remove('hidden');
    roleIndicator.textContent = 'Standalone Player';
    roleIndicator.className = 'badge badge-host';
    syncDriftText.textContent = 'Left room. Standalone mode.';
    updatePlayPauseIcon(false);
    if (window.history.pushState) window.history.pushState({}, '', window.location.pathname);
  });
}

function applyRemoteState(state) {
  if (!state) return;
  lastRemoteState = state;

  // Relative track URL update comparison
  if (state.trackUrl && state.trackUrl !== currentTrackUrl) {
    loadTrack(state.trackUrl, state.trackTitle, state.trackArtist, state.coverUrl);
  }

  if (state.coverUrl && playerCoverImg) {
    playerCoverImg.src = state.coverUrl;
    playerCoverImg.classList.remove('hidden');
  } else if (playerCoverImg && !state.coverUrl) {
    playerCoverImg.classList.add('hidden');
  }

  // Latency & Clock Offset Projected Position Calculation
  const nowClient = Date.now();
  const nowServer = nowClient + clockOffsetMs;
  const elapsedServerSec = Math.max(0, (nowServer - state.updatedAt) / 1000);
  const projectedHostPosition = Math.max(0, state.position + (state.playing ? elapsedServerSec : 0));

  const localPos = audio.currentTime;
  const driftSec = projectedHostPosition - localPos;
  const driftMs = Math.round(driftSec * 1000);

  // Play / Pause alignment
  if (state.playing) {
    if (audio.paused) {
      audio.currentTime = projectedHostPosition;
      audio.play().then(() => {
        mobileUnlockBox.classList.add('hidden');
      }).catch(() => {
        mobileUnlockBox.classList.remove('hidden');
        updateMicStatus('state-listening', 'Tap button below to enable mobile audio playback');
      });
    } else {
      mobileUnlockBox.classList.add('hidden');
      // Drift Correction Logic
      // Hard seek only for very large drifts (>2s) — avoids pop artifacts.
      // Medium drift uses ultra-smooth playbackRate micro-nudge.
      // Small drift (<60ms) is ignored — human ear can't detect it.
      if (Math.abs(driftSec) > 2.0) {
        audio.currentTime = projectedHostPosition;
        audio.playbackRate = 1.0;
        syncDriftText.textContent = `Re-Synced (Drift was: ${driftMs}ms)`;
      } else if (Math.abs(driftSec) > 0.06) {
        // Ultra-gentle micro-nudge (max ±2%) for smooth pitch-preserved playback
        const nudge = Math.min(0.02, Math.abs(driftSec) * 0.01);
        const targetRate = driftSec > 0 ? (1.0 + nudge) : (1.0 - nudge);
        // Exponential smoothing filter to prevent sudden rate jumps
        const currentRate = audio.playbackRate || 1.0;
        const smoothedRate = currentRate * 0.7 + targetRate * 0.3;
        audio.playbackRate = parseFloat(smoothedRate.toFixed(4));
        syncDriftText.textContent = `Syncing ±${Math.abs(driftMs)}ms (${smoothedRate.toFixed(3)}x)`;
      } else {
        // Within tolerance — maintain normal playback rate smoothly
        const currentRate = audio.playbackRate || 1.0;
        audio.playbackRate = parseFloat((currentRate * 0.7 + 1.0 * 0.3).toFixed(4));
        syncDriftText.textContent = `In Sync ✓ (Drift: ${driftMs}ms)`;
      }
    }
  } else {
    audio.playbackRate = 1.0;
    if (!audio.paused) {
      audio.pause();
    }
    audio.currentTime = projectedHostPosition;
    syncDriftText.textContent = 'Paused by Host';
  }

  audio.volume = state.volume ?? 1;
  volumeSlider.value = audio.volume;

  // Update Mic Status if Mic is active
  if (isMicActive) {
    if (micEnergyLevel > 15) {
      updateMicStatus('state-synced', `Synced! Song detected: ${state.trackTitle || 'Room Audio'}`);
    } else {
      updateMicStatus('state-listening', 'Listening… Waiting for room audio energy');
    }
  }
}

// Check URL query parameters for auto-joining room
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    joinCodeInput.value = roomParam.toUpperCase();
    joinRoom(roomParam.toUpperCase());
  }
});

// -------------------------------------------------------------
// 5. Microphone Proximity & Energy Detection
// -------------------------------------------------------------
enableMicBtn.addEventListener('click', initMicrophone);
disableMicBtn.addEventListener('click', stopMicrophone);

function stopMicrophone() {
  if (micAnimFrame) {
    cancelAnimationFrame(micAnimFrame);
    micAnimFrame = null;
  }
  if (micSourceNode) {
    try { micSourceNode.disconnect(); } catch(e) {}
    micSourceNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (micAudioCtx) {
    micAudioCtx.close().catch(() => {});
    micAudioCtx = null;
  }
  micAnalyser = null;
  isMicActive = false;
  micEnergyLevel = 0;
  micRmsText.textContent = '0 dB';

  // Clear canvas
  micVizCtx.clearRect(0, 0, micVizCanvas.width, micVizCanvas.height);

  // Update button states
  enableMicBtn.textContent = 'Enable Microphone';
  enableMicBtn.style.background = '';
  enableMicBtn.style.display = '';
  disableMicBtn.style.display = 'none';

  updateMicStatus('state-idle', 'Microphone disabled.');
}

async function initMicrophone() {
  // Check if mic is already active
  if (isMicActive) return;

  // Check for secure context (HTTPS or localhost)
  if (window.isSecureContext === false) {
    updateMicStatus(
      'state-listening',
      '⚠️ Mic requires HTTPS. Room sync still works via WebSockets!'
    );
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    updateMicStatus(
      'state-listening',
      '⚠️ Mic not supported in this browser. Try Chrome or Firefox on HTTPS.'
    );
    return;
  }

  updateMicStatus('state-listening', 'Requesting microphone access…');

  try {
    // Mobile-friendly constraints — minimal processing to avoid conflicts
    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 44100,
      }
    };

    micStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Create a fresh AudioContext for the mic (separate from player context)
    micAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    if (micAudioCtx.state === 'suspended') await micAudioCtx.resume();

    micAnalyser = micAudioCtx.createAnalyser();
    micAnalyser.fftSize = 256;
    micAnalyser.smoothingTimeConstant = 0.8;

    micSourceNode = micAudioCtx.createMediaStreamSource(micStream);
    micSourceNode.connect(micAnalyser);
    // NOTE: do NOT connect micAnalyser to destination (avoids feedback loop)

    isMicActive = true;

    // Update button states
    enableMicBtn.style.display = 'none';
    disableMicBtn.style.display = '';

    updateMicStatus('state-listening', '🎙️ Mic active — listening for ambient room audio…');
    drawMicSpectrum();
  } catch (err) {
    console.error('Mic error:', err);
    isMicActive = false;
    let msg = 'Microphone permission denied.';
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      msg = '⚠️ No microphone found on this device.';
    } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = '⚠️ Mic permission denied. Check browser settings and allow mic access.';
    } else if (err.name === 'NotReadableError') {
      msg = '⚠️ Mic is in use by another app. Close other tabs/apps and try again.';
    } else if (err.name === 'OverconstrainedError') {
      // Fallback to basic constraints
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (micAudioCtx.state === 'suspended') await micAudioCtx.resume();
        micAnalyser = micAudioCtx.createAnalyser();
        micAnalyser.fftSize = 256;
        micSourceNode = micAudioCtx.createMediaStreamSource(micStream);
        micSourceNode.connect(micAnalyser);
        isMicActive = true;
        enableMicBtn.style.display = 'none';
        disableMicBtn.style.display = '';
        updateMicStatus('state-listening', '🎙️ Mic active (fallback mode)…');
        drawMicSpectrum();
        return;
      } catch (fallbackErr) {
        msg = '⚠️ Could not access microphone. Try Chrome on HTTPS.';
      }
    }
    updateMicStatus('state-idle', msg);
  }
}

function updateMicStatus(stateClass, text) {
  micStatusBanner.className = `status-banner ${stateClass}`;
  micStatusText.textContent = text;
}

function drawMicSpectrum() {
  if (!isMicActive || !micAnalyser) return;

  micAnimFrame = requestAnimationFrame(drawMicSpectrum);

  const bufferLength = micAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  micAnalyser.getByteFrequencyData(dataArray);

  // Compute RMS level
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sum / bufferLength);
  micEnergyLevel = Math.min(100, Math.round((rms / 128) * 100));

  const db = rms > 0 ? Math.round(20 * Math.log10(rms / 255)) : -60;
  micRmsText.textContent = `${db} dB`;

  // Draw spectrum on canvas
  const width = micVizCanvas.width = micVizCanvas.clientWidth;
  const height = micVizCanvas.height = 60;
  micVizCtx.clearRect(0, 0, width, height);

  const barWidth = Math.max(2, (width / bufferLength) * 2);
  let x = 0;

  // Only draw the first half of freq bins (upper bins are mostly silence)
  const drawCount = Math.floor(bufferLength / 2);
  for (let i = 0; i < drawCount; i++) {
    const barHeight = (dataArray[i] / 255) * height;

    const gradient = micVizCtx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#ec4899');
    gradient.addColorStop(1, '#a855f7');

    micVizCtx.fillStyle = gradient;
    micVizCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

    x += barWidth;
    if (x > width) break;
  }
}

// -------------------------------------------------------------
// 6. Web Audio API Music Player Visualizer & Vinyl Disc
// -------------------------------------------------------------
function initPlayerAudioContext() {
  // Guard against double-initialization which causes InvalidStateError
  // and audio corruption/popping
  if (audioContextAttached) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try {
    // High-fidelity audio context configured for smooth, glitch-free playback
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    playerAnalyser = audioCtx.createAnalyser();
    playerAnalyser.fftSize = 512;
    playerAnalyser.smoothingTimeConstant = 0.85;

    // Ensure audio element has pitch preservation enabled
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.preservesPitch = true;
    if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
    if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;

    playerSourceNode = audioCtx.createMediaElementSource(audio);
    playerSourceNode.connect(playerAnalyser);
    playerAnalyser.connect(audioCtx.destination);

    audioContextAttached = true;
    drawAudioSpectrum();
  } catch (err) {
    console.error('AudioContext init error:', err);
    // If AudioContext fails (e.g. CORS), audio still plays fine via HTML5
    // Just skip the visualizer
    audioContextAttached = true; // prevent infinite retry loops
  }
}

function drawAudioSpectrum() {
  if (!playerAnalyser) return;
  requestAnimationFrame(drawAudioSpectrum);

  const bufferLength = playerAnalyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  playerAnalyser.getByteFrequencyData(dataArray);

  const width = audioSpectrumCanvas.width = audioSpectrumCanvas.clientWidth;
  const height = audioSpectrumCanvas.height = 140;
  audioSpectrumCtx.clearRect(0, 0, width, height);

  const barWidth = (width / bufferLength) * 2.2;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight = (dataArray[i] / 255) * height * 0.9;

    const gradient = audioSpectrumCtx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, 'rgba(0, 242, 254, 0.2)');
    gradient.addColorStop(0.5, 'rgba(79, 172, 254, 0.7)');
    gradient.addColorStop(1, 'rgba(224, 86, 253, 0.9)');

    audioSpectrumCtx.fillStyle = gradient;
    audioSpectrumCtx.fillRect(x, height - barHeight, barWidth - 2, barHeight);

    x += barWidth;
  }
}

// -------------------------------------------------------------
// 7. Player Controls & Event Listeners
// -------------------------------------------------------------
masterPlayBtn.addEventListener('click', () => {
  initPlayerAudioContext();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  if (audio.paused) {
    audio.play().then(() => {
      updatePlayPauseIcon(true);
      if (currentRole === 'host') broadcastHostState();
    }).catch(err => console.error('Play error:', err));
  } else {
    audio.pause();
    updatePlayPauseIcon(false);
    if (currentRole === 'host') broadcastHostState();
  }
});

function updatePlayPauseIcon(isPlaying) {
  if (isPlaying) {
    vinylDisc.classList.add('spinning');
    playPauseIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
  } else {
    vinylDisc.classList.remove('spinning');
    playPauseIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
  }
}

audio.addEventListener('play', () => {
  updatePlayPauseIcon(true);
  if (currentRole === 'host') broadcastHostState();
});

audio.addEventListener('pause', () => {
  updatePlayPauseIcon(false);
  if (currentRole === 'host') broadcastHostState();
});

audio.addEventListener('timeupdate', () => {
  if (!isNaN(audio.duration) && audio.duration > 0) {
    seekSlider.value = (audio.currentTime / audio.duration) * 100;
    currentTimeDisplay.textContent = formatTime(audio.currentTime);
  }
});

audio.addEventListener('loadedmetadata', () => {
  durationDisplay.textContent = formatTime(audio.duration);
});

seekSlider.addEventListener('input', () => {
  if (!isNaN(audio.duration)) {
    const targetTime = (seekSlider.value / 100) * audio.duration;
    audio.currentTime = targetTime;
    currentTimeDisplay.textContent = formatTime(targetTime);
    if (currentRole === 'host') broadcastHostState();
  }
});

rewindBtn.addEventListener('click', () => {
  audio.currentTime = Math.max(0, audio.currentTime - 10);
  if (currentRole === 'host') broadcastHostState();
});

forwardBtn.addEventListener('click', () => {
  if (!isNaN(audio.duration)) {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
    if (currentRole === 'host') broadcastHostState();
  }
});

volumeSlider.addEventListener('input', () => {
  audio.volume = volumeSlider.value;
  if (currentRole === 'host') broadcastHostState();
});

muteBtn.addEventListener('click', () => {
  audio.muted = !audio.muted;
  muteBtn.style.color = audio.muted ? '#ef4444' : '#fff';
});

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
