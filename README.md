# A+ Cleaning Solutions

Website and client portal for **A+ Cleaning Solutions** — student housing & dorm cleaning.
*Clean dorms. No hassle.*

- **Public website** (`/`) — informational site: services, plans, how it works, client-portal preview, FAQ and a booking/quote form.
- **Client login** (`/login`) — secure sign-in for existing clients.
- **Client portal** (`/portal`) — next visit, completed cleans, total paid, current plan, full order history (filter by upcoming / completed / cancelled) with team notes, account details and change password.

## Quick start

Requires Node.js 22.13+ (uses built-in `node:sqlite` — no database server needed).

```bash
npm install
npm run seed      # optional: demo client with sample orders
npm start         # http://localhost:3000
```

Demo login (after `npm run seed`): `demo@aplus-cleaning-solutions.com` / `CleanDorm2026`

## Managing clients and orders

Clients don't self-register — you create their login when they book:

```bash
npm run manage -- add-client --email student@school.ca --name "Sam Lee" --password "TempPass123" \
  --residence "Maple Hall" --room 214 --phone "555-555-0100"

npm run manage -- add-order --email student@school.ca --date 2026-10-14 \
  --service "Dorm Room Clean" --plan Bi-Weekly --amount 49

npm run manage -- set-status --order AP-10008 --status completed
npm run manage -- reset-password --email student@school.ca --password "NewPass123"
npm run manage -- list-clients
npm run manage -- list-orders [--email student@school.ca]
npm run manage -- inquiries     # booking/quote requests from the website form
```

## Configuration

| Variable      | Default         | Purpose                                                         |
|---------------|-----------------|-----------------------------------------------------------------|
| `PORT`        | `3000`          | HTTP port                                                       |
| `DB_PATH`     | `data/aplus.db` | SQLite database file (keep on persistent storage & back it up)  |
| `NODE_ENV`    | —               | `production` marks the session cookie `Secure` (HTTPS only)     |
| `TRUST_PROXY` | —               | Set (e.g. `1`) when behind a load balancer / reverse proxy      |

## Security

- Passwords hashed with scrypt; sessions are random tokens stored hashed, in `HttpOnly`, `SameSite=Lax` cookies (14-day expiry).
- Clients can only read their own orders; login errors don't reveal which emails exist.
- Login attempts rate-limited per IP; API writes must be JSON (CSRF protection); strict Content-Security-Policy.
- Always serve over HTTPS in production.

## Layout

```
src/server.js      Express app: pages, auth & orders API, inquiry form
src/auth.js        Password hashing, sessions, rate limiting
src/db.js          SQLite schema (clients, orders, sessions, inquiries)
scripts/manage.js  Admin CLI
scripts/seed.js    Demo data
public/            Website, login & portal (HTML/CSS/JS, brand images)
test/              API tests (npm test)
```
