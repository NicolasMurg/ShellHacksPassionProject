# ShellHacks2026
  
## Inspiration:

With AI's penetration into modern day transportation it's important to address the problems that come with this change. While there are some obvious issues, a more subtle one is AI drivers' lack of ability to intelligently decide not only what building to leave a passenger but where specifically at the building they should be dropped off. We made DoorStep to solve this by using user specified locations to ensure you arrive at your location's doorstep and not just in the general area.

## What it does:

DoorStep is an AI powered web application that is built to assist AI drivers in sending their passengers to the exact right position. Instead of leaving people at general areas outside of a building, DoorStep ensures AI has a specific plan per person of where to take them. Users fill out their preferred drop-off location for certain buildings and areas (or leave default drop-off locations) and are able to change these whenever to fit there needs.

## How we built it:

We built a full-stack web application using CSS + TypeScript + JavaScript + HTML + Bun + React.



## Arrival points outside campus

Search an address or business, or tap a location on the map. Choose **Drop off here** or **Pick up here**, review the suggested stop and walking path, then **Use this spot**. **Move pin** lets you tap or drag to a different stop. Signed-in users can name the confirmed stop, add instructions, and save it privately across devices. **Clear selection** resets the preview.

Campus buildings keep their existing entrance and zone planner. Other destinations use individual arrival points, without creating shared building or zone records.

### Setup

The backend requires MongoDB, Prisma 6, and a Google server key with Routes API and Places API (New) enabled. Set `DATABASE_URL` and `GOOGLE_SERVER_KEY` (or `GOOGLE_MAPS_API_KEY`) in `backend/.env`. The browser map key remains in `frontend/.env.local` as `VITE_GOOGLE_MAPS_API_KEY`.

After pulling schema changes, run `bun run db:push` in `backend`, then restart the backend to load the generated Prisma client. Start each app with `bun run dev` in its directory.

### Arrival API

- `GET /api/search?q=...`: returns `{ building, room }` for campus matches or `{ destination: { name, location, placeId }, room: "" }` for other places.
- `POST /api/arrivals/plan`: optional bearer token; accepts `{ destination, origin?, stopPoint?, kind: "DROPOFF" | "PICKUP", stepFree? }`. Returns options, closure notices, and the user's saved preference, if any.
- `GET /api/me/stops`: lists only the authenticated user's saved arrival points.
- `PUT /api/me/stops`: saves `{ destination, stopPoint, name, instructions }` as the authenticated user's preference for that destination.
- `DELETE /api/me/stops/:id`: removes only the authenticated user's preference.

All API coordinates are GeoJSON-style `{ type: "Point", coordinates: [longitude, latitude] }`; frontend adapters convert them to map coordinates.

Arrival planning prefers saved spots, checks Google's mapped arrival point, and considers alternatives along its approach. It excludes routes intersecting active reported restrictions, including polygon interiors. It does not ask Google to reroute around arbitrary reports; if all candidates are affected, it asks the user to move the pin. Without GPS, a local approach is used only for discovering stops, and no driving ETA is displayed.

Generated and personal spots remain unverified for stopping permission, private-property access, crossings, and full-path accessibility. Google may snap a moved pin to its road network; the preview shows that adjustment before confirmation. Step-free requests expose this uncertainty rather than claiming an accessible route.

### Checks

Run `bun run typecheck` and `bun test` in `backend`; run `bun run build` and `bun run lint` in `frontend`. Integration tests use an isolated MongoDB replica set and mock Google responses.
