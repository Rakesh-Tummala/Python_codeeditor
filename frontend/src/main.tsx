import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import './index.css'
import App from './App.tsx'

// Without this, @monaco-editor/react fetches its Monaco bundle from a CDN
// at runtime, a *separate* module instance from the local monaco-editor
// package that y-monaco imports directly. Two instances means y-monaco's
// Range/Selection objects aren't instanceof-compatible with the actual
// running editor. Self-hosting from the local package keeps it to one.
loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
