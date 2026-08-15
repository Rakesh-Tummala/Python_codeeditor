import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { API_WS_BASE } from './config'

const TERMINAL_WS_BASE = `${API_WS_BASE}/api/sessions`

interface TerminalPanelProps {
  sessionId: string
  onClose: () => void
}

export default function TerminalPanel({ sessionId, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({ fontSize: 13, theme: { background: '#1e1e1e' }, cursorBlink: true })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    const ws = new WebSocket(`${TERMINAL_WS_BASE}/${sessionId}/terminal`)

    function sendResize() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }))
      }
    }

    ws.onopen = () => {
      sendResize()
      term.focus()
    }
    ws.onmessage = (ev) => term.write(ev.data)
    ws.onerror = () => term.write('\r\n\x1b[31m[connection error]\x1b[0m\r\n')
    ws.onclose = () => term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')

    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      sendResize()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      dataDisposable.dispose()
      ws.close()
      term.dispose()
    }
  }, [sessionId])

  return (
    <div className="terminal-panel">
      <div className="terminal-panel-header">
        <span>💻 Terminal</span>
        <button className="panel-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  )
}
