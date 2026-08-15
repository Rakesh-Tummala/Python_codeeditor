import { useState } from 'react'
import type { GitStatus, PullRequestInfo } from './api'

interface GitHubPanelProps {
  status: GitStatus | null
  loadingStatus: boolean
  cloning: boolean
  cloneError: string | null
  onClone: (repoUrl: string, token: string) => void
  pushing: boolean
  pushError: string | null
  pushOutput: string | null
  onCommitPush: (message: string) => void
  onRefreshStatus: () => void
  onClose: () => void
  prs: PullRequestInfo[] | null
  loadingPrs: boolean
  prsError: string | null
  onLoadPrs: () => void
  creatingPr: boolean
  createPrError: string | null
  createdPr: { number: number; html_url: string } | null
  onCreatePr: (title: string, body: string) => void
}

export default function GitHubPanel({
  status,
  loadingStatus,
  cloning,
  cloneError,
  onClone,
  pushing,
  pushError,
  pushOutput,
  onCommitPush,
  onRefreshStatus,
  onClose,
  prs,
  loadingPrs,
  prsError,
  onLoadPrs,
  creatingPr,
  createPrError,
  createdPr,
  onCreatePr,
}: GitHubPanelProps) {
  const [repoUrl, setRepoUrl] = useState('')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const isGitHubRemote = !!status?.remote_url?.includes('github.com')

  function handleCloneSubmit() {
    if (!repoUrl.trim()) return
    onClone(repoUrl.trim(), token)
    // Cleared immediately after handing off - the token only needs to
    // reach the backend once on clone; it's never held in this component
    // (or logged) beyond the single submit.
    setToken('')
  }

  function handlePushSubmit() {
    if (!message.trim()) return
    onCommitPush(message.trim())
    setMessage('')
  }

  function handleCreatePrSubmit() {
    if (!prTitle.trim()) return
    onCreatePr(prTitle.trim(), prBody.trim())
  }

  return (
    <div className="github-panel-overlay" onClick={onClose}>
      <div className="github-panel" onClick={(e) => e.stopPropagation()}>
        <div className="github-panel-header">
          <span>🐙 GitHub</span>
          <button className="panel-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {loadingStatus ? (
          <div className="github-panel-loading">Loading status…</div>
        ) : status?.connected ? (
          <div className="github-panel-body">
            <div className="github-status-row">
              <span className="github-status-label">Repo</span>
              <span>{status.repo_dir}</span>
            </div>
            <div className="github-status-row">
              <span className="github-status-label">Branch</span>
              <span>{status.branch ?? '(none)'}</span>
            </div>
            <div className="github-status-row">
              <span className="github-status-label">Remote</span>
              <span className="github-remote-url" title={status.remote_url ?? ''}>
                {status.remote_url}
              </span>
            </div>
            <div className="github-status-row">
              <span className="github-status-label">Changes</span>
              <span>{status.changes.length === 0 ? 'clean' : `${status.changes.length} file(s)`}</span>
            </div>
            {status.changes.length > 0 && (
              <ul className="github-changes-list">
                {status.changes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <button className="github-refresh-button" onClick={onRefreshStatus}>
              ↻ Refresh
            </button>

            <div className="github-panel-divider" />

            <label className="github-field-label" htmlFor="commit-message">
              Commit message
            </label>
            <input
              id="commit-message"
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your change"
              disabled={pushing}
            />
            <button className="github-commit-button" onClick={handlePushSubmit} disabled={pushing || !message.trim()}>
              {pushing ? 'Pushing…' : 'Commit & Push'}
            </button>
            {pushError && <div className="github-error">{pushError}</div>}
            {pushOutput && <pre className="github-push-output">{pushOutput}</pre>}

            {isGitHubRemote && (
              <>
                <div className="github-panel-divider" />
                <div className="github-pr-header">
                  <span className="github-field-label">Pull requests</span>
                  <button className="github-refresh-button" onClick={onLoadPrs}>
                    ↻ {prs === null ? 'Load' : 'Refresh'}
                  </button>
                </div>
                {loadingPrs && <div className="github-panel-loading">Loading pull requests…</div>}
                {prsError && <div className="github-error">{prsError}</div>}
                {prs !== null && !loadingPrs && (
                  <ul className="pr-list">
                    {prs.length === 0 && <li className="github-panel-hint">No open pull requests.</li>}
                    {prs.map((pr) => (
                      <li key={pr.number}>
                        <a href={pr.html_url} target="_blank" rel="noreferrer">
                          #{pr.number} {pr.title}
                        </a>
                        <span className="pr-meta">
                          {pr.head} → {pr.base} · @{pr.user}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="github-panel-divider" />

                <label className="github-field-label" htmlFor="pr-title">
                  New PR from current branch
                </label>
                <input
                  id="pr-title"
                  type="text"
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  placeholder="Title"
                  disabled={creatingPr}
                />
                <input
                  id="pr-body"
                  type="text"
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  placeholder="Description (optional)"
                  disabled={creatingPr}
                />
                <button className="github-commit-button" onClick={handleCreatePrSubmit} disabled={creatingPr || !prTitle.trim()}>
                  {creatingPr ? 'Creating…' : 'Create Pull Request'}
                </button>
                {createPrError && <div className="github-error">{createPrError}</div>}
                {createdPr && (
                  <div className="github-panel-hint">
                    Created{' '}
                    <a href={createdPr.html_url} target="_blank" rel="noreferrer">
                      #{createdPr.number}
                    </a>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="github-panel-body">
            <p className="github-panel-hint">Connect a repo to this session.</p>
            <label className="github-field-label" htmlFor="repo-url">
              Repository URL
            </label>
            <input
              id="repo-url"
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/you/your-repo.git"
              disabled={cloning}
            />
            <label className="github-field-label" htmlFor="repo-token">
              Personal access token (private repos only)
            </label>
            <input
              id="repo-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="optional for public repos"
              disabled={cloning}
            />
            <p className="github-panel-note">
              Use a fine-grained token scoped to just this repo. It's encrypted at rest and only ever sent to your own
              backend.
            </p>
            <button className="github-clone-button" onClick={handleCloneSubmit} disabled={cloning || !repoUrl.trim()}>
              {cloning ? 'Cloning…' : 'Clone'}
            </button>
            {cloneError && <div className="github-error">{cloneError}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
