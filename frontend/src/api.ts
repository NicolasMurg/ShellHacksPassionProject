import { BUILDINGS, DESIGN_ZONES } from './data/campus'
import type { Building, LatLng, RoadClosure, User, WalkingProfile, Zone } from './types'

// Talks to the Express backend. Until it's ready (VITE_USE_MOCK !== 'false'),
// everything is stored in this browser's localStorage so the UI is fully usable.

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

type Session = { user: User; token: string }

// ---------------------------------------------------------------------------
// Real backend
// ---------------------------------------------------------------------------

async function http<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text
    } catch {
      // not JSON; use the raw text
    }
    throw new Error(message || `Request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

// ---------------------------------------------------------------------------
// Mock backend (localStorage)
// ---------------------------------------------------------------------------

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`doorstep.${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`doorstep.${key}`, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the change just won't survive a reload.
  }
}

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`
const delay = () => new Promise((r) => setTimeout(r, 150))

const DEFAULT_PROFILE: WalkingProfile = { mobility: 'none', learnedFactor: 1 }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function login(name: string, email: string): Promise<Session> {
  if (!USE_MOCK) return http('POST', '/api/auth/login', undefined, { name, email })
  await delay()
  const users = load<Record<string, User>>('users', {})
  const key = email.trim().toLowerCase()
  const user = users[key] ?? { id: newId('user'), name: name.trim(), email: key, profile: DEFAULT_PROFILE }
  users[key] = user
  save('users', users)
  return { user, token: user.id }
}

export async function getMe(token: string): Promise<User> {
  if (!USE_MOCK) return http('GET', '/api/me', token)
  const user = Object.values(load<Record<string, User>>('users', {})).find((u) => u.id === token)
  if (!user) throw new Error('Session expired')
  return user
}

export async function updateProfile(token: string, profile: WalkingProfile): Promise<User> {
  if (!USE_MOCK) return http('PUT', '/api/me/profile', token, profile)
  const users = load<Record<string, User>>('users', {})
  const entry = Object.entries(users).find(([, u]) => u.id === token)
  if (!entry) throw new Error('Session expired')
  const user = { ...entry[1], profile }
  users[entry[0]] = user
  save('users', users)
  return user
}

export async function getBuildings(): Promise<Building[]> {
  if (!USE_MOCK) return http('GET', '/api/buildings')
  return BUILDINGS
}

/** Shared zones: generated curbs + design-team zones. In mock mode only design zones; curbs.ts generates the rest. */
export async function getDefaultZones(): Promise<Zone[]> {
  if (!USE_MOCK) return http('GET', '/api/zones')
  return DESIGN_ZONES
}

export async function getMyZones(token: string): Promise<Zone[]> {
  if (!USE_MOCK) return http('GET', '/api/me/zones', token)
  return load<Zone[]>(`zones.v2.${token}`, [])
}

/** Create or update one of the user's personal zones. */
export async function saveMyZone(token: string, zone: Zone): Promise<Zone> {
  if (!USE_MOCK) return http('PUT', `/api/me/zones/${zone.id}`, token, zone)
  const zones = load<Zone[]>(`zones.v2.${token}`, [])
  const next = zones.some((z) => z.id === zone.id) ? zones.map((z) => (z.id === zone.id ? zone : z)) : [...zones, zone]
  save(`zones.v2.${token}`, next)
  return zone
}

export async function deleteMyZone(token: string, id: string): Promise<void> {
  if (!USE_MOCK) return http('DELETE', `/api/me/zones/${id}`, token)
  save(`zones.v2.${token}`, load<Zone[]>(`zones.v2.${token}`, []).filter((z) => z.id !== id))
}

export async function getClosures(): Promise<RoadClosure[]> {
  if (!USE_MOCK) return http('GET', '/api/closures')
  return load<RoadClosure[]>('closures', [])
}

export async function reportClosure(
  token: string,
  reporter: string,
  path: LatLng[],
  reason: string,
): Promise<RoadClosure> {
  if (!USE_MOCK) return http('POST', '/api/closures', token, { path, reason })
  await delay()
  const closure: RoadClosure = {
    id: newId('closure'),
    path,
    reason,
    reportedBy: reporter,
    createdAt: new Date().toISOString(),
  }
  save('closures', [...load<RoadClosure[]>('closures', []), closure])
  return closure
}

export async function removeClosure(token: string, id: string): Promise<void> {
  if (!USE_MOCK) return http('DELETE', `/api/closures/${id}`, token)
  save('closures', load<RoadClosure[]>('closures', []).filter((c) => c.id !== id))
}

export { newId }
