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

## Owner dashboard (`/admin`)

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your hosting settings, then sign in at `/admin` to:

- create client logins (with a generated temporary password to send them),
- add, edit and delete orders and change their status (scheduled / completed / cancelled),
- see quote requests from the website's "Book Today" form and turn them into clients in one click.

## Invoices & online payments (Stripe)

From the dashboard's **Invoices** tab (or **Approve & Invoice** on a quote request) you can send a client an
invoice with line items. It appears in their portal with a **Pay** button that opens Stripe Checkout; when they
pay, the invoice is marked paid, the owner gets an email, and the client gets a Stripe receipt. Invoices can also
be marked paid by hand (e-transfer, cash) or voided.

| Variable                | Purpose                                                                            |
|-------------------------|------------------------------------------------------------------------------------|
| `STRIPE_SECRET_KEY`     | `sk_test_…` for testing (card 4242 4242 4242 4242) or `sk_live_…` for real payments |
| `STRIPE_WEBHOOK_SECRET` | Optional but recommended: endpoint `https://<domain>/api/stripe/webhook`, event `checkout.session.completed` |
| `STRIPE_CURRENCY`       | Optional, defaults to `cad`                                                         |

## Deploying (Render)

`render.yaml` sets everything up: a Node web service on the Starter plan with a 1 GB persistent disk for the
database, auto-deploying from `main`. In Render choose **New → Blueprint**, pick this repository, enter
`ADMIN_EMAIL` / `ADMIN_PASSWORD` when prompted, then add your domain under **Settings → Custom Domains**.

## Command-line admin (optional)

The same tasks can be done from a terminal:

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
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Owner dashboard login (dashboard is disabled until both are set) |
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
src/admin.js       Owner dashboard API
src/db.js          SQLite schema (clients, orders, sessions, inquiries)
scripts/manage.js  Admin CLI
scripts/seed.js    Demo data
public/            Website, login & portal (HTML/CSS/JS, brand images)
test/              API tests (npm test)
```
