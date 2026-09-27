// Builds src/data/fiuWalkways.json: FIU MMC's walkable network from OpenStreetMap
// (footpaths, crossings, stairs, service roads...), used by src/walkRouter.ts to
// find the shortest walk on campus. Google Directions only knows a fraction of
// these paths, which is why its campus walks take long detours.
//
// Run from frontend/:   bun scripts/build-walkways.ts
// Or from a saved file: bun scripts/build-walkways.ts path/to/overpass.json
//
// Map data © OpenStreetMap contributors, ODbL.

const BBOX = [25.75, -80.384, 25.763, -80.3655] as const // south, west, north, east

// Edge kinds, in the order the router's cost table expects.
const KINDS = ['walkway', 'crossing', 'steps', 'service', 'street', 'major'] as const
type Kind = (typeof KINDS)[number]

function kindOf(tags: Record<string, string>): Kind | undefined {
  if (tags.foot === 'no' || tags.access === 'private' || tags.access === 'no') {
    if (tags.foot !== 'yes' && tags.foot !== 'designated') return undefined
  }
  const h = tags.highway
  if (tags.indoor === 'corridor' || h === 'corridor') return 'walkway'
  if (h === 'steps') return 'steps'
  if (h === 'footway' && tags.footway === 'crossing') return 'crossing'
  if (['footway', 'path', 'pedestrian', 'cycleway', 'track'].includes(h)) return 'walkway'
  if (['service', 'living_street'].includes(h)) return 'service'
  if (['residential', 'unclassified', 'tertiary'].includes(h)) return 'street'
  if (['secondary', 'primary'].includes(h)) return h === 'primary' && tags.sidewalk === 'no' ? undefined : 'major'
  return undefined
}

const QUERY = `[out:json][timeout:60];
(way["highway"~"^(footway|path|pedestrian|steps|service|living_street|residential|unclassified|tertiary|secondary|primary|cycleway|corridor|track)$"](${BBOX.join(',')});
 way["indoor"="corridor"](${BBOX.join(',')}););
(._;>;);out body;`

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

type OsmNode = { type: 'node'; id: number; lat: number; lon: number }
type OsmWay = { type: 'way'; id: number; nodes: number[]; tags: Record<string, string> }

async function download(): Promise<{ elements: (OsmNode | OsmWay)[] }> {
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: QUERY }), headers: { 'User-Agent': 'Doorstep-ShellHacks/1.0' } })
      const text = await res.text()
      if (text.startsWith('{')) return JSON.parse(text)
      console.warn(`${url}: not JSON (server busy?)`)
    } catch (err) {
      console.warn(`${url}: ${err}`)
    }
  }
  throw new Error('Every Overpass server failed; try again in a minute.')
}

const input = process.argv[2]
const osm = input ? await Bun.file(input).json() : await download()

const coords = new Map<number, [number, number]>()
for (const e of osm.elements) if (e.type === 'node') coords.set(e.id, [e.lat, e.lon])

const index = new Map<number, number>() // OSM node id → our node index
const nodes: number[] = [] // flat [lat, lng, lat, lng, ...]
const edges: number[] = [] // flat [a, b, kind, nameIndex(-1 = none), ...]
const names: string[] = []
const nameIndex = new Map<string, number>()

const nodeIdx = (id: number) => {
  let i = index.get(id)
  if (i === undefined) {
    const c = coords.get(id)
    if (!c) return undefined
    i = nodes.length / 2
    nodes.push(Number(c[0].toFixed(6)), Number(c[1].toFixed(6)))
    index.set(id, i)
  }
  return i
}

for (const e of osm.elements) {
  if (e.type !== 'way') continue
  const kind = kindOf(e.tags ?? {})
  if (!kind) continue
  const name = e.tags.name as string | undefined
  let n = -1
  if (name) {
    n = nameIndex.get(name) ?? names.length
    if (n === names.length) {
      names.push(name)
      nameIndex.set(name, n)
    }
  }
  for (let k = 1; k < e.nodes.length; k++) {
    const a = nodeIdx(e.nodes[k - 1])
    const b = nodeIdx(e.nodes[k])
    if (a === undefined || b === undefined || a === b) continue
    edges.push(a, b, KINDS.indexOf(kind), n)
  }
}

const out = {
  source: 'OpenStreetMap contributors (ODbL), via Overpass',
  bbox: BBOX,
  kinds: KINDS,
  names,
  nodes,
  edges,
}
const target = new URL('../src/data/fiuWalkways.json', import.meta.url)
await Bun.write(target, JSON.stringify(out))
console.log(`Wrote ${nodes.length / 2} nodes, ${edges.length / 4} edges, ${names.length} names → src/data/fiuWalkways.json`)
