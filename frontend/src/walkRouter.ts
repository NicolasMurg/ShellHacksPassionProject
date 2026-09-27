import type { LatLng } from './types'

// Campus walking router. Finds the shortest walk over FIU's footpath network
// from OpenStreetMap (src/data/fiuWalkways.json, built by scripts/build-walkways.ts)
// using A* search, and writes its own turn-by-turn directions. Google Directions
// only knows a fraction of campus paths, so its walks take long detours.

// 'indoor' = a user-linked doorway shortcut through a building (see withShortcuts).
type Kind = 'walkway' | 'crossing' | 'steps' | 'service' | 'street' | 'major' | 'indoor'

/** How much each kind of path "costs" per meter. Lower = preferred. */
const COST: Record<Kind, number> = {
  indoor: 1,
  walkway: 1,
  crossing: 1.05,
  steps: 1.4,
  service: 1.15, // campus service drives: walkable but less pleasant
  street: 1.3,
  major: 1.8, // big roads: only when there's no alternative
}

export type WalkStep = { instruction: string; maneuver: string; startAlong: number; endAlong: number }
/** `indoorMeters` = how much of the walk goes through buildings via doorway shortcuts. */
export type WalkRoute = { path: LatLng[]; meters: number; steps: WalkStep[]; indoorMeters: number }

type Graph = {
  n: number
  x: Float64Array // meters east of the origin
  y: Float64Array // meters north of the origin
  lat: Float64Array
  lng: Float64Array
  ea: Int32Array
  eb: Int32Array
  kind: Kind[]
  name: (string | undefined)[]
  len: Float64Array
  adj: number[][] // node → edge ids
  bbox: readonly [number, number, number, number]
}

const LAT0 = 25.7565
const LNG0 = -80.374
const KY = 110_574 // meters per degree of latitude
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180) // meters per degree of longitude here

let graphPromise: Promise<Graph> | undefined

/** Loads the campus network once (it's ~350 KB, so it's fetched on demand). */
export function loadCampusGraph(): Promise<Graph> {
  graphPromise ??= import('./data/fiuWalkways.json').then(({ default: data }) => {
    const kinds = data.kinds as Kind[]
    const n = data.nodes.length / 2
    const g: Graph = {
      n,
      x: new Float64Array(n),
      y: new Float64Array(n),
      lat: new Float64Array(n),
      lng: new Float64Array(n),
      ea: new Int32Array(data.edges.length / 4),
      eb: new Int32Array(data.edges.length / 4),
      kind: [],
      name: [],
      len: new Float64Array(data.edges.length / 4),
      adj: Array.from({ length: n }, () => []),
      bbox: data.bbox as unknown as Graph['bbox'],
    }
    for (let i = 0; i < n; i++) {
      g.lat[i] = data.nodes[2 * i]
      g.lng[i] = data.nodes[2 * i + 1]
      g.x[i] = (g.lng[i] - LNG0) * KX
      g.y[i] = (g.lat[i] - LAT0) * KY
    }
    for (let e = 0; e < g.ea.length; e++) {
      const a = data.edges[4 * e]
      const b = data.edges[4 * e + 1]
      g.ea[e] = a
      g.eb[e] = b
      g.kind[e] = kinds[data.edges[4 * e + 2]]
      g.name[e] = data.edges[4 * e + 3] >= 0 ? data.names[data.edges[4 * e + 3]] : undefined
      g.len[e] = Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a])
      g.adj[a].push(e)
      g.adj[b].push(e)
    }
    return g
  })
  return graphPromise
}

export type CampusGraph = Graph

/** Whether a point is inside the area the campus network covers (with a small margin). */
export function inCampus(g: Graph, p: LatLng): boolean {
  const [s, w, n, e] = g.bbox
  const m = 0.0015
  return p.lat > s - m && p.lat < n + m && p.lng > w - m && p.lng < e + m
}

const toXY = (p: LatLng) => ({ x: (p.lng - LNG0) * KX, y: (p.lat - LAT0) * KY })
const toLatLng = (x: number, y: number): LatLng => ({ lat: LAT0 + y / KY, lng: LNG0 + x / KX })

/** A doorway farther than this from every mapped path can't be joined to the network. */
export const MAX_DOOR_REACH_M = 60

/** Nearest network node to a point, and how far away it is. */
function nearestNode(g: Graph, p: LatLng) {
  const { x, y } = toXY(p)
  let node = -1
  let meters = Infinity
  for (let i = 0; i < g.n; i++) {
    const d = Math.hypot(g.x[i] - x, g.y[i] - y)
    if (d < meters) {
      meters = d
      node = i
    }
  }
  return { node, meters }
}

/**
 * Meters from a point to the nearest footpath, campus drive (service/street) and main road,
 * so travel-mode detection knows whether a car could be here.
 */
export function surroundings(g: Graph, p: LatLng): { walkway: number; campusRoad: number; road: number } {
  const { x, y } = toXY(p)
  const near = { walkway: Infinity, campusRoad: Infinity, road: Infinity }
  for (let e = 0; e < g.ea.length; e++) {
    const k = g.kind[e]
    const group = k === 'major' ? 'road' : k === 'service' || k === 'street' ? 'campusRoad' : 'walkway'
    const a = g.ea[e]
    const b = g.eb[e]
    const dx = g.x[b] - g.x[a]
    const dy = g.y[b] - g.y[a]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - g.x[a]) * dx + (y - g.y[a]) * dy) / l2))
    const d = Math.hypot(x - (g.x[a] + t * dx), y - (g.y[a] + t * dy))
    if (d < near[group]) near[group] = d
  }
  return near
}

/** How far a doorway is from the nearest mapped path (it's usable within MAX_DOOR_REACH_M). */
export const distanceToNetwork = (g: Graph, p: LatLng) => nearestNode(g, p).meters

/**
 * The network plus user-linked doorway shortcuts: each linked doorway becomes a node joined
 * to its nearest path node, and each link a straight "indoor" edge through the building.
 * The base graph isn't modified.
 */
export function withShortcuts(g: Graph, shortcuts: { a: LatLng; b: LatLng }[]): Graph {
  if (shortcuts.length === 0) return g
  const nodes: LatLng[] = []
  const edges: { a: number; b: number; kind: Kind; name?: string }[] = []
  const nodeAt = new Map<string, number | undefined>()
  const doorNode = (p: LatLng) => {
    const key = `${p.lat},${p.lng}`
    if (!nodeAt.has(key)) {
      const near = nearestNode(g, p)
      if (near.node < 0 || near.meters > MAX_DOOR_REACH_M) nodeAt.set(key, undefined)
      else {
        const id = g.n + nodes.length
        nodes.push(p)
        edges.push({ a: id, b: near.node, kind: 'walkway' })
        nodeAt.set(key, id)
      }
    }
    return nodeAt.get(key)
  }
  for (const s of shortcuts) {
    const a = doorNode(s.a)
    const b = doorNode(s.b)
    if (a !== undefined && b !== undefined && a !== b) edges.push({ a, b, kind: 'indoor' })
  }
  if (nodes.length === 0) return g

  const n = g.n + nodes.length
  const grow = (from: Float64Array, extra: number[]) => {
    const out = new Float64Array(from.length + extra.length)
    out.set(from)
    out.set(extra, from.length)
    return out
  }
  const lat = grow(g.lat, nodes.map((p) => p.lat))
  const lng = grow(g.lng, nodes.map((p) => p.lng))
  const x = grow(g.x, nodes.map((p) => toXY(p).x))
  const y = grow(g.y, nodes.map((p) => toXY(p).y))
  const e0 = g.ea.length
  const ea = new Int32Array(e0 + edges.length)
  const eb = new Int32Array(e0 + edges.length)
  ea.set(g.ea)
  eb.set(g.eb)
  const len = new Float64Array(e0 + edges.length)
  len.set(g.len)
  const kind = [...g.kind]
  const name = [...g.name]
  const adj = [...g.adj, ...nodes.map((): number[] => [])]
  edges.forEach((edge, i) => {
    const e = e0 + i
    ea[e] = edge.a
    eb[e] = edge.b
    len[e] = Math.hypot(x[edge.b] - x[edge.a], y[edge.b] - y[edge.a])
    kind[e] = edge.kind
    name[e] = edge.name
    adj[edge.a] = [...adj[edge.a], e] // copy, so the base graph's lists stay untouched
    adj[edge.b] = [...adj[edge.b], e]
  })
  return { n, x, y, lat, lng, ea, eb, kind, name, len, adj, bbox: g.bbox }
}

type Snap = { edge: number; t: number; x: number; y: number; off: number }

/** Nearest usable path segment to a point. */
function snap(g: Graph, p: LatLng, stepFree: boolean): Snap | undefined {
  const { x, y } = toXY(p)
  let best: Snap | undefined
  for (let e = 0; e < g.ea.length; e++) {
    const k = g.kind[e]
    if (stepFree && k === 'steps') continue
    const a = g.ea[e]
    const b = g.eb[e]
    const dx = g.x[b] - g.x[a]
    const dy = g.y[b] - g.y[a]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - g.x[a]) * dx + (y - g.y[a]) * dy) / l2))
    const px = g.x[a] + t * dx
    const py = g.y[a] + t * dy
    // Prefer snapping onto walkways over big roads when both are close.
    const off = Math.hypot(x - px, y - py) * (k === 'major' ? 2 : k === 'street' ? 1.3 : 1)
    if (!best || off < best.off) best = { edge: e, t, x: px, y: py, off }
  }
  return best
}

/** Minimal binary heap keyed by priority. */
class Heap {
  private items: number[] = []
  private prio: number[] = []
  get size() {
    return this.items.length
  }
  push(item: number, p: number) {
    const { items, prio } = this
    items.push(item)
    prio.push(p)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (prio[parent] <= prio[i]) break
      ;[items[i], items[parent]] = [items[parent], items[i]]
      ;[prio[i], prio[parent]] = [prio[parent], prio[i]]
      i = parent
    }
  }
  pop(): number {
    const { items, prio } = this
    const top = items[0]
    const lastItem = items.pop()!
    const lastPrio = prio.pop()!
    if (items.length) {
      items[0] = lastItem
      prio[0] = lastPrio
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < items.length && prio[l] < prio[m]) m = l
        if (r < items.length && prio[r] < prio[m]) m = r
        if (m === i) break
        ;[items[i], items[m]] = [items[m], items[i]]
        ;[prio[i], prio[m]] = [prio[m], prio[i]]
        i = m
      }
    }
    return top
  }
}

// One cache per graph: adding doorway shortcuts makes a new graph, so old routes can't leak in.
const caches = new WeakMap<Graph, Map<string, WalkRoute | null>>()

/** Shortest walk between two points on campus, or undefined if they aren't connected. */
export function routeWalk(g: Graph, from: LatLng, to: LatLng, opts: { stepFree?: boolean } = {}): WalkRoute | undefined {
  const stepFree = !!opts.stepFree
  const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}|${to.lat.toFixed(5)},${to.lng.toFixed(5)}|${stepFree}`
  let cache = caches.get(g)
  if (!cache) caches.set(g, (cache = new Map()))
  const hit = cache.get(key)
  if (hit !== undefined) return hit ?? undefined
  const result = search(g, from, to, stepFree)
  if (cache.size > 300) cache.clear()
  cache.set(key, result ?? null)
  return result
}

function search(g: Graph, from: LatLng, to: LatLng, stepFree: boolean): WalkRoute | undefined {
  const s = snap(g, from, stepFree)
  const t = snap(g, to, stepFree)
  if (!s || !t) return undefined

  const S = g.n // virtual start node (the snapped start point)
  const T = g.n + 1 // virtual end node
  const dist = new Float64Array(g.n + 2).fill(Infinity)
  const prev = new Int32Array(g.n + 2).fill(-1)
  const prevEdge = new Int32Array(g.n + 2).fill(-1)
  const tx = t.x
  const ty = t.y
  const h = (i: number) => (i >= g.n ? 0 : Math.hypot(g.x[i] - tx, g.y[i] - ty))
  const cost = (e: number, meters: number) => meters * (stepFree && g.kind[e] === 'steps' ? Infinity : COST[g.kind[e]])

  const heap = new Heap()
  dist[S] = 0
  heap.push(S, 0)
  const relax = (u: number, v: number, c: number, edge: number) => {
    const d = dist[u] + c
    if (d < dist[v]) {
      dist[v] = d
      prev[v] = u
      prevEdge[v] = edge
      heap.push(v, d + h(v))
    }
  }

  while (heap.size) {
    const u = heap.pop()
    if (u === T) break
    if (u === S) {
      const e = s.edge
      relax(S, g.ea[e], cost(e, s.t * g.len[e]), e)
      relax(S, g.eb[e], cost(e, (1 - s.t) * g.len[e]), e)
      if (e === t.edge) relax(S, T, cost(e, Math.abs(s.t - t.t) * g.len[e]), e)
      continue
    }
    if (u === g.ea[t.edge]) relax(u, T, cost(t.edge, t.t * g.len[t.edge]), t.edge)
    if (u === g.eb[t.edge]) relax(u, T, cost(t.edge, (1 - t.t) * g.len[t.edge]), t.edge)
    for (const e of g.adj[u]) {
      const v = g.ea[e] === u ? g.eb[e] : g.ea[e]
      relax(u, v, cost(e, g.len[e]), e)
    }
  }
  if (dist[T] === Infinity) return undefined

  // Rebuild the path, remembering the kind/name of each segment for directions.
  const chain: number[] = []
  for (let v = T; v !== -1; v = prev[v]) chain.push(v)
  chain.reverse()
  const pts: { p: LatLng; edge: number }[] = [] // edge = the segment arriving at this point
  const pointOf = (v: number) => (v === S ? toLatLng(s.x, s.y) : v === T ? toLatLng(t.x, t.y) : { lat: g.lat[v], lng: g.lng[v] })
  pts.push({ p: from, edge: -1 })
  for (const v of chain) pts.push({ p: pointOf(v), edge: v === S ? -1 : prevEdge[v] })
  pts.push({ p: to, edge: -1 })

  return withDirections(g, pts)
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

function bearingXY(a: { x: number; y: number }, b: { x: number; y: number }) {
  return ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360
}

/** Turn the raw point chain into a clean path plus turn-by-turn steps. */
function withDirections(g: Graph, raw: { p: LatLng; edge: number }[]): WalkRoute {
  // Drop duplicate points (e.g. a snap point right on a node).
  const pts: { p: LatLng; xy: { x: number; y: number }; edge: number; along: number }[] = []
  for (const r of raw) {
    const xy = toXY(r.p)
    const last = pts[pts.length - 1]
    const d = last ? Math.hypot(xy.x - last.xy.x, xy.y - last.xy.y) : 0
    if (last && d < 0.5) continue
    pts.push({ ...r, xy, along: (last?.along ?? 0) + d })
  }
  const meters = pts[pts.length - 1]?.along ?? 0
  const path = pts.map((q) => q.p)
  let indoorMeters = 0
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].edge >= 0 && g.kind[pts[i].edge] === 'indoor') indoorMeters += pts[i].along - pts[i - 1].along
  }
  if (pts.length < 2) return { path, meters, steps: [], indoorMeters }

  // Direction of travel around a point, averaged over ~8 m to ignore tiny wiggles.
  const at = (along: number) => {
    const d = Math.max(0, Math.min(meters, along))
    let i = 1
    while (i < pts.length - 1 && pts[i].along < d) i++
    const a = pts[i - 1]
    const b = pts[i]
    const f = b.along === a.along ? 0 : (d - a.along) / (b.along - a.along)
    return { x: a.xy.x + (b.xy.x - a.xy.x) * f, y: a.xy.y + (b.xy.y - a.xy.y) * f }
  }
  const labelOf = (edge: number) => (edge >= 0 ? g.name[edge] : undefined)
  const kindAfter = (i: number) => (i + 1 < pts.length ? (pts[i + 1].edge >= 0 ? g.kind[pts[i + 1].edge] : undefined) : undefined)

  const startBearing = bearingXY(pts[0].xy, at(10))
  const firstEdge = pts[1]?.edge ?? -1
  const firstName = labelOf(firstEdge)
  const startsIndoors = firstEdge >= 0 && g.kind[firstEdge] === 'indoor'
  const maneuvers: { along: number; instruction: string; maneuver: string }[] = [
    {
      along: 0,
      instruction: `Head ${COMPASS[Math.round(startBearing / 45) % 8]}${
        startsIndoors ? ' through the building (doorway shortcut)' : firstName ? ` on ${firstName}` : ''
      }`,
      maneuver: 'straight',
    },
  ]
  let lastKind = kindAfter(0)
  for (let i = 1; i < pts.length - 1; i++) {
    const here = pts[i]
    const kind = kindAfter(i)
    const sinceLast = here.along - maneuvers[maneuvers.length - 1].along
    if (kind === 'indoor' && lastKind !== 'indoor' && sinceLast > 1) {
      maneuvers.push({ along: here.along, instruction: 'Go through the building here (doorway shortcut)', maneuver: 'straight' })
    } else if (kind === 'steps' && lastKind !== 'steps' && sinceLast > 3) {
      maneuvers.push({ along: here.along, instruction: 'Take the stairs', maneuver: 'straight' })
    } else if (kind === 'crossing' && lastKind !== 'crossing' && sinceLast > 3) {
      maneuvers.push({ along: here.along, instruction: 'Cross the street at the crosswalk', maneuver: 'straight' })
    } else if (sinceLast > 12 && meters - here.along > 6) {
      const inB = bearingXY(at(here.along - 8), here.xy)
      const outB = bearingXY(here.xy, at(here.along + 8))
      const turn = ((outB - inB + 540) % 360) - 180 // -180..180, negative = left
      const abs = Math.abs(turn)
      if (abs > 40) {
        const side = turn < 0 ? 'left' : 'right'
        const maneuver = abs < 65 ? `turn-slight-${side}` : abs > 140 ? `turn-sharp-${side}` : `turn-${side}`
        const verb = abs < 65 ? `Bear ${side}` : abs > 140 ? `Make a sharp ${side}` : `Turn ${side}`
        const name = labelOf(pts[i + 1]?.edge ?? -1)
        maneuvers.push({ along: here.along, instruction: `${verb}${name ? ` onto ${name}` : ''}`, maneuver })
      }
    }
    lastKind = kind
  }

  const steps: WalkStep[] = maneuvers.map((m, i) => ({
    instruction: m.instruction,
    maneuver: m.maneuver,
    startAlong: m.along,
    endAlong: maneuvers[i + 1]?.along ?? meters,
  }))
  return { path, meters, steps, indoorMeters }
}
