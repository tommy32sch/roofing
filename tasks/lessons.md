# Lessons

## Deploy verification: middleware makes 401 probes meaningless
- **Mistake:** verified Vercel deploys by probing a new-only API route and treating
  401 as "route exists in new build". But `src/middleware.ts` matches
  `/api/admin/:path*` and returns 401 for ANY unauthenticated path under it —
  including routes that don't exist. The probe passes on the OLD build too.
- **Rule:** to confirm a deploy on this app, check a **build fingerprint** that only
  the new build can serve — e.g. a response header changed in `next.config.ts`
  (CSP), or page content visible without auth. Never use status codes on
  middleware-guarded paths.
- **Also:** Vercel builds take ~2-3 min; a probe 30s after push tests the old build.

## Locally-minted JWTs don't work against production
- `.env.local` JWT_SECRET differs from the Vercel env. Minted tokens are for
  LOCAL dev-server e2e only; production auth checks require the user to log in.

## Always verify prod DB schema before pushing main
- Dev and prod share one Supabase project, and migrations are applied manually via
  the dashboard SQL editor. Code on main that references a column the user hasn't
  applied yet breaks production (found migration 007 missing this way). Check
  column existence against the live DB before any deploy that touches the schema.
