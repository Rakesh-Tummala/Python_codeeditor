const COLORS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#a1887f']

export interface UserIdentity {
  name: string
  color: string
}

// Stable per-browser identity, not per-session, so a user keeps the same
// name/color across reloads and across joining different rooms.
export function getUserIdentity(): UserIdentity {
  let name = localStorage.getItem('pytrace:userName')
  if (!name) {
    name = `User-${Math.random().toString(36).slice(2, 6)}`
    localStorage.setItem('pytrace:userName', name)
  }
  let color = localStorage.getItem('pytrace:userColor')
  if (!color) {
    color = COLORS[Math.floor(Math.random() * COLORS.length)]
    localStorage.setItem('pytrace:userColor', color)
  }
  return { name, color }
}
