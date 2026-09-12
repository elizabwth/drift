import { readFileSync } from 'fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  define: {
    // Baked in at build time so the version shows in the join screen on
    // every platform (Electron's own app.getVersion() IPC only exists
    // there - the Android/WebView build has no main process to ask).
    __APP_VERSION__: JSON.stringify(pkg.version),
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
  server: {
    port: 5173,
  },
})
