# SyncPulse

A lightweight cross-device synced music player demo built with Node.js, Express, Socket.IO, and QR-code-based device pairing.

## Features

- Host a shared music session from one browser
- Join from another device using a QR code
- Upload and queue audio files
- Play/pause and track synchronization across devices
- Optional proximity confirmation flow for device pairing

## Run locally

```bash
npm install
npm start
```

Then open the local server URL shown in the terminal.

## Tech stack

- Node.js
- Express
- Socket.IO
- Multer
- music-metadata
- QRCode
