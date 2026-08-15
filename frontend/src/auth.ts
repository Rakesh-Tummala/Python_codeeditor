import { API_HTTP_BASE } from './config'

const TOKEN_KEY = 'pytrace:authToken'

export interface AuthUser {
  id: number
  email: string
  name: string
  picture: string | null
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// Called once on app boot. Google's OAuth callback redirects back with
// `#token=...` in the URL *fragment* - fragments are never sent to any
// server (ours or Google's), unlike a query string, so the token can't
// leak into access logs or a Referer header along the way.
export function consumeTokenFromUrl(): void {
  const hash = window.location.hash
  if (hash.startsWith('#token=')) {
    setToken(decodeURIComponent(hash.slice('#token='.length)))
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}

export function loginUrl(): string {
  return `${API_HTTP_BASE}/api/auth/google/login`
}

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken()
  if (!token) return null
  const res = await fetch(`${API_HTTP_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    clearToken()
    return null
  }
  return res.json()
}
