import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // y-monaco hardcodes this deep import path. monaco-editor's own
      // package.json `exports` map has a pattern-order bug that makes
      // that exact request resolve to a doubled, nonexistent path
      // ("./esm/vs/esm/vs/editor/editor.api.js") - bypass its exports
      // resolution entirely and point straight at the real file.
      {
        find: 'monaco-editor/esm/vs/editor/editor.api.js',
        replacement: fileURLToPath(
          new URL('./node_modules/monaco-editor/esm/vs/editor/editor.api.js', import.meta.url),
        ),
      },
    ],
  },
})
