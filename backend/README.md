# Express API

Bun + TypeScript + Express 5, Prisma 6.19, and MongoDB. The server listens on
port 3000 and allows browser requests from `http://localhost:5173`.

## Setup

```bash
bun install
# If .env does not exist yet:
cp .env.example .env
# Set DATABASE_URL to a real MongoDB replica set or Atlas database.
bun run db:check
bun run db:push
bun run db:seed
bun run dev
```

`db:seed` creates one synthetic demo building, entrance, and pickup/dropoff zone
near FIU, preserving existing records on repeat runs. They are explicitly labeled
unverified, and the entrance is not marked accessible. Replace these fixtures
with the map team's verified data before using them for navigation.

MongoDB requires a replica set. `db:push` creates collections/indexes; Prisma
Migrate is not used. Existing users without password hashes cannot log in until
a real credential enrollment flow is provided. Registration never claims an
existing account by email.

`bun start` runs without hot reload. `bun run typecheck` checks TypeScript.
`bun test` runs integration tests against a disposable MongoDB replica set; its
first run downloads MongoDB 7.0.24. Tests never use the configured database and
mock Google HTTP calls, so they do not consume Google API quota.

## API contract

All failures return `{ "error": "message" }`. Lists are bare JSON arrays;
single resources are bare objects. Coordinates follow GeoJSON order:
`{ "type": "Point", "coordinates": [longitude, latitude] }`.
Unknown input fields are rejected on mutations. IDs are strings. Dates use ISO
8601 UTC strings. Successful deletes and logout return 204 with no body.

This checkout currently contains the Vite starter UI, not the map application or
its API types. These contracts follow the supplied Prisma schema and must be
compared with the teammate's API client before UI compatibility can be verified.
`frontend/.env.local` sets `VITE_USE_MOCK=false`; the starter UI does not read it.

| Method | Path | Body/query | Result / access |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ status: "ok" }`, public |
| GET | `/api/buildings` | — | Building array including `entrances`, public |
| GET | `/api/zones` | Optional `?buildingId=...` | Visible shared zones only, public |
| POST | `/api/auth/register` | `{ name, email, password }` | 201 `{ user, token, expiresAt }` |
| POST | `/api/auth/login` | `{ email, password }` | `{ user, token, expiresAt }` |
| POST | `/api/auth/logout` | — | Revokes current token, authenticated |
| GET | `/api/me` | — | `{ id, name, email, profile }`, authenticated |
| PATCH | `/api/me` | `{ name?, profile? }` | Updated user, authenticated |
| GET | `/api/me/zones` | — | All owned zones, including hidden ones |
| GET | `/api/me/zones/:id` | — | Owned zone |
| POST | `/api/me/zones` | Full zone or `{ basedOnZoneId, ...overrides }` | 201 owned zone |
| PATCH | `/api/me/zones/:id` | Zone fields to change | Updated owned zone |
| DELETE | `/api/me/zones/:id` | — | Deletes owned zone |
| GET | `/api/closures` | — | All reported restrictions, public |
| GET | `/api/closures/:id` | — | A reported restriction, public |
| POST | `/api/closures` | Restriction fields below | 201 restriction; authenticated |
| PATCH | `/api/closures/:id` | Restriction fields to change | Only the author can edit |
| DELETE | `/api/closures/:id` | — | Only the author can delete |
| GET | `/api/search` | `?q=library` | Google place array, public |
| POST | `/api/plan` | Origin + destination or zone ID | Route plan, authenticated |
| POST | `/api/trips/feedback` | `{ tripId, rating, comment? }` | Saves/replaces feedback for an owned trip |

### Accounts

Passwords are 8–128 characters and hashed with Argon2id. Emails are normalized
to lowercase. Send `Authorization: Bearer <token>` on authenticated requests.
Tokens are random opaque credentials; only SHA-256 token hashes are stored in
MongoDB. Sessions expire after 30 days; separate device logins create separate
sessions. Logout revokes the current session. Authentication attempts are rate
limited. Password reset and email verification are not implemented.

A profile contains `avoidStairs`, `requireCurbCuts`, `avoidSteepSlopes`,
`preferAccessibleEntrances` (booleans), and optional nullable `maxWalkMinutes`
(1–240). PATCH replaces the supplied profile as a whole. These preferences are
stored but are not yet applied by the route planner.

### Zones and closures

A zone contains `buildingId`, `entranceId`, `name`, `kinds` (array of `DROPOFF`,
`PICKUP`, `BOTH`), `polygon` (3–200 GeoPoints), `stopPoint` (GeoPoint), `rooms`
(string array), and optional `hidden`. An entrance must belong to the specified
building. The server assigns the zone ID and owner; clients cannot change owners.
Personal zones are separate records. `basedOnZoneId` clones a shared zone or one
owned by the current user, with optional field overrides. Hiding that copy does
not modify the shared zone. The UI can use `basedOnZoneId` when merging personal
choices into the shared map.

A closure maps to `RouteRestriction`: `type` is one of `ROAD_CLOSED`,
`SIDEWALK_CLOSED`, `CONSTRUCTION`, `STAIRS`, `NO_CURB_CUT`, `BLOCKED_PATH`,
`STEEP_SLOPE`, `FLOODED`, `TEMPORARY_OBSTACLE`, `OTHER`; `geometryType` is `POINT`,
`PATH`, or `AREA`; `points` contains exactly 1, at least 2, or at least 3 GeoPoints,
respectively. `reason` is required. `startsAt` and `endsAt` are optional nullable
dates. Shared reads include expired and future reports so the UI can display
scheduled/history states; plans return only reports active at request time.
Closure reports are user submissions, not verified official closures.

### Google setup and contracts

Enable **Places API (New)** and **Routes API** in a Google Cloud project with
billing enabled. Set `GOOGLE_MAPS_API_KEY` in `backend/.env`; keep this server
credential out of all `VITE_*` variables. Restrict the key to these APIs and your
server deployment. A frontend map may separately need its own browser-restricted
Maps JavaScript API key; the backend does not need that API or Geocoding for
these coordinate-based requests.

The backend uses Places Text Search and Routes Compute Routes over HTTPS with
explicit field masks and a 10-second timeout. Missing configuration returns 503;
upstream failures return 502 without forwarding credential/provider details.
Search/plan requests are rate limited per IP in this process.

Search returns `[{ id, name, address, location, googleMapsUri?, attributions }]`.
Preserve required Google/third-party attribution when displaying results.

A direct plan request:

```json
{
  "origin": { "type": "Point", "coordinates": [-80.374, 25.756] },
  "destination": { "type": "Point", "coordinates": [-80.373, 25.757] },
  "travelMode": "WALK"
}
```

`travelMode` is `WALK` (default) or `DRIVE`. Alternatively supply `zoneId` instead
of `destination`: this produces a driving segment to the zone's stop point and a
walking segment to its entrance. Only visible shared zones or the user's own
visible zones can be selected. The response is:

```ts
{
  tripId: string,
  segments: Array<{
    travelMode: "DRIVE" | "WALK",
    distanceMeters: number,
    durationSeconds: number,
    encodedPolyline: string,
    warnings: string[]
  }>,
  closures: RouteRestriction[],
  accessibilityVerified: false,
  warnings: string[]
}
```

Google walking directions do not guarantee wheelchair accessibility. Custom
closures and saved walking preferences are **not enforced** or checked for
intersection with the returned path; active closure reports and warnings are
returned for display. The frontend must display route warnings. No automatic
zone ranking or accessible-path solver is implemented. Google route/search
content is not cached in MongoDB; only trip ownership/time and user feedback
are stored. Feedback ratings are integers 1–5, with an optional comment.

References: [Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search),
[Routes Compute Routes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes).
