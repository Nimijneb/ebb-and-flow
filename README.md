# Ebb and Flow

> **Disclaimer:** this project is 100% vibe coded. There may be security issues that I do not know to look for.

Self-hosted envelope budgeting: **households**, **envelopes**, **Ebb** (money out) and **Flow** (money in), plus optional **scheduled** Ebb/Flow. One container serves the API and the web UI.

## Run with Docker (recommended)

You do **not** need Node.js or a local build. Pull the published image and run it with Compose.

1. Put a `.env` in the same folder as the compose file:

```env
JWT_SECRET=your-long-random-secret-at-least-32-characters
ADMIN_USERNAME=your-admin-username
ADMIN_PASSWORD=your-initial-admin-password
```

2. Use the repo’s [`docker-compose.image.yml`](docker-compose.image.yml) (or copy it from GitHub) and start:

```bash
docker compose -f docker-compose.image.yml pull
docker compose -f docker-compose.image.yml up -d
```

The image is built from `main` and published to **GitHub Container Registry** as:

`ghcr.io/nimijneb/envelope-budget:latest`

(Use your fork’s owner in lowercase if you forked the repo.) Treat it like any other public image: same `docker pull` / `docker compose` workflow as Docker Hub.

3. Open **http://localhost:4000** (or the host/port you mapped).

There is **no public registration**. The first account is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` on startup. That admin adds everyone else under **Settings**.

> **Networking note:** the bundled compose files publish port `4000` on all host interfaces. On a single-user machine that is fine. On a shared host, change the mapping to `127.0.0.1:4000:4000` and front it with a reverse proxy that terminates TLS.

> **Sessions:** logging out on one device invalidates every active session for that account on every device (the server bumps a token version). This is intentional — there is no way to keep a phone session alive after logging out on a laptop.

### Optional environment

| Variable | Notes |
|----------|--------|
| `JWT_SECRET` | Required; use a long random string |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Required for the first admin (password ≥ 8 characters) |
| `PORT` | Default `4000` |
| `DATABASE_PATH` | SQLite path (default in container: `/data/envelopes.db` with the sample compose) |
| `CORS_ORIGIN` | Only if the browser loads the UI from a different origin than the API |
| `ALLOW_OPEN_REGISTRATION` | `true` = allow open signup (**dev only**; leave unset in production) |

## Development

If you are working on the code: clone the repo, `npm install`, copy `.env` at the repo root, then `npm run dev` (Vite + API). Production build: `npm run build` then `npm run start` from the repo root.

## License

MIT (project scaffold; adjust as you like).
