# CTF Platform

A self-hosted CTF (Capture the Flag) platform with an admin panel for adding
challenges by hand, team registration/login, and a live-updating scoreboard.

## What's included

- **Admin panel** (`/admin.html`) — password-protected. Add, edit, and delete
  challenges; organize them into categories; attach optional paid hints;
  manage registered teams; toggle registration open/closed.
- **Team portal** (`/` and `/challenges.html`) — teams register with a team
  name + password, browse challenges by category, and submit flags.
- **Live scoreboard** (`/scoreboard.html`) — updates in real time over
  websockets as teams solve challenges, plus a live activity feed.
- **Flags and passwords are hashed** with bcrypt — never stored in plaintext.

## Running it locally

Requirements: Node.js 18+.

```bash
npm install
cp .env.example .env
```

Open `.env` and set:
- `ADMIN_PASSWORD` — whatever you'll type into `/admin.html` to manage the event
- `SESSION_SECRET` — any long random string

Then:

```bash
npm start
```

Visit `http://localhost:3000`. Go to `/admin.html`, sign in with
`ADMIN_PASSWORD`, and start adding challenges. Teams register at `/`.

## Adding challenges

In the admin panel:
1. **Categories** tab — add categories like "Web", "Crypto", "Forensics", etc.
2. **Challenges** tab → **+ Add challenge** — fill in title, category, point
   value, difficulty, description, an optional external resource link, and
   the flag (exact string a team must submit, e.g. `flag{...}`).
3. Optionally add one or more **hints**, each with a point cost that's
   deducted from a team's score the moment they choose to reveal it.
4. Toggle **Visibility** to "Hidden" to stage a challenge without showing it
   to teams yet — flip it to "Visible" when you're ready to release it.

Flags are matched as an exact (trimmed) string comparison against the hashed
flag you entered — teams never see the flag hash, only whether their guess
was right.

## Hosting it online for remote teams

This is a normal Node.js server with a local SQLite file for storage, so it
needs a host that runs a persistent process — not a static site host. Good,
simple options:

### Railway / Render (easiest)
1. Push this folder to a GitHub repo.
2. Create a new Web Service from that repo on [Railway](https://railway.app)
   or [Render](https://render.com).
3. Set the start command to `npm start` (usually auto-detected).
4. Add environment variables `ADMIN_PASSWORD`, `SESSION_SECRET`, and
   `NODE_ENV=production` in the host's dashboard.
5. **Attach a persistent volume/disk mounted at `/data`** (both platforms
   support this) so the SQLite database survives restarts and deploys —
   otherwise team accounts and scores reset every time the app redeploys.
   If you add a volume at a different path, update the `data` folder
   reference in `db.js` and `server.js` to match.
6. Deploy. Share the resulting URL with participants.

### Fly.io
Similar idea — `fly launch`, attach a volume for `/app/data`, set secrets
with `fly secrets set ADMIN_PASSWORD=... SESSION_SECRET=...`.

### A VPS (DigitalOcean, Linode, etc.)
```bash
git clone <your-repo>
cd ctf-platform
npm install
cp .env.example .env   # edit with real values
npm install -g pm2
pm2 start server.js --name ctf
pm2 save
```
Put it behind Nginx or Caddy for HTTPS (recommended — team passwords are
sent to `/api/auth/login`, so serve over TLS).

## Notes on scale and fairness

- Sessions are stored in memory in this build, which is the simplest setup
  and works well for a single-process deployment (the normal way to run a
  CTF for one event). If you ever need multiple server instances behind a
  load balancer, swap in a shared session store like `connect-redis`.
- The scoreboard breaks ties by who reached their current score first,
  which is the standard CTF convention.
- There's no built-in rate limiting on flag submission — if you expect
  brute-force guessing to be a concern, consider adding a reverse-proxy
  rate limit (Nginx, Cloudflare, etc.) in front of `/api/challenges/*/submit`.

## Project structure

```
server.js           Entry point — Express app, sessions, Socket.io
db.js                SQLite schema + connection
routes/
  auth.js            Team register/login/logout
  admin.js            Admin login + CRUD for challenges/categories/teams/settings
  challenges.js        Public challenge list + flag submission + hint reveal
  scoreboard.js         Score calculation + live broadcast
middleware/auth.js    requireTeam / requireAdmin guards
public/               Static frontend (vanilla HTML/CSS/JS, no build step)
data/                 SQLite database file lives here (gitignored)
```
"# ctf-platform" 
