import type { RunResult } from './api'

interface OutputPanelProps {
  running: boolean
  result: RunResult | null
  onExplainError: () => void
  onFixError: () => void
  explaining: boolean
  fixing: boolean
}

export default function OutputPanel({ running, result, onExplainError, onFixError, explaining, fixing }: OutputPanelProps) {
  return (
    <div className="output-panel">
      <div className="debug-section-title">Output</div>
      {running && <div className="debug-empty">running…</div>}
      {!running && !result && <div className="debug-empty">run a file to see output</div>}
      {!running && result && (
        <>
          {result.timed_out && <div className="output-timeout">killed: exceeded time or resource limits</div>}
          {result.stdout && <pre className="output-stdout">{result.stdout}</pre>}
          {result.stderr && <pre className="output-stderr">{result.stderr}</pre>}
          {result.trace.error && (
            <>
              <pre className="output-error">{result.trace.error}</pre>
              <div className="output-error-actions">
                <button className="explain-button" onClick={onExplainError} disabled={explaining}>
                  {explaining ? 'Asking Gemini…' : '✨ Explain this error'}
                </button>
                <button className="fix-button" onClick={onFixError} disabled={fixing}>
                  {fixing ? 'Asking Gemini…' : '🛠️ Fix this error'}
                </button>
              </div>
            </>
          )}
          {result.trace.truncated && <div className="output-timeout">trace truncated at event limit</div>}
        </>
      )}
    </div>
  )
}
