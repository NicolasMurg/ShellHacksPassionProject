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
email/password, with registration available on the sign-in screen. The token, map display preferences, and MVP GPS walking traces are stored locally. Campus data, saved zones, closure
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


## Foreground walking-path demo

Open the map and allow location access. No recording button or manual reports are
needed: walking movement is collected automatically while the map is visible.
Use HTTPS when opening the app on a phone (or localhost on a desktop); browser GPS
requires a secure context. Keep the screen awake for the demo.

- Walk at least 30 meters with GPS accuracy of 20 meters or better. A blue line
  appears as you move and the qualifying walk saves automatically in this browser.
- Select a destination and a walking route to compare your movement against that
  route. Orange segments are farther than 25 meters (or twice GPS accuracy) from
  the planned route captured for that walk. Without a planned route, the app records
  the walk but does not label it a deviation.
- After a 90-second stop, hiding/reopening the app, or pausing/resuming learning,
  walk the same path again. Similar walks, including the reverse direction, are
  grouped; purple paths indicate at least two recorded walks. Orange deviations
  become thicker when repeated.
- Pause stops collection. Clear walks deletes this browser's saved traces.
  Poor accuracy, stale fixes, tiny movements, and speeds above 3 m/s are filtered.

This demo keeps up to 40 traces of up to 500 points each on the current device.
Repeated walks are observations, not distinct people. GPS-only speed filtering
cannot reliably distinguish walking from every other slow activity. Learned lines
are unverified overlays; they do not yet modify Google directions or establish
public access or accessibility. Cross-user aggregation needs a backend extension.

Run `bun run test` for deterministic GPS replay tests covering walking, repeated
paths, deviations, stationary drift, driving, gaps, and saved-data validation.


## Public stops demo

Use **Public stops** on the map. Sign in, choose **Add public stop**, tap its location,
and submit a name, access instructions, pickup/drop-off types, and optional photo
link. It appears for everyone as **Unverified** and is saved in the backend database.

A different nearby account can use **I used this stop successfully**; the browser
requests a fresh GPS fix. **Report a problem** marks it **Disputed** and sends it to
the review queue. Existing reports and decisions remain in the stop's history.

An account appointed with the backend `db:admin` command sees **Review queue only**
and **Administrator review**. Record public stopping permission and independently
check accessibility, write evidence notes, and save the decision. Approval expires
in 90 days by default. Reviewers cannot verify their own submissions. **Retired**
stops disappear from the public map; admins can still view and review them.

Verified and Unverified stops offer **Use this public stop** for a route preview. The backend
rechecks eligibility on every new plan. A step-free stop does not certify a whole
walking route. Use **Refresh** to load new reports or other users' submissions;
**Load more** fetches older stops beyond the first 100.


Public stops use compact car-sign map icons with a small status badge. Their names
appear on hover or selection; destination labels remain separate. Selecting a place
now previews arrival options automatically, including nearby public stops with their verification status.
A stop can serve multiple places and campus buildings within a 500 m walk. Choosing
an eligible stop's map icon selects its route option without replacing the original
destination. Newly submitted stops immediately appear in route suggestions as **Unverified**;
admin approval changes that label to Verified. Disputed, retired, and restricted
stops are excluded. Step-free-only requests still require verified step-free stops.
