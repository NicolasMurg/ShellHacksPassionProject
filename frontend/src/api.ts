import type { ApiArrivalDestination, ApiArrivalPlan, ApiPersonalStop, ApiBuilding, ApiClosure, ApiPlan, ApiRoute, ApiUser, ApiZone } from '../../backend/src/contracts'
import type { LatLng, User, WalkingProfile, Zone } from './types'
import { fromPoint, fromBuilding, fromClosure, fromEntrance, fromRoute, fromUser, fromZone, toPoint, toZone } from './api/adapters'

export async function http<T>(method: string, path: string, token?: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, signal,
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) {
    const text = await response.text()
    let message = text
    try { message = (JSON.parse(text) as { error?: string }).error ?? text } catch { /* Preserve non-JSON server errors. */ }
    throw new Error(message || `Request failed (${response.status})`)
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}
export async function login(email: string, password: string, name?: string) {
  const session = await http<{ user: ApiUser; token: string }>('POST', name === undefined ? '/api/auth/login' : '/api/auth/register', undefined,
    name === undefined ? { email, password } : { name, email, password })
  return { ...session, user: fromUser(session.user) }
}
export const logout = (token: string) => http<void>('POST', '/api/auth/logout', token)
export const getMe = async (token: string) => fromUser(await http<ApiUser>('GET', '/api/me', token))
export async function updateProfile(token: string, profile: WalkingProfile): Promise<User> {
  const editable = { pace: profile.pace, mobility: profile.mobility, avoidStairs: profile.avoidStairs,
    requireCurbCuts: profile.requireCurbCuts, avoidSteepSlopes: profile.avoidSteepSlopes,
    maxWalkMinutes: profile.maxWalkMinutes, preferAccessibleEntrances: profile.preferAccessibleEntrances }
  return fromUser(await http<ApiUser>('PATCH', '/api/me', token, { profile: {
    ...editable, age: profile.age ?? null, heightCm: profile.heightCm ?? null,
  } }))
}
export const getBuildings = async () => (await http<ApiBuilding[]>('GET', '/api/buildings')).map(fromBuilding)
export const getDefaultZones = async () => (await http<ApiZone[]>('GET', '/api/zones')).map(fromZone)
export const getMyZones = async (token: string) => (await http<ApiZone[]>('GET', '/api/me/zones', token)).map(fromZone)
export const saveMyZone = async (token: string, zone: Zone) => fromZone(await http<ApiZone>('PUT', `/api/me/zones/${encodeURIComponent(zone.id)}`, token, toZone(zone)))
export const deleteMyZone = (token: string, id: string) => http<void>('DELETE', `/api/me/zones/${encodeURIComponent(id)}`, token)
export async function getClosures() {
  const now = Date.now()
  return (await http<ApiClosure[]>('GET', '/api/closures'))
    .filter(c => (!c.startsAt || Date.parse(c.startsAt) <= now) && (!c.endsAt || Date.parse(c.endsAt) > now)).map(fromClosure)
}
export const reportClosure = async (token: string, path: LatLng[], reason: string) => fromClosure(await http<ApiClosure>('POST', '/api/closures', token,
  { type: 'ROAD_CLOSED', geometryType: 'PATH', points: path.map(toPoint), reason }))
export const removeClosure = (token: string, id: string) => http<void>('DELETE', `/api/closures/${encodeURIComponent(id)}`, token)
export async function search(text: string, signal?: AbortSignal) {
  const result = await http<{ building?: ApiBuilding; room: string; destination?: ApiArrivalDestination }>('GET', `/api/search?q=${encodeURIComponent(text)}`, undefined, undefined, signal)
  return { building: result.building ? fromBuilding(result.building) : undefined, room: result.room,
    destination: result.destination ? { ...result.destination, location: fromPoint(result.destination.location) } : undefined }
}
export type PlanInput = { buildingId: string; room: string; kind: 'dropoff' | 'pickup' | 'walk'; stepFree: boolean; origin?: LatLng }
export async function plan(input: PlanInput, token?: string, signal?: AbortSignal) {
  const result = await http<ApiPlan>('POST', '/api/plan', token, { ...input, kind: input.kind.toUpperCase(), origin: input.origin && toPoint(input.origin) }, signal)
  return { tripId: result.tripId, options: result.options.map(o => ({ ...o, entrance: fromEntrance(o.entrance),
    zone: o.zone ? fromZone(o.zone) : undefined, route: fromRoute(o.route) })) }
}
export const route = async (mode: 'DRIVING' | 'WALKING', from: LatLng, to: LatLng, signal?: AbortSignal) =>
  fromRoute(await http<ApiRoute>('POST', '/api/route', undefined, { origin: toPoint(from), destination: toPoint(to), travelMode: mode === 'DRIVING' ? 'DRIVE' : 'WALK' }, signal))
export async function feedback(token: string, tripId: string, paceFeedback: 'faster' | 'right' | 'slower') {
  const result = await http<{ user: ApiUser }>('POST', '/api/trips/feedback', token, { tripId, rating: paceFeedback === 'right' ? 5 : 3, paceFeedback })
  return fromUser(result.user)
}
export const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

export type ArrivalDestination = { name: string; location: LatLng; placeId?: string }
export type ArrivalInput = { destination: ArrivalDestination; origin?: LatLng; stopPoint?: LatLng; stepFree: boolean; kind: 'dropoff' | 'pickup' }
const toDestination = (d: ArrivalDestination): ApiArrivalDestination => ({ ...d, location: toPoint(d.location) })
const fromStop = (s: ApiPersonalStop) => ({ ...s, destinationLocation: fromPoint(s.destinationLocation), stopPoint: fromPoint(s.stopPoint) })
export async function planArrival(input: ArrivalInput, token?: string, signal?: AbortSignal) {
  const result = await http<ApiArrivalPlan>('POST', '/api/arrivals/plan', token, { ...input,
    kind: input.kind.toUpperCase(), destination: toDestination(input.destination), origin: input.origin && toPoint(input.origin),
    stopPoint: input.stopPoint && toPoint(input.stopPoint) }, signal)
  return { ...result, savedStop: result.savedStop ? fromStop(result.savedStop) : undefined,
    options: result.options.map(o => ({ ...o, stopPoint: fromPoint(o.stopPoint), walk: fromRoute(o.walk), drive: o.drive && fromRoute(o.drive) })) }
}
export const saveStop = async (token: string, destination: ArrivalDestination, stopPoint: LatLng, name: string, instructions: string) =>
  fromStop(await http<ApiPersonalStop>('PUT', '/api/me/stops', token, { destination: toDestination(destination), stopPoint: toPoint(stopPoint), name, instructions }))
export const deleteStop = (token: string, id: string) => http<void>('DELETE', `/api/me/stops/${encodeURIComponent(id)}`, token)
