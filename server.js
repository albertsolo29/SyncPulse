const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const uploadsDir = process.env.UPLOADS_DIR || path.join(os.tmpdir(), 'syncpulse-uploads');

// Detect local network IP (for share links on other devices)
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}
const LOCAL_IP = getLocalIp();

// Ensure uploads directory exists in a writable location at runtime.
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Dynamic import variable for music-metadata
let musicMetadata = null;
import('music-metadata').then(mm => {
  musicMetadata = mm;
}).catch(() => {});

// File cleanup helpers
function deleteFileIfUploaded(url) {
  if (!url || typeof url !== 'string') return;
  if (url.includes('/uploads/')) {
    const filename = path.basename(url.split('?')[0]);
    const filepath = path.join(uploadsDir, filename);
    fs.stat(filepath, (err) => {
      if (!err) {
        fs.unlink(filepath, () => {
          console.log(`🗑️ Deleted audio upload: ${filename}`);
        });
      }
    });
    // Check and remove associated cover image
    const ext = path.extname(filename);
    const base = filename.replace(ext, '');
    ['.jpg', '.png', '.webp', '.jpeg'].forEach(cExt => {
      const coverPath = path.join(uploadsDir, `${base}-cover${cExt}`);
      fs.unlink(coverPath, () => {});
    });
  }
}

// Clear all temporary uploads on server startup
function clearAllUploads() {
  fs.readdir(uploadsDir, (err, files) => {
    if (err || !files) return;
    files.forEach(file => {
      fs.unlink(path.join(uploadsDir, file), () => {});
    });
    if (files.length > 0) {
      console.log(`🧹 Cleaned ${files.length} leftover upload file(s) on startup.`);
    }
  });
}
clearAllUploads();

// Periodically purge unused / expired uploads older than 15 minutes
function cleanupOrphanedUploads() {
  fs.readdir(uploadsDir, (err, files) => {
    if (err || !files) return;
    const activeFiles = new Set();
    for (const room of rooms.values()) {
      if (room.state?.trackUrl?.includes('/uploads/')) {
        activeFiles.add(path.basename(room.state.trackUrl.split('?')[0]));
      }
    }
    const now = Date.now();
    const maxAgeMs = 15 * 60 * 1000; // 15 minutes

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        const ageMs = now - stats.mtimeMs;
        const isActive = activeFiles.has(file);
        if (!isActive || ageMs > maxAgeMs) {
          fs.unlink(filePath, () => console.log(`🗑️ Auto-purged expired upload: ${file}`));
        }
      });
    });
  });
}
setInterval(cleanupOrphanedUploads, 5 * 60 * 1000); // Run every 5 minutes

// Storage engine for local audio file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `${uniqueSuffix}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.originalname.match(/\.(mp3|wav|ogg|flac|m4a|aac)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'), false);
    }
  }
});

// Curated preset audio tracks (royalty-free samples)
const PRESET_TRACKS = [
  {
    id: 'preset-1',
    title: 'SoundHelix Synthwave Energy',
    artist: 'SoundHelix Sample 1',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    duration: 372
  },
  {
    id: 'preset-2',
    title: 'SoundHelix Chill Ambient',
    artist: 'SoundHelix Sample 2',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    duration: 423
  },
  {
    id: 'preset-3',
    title: 'SoundHelix Cyber Funk',
    artist: 'SoundHelix Sample 3',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    duration: 350
  }
];

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      hostId: null,
      state: {
        trackUrl: PRESET_TRACKS[0].url,
        trackTitle: PRESET_TRACKS[0].title,
        trackArtist: PRESET_TRACKS[0].artist,
        position: 0,
        playing: false,
        volume: 1,
        updatedAt: Date.now(),
      },
      listeners: new Set(),
    });
  }
  return rooms.get(code);
}

// Add CORS + range request & caching headers for audio files (critical for smooth streaming)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.header('Accept-Ranges', 'bytes');

  // Cache static audio files for smooth buffering
  if (req.url.match(/\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i)) {
    res.header('Cache-Control', 'public, max-age=86400, immutable');
  }
  next();
});

app.use(express.static(publicDir, {
  maxAge: '1d',
  acceptRanges: true,
  etag: true
}));
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '1d',
  acceptRanges: true,
  etag: true
}));
app.use(express.json());

// Presets API
app.get('/api/presets', (_req, res) => {
  res.json({ ok: true, tracks: PRESET_TRACKS });
});

// Server-side QR Code Generator API
const QRCode = require('qrcode');
app.get('/api/qrcode', async (req, res) => {
  const text = req.query.text || '';
  if (!text) return res.status(400).send('No text provided');
  try {
    const dataUrl = await QRCode.toDataURL(text, { width: 200, margin: 1 });
    const img = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length
    });
    res.end(img);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Local file upload endpoint with ID3 metadata & artwork extraction
app.post('/api/upload', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No audio file received.' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  let title = path.basename(req.file.originalname, path.extname(req.file.originalname));
  let artist = 'Local Upload';
  let coverUrl = null;

  try {
    if (!musicMetadata) {
      musicMetadata = await import('music-metadata');
    }
    const metadata = await musicMetadata.parseFile(req.file.path);
    if (metadata?.common) {
      if (metadata.common.title) title = metadata.common.title;
      if (metadata.common.artist) artist = metadata.common.artist;

      // Extract embedded album artwork if available
      const picture = metadata.common.picture && metadata.common.picture[0];
      if (picture && picture.data) {
        const mime = picture.format || 'image/jpeg';
        const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
        const coverFilename = `${req.file.filename}-cover${ext}`;
        const coverPath = path.join(uploadsDir, coverFilename);
        fs.writeFileSync(coverPath, picture.data);
        coverUrl = `/uploads/${coverFilename}`;
      }
    }
  } catch (err) {
    console.warn('Metadata/cover extraction notice:', err.message);
  }

  res.json({
    ok: true,
    fileUrl,
    title,
    artist,
    coverUrl
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, roomsCount: rooms.size, timestamp: Date.now() });
});

// Server info — exposes local IP so clients can build correct share links
app.get('/api/server-info', (_req, res) => {
  res.json({ ip: LOCAL_IP, port });
});

io.on('connection', (socket) => {
  // High-precision NTP ping
  socket.on('ntp_ping', (clientTimestamp, ack) => {
    ack?.({
      clientTimestamp,
      serverTimestamp: Date.now()
    });
  });

  socket.on('create_room', (payload, ack) => {
    let code = payload?.roomCode ? payload.roomCode.toUpperCase() : generateCode();
    if (rooms.has(code) && rooms.get(code).hostId && rooms.get(code).hostId !== socket.id) {
      code = generateCode();
    }

    const room = getOrCreateRoom(code);
    room.hostId = socket.id;
    if (payload?.initialState) {
      room.state = {
        ...room.state,
        ...payload.initialState,
        updatedAt: Date.now(),
      };
    } else {
      room.state.updatedAt = Date.now();
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'host';

    io.to(code).emit('room_info', {
      roomCode: code,
      listenerCount: room.listeners.size
    });

    ack?.({ ok: true, roomCode: code, state: room.state });
  });

  socket.on('join_room', (payload, ack) => {
    const code = payload?.roomCode?.toUpperCase();
    if (!code || !rooms.has(code)) {
      return ack?.({ ok: false, error: 'Room code not found. Please check code.' });
    }

    const room = rooms.get(code);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'listener';
    room.listeners.add(socket.id);

    io.to(code).emit('room_info', {
      roomCode: code,
      listenerCount: room.listeners.size
    });

    socket.emit('sync_state', room.state);
    ack?.({ ok: true, roomCode: code, state: room.state });
  });

  socket.on('host_update_state', (payload) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;

    // Rate-limit sync messages to avoid flooding listeners with micro-seeks
    // that cause audio popping. Allow immediate updates for track changes,
    // play/pause events, and position seeks (not heartbeat drift updates).
    const now = Date.now();
    const isTrackChange = payload.trackUrl && payload.trackUrl !== room.state.trackUrl;
    const isPlayPauseChange = payload.playing !== undefined && payload.playing !== room.state.playing;
    const timeSinceLast = now - (room.lastSyncAt || 0);
    const isHeartbeat = !isTrackChange && !isPlayPauseChange;

    // Throttle pure heartbeats to max 1 per second
    if (isHeartbeat && timeSinceLast < 1000) return;

    // Clean up previous uploaded track if host swapped tracks
    if (isTrackChange && room.state.trackUrl) {
      deleteFileIfUploaded(room.state.trackUrl);
    }

    room.lastSyncAt = now;
    room.state = {
      ...room.state,
      ...payload,
      updatedAt: now,
    };

    socket.to(roomCode).emit('sync_state', room.state);
  });

  // Listener or Host leaving room explicitly
  socket.on('leave_room', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    socket.leave(roomCode);
    socket.data.roomCode = null;

    if (room) {
      if (room.hostId === socket.id) {
        room.hostId = null;
        room.state.playing = false;
        room.state.updatedAt = Date.now();
        io.to(roomCode).emit('sync_state', room.state);
        io.to(roomCode).emit('host_disconnected');
      } else {
        room.listeners.delete(socket.id);
        io.to(roomCode).emit('room_info', {
          roomCode,
          listenerCount: room.listeners.size
        });
      }

      if (room.listeners.size === 0 && !room.hostId) {
        deleteFileIfUploaded(room.state?.trackUrl);
        rooms.delete(roomCode);
      }
    }
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.hostId === socket.id) {
      room.hostId = null;
      room.state.playing = false;
      room.state.updatedAt = Date.now();
      io.to(roomCode).emit('sync_state', room.state);
      io.to(roomCode).emit('host_disconnected');
    } else {
      room.listeners.delete(socket.id);
      io.to(roomCode).emit('room_info', {
        roomCode,
        listenerCount: room.listeners.size
      });
    }

    if (room.listeners.size === 0 && !room.hostId) {
      // Host and all listeners left — delete uploaded audio file immediately
      deleteFileIfUploaded(room.state?.trackUrl);
      rooms.delete(roomCode);
    }
  });

  // Explicit host leave / room close event
  socket.on('close_room', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (room && room.hostId === socket.id) {
      deleteFileIfUploaded(room.state?.trackUrl);
      io.to(roomCode).emit('host_disconnected');
      rooms.delete(roomCode);
    }
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`🎵 SyncPulse running on:`);
  console.log(`   Local:   http://localhost:${port}`);
  console.log(`   Network: http://${LOCAL_IP}:${port}`);
  console.log(`   SyncDrop: http://${LOCAL_IP}:${port}/stream.html`);
});
