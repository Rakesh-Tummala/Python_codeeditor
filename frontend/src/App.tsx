import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { MonacoBinding } from 'y-monaco'
import FileTree from './FileTree'
import DebugSidebar, { type AiState, type ReviewState, type StackFrame } from './DebugSidebar'
import OutputPanel from './OutputPanel'
import FixDiffModal, { type FixState } from './FixDiffModal'
import GitHubPanel from './GitHubPanel'
import LoginPage from './LoginPage'
import TerminalPanel from './TerminalPanel'
import TestResultsPanel from './TestResultsPanel'
import UserMenu from './UserMenu'
import { clearToken, consumeTokenFromUrl, fetchMe, getToken, type AuthUser } from './auth'
import { API_WS_BASE } from './config'
import { identityForUser, type UserIdentity } from './collab'
import { useResizable } from './useResizable'
import {
  cloneRepo,
  commitAndPush,
  createEntry,
  createPullRequest,
  createSession,
  deleteEntry,
  explainCode,
  explainError,
  fixError,
  generateTests,
  gitStatus,
  listFiles,
  listMySessions,
  listPullRequests,
  readFile,
  renameEntry,
  reviewCode,
  runFile,
  writeFile,
  type GenerateTestsResult,
  type GitStatus,
  type PullRequestInfo,
  type RunResult,
  type SessionSummary,
  type TraceEvent,
  type TreeNode,
} from './api'
import './App.css'

interface Tab {
  path: string
  content: string
  dirty: boolean
}

const SAVE_DEBOUNCE_MS = 600
const YJS_WS_BASE = `${API_WS_BASE}/api/yjs`

function languageForPath(path: string): string {
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.md')) return 'markdown'
  return 'plaintext'
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

// Each event only records the depth of its own frame; the full stack at
// that point is reconstructed by keeping a running array indexed by depth
// and truncating it to the current depth on every step. This is correct
// even when depth drops by more than one at once (e.g. an exception
// unwinding several frames between two consecutive recorded events).
function computeStacks(events: TraceEvent[]): StackFrame[][] {
  const stacks: StackFrame[][] = []
  const stack: StackFrame[] = []
  for (const ev of events) {
    stack[ev.depth - 1] = { func: ev.func, file: ev.file, line: ev.line }
    stack.length = ev.depth
    stacks.push([...stack])
  }
  return stacks
}

function findNextEventIndex(events: TraceEvent[], fromIndex: number, file: string, line: number): number | null {
  for (let i = fromIndex + 1; i < events.length; i++) {
    if (events[i].file === file && events[i].line === line) return i
  }
  for (let i = 0; i <= fromIndex; i++) {
    if (events[i].file === file && events[i].line === line) return i
  }
  return null
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [mySessions, setMySessions] = useState<SessionSummary[]>([])

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set())
  const [aiState, setAiState] = useState<AiState | null>(null)
  const [fixState, setFixState] = useState<FixState | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [presence, setPresence] = useState<UserIdentity[]>([])

  const [reviewState, setReviewState] = useState<ReviewState | null>(null)
  const [reviewedPath, setReviewedPath] = useState<string | null>(null)
  const reviewDecorationsRef = useRef<string[]>([])

  const [showTestPanel, setShowTestPanel] = useState(false)
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<GenerateTestsResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  // Shared debugging state (Week 8): whoever last ran the file is the
  // "driver" - their run result / step position / breakpoints broadcast to
  // everyone else in the session via a dedicated Yjs room. Simplest correct
  // version: one shared truth, no independent-but-synced per-user state.
  const [driverId, setDriverId] = useState<number | null>(null)
  const [driverName, setDriverName] = useState<string | null>(null)
  const debugYdocRef = useRef<Y.Doc | null>(null)
  const debugMapRef = useRef<Y.Map<unknown> | null>(null)

  const [showGitPanel, setShowGitPanel] = useState(false)
  const [gitStatusState, setGitStatusState] = useState<GitStatus | null>(null)
  const [loadingGitStatus, setLoadingGitStatus] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushOutput, setPushOutput] = useState<string | null>(null)

  const [prs, setPrs] = useState<PullRequestInfo[] | null>(null)
  const [loadingPrs, setLoadingPrs] = useState(false)
  const [prsError, setPrsError] = useState<string | null>(null)
  const [creatingPr, setCreatingPr] = useState(false)
  const [createPrError, setCreatePrError] = useState<string | null>(null)
  const [createdPr, setCreatedPr] = useState<{ number: number; html_url: string } | null>(null)

  const [showTerminal, setShowTerminal] = useState(false)

  // Each panel's size is user-draggable rather than fixed - direction=-1
  // means the panel grows as the pointer moves in the *opposite* axis
  // direction (a right- or bottom-anchored panel growing left/up).
  const fileTree = useResizable(220, { axis: 'x', direction: 1, min: 150, max: 500 })
  const debugSidebar = useResizable(280, { axis: 'x', direction: -1, min: 200, max: 560 })
  const outputPanel = useResizable(160, { axis: 'y', direction: -1, min: 80, max: 500 })
  const terminalPanel = useResizable(320, { axis: 'y', direction: -1, min: 120, max: 700 })

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const lineDecorationsRef = useRef<string[]>([])
  const breakpointDecorationsRef = useRef<string[]>([])
  // Which tab currently has a live Yjs binding, so autosave knows to defer
  // to the collab room's own persistence instead of double-writing the file.
  const yjsBoundPathRef = useRef<string | null>(null)

  // No driver yet (nobody has run anything in this room) counts as "you may
  // drive" - otherwise only the client whose Yjs doc ID matches gets control.
  const myClientId = debugYdocRef.current?.clientID ?? null
  const isDriver = driverId === null || driverId === myClientId

  // Bridges Monaco's onMouseDown (registered once at mount, so it closes
  // over whatever state existed at that moment) with state that changes
  // on every render. The handler reads through this ref instead of
  // directly closing over activePath/runResult/etc., so it always sees
  // current values without needing to be torn down and re-registered.
  const liveRef = useRef({ activePath, runResult, stepIndex, breakpoints, isDriver })
  useEffect(() => {
    liveRef.current = { activePath, runResult, stepIndex, breakpoints, isDriver }
  })

  // Runs once, before anything session-related: pick up a token from a
  // just-completed OAuth redirect (if any), then resolve whoever is
  // actually logged in. Nothing else in the app can safely start until
  // this settles, since every API call and WebSocket needs the token.
  useEffect(() => {
    async function boot() {
      consumeTokenFromUrl()
      const me = await fetchMe()
      setUser(me)
      setAuthLoading(false)
    }
    boot()
  }, [])

  // One-time setup: reuse a saved session id so a page reload keeps
  // working in the same on-disk directory instead of starting fresh.
  // Waits for login to resolve first - every call inside needs the token.
  useEffect(() => {
    if (!user) return
    async function init() {
      // A shareable link (?session=...) always wins over whatever is
      // already saved locally - that's what makes it a "join this room"
      // link rather than just a bookmark back to your own last session.
      const urlSession = new URLSearchParams(window.location.search).get('session')
      let sid = urlSession ?? localStorage.getItem('pytrace:sessionId')
      let initialTree: TreeNode[] = []

      if (sid) {
        try {
          initialTree = (await listFiles(sid)).tree
          localStorage.setItem('pytrace:sessionId', sid)
        } catch {
          // Saved session no longer exists on the backend (moved project,
          // cleared sessions dir, etc.) - fall through and start fresh
          // instead of leaving this as an unhandled rejection.
          sid = null
        }
      }
      if (!sid) {
        const res = await createSession()
        sid = res.session_id
        localStorage.setItem('pytrace:sessionId', sid)
        initialTree = (await listFiles(sid)).tree
      }

      // Captured before setSessionId triggers any render: once sessionId
      // is set, the persistence effect below fires with the still-empty
      // `tabs` state and overwrites these very keys with "[]".
      const savedTabs: string[] = JSON.parse(localStorage.getItem(`pytrace:openTabs:${sid}`) ?? '[]')
      const savedActive = localStorage.getItem(`pytrace:activeTab:${sid}`)

      setSessionId(sid)
      setTree(initialTree)

      const reopened: Tab[] = []
      for (const path of savedTabs) {
        try {
          const { content } = await readFile(sid, path)
          reopened.push({ path, content, dirty: false })
        } catch {
          // file was deleted outside this session; skip it
        }
      }
      setTabs(reopened)
      if (savedActive && reopened.some((t) => t.path === savedActive)) {
        setActivePath(savedActive)
      } else if (reopened.length > 0) {
        setActivePath(reopened[0].path)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Persist which tabs are open so a reload restores the workspace, not
  // just the on-disk files (which already persist on their own via save).
  useEffect(() => {
    if (!sessionId) return
    localStorage.setItem(`pytrace:openTabs:${sessionId}`, JSON.stringify(tabs.map((t) => t.path)))
  }, [tabs, sessionId])

  useEffect(() => {
    if (!sessionId) return
    localStorage.setItem(`pytrace:activeTab:${sessionId}`, activePath ?? '')
  }, [activePath, sessionId])

  async function refreshTree() {
    if (!sessionId) return
    const { tree: newTree } = await listFiles(sessionId)
    setTree(newTree)
  }

  async function openFile(path: string) {
    if (!sessionId) return
    if (tabs.some((t) => t.path === path)) {
      setActivePath(path)
      return
    }
    const { content } = await readFile(sessionId, path)
    setTabs((prev) => [...prev, { path, content, dirty: false }])
    setActivePath(path)
  }

  function closeTab(path: string) {
    setTabs((prev) => prev.filter((t) => t.path !== path))
    if (activePath === path) {
      const remaining = tabs.filter((t) => t.path !== path)
      setActivePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
    }
  }

  function updateTabContent(path: string, content: string) {
    const yjsBound = yjsBoundPathRef.current === path

    // While a Yjs binding owns this file, the backend collab room already
    // debounce-persists every change to disk - a second writer racing on
    // the same file would be redundant at best, and a source of stale
    // overwrites at worst.
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, content, dirty: !yjsBound } : t)))
    if (yjsBound) return

    clearTimeout(saveTimers.current[path])
    saveTimers.current[path] = setTimeout(async () => {
      if (!sessionId) return
      await writeFile(sessionId, path, content)
      setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, dirty: false } : t)))
    }, SAVE_DEBOUNCE_MS)
  }

  async function handleCreate(parentDir: string, isDir: boolean) {
    if (!sessionId) return
    const name = window.prompt(isDir ? 'New folder name:' : 'New file name:')
    if (!name) return
    const path = joinPath(parentDir, name)
    try {
      await createEntry(sessionId, path, isDir)
      await refreshTree()
      if (!isDir) await openFile(path)
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  async function handleDelete(path: string) {
    if (!sessionId) return
    if (!window.confirm(`Delete ${path}?`)) return
    await deleteEntry(sessionId, path)
    closeTab(path)
    await refreshTree()
  }

  async function handleRename(oldPath: string) {
    if (!sessionId) return
    const oldName = oldPath.split('/').pop()!
    const newName = window.prompt('Rename to:', oldName)
    if (!newName || newName === oldName) return
    const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const newPath = joinPath(dir, newName)
    try {
      await renameEntry(sessionId, oldPath, newPath)
      setTabs((prev) => prev.map((t) => (t.path === oldPath ? { ...t, path: newPath } : t)))
      if (activePath === oldPath) setActivePath(newPath)
      await refreshTree()
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  // Publishes run/step/breakpoint state to everyone else in the session and
  // claims driver status for whoever calls it - running always reclaims the
  // driver seat (last-to-run wins), which is the "simplest correct version"
  // the plan calls for rather than a negotiated handoff.
  function broadcastDebugState(result: RunResult | null, step: number, bps: Set<string>, file: string | null) {
    const ydoc = debugYdocRef.current
    const dmap = debugMapRef.current
    if (!ydoc || !dmap || !user) return
    const me = identityForUser(user)
    ydoc.transact(() => {
      dmap.set('runResult', result ? JSON.stringify(result) : null)
      dmap.set('stepIndex', step)
      dmap.set('breakpoints', Array.from(bps))
      dmap.set('driverId', ydoc.clientID)
      dmap.set('driverName', me.name)
      dmap.set('activeFile', file)
    })
  }

  async function handleRun() {
    if (!sessionId || !activeTab) return
    setRunning(true)
    setRunResult(null)
    setStepIndex(0)
    try {
      const result = await runFile(sessionId, activeTab.path)
      setRunResult(result)
      setStepIndex(0)
      broadcastDebugState(result, 0, breakpoints, activeTab.path)
    } catch (e) {
      window.alert((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  async function handleExplainError() {
    if (!runResult?.trace.error) return
    const tail = runResult.trace.events.slice(-12)
    const crashFile = tail.length > 0 ? tail[tail.length - 1].file : activeTab?.path ?? ''
    const sourceTab = tabs.find((t) => t.path === crashFile)
    setAiState({ loading: true, title: 'Why it crashed', text: '' })
    try {
      const { explanation } = await explainError(crashFile, runResult.trace.error, tail, sourceTab?.content)
      setAiState({ loading: false, title: 'Why it crashed', text: explanation })
    } catch (e) {
      setAiState({ loading: false, title: 'Explain error failed', text: (e as Error).message })
    }
  }

  async function handleFixError() {
    if (!runResult?.trace.error) return
    const tail = runResult.trace.events.slice(-12)
    const crashFile = tail.length > 0 ? tail[tail.length - 1].file : activeTab?.path ?? ''
    const sourceTab = tabs.find((t) => t.path === crashFile)
    if (!sourceTab) {
      window.alert(`Can't propose a fix: ${crashFile} isn't open.`)
      return
    }
    setFixState({ loading: true, file: crashFile, original: sourceTab.content, proposed: '' })
    try {
      const { fixed_code } = await fixError(crashFile, runResult.trace.error, tail, sourceTab.content)
      setFixState({ loading: false, file: crashFile, original: sourceTab.content, proposed: fixed_code })
    } catch (e) {
      window.alert((e as Error).message)
      setFixState(null)
    }
  }

  function handleRejectFix() {
    setFixState(null)
  }

  // Applying a fix always goes through the real editor model (never a
  // direct disk write) so it flows through the same path a keystroke
  // would - autosave if plain, or the Yjs binding if the file happens to
  // be collaboratively bound, either way with nothing to special-case.
  const pendingFixRef = useRef<{ path: string; code: string } | null>(null)

  async function handleAcceptFix() {
    if (!fixState) return
    pendingFixRef.current = { path: fixState.file, code: fixState.proposed }
    setFixState(null)
    await openFile(fixState.file)
  }

  useEffect(() => {
    const pending = pendingFixRef.current
    if (!pending || !activeTab || activeTab.path !== pending.path) return
    const model = editorRef.current?.getModel()
    if (!model || !model.uri.toString().endsWith(pending.path)) return
    model.setValue(pending.code)
    pendingFixRef.current = null
  })

  async function handleExplainSelection() {
    const editor = editorRef.current
    if (!editor || !activeTab) return
    const selection = editor.getSelection()
    const model = editor.getModel()
    const text = selection && model && !selection.isEmpty() ? model.getValueInRange(selection) : activeTab.content
    setAiState({ loading: true, title: 'Code explanation', text: '' })
    try {
      const { explanation } = await explainCode(text, languageForPath(activeTab.path))
      setAiState({ loading: false, title: 'Code explanation', text: explanation })
    } catch (e) {
      setAiState({ loading: false, title: 'Explain code failed', text: (e as Error).message })
    }
  }

  async function handleReviewCode() {
    if (!activeTab) return
    setReviewState({ loading: true, comments: [] })
    try {
      const { comments } = await reviewCode(activeTab.path, activeTab.content, languageForPath(activeTab.path))
      setReviewState({ loading: false, comments })
      setReviewedPath(activeTab.path)
    } catch (e) {
      setReviewState(null)
      window.alert((e as Error).message)
    }
  }

  function handleJumpToReviewLine(line: number) {
    const editor = editorRef.current
    if (!editor) return
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.focus()
  }

  async function handleGenerateTests() {
    if (!sessionId || !activeTab) return
    setShowTestPanel(true)
    setTestLoading(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await generateTests(sessionId, activeTab.path)
      setTestResult(result)
      await refreshTree()
    } catch (e) {
      setTestError((e as Error).message)
    } finally {
      setTestLoading(false)
    }
  }

  async function loadGitStatus() {
    if (!sessionId) return
    setLoadingGitStatus(true)
    try {
      const s = await gitStatus(sessionId)
      setGitStatusState(s)
    } catch (e) {
      window.alert((e as Error).message)
    } finally {
      setLoadingGitStatus(false)
    }
  }

  function handleOpenGitPanel() {
    setShowGitPanel(true)
    setCloneError(null)
    setPushError(null)
    setPushOutput(null)
    setPrs(null)
    setPrsError(null)
    setCreatePrError(null)
    setCreatedPr(null)
    loadGitStatus()
  }

  async function handleClone(repoUrl: string, token: string) {
    if (!sessionId) return
    setCloning(true)
    setCloneError(null)
    try {
      await cloneRepo(sessionId, repoUrl, token)
      await refreshTree()
      await loadGitStatus()
    } catch (e) {
      setCloneError((e as Error).message)
    } finally {
      setCloning(false)
    }
  }

  async function handleCommitPush(message: string) {
    if (!sessionId) return
    setPushing(true)
    setPushError(null)
    setPushOutput(null)
    try {
      const { output } = await commitAndPush(sessionId, message)
      setPushOutput(output)
      await loadGitStatus()
    } catch (e) {
      setPushError((e as Error).message)
    } finally {
      setPushing(false)
    }
  }

  async function handleLoadPrs() {
    if (!sessionId) return
    setLoadingPrs(true)
    setPrsError(null)
    try {
      const { pull_requests } = await listPullRequests(sessionId)
      setPrs(pull_requests)
    } catch (e) {
      setPrsError((e as Error).message)
    } finally {
      setLoadingPrs(false)
    }
  }

  async function handleCreatePr(title: string, body: string) {
    if (!sessionId) return
    setCreatingPr(true)
    setCreatePrError(null)
    setCreatedPr(null)
    try {
      const result = await createPullRequest(sessionId, title, body)
      setCreatedPr(result)
      await handleLoadPrs()
    } catch (e) {
      setCreatePrError((e as Error).message)
    } finally {
      setCreatingPr(false)
    }
  }

  function handleShare() {
    if (!sessionId) return
    const url = `${window.location.origin}${window.location.pathname}?session=${sessionId}`
    navigator.clipboard.writeText(url).then(
      () => window.alert(`Share link copied to clipboard:\n${url}`),
      () => window.prompt('Copy this link to share your session:', url),
    )
  }

  async function handleOpenUserMenu() {
    try {
      const { sessions } = await listMySessions()
      setMySessions(sessions)
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  function handleOpenMySession(id: string) {
    window.location.href = `${window.location.origin}${window.location.pathname}?session=${id}`
  }

  function handleLogout() {
    clearToken()
    // A stored sessionId is per-browser, not per-account - clearing it on
    // logout stops a different person logging into the same browser from
    // silently landing back in whatever session was open before.
    localStorage.removeItem('pytrace:sessionId')
    window.location.href = window.location.origin + window.location.pathname
  }

  const activeTab = tabs.find((t) => t.path === activePath) ?? null
  const events = runResult?.trace.events ?? []
  const stacksByIndex = useMemo(() => computeStacks(events), [events])
  const currentEvent = events[stepIndex] ?? null
  const currentStack = stacksByIndex[stepIndex] ?? []

  // Pre-open every file a trace touches, whether the trace came from your
  // own run or arrived over the shared debug room from whoever is driving -
  // otherwise a viewer following along would have nothing open to highlight.
  useEffect(() => {
    if (!runResult) return
    const filesInTrace = Array.from(new Set(runResult.trace.events.map((e) => e.file)))
    const openPaths = new Set(tabs.map((t) => t.path))
    const toOpen = filesInTrace.filter((f) => !openPaths.has(f))
    if (toOpen.length === 0) return
    ;(async () => {
      for (const f of toOpen) await openFile(f)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runResult])

  function stepTo(index: number) {
    if (events.length === 0 || !isDriver) return
    const clamped = Math.max(0, Math.min(index, events.length - 1))
    setStepIndex(clamped)
    broadcastDebugState(runResult, clamped, breakpoints, activeTab?.path ?? currentEvent?.file ?? null)
  }

  // Keep the visible tab in sync with wherever stepping lands, so the
  // highlighted line is always on screen without a manual tab click.
  useEffect(() => {
    if (currentEvent && currentEvent.file !== activePath && tabs.some((t) => t.path === currentEvent.file)) {
      setActivePath(currentEvent.file)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEvent])

  // Current-line highlight, re-applied whenever the step or visible file
  // changes. Cleared (empty decoration array) when they don't match yet,
  // i.e. mid-switch to a different file.
  useEffect(() => {
    const editor = editorRef.current
    const monacoNs = monacoRef.current
    if (!editor || !monacoNs) return
    if (!currentEvent || currentEvent.file !== activeTab?.path) {
      lineDecorationsRef.current = editor.deltaDecorations(lineDecorationsRef.current, [])
      return
    }
    lineDecorationsRef.current = editor.deltaDecorations(lineDecorationsRef.current, [
      {
        range: new monacoNs.Range(currentEvent.line, 1, currentEvent.line, 1),
        options: { isWholeLine: true, className: 'current-line-highlight', glyphMarginClassName: 'current-line-glyph' },
      },
    ])
    editor.revealLineInCenter(currentEvent.line)
  }, [currentEvent, activeTab])

  // Breakpoint gutter dots for whichever file is currently visible.
  useEffect(() => {
    const editor = editorRef.current
    const monacoNs = monacoRef.current
    if (!editor || !monacoNs || !activeTab) return
    const lines = Array.from(breakpoints)
      .filter((key) => key.startsWith(`${activeTab.path}:`))
      .map((key) => Number(key.slice(key.lastIndexOf(':') + 1)))
    breakpointDecorationsRef.current = editor.deltaDecorations(
      breakpointDecorationsRef.current,
      lines.map((line) => ({
        range: new monacoNs.Range(line, 1, line, 1),
        options: { isWholeLine: false, glyphMarginClassName: 'breakpoint-glyph' },
      })),
    )
  }, [breakpoints, activeTab])

  // Renders review comments as real Monaco decorations (line highlight +
  // native hover tooltip) rather than only listing them in the sidebar -
  // that's what makes them "inline annotations" and not just a text blob.
  // Only rendered while the reviewed file is the one currently open, so a
  // stale review from a different file never mislabels the wrong lines.
  useEffect(() => {
    const editor = editorRef.current
    const monacoNs = monacoRef.current
    if (!editor || !monacoNs) return
    if (!reviewState || reviewState.loading || activeTab?.path !== reviewedPath) {
      reviewDecorationsRef.current = editor.deltaDecorations(reviewDecorationsRef.current, [])
      return
    }
    const decorations = reviewState.comments
      .filter((c) => c.line !== null)
      .map((c) => ({
        range: new monacoNs.Range(c.line as number, 1, c.line as number, 1),
        options: {
          isWholeLine: true,
          className: `review-highlight review-highlight-${c.category}`,
          glyphMarginClassName: `review-glyph review-glyph-${c.category}`,
          hoverMessage: { value: `**${c.category}**: ${c.comment}` },
          glyphMarginHoverMessage: { value: `**${c.category}**: ${c.comment}` },
        },
      }))
    reviewDecorationsRef.current = editor.deltaDecorations(reviewDecorationsRef.current, decorations)
  }, [reviewState, reviewedPath, activeTab])

  function handleGutterClick(lineNumber: number) {
    const {
      activePath: curPath,
      runResult: curResult,
      stepIndex: curStep,
      breakpoints: curBreakpoints,
      isDriver: curIsDriver,
    } = liveRef.current
    if (!curPath || !curIsDriver) return
    const key = `${curPath}:${lineNumber}`
    const wasSet = curBreakpoints.has(key)
    const nextBreakpoints = new Set(curBreakpoints)
    if (wasSet) nextBreakpoints.delete(key)
    else nextBreakpoints.add(key)
    setBreakpoints(nextBreakpoints)

    let nextStep = curStep
    if (!wasSet && curResult) {
      const idx = findNextEventIndex(curResult.trace.events, curStep, curPath, lineNumber)
      if (idx !== null) nextStep = idx
      else window.alert(`No trace event hits ${curPath}:${lineNumber} in this run.`)
    }
    if (nextStep !== curStep) setStepIndex(nextStep)
    broadcastDebugState(curResult, nextStep, nextBreakpoints, curPath)
  }

  const handleEditorMount: OnMount = (editor, monacoNs) => {
    editorRef.current = editor
    monacoRef.current = monacoNs
    editor.onMouseDown((e) => {
      const isGutter =
        e.target.type === monacoNs.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        e.target.type === monacoNs.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      if (isGutter && e.target.position) {
        handleGutterClick(e.target.position.lineNumber)
      }
    })
    // The Yjs-binding effect depends on the editor existing; onMount fires
    // imperatively from Monaco's own loader, not through React's render
    // cycle, so a plain ref write wouldn't re-trigger that effect on the
    // very first file opened.
    setEditorReady(true)
  }

  // Binds the currently visible file to a shared Yjs document over the
  // collab websocket, so every keystroke (local or remote) flows through
  // one CRDT instead of the plain string state used for everything else.
  // Only the active/visible file is bound - that's the file the "done
  // when" bar actually cares about (two tabs editing the SAME open file).
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeTab || !sessionId || !editorReady) return
    const model = editor.getModel()
    if (!model) return

    const ydoc = new Y.Doc()
    const roomName = `${sessionId}/${activeTab.path}`
    const provider = new WebsocketProvider(YJS_WS_BASE, roomName, ydoc, { params: { token: getToken() ?? '' } })
    const ytext = ydoc.getText('content')

    const me = user ? identityForUser(user) : { name: 'unknown', color: '#888888' }
    provider.awareness.setLocalStateField('user', me)

    function updatePresence() {
      const users = Array.from(provider.awareness.getStates().values())
        .map((s) => (s as { user?: UserIdentity }).user)
        .filter((u): u is UserIdentity => !!u)
      setPresence(users)
    }
    provider.awareness.on('change', updatePresence)
    updatePresence()

    // MonacoBinding's constructor immediately forces the model to match
    // ytext's *current local* value - but a brand-new Y.Doc starts empty
    // until the WebSocket round-trip completes. Binding right away would
    // briefly (and destructively) wipe a file that already has real
    // on-disk content, before the server's seeded content arrives. Wait
    // for the provider's own sync confirmation first.
    let binding: InstanceType<typeof MonacoBinding> | null = null
    function onSync(isSynced: boolean) {
      if (isSynced && !binding) {
        binding = new MonacoBinding(ytext, model!, new Set([editor!]), provider.awareness)
        yjsBoundPathRef.current = activeTab!.path
      }
    }
    provider.on('sync', onSync)

    return () => {
      provider.off('sync', onSync)
      yjsBoundPathRef.current = null
      provider.awareness.off('change', updatePresence)
      binding?.destroy()
      provider.destroy()
      ydoc.destroy()
      setPresence([])
    }
  }, [sessionId, activeTab?.path, editorReady, user])

  // Shared debugging state (Week 8), synced across the whole session rather
  // than per-file. Reuses the same generic Yjs websocket endpoint with a
  // synthetic room name - the room's Y.Text stays untouched (only the
  // "debug" Y.Map is used), so the backend's autosave-to-disk path for that
  // room never fires and no backend change was needed for this feature.
  useEffect(() => {
    if (!sessionId) return
    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider(YJS_WS_BASE, `${sessionId}/__debug__`, ydoc, {
      params: { token: getToken() ?? '' },
    })
    const dmap = ydoc.getMap('debug')
    debugYdocRef.current = ydoc
    debugMapRef.current = dmap

    function syncFromMap() {
      const rr = dmap.get('runResult')
      if (typeof rr === 'string') {
        try {
          setRunResult(JSON.parse(rr) as RunResult)
        } catch {
          // malformed/partial payload from a mid-transaction read; ignore
        }
      } else if (rr === null) {
        setRunResult(null)
      }
      const si = dmap.get('stepIndex')
      if (typeof si === 'number') setStepIndex(si)
      const bp = dmap.get('breakpoints')
      if (Array.isArray(bp)) setBreakpoints(new Set(bp as string[]))
      const did = dmap.get('driverId')
      setDriverId(typeof did === 'number' ? did : null)
      const dname = dmap.get('driverName')
      setDriverName(typeof dname === 'string' ? dname : null)
    }

    dmap.observe(syncFromMap)
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) syncFromMap()
    })

    return () => {
      dmap.unobserve(syncFromMap)
      provider.destroy()
      ydoc.destroy()
      debugYdocRef.current = null
      debugMapRef.current = null
    }
  }, [sessionId])

  if (authLoading) {
    return <div className="login-page" />
  }
  if (!user) {
    return <LoginPage />
  }

  return (
    <div className="app-layout">
      <div style={{ width: fileTree.size, flexShrink: 0 }}>
        <FileTree
          tree={tree}
          activePath={activePath}
          onOpenFile={openFile}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onRename={handleRename}
        />
      </div>
      <div className="resize-handle-x" onMouseDown={fileTree.onDragStart} />
      <div className="editor-area">
        <div className="tab-bar">
          {tabs.map((t) => (
            <div key={t.path} className={`tab${t.path === activePath ? ' active' : ''}`} onClick={() => setActivePath(t.path)}>
              <span>{t.path}{t.dirty ? ' •' : ''}</span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.path)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="toolbar">
          <button className="run-button" onClick={handleRun} disabled={running || !activeTab}>
            {running ? 'Running…' : `▶ Run ${activeTab ? activeTab.path : ''}`}
          </button>
          <button className="explain-button" onClick={handleExplainSelection} disabled={!activeTab || aiState?.loading}>
            ✨ Explain Code
          </button>
          <button className="explain-button" onClick={handleReviewCode} disabled={!activeTab || reviewState?.loading}>
            🔍 Review Code
          </button>
          <button className="explain-button" onClick={handleGenerateTests} disabled={!activeTab || testLoading}>
            🧪 Generate Tests
          </button>
          {events.length > 0 && (
            <div className="debug-controls">
              <button onClick={() => stepTo(0)} disabled={stepIndex === 0 || !isDriver}>
                |«
              </button>
              <button onClick={() => stepTo(stepIndex - 1)} disabled={stepIndex === 0 || !isDriver}>
                ‹ back
              </button>
              <span className="step-counter">
                step {stepIndex + 1} / {events.length}
              </span>
              <button onClick={() => stepTo(stepIndex + 1)} disabled={stepIndex === events.length - 1 || !isDriver}>
                forward ›
              </button>
              <button onClick={() => stepTo(events.length - 1)} disabled={stepIndex === events.length - 1 || !isDriver}>
                »|
              </button>
              {driverId !== null && (
                <span className="driver-badge">{isDriver ? '🚗 you are driving' : `👀 watching ${driverName ?? 'someone'}`}</span>
              )}
            </div>
          )}
          <div className="collab-bar">
            {presence.map((u, i) => (
              <span key={i} className="presence-dot" style={{ background: u.color }} title={u.name}>
                {u.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
            <button className="share-button" onClick={handleShare} disabled={!sessionId}>
              🔗 Share
            </button>
            <button className="github-button" onClick={handleOpenGitPanel} disabled={!sessionId}>
              🐙 GitHub
            </button>
            <button className="github-button" onClick={() => setShowTerminal((v) => !v)} disabled={!sessionId}>
              💻 Terminal
            </button>
            {user && (
              <UserMenu
                user={user}
                mySessions={mySessions}
                onOpenMenu={handleOpenUserMenu}
                onOpenSession={handleOpenMySession}
                onLogout={handleLogout}
              />
            )}
          </div>
        </div>
        <div className="editor-and-debug">
          {activeTab ? (
            <Editor
              path={activeTab.path}
              language={languageForPath(activeTab.path)}
              value={activeTab.content}
              theme="vs-dark"
              options={{ fontSize: 14, minimap: { enabled: false }, automaticLayout: true, glyphMargin: true }}
              onChange={(value) => updateTabContent(activeTab.path, value ?? '')}
              onMount={handleEditorMount}
            />
          ) : (
            <div className="empty-state">Open a file from the tree to start editing.</div>
          )}
          <div className="resize-handle-x" onMouseDown={debugSidebar.onDragStart} />
          <div style={{ width: debugSidebar.size, flexShrink: 0 }}>
            <DebugSidebar
              currentEvent={currentEvent}
              stack={currentStack}
              ai={aiState}
              review={activeTab?.path === reviewedPath ? reviewState : null}
              onJumpToLine={handleJumpToReviewLine}
            />
          </div>
        </div>
        <div className="resize-handle-y" onMouseDown={outputPanel.onDragStart} />
        <div style={{ height: outputPanel.size, flexShrink: 0 }}>
          <OutputPanel
            running={running}
            result={runResult}
            onExplainError={handleExplainError}
            onFixError={handleFixError}
            explaining={aiState?.loading ?? false}
            fixing={fixState?.loading ?? false}
          />
        </div>
        {showTerminal && sessionId && (
          <>
            <div className="resize-handle-y" onMouseDown={terminalPanel.onDragStart} />
            <div style={{ height: terminalPanel.size, flexShrink: 0 }}>
              <TerminalPanel sessionId={sessionId} onClose={() => setShowTerminal(false)} />
            </div>
          </>
        )}
      </div>
      {fixState && !fixState.loading && (
        <FixDiffModal fix={fixState} onAccept={handleAcceptFix} onReject={handleRejectFix} />
      )}
      {showGitPanel && (
        <GitHubPanel
          status={gitStatusState}
          loadingStatus={loadingGitStatus}
          cloning={cloning}
          cloneError={cloneError}
          onClone={handleClone}
          pushing={pushing}
          pushError={pushError}
          pushOutput={pushOutput}
          onCommitPush={handleCommitPush}
          onRefreshStatus={loadGitStatus}
          onClose={() => setShowGitPanel(false)}
          prs={prs}
          loadingPrs={loadingPrs}
          prsError={prsError}
          onLoadPrs={handleLoadPrs}
          creatingPr={creatingPr}
          createPrError={createPrError}
          createdPr={createdPr}
          onCreatePr={handleCreatePr}
        />
      )}
      {showTestPanel && (
        <TestResultsPanel
          loading={testLoading}
          result={testResult}
          error={testError}
          onClose={() => setShowTestPanel(false)}
        />
      )}
    </div>
  )
}

export default App
