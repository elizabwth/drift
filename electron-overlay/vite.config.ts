import { existsSync, readFileSync } from 'fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// 2026-09-20: the self-hosted TURN relay's credential + the home's public
// IP used to be hardcoded directly in App.tsx's iceServers array - fine
// for a private repo, not for this one (public, github.com/elizabwth/drift,
// a real collaborator's account). Read from a gitignored local file
// instead (already covered by the existing `*.local` glob in .gitignore)
// and bake it in at build time the same way __APP_VERSION__ already is -
// so a clone of this repo with no turn-config.local.json still builds and
// runs fine, just without a TURN relay (STUN-only, works unless either
// peer is behind symmetric NAT/CGNAT). See turn-config.example.json for
// the expected shape.
const turnConfigPath = new URL('./turn-config.local.json', import.meta.url)
const turnServers = existsSync(turnConfigPath)
  ? JSON.parse(readFileSync(turnConfigPath, 'utf-8'))
  : []

export default defineConfig({
  define: {
    // Baked in at build time so the version shows in the join screen on
    // every platform (Electron's own app.getVersion() IPC only exists
    // there - the Android/WebView build has no main process to ask).
    __APP_VERSION__: JSON.stringify(pkg.version),
    __TURN_SERVERS__: JSON.stringify(turnServers),
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            // Electron always loads preload scripts as CommonJS, regardless of
            // this package's "type": "module" — force cjs output here or the
            // preload build inherits esm and fails with "Cannot use import
            // statement outside a module".
            lib: false,
            rollupOptions: {
              input: 'electron/preload.ts',
              output: {
                format: 'cjs',
                entryFileNames: 'preload.js',
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    // Two real HTML entry points now - the chat overlay (index.html) and
    // the standalone Settings window (settings.html, see the 2026-09-18
    // tray rework). Vite's dev server serves any .html by its own path
    // automatically with no config, but a production build only picks up
    // index.html by default unless every entry is listed explicitly here.
    rollupOptions: {
      input: {
        main: 'index.html',
        settings: 'settings.html',
      },
    },
  },
  server: {
    port: 5173,
  },
})
