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

## Deploy on Render

This project is designed for a persistent Node runtime, which is a better fit than Vercel for the real-time Socket.IO backend.

### Render setup

1. Push this repo to GitHub.
2. In Render, create a new Web Service.
3. Connect the repository.
4. Use these settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Node Version: `18`
5. Set the health check path to `/health`.

### Example Render config

```yaml
services:
  - type: web
    name: syncpulse
    env: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
```

## Tech stack

- Node.js
- Express
- Socket.IO
- Multer
- music-metadata
- QRCode
