import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import * as api from '../api'
import type { User, WalkingProfile } from '../types'

type Auth = {
  user?: User
  token?: string
  login: (name: string, email: string) => Promise<User>
  logout: () => void
  saveProfile: (profile: WalkingProfile) => Promise<void>
}

const AuthContext = createContext<Auth | null>(null)
const TOKEN_KEY = 'doorstep.token'

function storedToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(storedToken)
  const [user, setUser] = useState<User>()

  // Restore the session on page load.
  useEffect(() => {
    if (!token || user) return
    api
      .getMe(token)
      .then(setUser)
      .catch(() => setToken(undefined))
  }, [token, user])

  const login = useCallback(async (name: string, email: string) => {
    const session = await api.login(name, email)
    try {
      localStorage.setItem(TOKEN_KEY, session.token)
    } catch {
      // Not persisted; the user stays signed in until reload.
    }
    setToken(session.token)
    setUser(session.user)
    return session.user
  }, [])

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      // ignore
    }
    setToken(undefined)
    setUser(undefined)
  }, [])

  const saveProfile = useCallback(
    async (profile: WalkingProfile) => {
      if (!token) return
      setUser(await api.updateProfile(token, profile))
    },
    [token],
  )

  return (
    <AuthContext.Provider value={{ user, token: user ? token : undefined, login, logout, saveProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): Auth {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
