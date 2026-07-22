// SyncDrop — stream.js
// Focused upload-and-stream page logic

const socket = io();

// ── Mode detection ──────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
const isListenerMode = !!roomParam;

// ── DOM refs ────────────────────────────────────────────────────
const connDot    = document.getElementById('connDot');
const connLabel  = document.getElementById('connLabel');

// Host elements
const hostView         = document.getElementById('hostView');
const uploadZone       = document.getElementById('uploadZone');
const fileInput        = document.getElementById('fileInput');
const uploadIdle       = document.getElementById('uploadIdle');
const uploadProgress   = document.getElementById('uploadProgress');
const uploadProgressTxt= document.getElementById('uploadProgressText');
const progressBar      = document.getElementById('progressBar');
const sessionPanel     = document.getElementById('sessionPanel');
const hostTrackTitle   = document.getElementById('hostTrackTitle');
const listenerBadge    = document.getElementById('listenerBadge');
const hostDisk         = document.getElementById('hostDisk');
const hostAudio        = document.getElementById('hostAudio');
const waveCanvas       = document.getElementById('waveCanvas');
const hostPlay         = document.getElementById('hostPlay');
const hostPlayIcon     = document.getElementById('hostPlayIcon');
const hostRewind       = document.getElementById('hostRewind');
const hostForward      = document.getElementById('hostForward');
const seekBar          = document.getElementById('seekBar');
const curTime          = document.getElementById('curTime');
const durTime          = document.getElementById('durTime');
const hostVol          = document.getElementById('hostVol');
const shareLinkInput   = document.getElementById('shareLinkInput');
const copyLinkBtn      = document.getElementById('copyLinkBtn');
const copyBtnLabel     = document.getElementById('copyBtnLabel');
const roomCodeDisplay  = document.getElementById('roomCodeDisplay');
const qrToggleBtn      = document.getElementById('qrToggleBtn');
const qrBlock          = document.getElementById('qrBlock');
const qrImg            = document.getElementById('qrImg');
const uploadAnotherBtn = document.getElementById('uploadAnotherBtn');
const joinCodeField    = document.getElementById('joinCodeField');
const joinCodeBtn      = document.getElementById('joinCodeBtn');
const joinErrorMsg     = document.getElementById('joinErrorMsg');

// Listener elements
const listenerView     = document.getElementById('listenerView');
const listenerLoading  = document.getElementById('listenerLoading');
const listenerError    = document.getElementById('listenerError');
const listenerErrorMsg = document.getElementById('listenerErrorMsg');
const listenerPlayer   = document.getElementById('listenerPlayer');
const listenerDisk     = document.getElementById('listenerDisk');
const listenerTrackTitle = document.getElementById('listenerTrackTitle');
const listenerSyncStatus = document.getElementById('listenerSyncStatus');
const listenUnlockBox  = document.getElementById('listenUnlockBox');
const listenUnlockBtn  = document.getElementById('listenUnlockBtn');
const listenerAudio    = document.getElementById('listenerAudio');
const listenerWave     = document.getElementById('listenerWave');
const listenSeekBar    = document.getElementById('listenSeekBar');
const listenCurTime    = document.getElementById('listenCurTime');
const listenDurTime    = document.getElementById('listenDurTime');
const listenerVol      = document.getElementById('listenerVol');
const hostCoverImg     = document.getElementById('hostCoverImg');
const hostDiskSvg      = document.getElementById('hostDiskSvg');
const listenerCoverImg = document.getElementById('listenerCoverImg');
const listenerDiskSvg  = document.getElementById('listenerDiskSvg');
const leaveRoomBtn     = document.getElementById('leaveRoomBtn');
const listenerRoomCodeTag = document.getElementById('listenerRoomCodeTag');
const driftText        = document.getElementById('driftText');

// ── State ───────────────────────────────────────────────────────
let currentRole       = isListenerMode ? 'listener' : 'host';
let currentRoomCode   = '';
let clockOffsetMs     = 0;
let hostBroadcastTimer = null;
let currentTrackUrl   = '';
let currentCoverUrl   = '';
let serverBaseUrl     = window.location.origin;

// Web Audio
let audioCtx       = null;
let audioAttached  = false;
let analyser       = null;
let waveAnimId     = null;

// ── Connection ──────────────────────────────────────────────────
socket.on('connect', () => {
  connDot.className = 'conn-dot online';
  connLabel.textContent = 'Connected';
  performNtpSync(5);
  if (isListenerMode) joinRoom(roomParam.toUpperCase());
});

socket.on('disconnect', () => {
  connDot.className = 'conn-dot offline';
  connLabel.textContent = 'Disconnected';
});

// ── NTP Clock Sync ───────────────────────────────────────────────
function performNtpSync(samples = 5) {
  let count = 0;
  const offsets = [];
  const ping = () => {
    const t0 = Date.now();
    socket.emit('ntp_ping', t0, (data) => {
      const t3 = Date.now();
      if (data?.serverTimestamp) {
        const rtt = t3 - t0;
        offsets.push(data.serverTimestamp - (t0 + rtt / 2));
      }
      if (++count < samples) setTimeout(ping, 100);
      else clockOffsetMs = Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length);
    });
  };
  ping();
}
setInterval(() => { if (socket.connected) performNtpSync(3); }, 20000);

// ── Background wave animation ───────────────────────────────────
(function animateBgWave() {
  const canvas = document.getElementById('bgWave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let t = 0;
  function draw() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width, h = canvas.height;
    for (let wave = 0; wave < 3; wave++) {
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      for (let x = 0; x <= w; x += 4) {
        const y = h * 0.5 + Math.sin((x / w * 4 + t + wave * 1.2) * Math.PI) * (30 + wave * 15);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(91,139,255,${0.06 - wave * 0.015})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    t += 0.004;
    requestAnimationFrame(draw);
  }
  draw();
})();

// ── Mode routing ─────────────────────────────────────────────────
if (isListenerMode) {
  hostView.classList.add('hidden');
  listenerView.classList.remove('hidden');
} else {
  setupHostView();
}

// ═══════════════════════════════════════════════════════════════
// HOST LOGIC
// ═══════════════════════════════════════════════════════════════
function setupHostView() {
  // Drag & drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) handleFileUpload(file);
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  });

  uploadAnotherBtn.addEventListener('click', () => {
    if (socket.connected && currentRoomCode) {
      socket.emit('close_room');
    }
    currentRoomCode = '';
    sessionPanel.classList.add('hidden');
    uploadIdle.classList.remove('hidden');
    uploadProgress.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    hostAudio.pause();
    hostDisk.classList.remove('spinning');
    clearInterval(hostBroadcastTimer);
    fileInput.value = '';
  });

  // Player controls
  hostPlay.addEventListener('click', togglePlay);

  hostAudio.addEventListener('play', () => {
    updatePlayIcon(true);
    hostDisk.classList.add('spinning');
    if (currentRole === 'host') broadcastState();
  });

  hostAudio.addEventListener('pause', () => {
    updatePlayIcon(false);
    hostDisk.classList.remove('spinning');
    if (currentRole === 'host') broadcastState();
  });

  hostAudio.addEventListener('timeupdate', () => {
    if (!isNaN(hostAudio.duration) && hostAudio.duration > 0) {
      seekBar.value = (hostAudio.currentTime / hostAudio.duration) * 100;
      curTime.textContent = fmt(hostAudio.currentTime);
    }
  });

  hostAudio.addEventListener('loadedmetadata', () => {
    durTime.textContent = fmt(hostAudio.duration);
  });

  seekBar.addEventListener('input', () => {
    if (!isNaN(hostAudio.duration)) {
      hostAudio.currentTime = (seekBar.value / 100) * hostAudio.duration;
      if (currentRole === 'host') broadcastState();
    }
  });

  hostRewind.addEventListener('click', () => {
    hostAudio.currentTime = Math.max(0, hostAudio.currentTime - 10);
    if (currentRole === 'host') broadcastState();
  });

  hostForward.addEventListener('click', () => {
    if (!isNaN(hostAudio.duration)) {
      hostAudio.currentTime = Math.min(hostAudio.duration, hostAudio.currentTime + 10);
      if (currentRole === 'host') broadcastState();
    }
  });

  hostVol.addEventListener('input', () => {
    hostAudio.volume = hostVol.value;
    if (currentRole === 'host') broadcastState();
  });

  copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
      copyLinkBtn.classList.add('copied');
      copyBtnLabel.textContent = 'Copied!';
      setTimeout(() => {
        copyLinkBtn.classList.remove('copied');
        copyBtnLabel.textContent = 'Copy';
      }, 2000);
    });
  });

  qrToggleBtn.addEventListener('click', () => {
    qrBlock.classList.toggle('hidden');
    qrToggleBtn.textContent = qrBlock.classList.contains('hidden') ? '⠿ Show QR Code' : '⠿ Hide QR Code';
  });

  // Join existing session by Room Code
  function handleJoinByCode() {
    const code = joinCodeField?.value.trim().toUpperCase();
    if (!code) return;
    if (code.length < 4) {
      if (joinErrorMsg) {
        joinErrorMsg.textContent = 'Please enter a valid 6-character room code.';
        joinErrorMsg.classList.remove('hidden');
      }
      return;
    }
    window.location.href = `/stream.html?room=${encodeURIComponent(code)}`;
  }

  if (joinCodeBtn) {
    joinCodeBtn.addEventListener('click', handleJoinByCode);
  }
  if (joinCodeField) {
    joinCodeField.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') handleJoinByCode();
    });
    joinCodeField.addEventListener('input', () => {
      joinCodeField.value = joinCodeField.value.toUpperCase();
      if (joinErrorMsg) joinErrorMsg.classList.add('hidden');
    });
  }
}

function togglePlay() {
  initAudioContext(hostAudio);
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  if (hostAudio.paused) {
    hostAudio.play().catch(console.error);
  } else {
    hostAudio.pause();
  }
}

function updatePlayIcon(playing) {
  hostPlayIcon.innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>'
    : '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
}

async function handleFileUpload(file) {
  // Show progress UI
  uploadIdle.classList.add('hidden');
  uploadProgress.classList.remove('hidden');
  uploadProgressTxt.textContent = `Uploading "${file.name}"…`;

  // Simulate progress while uploading (XHR with progress event)
  const formData = new FormData();
  formData.append('audio', file);

  try {
    await uploadWithProgress(formData);
  } catch (err) {
    console.error('Upload error:', err);
    uploadProgress.classList.add('hidden');
    uploadIdle.classList.remove('hidden');
    uploadProgressTxt.textContent = 'Upload failed. Try again.';
    alert('Upload failed: ' + err.message);
  }
}

function uploadWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = pct + '%';
        uploadProgressTxt.textContent = `Uploading… ${pct}%`;
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.ok) {
            onUploadSuccess(data);
            resolve(data);
          } else {
            reject(new Error(data.error || 'Upload failed'));
          }
        } catch {
          reject(new Error('Server response parse error'));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.open('POST', '/api/upload');
    xhr.send(formData);
  });
}

function onUploadSuccess(data) {
  currentTrackUrl = data.fileUrl;
  currentCoverUrl = data.coverUrl || '';
  const title = data.title || 'Uploaded Track';

  hostTrackTitle.textContent = title;

  if (currentCoverUrl) {
    if (hostCoverImg) {
      hostCoverImg.src = currentCoverUrl;
      hostCoverImg.classList.remove('hidden');
    }
    if (hostDiskSvg) hostDiskSvg.classList.add('hidden');
  } else {
    if (hostCoverImg) hostCoverImg.classList.add('hidden');
    if (hostDiskSvg) hostDiskSvg.classList.remove('hidden');
  }

  hostAudio.crossOrigin = 'anonymous';
  hostAudio.preload = 'auto';
  hostAudio.preservesPitch = true;
  if ('mozPreservesPitch' in hostAudio) hostAudio.mozPreservesPitch = true;
  if ('webkitPreservesPitch' in hostAudio) hostAudio.webkitPreservesPitch = true;
  hostAudio.src = data.fileUrl;
  hostAudio.load();

  // Show session panel
  uploadZone.classList.add('hidden');
  uploadProgress.classList.add('hidden');
  sessionPanel.classList.remove('hidden');

  // Init visualizer
  initAudioContext(hostAudio);
  startWaveDrawer(hostAudio, waveCanvas);

  // Create or reuse a room
  if (!currentRoomCode) {
    createRoom(title, data.fileUrl);
  } else {
    broadcastState({ resetPosition: true });
  }
}

function createRoom(title, trackUrl) {
  socket.emit('create_room', {
    initialState: {
      trackUrl,
      trackTitle: title,
      trackArtist: 'SyncDrop Upload',
      coverUrl: currentCoverUrl,
      position: 0,
      playing: false,
      volume: 1,
    }
  }, (res) => {
    if (res?.ok) {
      currentRoomCode = res.roomCode;
      currentRole = 'host';
      roomCodeDisplay.textContent = currentRoomCode;
      const joinUrl = `${serverBaseUrl}/stream.html?room=${currentRoomCode}`;
      shareLinkInput.value = joinUrl;
      qrImg.src = `/api/qrcode?text=${encodeURIComponent(joinUrl)}`;
      startHeartbeat();
    }
  });
}

socket.on('room_info', (info) => {
  if (info?.listenerCount !== undefined && currentRole === 'host') {
    const n = info.listenerCount;
    listenerBadge.textContent = `${n} listener${n === 1 ? '' : 's'}`;
  }
});

function broadcastState(extra = {}) {
  if (currentRole !== 'host' || !currentRoomCode) return;
  socket.emit('host_update_state', {
    trackUrl: currentTrackUrl,
    trackTitle: hostTrackTitle.textContent,
    trackArtist: 'SyncDrop Upload',
    coverUrl: currentCoverUrl,
    position: extra.resetPosition ? 0 : hostAudio.currentTime,
    playing: !hostAudio.paused,
    volume: hostAudio.volume,
  });
}

function startHeartbeat() {
  clearInterval(hostBroadcastTimer);
  hostBroadcastTimer = setInterval(() => {
    if (!hostAudio.paused) broadcastState();
  }, 1500);
}

// ═══════════════════════════════════════════════════════════════
// LISTENER LOGIC
// ═══════════════════════════════════════════════════════════════
function joinRoom(code) {
  socket.emit('join_room', { roomCode: code }, (res) => {
    listenerLoading.classList.add('hidden');

    if (!res?.ok) {
      listenerError.classList.remove('hidden');
      listenerErrorMsg.textContent = res?.error || 'Room not found.';
      return;
    }

    currentRole = 'listener';
    currentRoomCode = res.roomCode;
    if (listenerRoomCodeTag) listenerRoomCodeTag.textContent = currentRoomCode;
    listenerPlayer.classList.remove('hidden');
    initAudioContext(listenerAudio);
    startWaveDrawer(listenerAudio, listenerWave);

    if (res.state) applyState(res.state);
  });
}

socket.on('sync_state', (state) => {
  if (currentRole === 'listener') applyState(state);
});

socket.on('host_disconnected', () => {
  if (currentRole === 'listener') {
    listenerAudio.pause();
    listenerSyncStatus.textContent = '⚠️ Host disconnected. Playback paused.';
    driftText.textContent = 'Host Disconnected';
    listenerDisk.classList.remove('spinning');
  }
});

function applyState(state) {
  if (!state) return;

  // Load track if changed
  if (state.trackUrl && currentTrackUrl !== state.trackUrl) {
    currentTrackUrl = state.trackUrl;
    listenerAudio.crossOrigin = 'anonymous';
    listenerAudio.preload = 'auto';
    listenerAudio.preservesPitch = true;
    if ('mozPreservesPitch' in listenerAudio) listenerAudio.mozPreservesPitch = true;
    if ('webkitPreservesPitch' in listenerAudio) listenerAudio.webkitPreservesPitch = true;
    listenerAudio.src = state.trackUrl;
    listenerAudio.load();
    listenerTrackTitle.textContent = state.trackTitle || 'Streaming…';
  }

  // Update cover art
  if (state.coverUrl) {
    if (listenerCoverImg) {
      listenerCoverImg.src = state.coverUrl;
      listenerCoverImg.classList.remove('hidden');
    }
    if (listenerDiskSvg) listenerDiskSvg.classList.add('hidden');
  } else {
    if (listenerCoverImg) listenerCoverImg.classList.add('hidden');
    if (listenerDiskSvg) listenerDiskSvg.classList.remove('hidden');
  }

  const nowClient = Date.now();
  const nowServer = nowClient + clockOffsetMs;
  const elapsed = Math.max(0, (nowServer - state.updatedAt) / 1000);
  const projectedPos = Math.max(0, state.position + (state.playing ? elapsed : 0));

  const drift = projectedPos - listenerAudio.currentTime;
  const driftMs = Math.round(drift * 1000);

  if (state.playing) {
    if (listenerAudio.paused) {
      listenerAudio.currentTime = projectedPos;
      listenerAudio.play().then(() => {
        listenUnlockBox.classList.add('hidden');
        listenerDisk.classList.add('spinning');
      }).catch(() => {
        listenUnlockBox.classList.remove('hidden');
      });
    } else {
      listenUnlockBox.classList.add('hidden');
      // Drift correction — gentle & pitch-preserved to avoid pops
      if (Math.abs(drift) > 2.0) {
        listenerAudio.currentTime = projectedPos;
        listenerAudio.playbackRate = 1.0;
        driftText.textContent = `Re-synced (was ${driftMs}ms off)`;
      } else if (Math.abs(drift) > 0.06) {
        const nudge = Math.min(0.02, Math.abs(drift) * 0.01);
        const targetRate = drift > 0 ? (1.0 + nudge) : (1.0 - nudge);
        const currentRate = listenerAudio.playbackRate || 1.0;
        const smoothedRate = currentRate * 0.7 + targetRate * 0.3;
        listenerAudio.playbackRate = parseFloat(smoothedRate.toFixed(4));
        driftText.textContent = `Syncing ±${Math.abs(driftMs)}ms (${smoothedRate.toFixed(3)}x)`;
      } else {
        const currentRate = listenerAudio.playbackRate || 1.0;
        listenerAudio.playbackRate = parseFloat((currentRate * 0.7 + 1.0 * 0.3).toFixed(4));
        driftText.textContent = `In Sync ✓ (${driftMs}ms)`;
      }
      listenerDisk.classList.add('spinning');
    }
  } else {
    listenerAudio.playbackRate = 1.0;
    if (!listenerAudio.paused) listenerAudio.pause();
    listenerAudio.currentTime = projectedPos;
    listenerDisk.classList.remove('spinning');
    driftText.textContent = 'Paused by host';
  }

  listenerAudio.volume = state.volume ?? 1;
  listenerVol.value = listenerAudio.volume;
  listenerSyncStatus.textContent = state.playing ? '● Streaming live' : '⏸ Paused by host';
}

// Timeline update for listener
listenerAudio.addEventListener('timeupdate', () => {
  if (!isNaN(listenerAudio.duration) && listenerAudio.duration > 0) {
    listenSeekBar.value = (listenerAudio.currentTime / listenerAudio.duration) * 100;
    listenCurTime.textContent = fmt(listenerAudio.currentTime);
  }
});

listenerAudio.addEventListener('loadedmetadata', () => {
  listenDurTime.textContent = fmt(listenerAudio.duration);
});

listenerVol.addEventListener('input', () => {
  listenerAudio.volume = listenerVol.value;
});

listenUnlockBtn.addEventListener('click', () => {
  initAudioContext(listenerAudio);
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  listenerAudio.play().then(() => {
    listenUnlockBox.classList.add('hidden');
    listenerDisk.classList.add('spinning');
  }).catch(console.error);
});

if (leaveRoomBtn) {
  leaveRoomBtn.addEventListener('click', () => {
    if (listenerAudio) listenerAudio.pause();
    if (socket.connected && currentRoomCode) {
      socket.emit('leave_room');
    }
    currentRoomCode = '';
    currentRole = 'host';
    window.location.href = '/stream.html';
  });
}

// Mobile AudioContext unlock on first touch
document.addEventListener('touchstart', () => {
  if (audioCtx?.state === 'suspended') audioCtx.resume();
}, { once: true });

// ═══════════════════════════════════════════════════════════════
// WEB AUDIO — Visualizer
// ═══════════════════════════════════════════════════════════════
function initAudioContext(audioEl) {
  if (audioAttached) {
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    return;
  }
  try {
    // High-fidelity playback AudioContext
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;

    audioEl.crossOrigin = 'anonymous';
    audioEl.preload = 'auto';
    audioEl.preservesPitch = true;
    if ('mozPreservesPitch' in audioEl) audioEl.mozPreservesPitch = true;
    if ('webkitPreservesPitch' in audioEl) audioEl.webkitPreservesPitch = true;

    const src = audioCtx.createMediaElementSource(audioEl);
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    audioAttached = true;
  } catch (err) {
    console.warn('AudioContext error (visualizer disabled):', err);
    audioAttached = true;
  }
}

function startWaveDrawer(audioEl, canvas) {
  if (waveAnimId) cancelAnimationFrame(waveAnimId);

  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);

  function draw() {
    waveAnimId = requestAnimationFrame(draw);

    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = 64;
    ctx.clearRect(0, 0, w, h);

    if (!analyser) return;
    analyser.getByteFrequencyData(data);

    const barCount = 80;
    const step = Math.floor(data.length / barCount);
    const barW = w / barCount;

    for (let i = 0; i < barCount; i++) {
      const value = data[i * step] / 255;
      const barH = value * h * 0.9;

      // Color shifts based on frequency
      const hue = 210 + i * 0.8;
      const alpha = 0.4 + value * 0.6;
      ctx.fillStyle = `hsla(${hue}, 100%, 70%, ${alpha})`;
      ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH);

      // Mirror (reflection)
      ctx.fillStyle = `hsla(${hue}, 100%, 70%, ${alpha * 0.25})`;
      ctx.fillRect(i * barW + 1, 0, barW - 2, barH * 0.2);
    }
  }

  draw();
}

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════
function fmt(s) {
  if (isNaN(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}
