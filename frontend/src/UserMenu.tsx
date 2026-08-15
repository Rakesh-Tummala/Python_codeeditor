import { useState } from 'react'
import type { SessionSummary } from './api'
import type { AuthUser } from './auth'
import { identityForUser } from './collab'

interface UserMenuProps {
  user: AuthUser
  mySessions: SessionSummary[]
  onOpenMenu: () => void
  onOpenSession: (sessionId: string) => void
  onLogout: () => void
}

export default function UserMenu({ user, mySessions, onOpenMenu, onOpenSession, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const color = identityForUser(user).color

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) onOpenMenu()
  }

  return (
    <div className="user-menu">
      <button className="user-avatar-button" onClick={toggle}>
        {user.picture ? (
          <img className="user-avatar-img" src={user.picture} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="user-avatar-fallback" style={{ background: color }}>
            {user.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        {user.name}
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-header">
            <div className="user-menu-name">{user.name}</div>
            <div className="user-menu-email">{user.email}</div>
          </div>
          <div className="user-menu-section-title">My Sessions</div>
          {mySessions.length === 0 ? (
            <div className="my-sessions-empty">no sessions yet</div>
          ) : (
            <ul className="my-sessions-list">
              {mySessions.map((s) => (
                <li key={s.session_id}>
                  <button
                    onClick={() => {
                      onOpenSession(s.session_id)
                      setOpen(false)
                    }}
                  >
                    {s.session_id.slice(0, 8)}… — {new Date(s.created_at).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="user-menu-logout" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
