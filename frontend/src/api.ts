import { getToken } from './auth'
import { API_HTTP_BASE } from './config'

const BASE = `${API_HTTP_BASE}/api/sessions`
const AI_BASE = `${API_HTTP_BASE}/api/ai`

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

export interface TraceEvent {
  file: string
  line: number
  func: string
  depth: number
  locals: Record<string, string>
}

export interface TraceInfo {
  events: TraceEvent[]
  truncated: boolean
  error: string | null
}

export interface RunResult {
  stdout: string
  stderr: string
  exit_code: number | null
  timed_out: boolean
  trace: TraceInfo
}

// Every REST call needs the bearer token attached - centralized here so
// call sites just describe the request, not the auth plumbing.
function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...options, headers })
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string }
    throw new Error(body.detail ?? `request failed: ${res.status}`)
  }
  // The actual shape is trusted from our own backend's response models,
  // not verified at runtime - `res.json()` only tells TypeScript `unknown`.
  return res.json() as Promise<T>
}

export function createSession(): Promise<{ session_id: string }> {
  return authFetch(BASE, { method: 'POST' }).then(unwrap<{ session_id: string }>)
}

export interface SessionSummary {
  session_id: string
  created_at: string
}

export function listMySessions(): Promise<{ sessions: SessionSummary[] }> {
  return authFetch(`${BASE}/mine`).then(unwrap<{ sessions: SessionSummary[] }>)
}

export function listFiles(sessionId: string): Promise<{ tree: TreeNode[] }> {
  return authFetch(`${BASE}/${sessionId}/files`).then(unwrap<{ tree: TreeNode[] }>)
}

export function readFile(sessionId: string, path: string): Promise<{ path: string; content: string }> {
  return authFetch(`${BASE}/${sessionId}/files/${path}`).then(unwrap<{ path: string; content: string }>)
}

export function writeFile(sessionId: string, path: string, content: string): Promise<void> {
  return authFetch(`${BASE}/${sessionId}/files/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).then(unwrap<void>)
}

export function createEntry(sessionId: string, path: string, isDir: boolean): Promise<void> {
  return authFetch(`${BASE}/${sessionId}/files/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_dir: isDir }),
  }).then(unwrap<void>)
}

export function deleteEntry(sessionId: string, path: string): Promise<void> {
  return authFetch(`${BASE}/${sessionId}/files/${path}`, { method: 'DELETE' }).then(unwrap<void>)
}

export function renameEntry(sessionId: string, oldPath: string, newPath: string): Promise<void> {
  return authFetch(`${BASE}/${sessionId}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
  }).then(unwrap<void>)
}

export function runFile(sessionId: string, entryPath: string): Promise<RunResult> {
  return authFetch(`${BASE}/${sessionId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry_path: entryPath }),
  }).then(unwrap<RunResult>)
}

export function explainError(
  file: string,
  error: string,
  traceTail: TraceEvent[],
  source?: string,
): Promise<{ explanation: string }> {
  return authFetch(`${AI_BASE}/explain-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, error, trace_tail: traceTail, source }),
  }).then(unwrap<{ explanation: string }>)
}

export function explainCode(code: string, language: string): Promise<{ explanation: string }> {
  return authFetch(`${AI_BASE}/explain-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, language }),
  }).then(unwrap<{ explanation: string }>)
}

export function fixError(
  file: string,
  error: string,
  traceTail: TraceEvent[],
  source: string,
): Promise<{ fixed_code: string }> {
  return authFetch(`${AI_BASE}/fix-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, error, trace_tail: traceTail, source }),
  }).then(unwrap<{ fixed_code: string }>)
}

export interface GitStatus {
  connected: boolean
  repo_dir: string | null
  remote_url: string | null
  branch: string | null
  changes: string[]
}

export function cloneRepo(sessionId: string, repoUrl: string, token?: string): Promise<{ repo_dir: string }> {
  return authFetch(`${BASE}/${sessionId}/git/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: repoUrl, token: token || undefined }),
  }).then(unwrap<{ repo_dir: string }>)
}

export function gitStatus(sessionId: string): Promise<GitStatus> {
  return authFetch(`${BASE}/${sessionId}/git/status`).then(unwrap<GitStatus>)
}

export function commitAndPush(sessionId: string, message: string): Promise<{ output: string }> {
  return authFetch(`${BASE}/${sessionId}/git/commit-and-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  }).then(unwrap<{ output: string }>)
}

export interface TestCaseResult {
  name: string
  passed: boolean
  message: string | null
}

export interface GenerateTestsResult {
  test_file: string
  test_code: string
  results: TestCaseResult[]
  stdout: string
  stderr: string
}

export function generateTests(sessionId: string, file: string): Promise<GenerateTestsResult> {
  return authFetch(`${BASE}/${sessionId}/generate-tests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  }).then(unwrap<GenerateTestsResult>)
}

export interface ReviewComment {
  line: number | null
  category: string
  comment: string
}

export function reviewCode(file: string, source: string, language: string): Promise<{ comments: ReviewComment[] }> {
  return authFetch(`${AI_BASE}/review-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, source, language }),
  }).then(unwrap<{ comments: ReviewComment[] }>)
}

export interface PullRequestInfo {
  number: number
  title: string
  html_url: string
  state: string
  user: string
  head: string
  base: string
}

export function listPullRequests(sessionId: string): Promise<{ pull_requests: PullRequestInfo[] }> {
  return authFetch(`${BASE}/${sessionId}/git/prs`).then(unwrap<{ pull_requests: PullRequestInfo[] }>)
}

export function createPullRequest(
  sessionId: string,
  title: string,
  body: string,
  base?: string,
): Promise<{ number: number; html_url: string }> {
  return authFetch(`${BASE}/${sessionId}/git/prs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, base: base || undefined }),
  }).then(unwrap<{ number: number; html_url: string }>)
}
