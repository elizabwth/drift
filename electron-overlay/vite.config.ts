import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
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
