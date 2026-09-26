# Doorstep frontend

```bash
bun install
# Copy only if .env.local does not already exist:
cp .env.example .env.local
bun run dev
```

Set `VITE_GOOGLE_MAPS_API_KEY` to the browser key for Maps JavaScript API and
Street View. The backend separately needs `GOOGLE_SERVER_KEY` for Places API
(New) and Routes API. Never put the server key in a VITE variable.

Start the backend on port 3000, synchronize its Prisma schema, seed campus data,
and run its curb generator before opening the map; see `../backend/README.md`.
Vite proxies relative `/api` requests to localhost:3000 during development.
Production hosting must also proxy `/api` to the backend.

The app now always uses the backend; `VITE_USE_MOCK` is obsolete. Accounts require
email/password, with registration available on the sign-in screen. Only the token
and map display preferences are stored locally. Campus data, saved zones, closure
reports, feedback, search, ranking, and directions are managed by the backend.
Map display, GPS, Street View, editing gestures, and personal-zone display merging
remain in the browser.

`src/api.ts` owns HTTP calls. `src/api/adapters.ts` converts canonical backend
GeoJSON coordinates, uppercase kinds, and author IDs into map view models.
Wire types are imported type-only from `backend/src/contracts.ts`, derived from
Prisma. After backend schema changes, run `bun run db:generate` in the backend
before building the frontend.

`bun run build` checks types and builds; `bun run lint` runs ESLint. The backend's
`bun test` suite tests the actual frontend API functions against isolated MongoDB
with Google responses mocked.
