import { DiffEditor } from '@monaco-editor/react'

export interface FixState {
  loading: boolean
  file: string
  original: string
  proposed: string
}

interface FixDiffModalProps {
  fix: FixState
  onAccept: () => void
  onReject: () => void
}

export default function FixDiffModal({ fix, onAccept, onReject }: FixDiffModalProps) {
  return (
    <div className="fix-modal-overlay">
      <div className="fix-modal">
        <div className="fix-modal-header">
          <span>Proposed fix for {fix.file}</span>
          <div className="fix-modal-actions">
            <button className="reject-button" onClick={onReject}>
              ✕ Reject
            </button>
            <button className="accept-button" onClick={onAccept}>
              ✓ Accept
            </button>
          </div>
        </div>
        <div className="fix-modal-diff">
          <DiffEditor
            original={fix.original}
            modified={fix.proposed}
            language="python"
            theme="vs-dark"
            options={{ fontSize: 13, readOnly: true, renderSideBySide: true }}
          />
        </div>
      </div>
    </div>
  )
}
