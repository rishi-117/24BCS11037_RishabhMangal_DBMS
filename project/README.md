# AURA Athletic Club ERP

A gym management application for members, trainers and administrators. It uses Next.js 16 (App Router), React 19, TypeScript, PostgreSQL and Tailwind CSS. The existing member passes, attendance, trainer roster, approvals, memberships and finance views use server-side PostgreSQL APIs. See [DBMS_GUIDE.md](DBMS_GUIDE.md) for the schema, SQL examples and viva preparation.

## Local setup

Requires Node.js 20.9 or later, npm and a running PostgreSQL server. From the repository's `project` directory:

```sh
npm ci
cp .env.example .env.local
```

Create a **new, empty** PostgreSQL database, set `DATABASE_URL` and a `DEMO_PASSWORD` of at least eight characters in `.env.local`, then run:

```sh
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000. The seed creates demonstration accounts including `admin@auraclub.fit` (username `admin`) and prints the other demo email addresses; all newly created demo accounts use `DEMO_PASSWORD`. Seed upserts do not change passwords of existing accounts. Use only a disposable database for demonstration accounts; they share a password and are not suitable for a real production service. The destructive `db:reset` drops application tables and prompts for confirmation; do not run it against a database containing valued data.

For a production build, run `npm run build` and `npm start`. `.env.local` is ignored by Git. Required runtime variable: `DATABASE_URL`. `DEMO_PASSWORD` is needed only by the seed script and API tests. `PG_POOL_MAX` and `NEXT_PUBLIC_APP_URL` are optional; `PGSSLMODE=require` is used by migration/reset scripts for hosted TLS connections. Use the provider's pooled PostgreSQL endpoint for the application and limit connection counts for serverless instances.

## Checks

```sh
npm run lint
npm run typecheck
npm run build
npm run test:api
npm run test:smoke
```

The API suite uses a real database and expects the seed and matching `DEMO_PASSWORD` in `.env.local`; use a disposable database. The UI suite mocks API responses. Playwright browsers may need `npx playwright install chromium`. Never run these tests against a production database.

## Deployment and migration limitations

Set the Vercel project root to `project`, configure environment variables securely, and connect a **new** hosted PostgreSQL database. Apply migrations and, only for a disposable demonstration deployment, seed it using a secure password. Deploy a preview and verify `/api/health` and actual authentication and database-backed workflows before promoting it. Do not reset or overwrite an existing database. The CLI migration and seed scripts load `.env.local`; use a separate secure environment pointing at the intended database and double-check the target before executing them.

Firebase Google sign-in has been replaced by email/password and server-side sessions. No Firebase user records or passwords were imported. Existing users need a separately planned data migration and account recovery or reset process; this application does not currently provide automated password reset. Creating the new database does not delete the old Firebase data. The app uses request-based refreshes rather than Firestore's realtime listeners.
