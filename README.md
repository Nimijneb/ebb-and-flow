# Ebb and Flow

> **Disclaimer:** this project is 100% vibe coded. There may be security issues that I do not know to look for.

A small, self-hosted envelope budgeting app with **households** (shared budgets) and multiple envelopes per household. Each envelope has a **starting balance** when created; you then record **Ebb** (money out) and **Flow** (money in). Current balance is: starting balance plus the sum of all transactions.

## Features

- **Locked sign-up**: there is no public registration. Set **`ADMIN_USERNAME`** and **`ADMIN_PASSWORD`** in the environment; on first start the server creates (or promotes) that admin. The admin signs in and uses **Add a family member** on the dashboard to create accounts for everyone else. Accounts use **usernames** only (no email).
- Optional **`ALLOW_OPEN_REGISTRATION=true`** (development only) re-enables `POST /api/auth/register`.
- Sign in (JWT, bcrypt passwords)
- **Households**: each account belongs to one household; family members share envelopes.
- Create envelopes with a starting balance (in dollars; stored as cents)
- List envelopes with running balance (shared with the household)
- Per-envelope transaction log (Ebb or Flow, optional note; shows who recorded each entry)
- Delete an envelope (and its transactions)
- **Scheduled transactions**: each user can add monthly Ebb or Flow on a chosen day of the month to any envelope they can access (shared or private); the server records them automatically in its local time zone
- Single container: API + static web UI

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev
```

- API: [http://127.0.0.1:4000](http://127.0.0.1:4000) (set `JWT_SECRET` in `.env` for stable tokens)
- Vite dev server: [http://127.0.0.1:5173](http://127.0.0.1:5173) (proxies `/api` to the API)

Create a `.env` in the repo root or under `server/`:

```env
JWT_SECRET=your-long-random-secret-at-least-16-chars
ADMIN_USERNAME=your-admin-username
ADMIN_PASSWORD=your-initial-admin-password
```

`ADMIN_EMAIL` is still accepted as a fallback for the admin username if `ADMIN_USERNAME` is unset.

Without admin env vars and an empty database, no one can sign in until you set them and restart (unless you use `ALLOW_OPEN_REGISTRATION=true` for dev).

Production build (writes the SPA into `server/public` and compiles the server):

```bash
npm run build
npm run start
```

## Docker

Put a `.env` in the same directory as your compose file:

```env
JWT_SECRET=your-long-random-secret
ADMIN_USERNAME=your-admin-username
ADMIN_PASSWORD=your-initial-admin-password
```

SQLite data lives in the named volume `envelope_budget_data` at `DATABASE_PATH` (`/data/envelopes.db` in the examples below).

### Example: build from this repository

Use the bundled [`docker-compose.yml`](docker-compose.yml) after cloning:

```yaml
services:
  envelope-budget:
    build: .
    image: envelope-budget:local
    restart: unless-stopped
    ports:
      - "4000:4000"
    environment:
      JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET in .env}
      ADMIN_USERNAME: ${ADMIN_USERNAME:?Set ADMIN_USERNAME in .env}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?Set ADMIN_PASSWORD in .env}
      PORT: "4000"
      DATABASE_PATH: /data/envelopes.db
    volumes:
      - envelope_budget_data:/data

volumes:
  envelope_budget_data:
```

```bash
docker compose up -d --build
```

### Example: pre-built image (GHCR)

This repo publishes to **GitHub Container Registry** via [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) (on pushes to `main` and tags like `v1.0.0`). Set the package to **Public** under **Packages** if you want unauthenticated `docker pull`.

Replace `nimijneb` with your GitHub user or org if you use a fork. Same layout as [`docker-compose.image.yml`](docker-compose.image.yml):

```yaml
services:
  envelope-budget:
    image: ghcr.io/nimijneb/envelope-budget:latest
    restart: unless-stopped
    ports:
      - "4000:4000"
    environment:
      JWT_SECRET: ${JWT_SECRET:?Set JWT_SECRET in .env}
      ADMIN_USERNAME: ${ADMIN_USERNAME:?Set ADMIN_USERNAME in .env}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?Set ADMIN_PASSWORD in .env}
      PORT: "4000"
      DATABASE_PATH: /data/envelopes.db
    volumes:
      - envelope_budget_data:/data

volumes:
  envelope_budget_data:
```

```bash
docker compose -f docker-compose.image.yml pull
docker compose -f docker-compose.image.yml up -d
```

Or download the file from GitHub and run the same commands:

```bash
curl -fsSL -o docker-compose.image.yml https://raw.githubusercontent.com/Nimijneb/envelope-budget/main/docker-compose.image.yml
docker compose -f docker-compose.image.yml pull
docker compose -f docker-compose.image.yml up -d
```

Open the app at [http://localhost:4000](http://localhost:4000) (change the host port in `ports:` if `4000` is taken).

## Environment

| Variable                   | Description |
|----------------------------|-------------|
| `JWT_SECRET`               | Secret for signing tokens (use a strong value) |
| `ADMIN_USERNAME`         | Username for the household admin (seeded on startup). `ADMIN_EMAIL` is used if this is unset (legacy). |
| `ADMIN_PASSWORD`           | Password for that admin when the account is first created (min 8 chars) |
| `ALLOW_OPEN_REGISTRATION`  | Set to `true` to allow `POST /api/auth/register` (dev only; default off) |
| `DATABASE_PATH`            | SQLite file path (default: `./data/envelopes.db` from server cwd) |
| `PORT`                     | HTTP port (default `4000`) |
| `CORS_ORIGIN`              | Optional browser origin for CORS |

## License

MIT (project scaffold; adjust as you like).
