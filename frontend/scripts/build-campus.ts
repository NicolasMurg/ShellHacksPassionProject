// Builds src/data/fiuCampus.json: every FIU MMC building with its doors.
//
//  - Buildings (names, codes, coordinates): FIU's official campus map
//    (https://campusmaps.fiu.edu, js/buildings-mmc.js).
//  - Doors: OpenStreetMap entrance points on each building's outline.
//    Buildings with no mapped doors get one estimated door on the side
//    facing the nearest walkway (label ends in "(estimated)").
//
// Run from frontend/:  bun scripts/build-campus.ts
// Offline:             bun scripts/build-campus.ts <buildings-mmc.js> <overpass.json>
//
// Map data © OpenStreetMap contributors (ODbL); building list © FIU.

import walkways from '../src/data/fiuWalkways.json'

type LatLng = { lat: number; lng: number }
type OsmNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
type OsmWay = { type: 'way'; id: number; nodes: number[]; tags?: Record<string, string> }

const BBOX = '25.7500,-80.3845,25.7630,-80.3655'
const QUERY = `[out:json][timeout:60];(node["entrance"](${BBOX});way["building"](${BBOX}););out body;>;out skel qt;`
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

async function fiuBuildings(file?: string) {
  const src = file ? await Bun.file(file).text() : await (await fetch('https://campusmaps.fiu.edu/js/buildings-mmc.js')).text()
  const google = { maps: { Animation: { DROP: 0 } } } // the file references google.maps.Animation
  const list = new Function('google', `${src}; return MMCBuildings`)(google) as {
    Building: string
    Abbreviation: string
    latitude: number
    longitude: number
  }[]
  return list.map((b) => ({ code: b.Abbreviation.trim(), name: b.Building.trim(), location: { lat: b.latitude, lng: b.longitude } }))
}

async function osm(file?: string): Promise<{ elements: (OsmNode | OsmWay)[] }> {
  if (file) return Bun.file(file).json()
  for (const url of OVERPASS) {
    const text = await (await fetch(url, { method: 'POST', body: new URLSearchParams({ data: QUERY }) })).text()
    if (text.startsWith('{')) return JSON.parse(text)
    console.warn(`${url}: busy, trying the next server`)
  }
  throw new Error('Overpass is busy; try again in a minute.')
}

// Local flat projection in meters (fine at campus scale).
const LAT0 = 25.7565
const KX = 111_320 * Math.cos((LAT0 * Math.PI) / 180)
const KY = 110_574
const xy = (p: LatLng) => ({ x: p.lng * KX, y: p.lat * KY })
const dist = (a: LatLng, b: LatLng) => Math.hypot((a.lng - b.lng) * KX, (a.lat - b.lat) * KY)

function contains(poly: LatLng[], p: LatLng) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside
  }
  return inside
}

function distToPolygon(poly: LatLng[], p: LatLng) {
  const P = xy(p)
  let best = Infinity
  for (let i = 0; i < poly.length - 1; i++) {
    const A = xy(poly[i])
    const B = xy(poly[i + 1])
    const dx = B.x - A.x
    const dy = B.y - A.y
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / l2))
    best = Math.min(best, Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy)))
  }
  return best
}

const centroid = (pts: LatLng[]) => ({
  lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
  lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
})

const SIDES = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest']
function sideOf(center: LatLng, door: LatLng) {
  const bearing = (Math.atan2((door.lng - center.lng) * KX, (door.lat - center.lat) * KY) * 180) / Math.PI
  return SIDES[Math.round(((bearing + 360) % 360) / 45) % 8]
}

// Walkway points, to estimate a door for buildings with none mapped.
const walkNodes: LatLng[] = []
for (let i = 0; i < walkways.nodes.length; i += 2) walkNodes.push({ lat: walkways.nodes[i], lng: walkways.nodes[i + 1] })
const nearestWalkway = (p: LatLng) => walkNodes.reduce((best, q) => (dist(p, q) < dist(p, best) ? q : best), walkNodes[0])

const [fiuFile, osmFile] = process.argv.slice(2)
const buildings = await fiuBuildings(fiuFile)
const data = await osm(osmFile)

const nodeById = new Map<number, OsmNode>()
for (const e of data.elements) if (e.type === 'node') nodeById.set(e.id, e)
const entranceIds = new Set(data.elements.filter((e): e is OsmNode => e.type === 'node' && !!e.tags?.entrance).map((e) => e.id))
const outlines = data.elements
  .filter((e): e is OsmWay => e.type === 'way' && !!e.tags?.building)
  .map((w) => ({
    way: w,
    poly: w.nodes.map((id) => nodeById.get(id)).filter((n): n is OsmNode => !!n).map((n) => ({ lat: n.lat, lng: n.lon })),
  }))
  .filter((o) => o.poly.length >= 3)

const usedIds = new Set<string>()
let mapped = 0
let estimated = 0

const out = buildings.map((b) => {
  // Unique lowercase id (FIU's list has two "PG6" entries).
  let id = b.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  for (let n = 2; usedIds.has(id); n++) id = `${b.code.toLowerCase()}-${n}`
  usedIds.add(id)

  // The OSM outline this building sits in (or the closest one within 40 m).
  const outline =
    outlines.find((o) => contains(o.poly, b.location)) ??
    outlines
      .map((o) => ({ o, d: distToPolygon(o.poly, b.location) }))
      .filter((x) => x.d < 40)
      .sort((a, c) => a.d - c.d)[0]?.o

  const center = outline ? centroid(outline.poly.slice(0, -1)) : b.location
  let doors: { location: LatLng; main: boolean; estimated: boolean }[] = []
  if (outline) {
    doors = [...new Set(outline.way.nodes.filter((id) => entranceIds.has(id)))].map((id) => {
      const n = nodeById.get(id)!
      return { location: { lat: n.lat, lng: n.lon }, main: n.tags?.entrance === 'main', estimated: false }
    })
  }
  if (doors.length) mapped++
  else {
    // No mapped doors: estimate one on the outline, on the side facing the nearest walkway.
    const walk = nearestWalkway(center)
    const onOutline = outline
      ? outline.poly.reduce((best, p) => (dist(p, walk) < dist(best, walk) ? p : best), outline.poly[0])
      : b.location
    doors = [{ location: onOutline, main: false, estimated: true }]
    estimated++
  }

  const counts: Record<string, number> = {}
  const entrances = doors.map((d, i) => {
    const side = sideOf(center, d.location)
    counts[side] = (counts[side] ?? 0) + 1
    const base = d.main ? 'Main entrance' : `${side} entrance`
    return {
      id: `${id}-${i + 1}`,
      buildingId: id,
      label: d.estimated ? `${base} (estimated)` : base,
      location: { lat: Number(d.location.lat.toFixed(7)), lng: Number(d.location.lng.toFixed(7)) },
      // OSM has no wheelchair tags for FIU's doors yet. Assumed step-free until
      // someone checks; mark stairs in STAIRS_OVERRIDES in src/data/campus.ts.
      accessible: true,
      rooms: [] as string[],
    }
  })
  // Two doors on the same side → "East entrance 1", "East entrance 2".
  const seen: Record<string, number> = {}
  for (const e of entrances) {
    const side = e.label.split(' entrance')[0]
    if ((counts[side] ?? 0) > 1 && !e.label.startsWith('Main')) {
      seen[side] = (seen[side] ?? 0) + 1
      e.label = e.label.replace(' entrance', ` entrance ${seen[side]}`)
    }
  }

  return { id, code: b.code, name: b.name, location: b.location, entrances }
})

const target = new URL('../src/data/fiuCampus.json', import.meta.url)
await Bun.write(
  target,
  JSON.stringify({ source: 'Buildings: FIU campus map (campusmaps.fiu.edu). Doors: OpenStreetMap contributors (ODbL).', buildings: out }),
)
console.log(`Wrote ${out.length} buildings (${mapped} with mapped doors, ${estimated} with an estimated door) → src/data/fiuCampus.json`)
