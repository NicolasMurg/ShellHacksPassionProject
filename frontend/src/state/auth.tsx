import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import * as api from '../api'
import type { User, WalkingProfile } from '../types'

type Auth = {
  user?: User; token?: string; error?: string; restoring: boolean
  login: (email: string, password: string, name?: string) => Promise<User>
  logout: () => Promise<void>
  saveProfile: (profile: WalkingProfile) => Promise<void>
  sendFeedback: (tripId: string, feedback: 'faster' | 'right' | 'slower') => Promise<void>
}
const AuthContext = createContext<Auth | null>(null)
const TOKEN_KEY = 'doorstep.token'
function storedToken(): string | undefined {
  try { return localStorage.getItem(TOKEN_KEY) ?? undefined } catch { return undefined }
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(storedToken)
  const [user, setUser] = useState<User>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!token || user) return
    let active = true
    api.getMe(token).then(u => { if (active) setUser(u) }).catch((e: Error) => {
      if (active) { setError(e.message); setToken(undefined); try { localStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ } }
    })
    return () => { active = false }
  }, [token, user])
  const login = useCallback(async (email: string, password: string, name?: string) => {
    const session = await api.login(email, password, name)
    try { localStorage.setItem(TOKEN_KEY, session.token) } catch { /* session still works in memory */ }
    setToken(session.token); setUser(session.user); setError(undefined)
    return session.user
  }, [])
  const logout = useCallback(async () => {
    try {
      if (token) await api.logout(token)
      try { localStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ }
      setToken(undefined); setUser(undefined); setError(undefined)
    } catch (e) { setError((e as Error).message) }
  }, [token])
  const saveProfile = useCallback(async (profile: WalkingProfile) => {
    if (token) setUser(await api.updateProfile(token, profile))
  }, [token])
  const sendFeedback = useCallback(async (tripId: string, feedback: 'faster' | 'right' | 'slower') => {
    if (token) setUser(await api.feedback(token, tripId, feedback))
  }, [token])
  return <AuthContext.Provider value={{ user, token: user ? token : undefined, error, restoring: Boolean(token) && !user,
    login, logout, saveProfile, sendFeedback }}>{children}</AuthContext.Provider>
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): Auth {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
