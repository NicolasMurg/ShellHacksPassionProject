# Doorstep backend

Express 5 + TypeScript on Bun, Prisma 6.19, and MongoDB. Port defaults to 3000.
The frontend dev server proxies `/api` to this port. Direct browser access from
localhost:5173 and localhost:8080 is also allowed.

## Run locally

```bash
bun install
# Copy only if .env doesn't already exist:
cp .env.example .env
```

Set `DATABASE_URL` to a real MongoDB Atlas database or replica set, including the
database name. Set `GOOGLE_SERVER_KEY` to a server key with **Places API (New)**
and **Routes API** enabled. The older `GOOGLE_MAPS_API_KEY` name is accepted as a
fallback. No Google SDK is needed; the server uses HTTPS requests with explicit
field masks and timeouts.

```bash
bun run db:check
bun run db:push
bun run seed
bun run db:curbs
bun run dev
```

`seed`/`db:seed` copies the six FIU buildings and ten entrances from `db/campus.ts`
into MongoDB. Entrance slugs map deterministically to ObjectIds. Existing records
are preserved. Seed coordinates/accessibility flags are approximate and need
verification. Old demo records are not automatically deleted.

`db:curbs` generates one shared curb zone per uncovered entrance using the end of
a Google driving route. It stores GeoJSON stop points, oriented polygons, room
patterns, and `source: "generated"`. Existing shared zones are preserved and
repeat runs skip them. Generation is an explicit setup/admin task, not a side
effect of reading the map. If no Google key is set, generated zones cannot be
created. A route endpoint alone does not prove a stop is legal or accessible;
generated zones are labeled unverified. The current seed has no hand-drawn zones.

Use `bun run db:generate` after schema changes, `bun run typecheck`, and `bun test`
for verification. Tests launch a disposable MongoDB replica set, mock Google,
and exercise the actual frontend API adapters. They do not use the configured
database. The first test run downloads a MongoDB binary.

## Data ownership and conversion

Prisma remains the canonical backend model: GeoJSON Point coordinates are
`[longitude, latitude]`; Entrance is a separate ObjectId-backed model; Zone uses
`DROPOFF`/`PICKUP`/`BOTH`; closures are `RouteRestriction` records.
`src/contracts.ts` derives wire types from Prisma. The frontend imports those
only as types and converts them in `frontend/src/api/adapters.ts` to `{lat,lng}`,
lowercase kinds, and display-ready closure authors. No Prisma runtime ships in
the browser. The browser retains map drawing, GPS, Street View, and personal-zone
merging for display. The server independently merges zones when planning.

The schema additionally stores entrance room patterns, zone source, and pace,
age, height, mobility, and learned factor alongside the existing accessibility
preferences. Applying `db:push` is required before using the new code.

## API

All failures return `{ "error": "message" }`. Authentication is
`Authorization: Bearer <token>`. Lists are bare arrays except the planning result.

| Method | Path | Request / response |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ name, email, password }` → `{ user, token, expiresAt }` |
| POST | `/api/auth/login` | `{ email, password }` → `{ user, token, expiresAt }` |
| POST | `/api/auth/logout` | Auth; revoke current session; 204 |
| GET | `/api/me` | Auth; user without password hash |
| PATCH | `/api/me` | Auth; `{ name?, profile?: partial profile }` → user |
| GET | `/api/buildings` | Buildings including entrances |
| GET | `/api/zones` | Shared visible zones; optional `buildingId` query |
| GET | `/api/me/zones` | Auth; own zones including hidden markers |
| PUT | `/api/me/zones/:id` | Auth; full zone fields → create/update using URL ID |
| POST | `/api/me/zones` | Auth; full fields or `basedOnZoneId` + overrides → server-generated ID |
| PATCH | `/api/me/zones/:id` | Auth; partial zone update |
| DELETE | `/api/me/zones/:id` | Auth; delete owned zone; 204 |
| GET | `/api/closures` | Shared restrictions with author `{ id, name }` |
| POST | `/api/closures` | Auth; restriction fields → restriction with author |
| PATCH | `/api/closures/:id` | Auth; only the author can edit |
| DELETE | `/api/closures/:id` | Auth; only the author can delete; 204 |
| GET | `/api/search?q=GC%20150` | `{ building, room }` |
| POST | `/api/plan` | Optional auth; ranked plan described below |
| POST | `/api/route` | `{ origin, destination, travelMode: "DRIVE" | "WALK" }` → route |
| POST | `/api/trips/feedback` | Auth; `{ tripId, rating, comment?, paceFeedback? }` → `{ user, feedback }` |

Passwords are hashed with Argon2id; random session tokens are stored only as
SHA-256 hashes and expire after 30 days. Separate device logins create separate
sessions. Existing users without password hashes need credential enrollment;
registration does not take over an existing email. Email verification and
password recovery are not implemented.

Zone PUT accepts `buildingId`, `entranceId`, `name`, `kinds`, `polygon`,
`stopPoint`, `rooms`, optional `basedOnZoneId` and `hidden`. The server assigns
ownership/source and ignores body `ownerId`, `id`, and `source`. It checks that
the entrance belongs to the building and prevents overwriting shared/other-user
zones. A personal hidden marker replaces its base zone only for its owner.

The closure UI submits `type: "ROAD_CLOSED"`, `geometryType: "PATH"`, GeoJSON
`points`, and `reason`. Other restriction types/geometries remain supported.
Ownership is enforced using the authenticated user ID, not the display name.

## Planning and feedback

A plan takes `{ buildingId, room?, kind: "DROPOFF" | "PICKUP" | "WALK",
stepFree?, origin? }`. `origin` is required for WALK and uses GeoJSON. It returns
`{ tripId?, options, accessibilityVerified: false }`. Each option includes
`entrance`, optional `zone`, `walkSeconds`, `reason`, `warnings`, and `route`.
Routes include decoded GeoJSON `path`, encoded polyline, Google duration/distance,
travel mode, and warnings. WALK ranks doors; the other modes rank curb zones.

Ranking merges shared and personal zones, respects hidden replacements, matches
room prefixes and trip kinds, and calculates actual Google walking-path lengths
before ranking. The walking model adjusts those lengths for pace, age, height,
mobility, learned factor, and approximate indoor/floor time. Step-free requests
and wheelchair/stroller profiles exclude entrances marked inaccessible. Maximum
walk time is enforced; nearby reports add penalties and warnings. Unreachable
candidates are skipped; provider/configuration failures return explicit errors.

Closure geometry is used to flag proximity to the start point; this does not
reroute Google paths around closures or establish full-path accessibility.
Curb cuts and slopes are not verified. The UI displays these limitations and
Google warnings. Search resolves building names/codes/aliases locally first;
Places fallback is restricted to campus and maps a result to a supported building
within 150 meters. Unmatched results return 404 rather than inventing a building.

Feedback ratings remain 1–5. Optional `paceFeedback` is `faster`, `right`, or
`slower`; it applies the learned-factor adjustment transactionally once per trip.
Repeated feedback cannot compound learning, and a different user cannot rate an
owned trip. Clients cannot overwrite `learnedFactor` through profile updates.
The pure walking/geometry helpers are shared for frontend previews; learning and
route selection run on the server. Google route content is not stored in trips.

References: [Routes API](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes),
[Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search).
