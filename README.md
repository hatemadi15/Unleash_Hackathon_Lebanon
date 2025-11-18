# ReCup Lebanon MVP

This repository contains a self-contained MVP for **ReCup Lebanon**, a reusable coffee cup deposit system that lets customers borrow, return, or keep QR-tracked cups across a network of partner cafés.

Because the execution environment blocks third-party package downloads, the backend relies entirely on Node.js built-in modules and a lightweight JSON file to mimic the specified PostgreSQL/SQLite schema. The code keeps the data model, business rules, and API surface from the spec so the storage layer can be swapped for a relational database later without changing the API.

## Project structure

```
.
├── backend
│   ├── data/                # JSON database created by the seed script
│   ├── package.json         # npm scripts (no external deps needed)
│   ├── seed.js              # re-creates database with demo data
│   └── src/
│       ├── server.js        # HTTP server + REST endpoints + static hosting
│       ├── db.js            # file-backed persistence helper
│       ├── utils.js         # password hashing + JWT helpers
│       └── configService.js # key/value config accessors
└── frontend
    ├── index.html
    ├── app.js
    └── styles.css
```

## Backend

### Install & seed

No dependencies are required besides Node.js ≥ 18.

```
cd backend
npm run seed   # wipes data/data.json and seeds demo content
```

The seed command creates:

| Role        | Email                   | Password    |
|-------------|-------------------------|-------------|
| Admin       | `admin@recup.local`     | `admin123`  |
| Café staff  | `cafe@recup.local`      | `cafe123`   |
| Customer    | `customer@recup.local`  | `customer123` |

It also creates two cafés, a handful of cups (UUIDs), and sensible defaults for deposit amount, borrow limits, rewards, etc.

### Run the server

```
npm start
```

The server listens on [http://localhost:4000](http://localhost:4000) and also serves the SPA front-end files from `frontend/`.

### API overview

All endpoints accept/return JSON and honor the business rules described in the spec:

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET /user/profile`, `PUT /user/profile`, `GET /user/transactions`
- `GET /cafes`, `GET /cafes/:id/inventory`
- `GET /cups/:cup_id`, `POST /cups/:cup_id/borrow`, `/return`, `/purchase`, `/mark-damaged`
- Admin endpoints for config, cafés, cups, and overdue processing.

Authentication uses simple JWTs signed via Node's `crypto` module. Passwords are hashed with PBKDF2. The QR content is treated as raw text; if it contains a URL, the backend/front-end extract the final path segment as the `cup_id`. Customer profiles now include an optional `profile_image` (stored as a base64 data URL, capped at 500 KB) that can be updated through `PUT /user/profile`.

The `/admin/process-overdue-borrows` endpoint implements the “mark lost” flow: overdue cups become `LOST`, the borrower’s active count is decremented, and the deposit stays locked (simulating the replacement fee).

### QR code system

1. **Cup identity** – Every cup row is seeded with a UUID and that identifier is exactly what the QR payload should carry (either the bare UUID or a URL such as `https://recup.app/cup/<id>`). Admins can mint more cups with `/admin/cups` or `/admin/cups/bulk-create`, and the response body lists the strings that need to be printed under the QR image.
2. **Frontend extraction** – When a customer or staff member pastes a QR scan into the SPA, `extractCupId` (see `frontend/app.js`) trims whitespace, optionally parses the URL, and keeps only the last path segment so the subsequent API call always uses a clean `cup_id`.
3. **Backend normalization** – All cup endpoints run their `:cup_id` path parameter through `normalizeCupIdSegment` → `parseCupIdFromQr` (see `backend/src/server.js` and `backend/src/utils.js`). That means even if a scanner submits the entire QR URL or it arrives URL-encoded, the server strips everything except the canonical identifier before looking up the cup record.
4. **State validation** – After the ID is resolved, the borrow/return/purchase handlers enforce the business rules: they load the matching cup row, ensure the status transition is allowed, and then update the cup/user/transaction records. Because every transition runs on the canonical ID, faked or duplicated QR data is rejected as soon as the lookup fails or violates a rule.

This shared pipeline keeps the QR workflow simple for the UI while ensuring the backend remains the single source of truth for every cup.

## Frontend

Open [http://localhost:4000/](http://localhost:4000/) after starting the backend. The single-page app supports:

- Customer registration/login
- Viewing deposit balance, reward points, active borrows, and managing a profile card with custom avatar uploads
- Borrowing, returning, and keeping cups by pasting a QR string and choosing a café
- Viewing the latest transactions
- Café staff login with inventory view plus borrow/return forms that accept customer emails
- A shared camera-based QR scanner (powered by `html5-qrcode`) that autofills whichever QR input is focused; click “Start camera” and grant permission on localhost/HTTPS
- A Leaflet map that plots every partner café with Google Maps links plus a "Route to nearest café" button that asks for browser geolocation and opens the best match directly in Google Maps

All QR scans can still be simulated via text inputs, and the camera helper is optional. The UI automatically loads the café list from `/cafes` for dropdowns.

## Notes & future upgrades

- Swapping the file-based persistence with PostgreSQL/SQLite would only require reimplementing `db.js` with a real ORM/driver; the rest of the API already matches the relational schema.
- Business rules (limits, deposits, overdue handling, rewards) are fully driven by the `config` key/value table exposed to admins.
- For clarity, overdue returns processed *before* the admin task still refund deposits and award rewards. Once `/admin/process-overdue-borrows` marks a cup as lost, the deposit stays withheld.
- The code intentionally avoids external dependencies due to the offline constraints. In a full deployment, Express, a proper migration tool, and a production-ready auth library are recommended. The frontend relies on CDN-hosted Leaflet and html5-qrcode for the map and scanner; keep an eye on CSP settings if you later self-host those assets.
