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
walk time is enforced; applicable closure intersections exclude stopping routes. Unreachable
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


## Public stops and verification

Public submissions, confirmations, reports, and review history live in the MongoDB
`Zone` collection alongside generated, design, and private zones. `/public-stops` remains a compatibility API over shared Zone records. Private arrival preferences remain in PersonalStop.
After reviewing the deployment target, apply the additive schema with `bun run db:push`
(no `--accept-data-loss`), then restart the API after `bun run db:generate`.

All accounts default to `USER`. To appoint a reviewer, first register the account,
then run this explicit server-side command from `backend`:

```bash
bun run db:admin reviewer@example.com
# Revoke reviewer permissions:
bun run db:admin reviewer@example.com --revoke
```

Refresh the app after a role change. Every protected request reads the current
server-side role; registration and profile updates cannot assign roles. Administrators
cannot verify their own submissions. Use separate submitter and reviewer accounts
for the demo. Institution/property-manager identity verification is not automated.

Endpoints:

- `GET /api/public-stops`: public list, 100 per page; pass `before=nextCursor`.
- `GET /api/public-stops?review=true`: admin queue of unverified/disputed/expired stops.
- `GET /api/public-stops?retired=true`: admin list including retired stops.
- `GET /api/public-stops/:id`: stop detail and public history.
- `POST /api/public-stops`: signed-in submission with name, instructions, GeoJSON
  location, `kinds` (`DROPOFF`/`PICKUP`), and optional HTTPS `photoUrl`.
- `POST /api/public-stops/:id/confirm`: signed-in confirmation with fresh GPS
  location, accuracy <=50 meters, and timestamp <=2 minutes old. Distance plus
  accuracy must be <=100 meters. One confirmation per account per stop; submitters
  cannot confirm their own stop. Coordinates are not retained in confirmations.
- `POST /api/public-stops/:id/reports`: category and details; one unresolved report
  per account. Categories: `MISPLACED`, `INACCESSIBLE`, `PRIVATE_PROPERTY`, `CLOSED`,
  `UNSAFE`, `OTHER`. A report immediately marks the stop `DISPUTED` and clears its
  current access/accessibility assurances without deleting previous evidence.
- `POST /api/public-stops/:id/review`: admin-only status, access, accessibility,
  evidence notes (10+ characters), current `revision`, and `validDays` (1–180; default
  90). A stale revision returns 409 rather than overwriting newer evidence.

Statuses: `UNVERIFIED`, `VERIFIED`, `DISPUTED`, `RETIRED`. Access and accessibility
are independent: verification requires `PERMITTED` public stopping, while step-free
access can remain `UNKNOWN`. Resolving a dispute preserves its report and records
its resolution date plus reviewer evidence. New reports can reopen a verified stop.
Retired stops leave the public list but remain available to administrators/history.

Verified stops expire on their next read and receive a System audit entry; arrival
planning immediately downgrades expired verification to an Unverified preview, even before any list refresh.
There is no scheduled expiration worker. `destination.publicStopId` in arrival
planning rechecks status, expiry, public access, trip type, and required accessibility,
then uses server-owned coordinates. Public-stop review does not certify Google’s
entire walking route or any road-arrival pin adjustment.

The MVP caps confirmations/reports at 1,000 each per stop, limits mutations to 30
per account per minute, and uses an atomic revision check on every update. Nearby
GPS and distinct accounts are supporting evidence, not proof of identity or physical
presence; no automatic promotion follows from votes. Photo evidence is an optional
external HTTPS link (not file uploads). Reports, review notes, and reviewer display
names are public; confirmer/reporter account IDs and GPS observations are not.

`bun run test` exercises this workflow in an isolated MongoDB replica set, including
race conditions, role revocation, GPS validation, expiry, and route eligibility.


### Unified zones and routing

Zone is the single stored model for generated suggestions, public stopping spots,
and private zones. A zone has a stopPoint, optional polygon (empty for point-only
spots), optional buildingId/placeId, and review/access/accessibility history.
entranceId and rooms remain for old references but do not constrain routing.
Building association is descriptive; eligible nearby destinations can reuse a zone.

Both planners discover all eligible shared zones within 500 m, without a five-stop
limit. Campus planning also loads associated building zones, merges private
replacements, filters entrances by room/accessibility, then evaluates every
zone–entrance combination in batches of three. Routes over 500 m or crossing
applicable restrictions are excluded. It returns the fastest entrance per zone,
ranked by walking time (with an accessible-entrance preference when requested).
Pickup walks run entrance → stop; drop-offs run stop → entrance. Arrival planning
ranks by walking time too; a manually moved pin overrides automatic discovery.
Generated suggestions and community proposals remain unverified. Step-free-only
plans require currently verified STEP_FREE zones and suitable entrances.

POST /api/public-stops accepts optional buildingId, placeId, polygon, origin
(manual/suggestion), and suggestedZoneId. A generated zone is promoted in place:
its ID, point, boundary and building association survive. New proposals get a Zone
record with UNVERIFIED status; only administrator review grants verification.
Repeated same-name proposals within 15 m return the existing zone. The creation
UI also offers nearby existing zones before submission. Private zones cannot be
promoted by another account or fetched through public endpoints.

### Upgrade an existing database

Stop older backend processes before the migration so they cannot write to the
legacy PublicStop collection. From backend/ run:

```sh
bun run db:generate
bun run db:unify-zones          # read-only counts
bun run db:unify-zones --apply  # additive backfill/import
bun run db:zone-indexes        # add two non-unique indexes; no drops
```

The migration preserves Zone IDs, imports legacy ObjectIds as equivalent string
IDs, and keeps ownership, review evidence, statuses and timestamps. Existing zone
metadata is filled only when absent. PublicStop is retained as a legacy archive;
the application no longer reads or writes it. Reruns skip previously imported
records and preserve subsequent edits. Review dry-run counts before applying.
Existing clients can continue using /public-stops and publicStopId; both refer to
Zone IDs. Updating the Prisma schema alone does not migrate existing records.
