import type { ReviewComment, TraceEvent } from './api'

export interface StackFrame {
  func: string
  file: string
  line: number
}

export interface AiState {
  loading: boolean
  title: string
  text: string
}

export interface ReviewState {
  loading: boolean
  comments: ReviewComment[]
}

interface DebugSidebarProps {
  currentEvent: TraceEvent | null
  stack: StackFrame[]
  ai: AiState | null
  review: ReviewState | null
  onJumpToLine: (line: number) => void
}

export default function DebugSidebar({ currentEvent, stack, ai, review, onJumpToLine }: DebugSidebarProps) {
  return (
    <div className="debug-sidebar">
      <div className="debug-section">
        <div className="debug-section-title">Variables</div>
        {currentEvent && Object.keys(currentEvent.locals).length > 0 ? (
          <table className="variables-table">
            <tbody>
              {Object.entries(currentEvent.locals).map(([name, value]) => (
                <tr key={name}>
                  <td className="variable-name">{name}</td>
                  <td className="variable-value">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="debug-empty">no locals at this step</div>
        )}
      </div>
      <div className="debug-section">
        <div className="debug-section-title">Call Stack</div>
        {stack.length > 0 ? (
          <ul className="call-stack-list">
            {[...stack].reverse().map((frame, i) => (
              <li key={i} className={i === 0 ? 'call-stack-top' : ''}>
                {frame.func} <span className="call-stack-location">{frame.file}:{frame.line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="debug-empty">not running</div>
        )}
      </div>
      <div className="debug-section">
        <div className="debug-section-title">{ai?.title ?? 'AI Explain'}</div>
        {!ai && <div className="debug-empty">use "Explain Code" or "Explain this error"</div>}
        {ai?.loading && <div className="debug-empty">asking Gemini…</div>}
        {ai && !ai.loading && <div className="ai-explanation">{ai.text}</div>}
      </div>
      <div className="debug-section">
        <div className="debug-section-title">Code Review</div>
        {!review && <div className="debug-empty">use "🔍 Review Code"</div>}
        {review?.loading && <div className="debug-empty">asking Gemini…</div>}
        {review && !review.loading && review.comments.length === 0 && (
          <div className="debug-empty">no issues found</div>
        )}
        {review && !review.loading && review.comments.length > 0 && (
          <ul className="review-list">
            {review.comments.map((c, i) => (
              <li
                key={i}
                className={`review-item review-${c.category}`}
                onClick={() => c.line !== null && onJumpToLine(c.line)}
              >
                <span className={`review-category-badge review-badge-${c.category}`}>{c.category}</span>
                {c.line !== null && <span className="review-line">L{c.line}</span>}
                <div className="review-comment-text">{c.comment}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
