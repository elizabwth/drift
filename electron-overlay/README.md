# Electron Overlay Chat

An overlay chat application built with Electron, React, TypeScript, and Vite that displays on top of games without in-game text chat.

## Features

- Transparent overlay window that stays on top of games
- Lightweight and responsive React UI
- TypeScript for type safety
- Vite for fast development and building
- Draggable window header

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

### Development

Run the app in development mode:
```bash
npm run electron:dev
```

This will start the Vite dev server and launch the Electron app with hot reload enabled.

### Building

Build the application for production:
```bash
npm run electron:build
```

The built application will be in the `release` directory.

## Project Structure

```
electron-overlay/
├── electron/          # Electron main process files
│   ├── main.ts       # Main process entry point
│   └── preload.ts    # Preload script for IPC
├── src/              # React application source
│   ├── App.tsx       # Main app component
│   ├── App.css       # App styles
│   ├── main.tsx      # React entry point
│   └── index.css     # Global styles
├── index.html        # HTML entry point
├── vite.config.ts    # Vite configuration
├── tsconfig.json     # TypeScript configuration
└── package.json      # Project dependencies
```

## Technology Stack

- **Electron**: Desktop application framework
- **React**: UI library
- **TypeScript**: Type-safe JavaScript
- **Vite**: Build tool and dev server
- **Vite Plugin Electron**: Integration between Vite and Electron

## Overlay Features

The window is configured to:
- Stay always on top of other windows
- Be transparent
- Have no frame (frameless window)
- Be draggable via the header
- Support resizing

## Next Steps

Consider adding:
- WebSocket or peer-to-peer communication for multi-user chat
- User authentication and profiles
- Message history persistence
- Customizable themes and opacity
- Hotkey to show/hide the overlay
- Voice chat integration
