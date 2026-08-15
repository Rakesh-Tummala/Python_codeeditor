const COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#a1887f']

export interface UserIdentity {
  name: string
  color: string
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

// Derived from the authenticated user's real id, so the color is stable
// across devices and sessions (a deterministic function of who they are),
// not a per-browser random pick like before login existed.
export function identityForUser(user: { id: number; name: string }): UserIdentity {
  return { name: user.name, color: COLORS[hashString(String(user.id)) % COLORS.length] }
}
