import type { GenerateTestsResult } from './api'

interface TestResultsPanelProps {
  loading: boolean
  result: GenerateTestsResult | null
  error: string | null
  onClose: () => void
}

export default function TestResultsPanel({ loading, result, error, onClose }: TestResultsPanelProps) {
  const passed = result?.results.filter((r) => r.passed).length ?? 0
  const total = result?.results.length ?? 0

  return (
    <div className="github-panel-overlay" onClick={onClose}>
      <div className="test-panel" onClick={(e) => e.stopPropagation()}>
        <div className="github-panel-header">
          <span>🧪 Generated Tests{result ? ` — ${result.test_file}` : ''}</span>
          <button className="panel-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="github-panel-body">
          {loading && <div className="github-panel-loading">Generating and running tests…</div>}
          {error && <div className="github-error">{error}</div>}
          {result && (
            <>
              {total > 0 && (
                <div className="test-summary">
                  {passed} / {total} passed
                </div>
              )}
              {result.results.length === 0 ? (
                <div className="github-panel-hint">
                  The generated script produced no parseable results - it may have failed before printing any. Check
                  the raw output below.
                </div>
              ) : (
                <ul className="test-result-list">
                  {result.results.map((r) => (
                    <li key={r.name} className={r.passed ? 'test-pass' : 'test-fail'}>
                      <span className="test-icon">{r.passed ? '✅' : '❌'}</span>
                      <span className="test-name">{r.name}</span>
                      {r.message && <span className="test-message">{r.message}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <details className="test-details">
                <summary>Raw output</summary>
                <pre className="test-pre">
                  {result.stdout || '(no stdout)'}
                  {result.stderr ? `\n${result.stderr}` : ''}
                </pre>
              </details>
              <details className="test-details">
                <summary>Generated test code</summary>
                <pre className="test-pre">{result.test_code}</pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
