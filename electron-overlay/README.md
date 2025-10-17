# Electron Overlay Chat

An overlay chat application that displays on top of games without in-game text chat. Built with Electron, React, TypeScript, and Vite.

## Getting Started

**Prerequisites:** Node.js (v18+)

**Install:**
```bash
npm install
```

**Run:**
```bash
npm run electron:dev
```

**Build:**
```bash
npm run electron:build
```

Built app will be in the `release` directory.

## Features

- Transparent overlay window that stays on top
- Frameless, draggable and resizable
- Lightweight React UI
- Hot reload during development

## Planned Features

- WebSocket/peer-to-peer communication for multi-user chat
- User authentication and profiles
- Message history persistence
- Customizable themes and opacity
- Hotkey to show/hide overlay
- Voice chat integration

See [WISHLIST.md](../WISHLIST.md) for the complete feature wishlist.
