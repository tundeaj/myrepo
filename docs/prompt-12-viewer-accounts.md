# PROMPT 12 — VIEWER ACCOUNTS & ACCESS GATE

*Drafted from the schema and settings already in the repo, not from the master prompt —
the master prompt ends at Prompt 10. Every table, column, enum and setting referenced
below already exists unless explicitly marked **NEW**.*

*Was Prompt 11; renumbered when the detail page moved ahead of it. The content is
unchanged apart from this section and the `resolveAccess` handover.*

---

## What this picks up

Prompt 11 built the public site's pages and wrote `resolveAccess` with its signed-out
branch complete. This prompt gives the platform actual people: accounts, free
registration, and the four signed-in branches of the access ladder that Prompt 11 left
as explicit `TODO(prompt-12)` throws.

Everything downstream needs it. The detail page can currently only say "sign in to
continue"; the player in Prompt 14 cannot issue a signed URL to nobody; checkout has no
one to attach an entitlement to. All of it reduces to "who is this person and what may
they see".

⚠️ **The migration described below is the first one this project has ever applied against
a real database.** Budget for that rather than assuming it is a formality.

---

## What already exists

| Concern | In place |
|---|---|
| Login + `/auth/me` | `server/src/routes/auth.ts` — 44 lines, JWT, bcrypt, `serializeUser` |
| User record | `users` — role, country, timezone, language, industry, job_role, company_name, headline, bio, `email_verified`, `is_active`, `parent_account_id`, `seat_status` |
| Free registration | `registrations` — unique on `(user_id, content_id)`, `join_token`, `custom_answers`, three reminder-sent flags |
| Paid access | `entitlements` (source: purchase / subscription / cohort / admin_grant, optional `expires_at`), `subscriptions`, `orders`, `plans` |
| Consent | `consent_records` — policy_key, policy_version, accepted_at, ip_address, user_agent, consent_method |
| Dynamic signup form | `signup_fields` — field_key, label, field_type, context, is_required, display_order, options, help_text |
| Preferences | `user_preferences` (one row per user), `notification_preferences`, `user_devices` |
| Gate policy | `registration.guest_viewing` = blocked / **soft_gate** / open |
| Flow shape | `registration.signup_flow` = single_step / **multi_step** |
| Session policy | `registration.session_timeout_days` (30), `registration.sensitive_reauth_minutes` (15) |
| Verification policy | `registration.email_verification` (off by default), `registration.free_registration` (on) |

## What is missing and needs a migration

Three items. The first two are blockers for this prompt; the third is pre-existing drift
that has to ship in the same migration anyway.

1. **NEW table `auth_tokens`** — there is no password-reset or email-verification token
   store anywhere in the schema. Columns: `id`, `user_id`, `token_hash VarChar(64)`,
   `purpose ENUM('password_reset','email_verification')`, `expires_at`, `consumed_at`,
   `created_at`. Index on `token_hash` and `user_id`. Store a **hash**, never the token
   — a leaked database read otherwise hands over live account-recovery links.

2. **NEW column `consent_records.granted Boolean @default(true)`** — the hard constraints
   say a withdrawal is a new record, never an edit or a delete. The table as it stands
   has no way to *express* a withdrawal: every row means "accepted". Without this column
   the append-only rule is unimplementable. One boolean, and the current consent for a
   policy is the newest row by `accepted_at`.

3. **Pre-existing drift** — `outcomes_json`, `cert_config_json` (Prompt 04) and
   `cancelled_at` (Prompt 07) are in `schema.prisma` but in no migration. The only
   migration is `20260811045641_init`. They must be folded into this one.

⚠️ No migration has ever been applied against a real database in this project. This is
the first prompt where that has to happen for anything to work.

---

## SERVER

### A — Complete the auth surface (`routes/auth.ts`)

Existing `POST /login` and `GET /me` stay as they are. Add:

```
POST /auth/register
  Body: email, password, full_name + whatever signup_fields marks enabled for
  context='public'. Validate against the field definitions, not a hardcoded shape.
  Reject if registration.free_registration is off.
  Password: minimum 10 characters. No composition rules — length beats symbol soup.
  Creates: users row (role='viewer'), user_preferences row, consent_records rows.
  If registration.email_verification is on: create an auth_tokens row, send the mail,
  return the user WITHOUT a token — an unverified account cannot hold a session.
  Otherwise sign in immediately.
  Duplicate email → 409 with "An account with this email already exists." and a link
  to sign in. Do NOT reveal anything more.

POST /auth/logout
  Clears the client token. Server-side this is a no-op with JWTs; the endpoint exists
  so the client has one thing to call and the audit trail has one thing to record.

POST /auth/forgot-password
  ALWAYS returns 200 with the same body, whether or not the email exists. An endpoint
  that 404s on unknown emails is an account-enumeration oracle.
  Rate limit: 5 per email per hour, reusing lib/rateLimit.ts.

POST /auth/reset-password
  Body: token, new_password. Single-use — set consumed_at in the same transaction that
  writes the hash. Expired, consumed and wrong tokens all return the same message.

POST /auth/verify-email
  Body: token. Sets email_verified. Single-use, same rules.

POST /auth/resend-verification
  Rate limited identically to forgot-password.
```

**Session length** comes from `registration.session_timeout_days`, read at sign-in —
`signToken` currently hardcodes `env.JWT_EXPIRES_IN`, which silently ignores the setting
an admin can see and change. Pass the expiry in.

**Sensitive re-auth**: the JWT carries `iat`. Any endpoint that changes email, password
or payout details requires `now - iat < registration.sensitive_reauth_minutes`, else 403
with a code the client can turn into a re-enter-your-password prompt. Applies to the
instructor payout endpoints already built.

### B — Signup fields (`routes/signup.ts`, NEW)

```
GET /signup-fields?context=public    (unauthenticated)
  Returns enabled fields for the context, ordered by display_order.
  Never returns fields for other contexts — checkout and corporate_seat collect
  different things and one of them is behind a payment.
```

`signup_fields` is **not seeded**. Seed the `public` context with: `full_name` (text,
required), `email` (email, required), `password` (password, required), `country`
(select, required, default NG), `industry` (select, optional), `job_role` (text,
optional), `company_name` (text, optional), `phone` (phone, optional).

Multi-step splits at the first optional field: credentials on step one, profile on step
two, and **step two is skippable**. `single_step` renders one form. The split is derived
from the field list, not hardcoded, so an admin reordering fields moves the boundary.

### C — Access resolution (`lib/access.ts`) — finish the signed-in branches

`lib/access.ts` already exists from Prompt 11, with its signature settled and its
signed-out path complete. This prompt fills the four branches left as
`TODO(prompt-12)` throws. **The signature does not change** — every caller written in
Prompt 11 keeps working.

```ts
resolveAccess(userId: number | null, contentId: number): Promise<AccessResult>
```

Already implemented, do not rewrite: `unavailable` for unpublished / inactive / expired;
`public` for open content; `needs_signin` for every gated level when `userId` is null;
`price_ngn` populated for `purchase` content whether or not anyone is signed in.

To implement now, by `content_items.access_level`, for a signed-in user:

- `registered` — needs a confirmed `registrations` row.
  `waitlisted` and `cancelled` do not grant access.
- `subscriber` — needs a `subscriptions` row with status in `active`, `past_due`,
  `paused`. Reuse `LIVE_STATUSES` from `routes/plans.ts` — one definition of "live
  subscription", not two that drift.
- `purchase` — needs an `entitlements` row with `expires_at` null or in the future.
- `cohort` — needs an entitlement with `source='cohort'`. Never inferable from a
  subscription; cohort membership is granted, not bought.

**This function is the only thing permitted to decide access.** No route re-implements
the ladder. When Prompt 14 builds the player, the signed-URL endpoint calls this and
nothing else — a second implementation is how a paywall develops a hole.

Prompt 11 shipped the detail page against the signed-out branch alone. The moment these
four land, every gated item on the public site starts resolving correctly with no change
to the page — which is the test that the seam was drawn in the right place.

⚠️ `join_token` is a capability: possession is access to that session. It is returned
only when `can_view` is true, and never appears in a list response.

### D — Free registration (`routes/registrations.ts`, NEW)

```
POST /registrations        { content_id, custom_answers? }
  Requires sign-in. Only for access_level in ('registered','public').
  Paid tiers 400 — they go through checkout in Prompt 13, and an endpoint that
  hands out free access to paid content is the whole paywall.
  Capacity: if content_items.capacity is set and confirmed registrations have reached
  it, create with status='waitlisted' and say so plainly.
  Closed: registration_closes_at in the past → 409.
  Idempotent — the (user_id, content_id) unique constraint means a double-submit
  returns the existing row rather than a 500.

DELETE /registrations/:id  — sets status='cancelled'. Never deletes: the row carries
  attendance history and reminder state.

GET /registrations/mine    — the viewer's own, upcoming first.
```

### E — Account (`routes/account.ts`, NEW)

```
GET  /account                 profile + preferences + consent state
PUT  /account/profile         the editable users columns only
PUT  /account/preferences     user_preferences (upsert — the row may predate this)
PUT  /account/notifications   notification_preferences
GET  /account/devices         user_devices, newest first
DELETE /account/devices/:id   sets is_active=false — sign out that device
PUT  /account/email           requires sensitive re-auth + re-verification
PUT  /account/password        requires sensitive re-auth
POST /account/consent         writes a NEW consent_records row (granted true or false)
```

⚠️ `consent_records` is append-only. No endpoint updates or deletes a row. Withdrawal is
a new row with `granted=false`. Editing destroys the evidentiary value, which is the
only reason the table exists.

⚠️ Every endpoint scopes by `req.user.sub`. No `user_id` is ever read from a request
body — that is the whole of horizontal privilege escalation in one parameter.

---

## WEB

### Routes

```
/register          multi-step or single-step per setting
/signin            viewer-facing. /login stays as-is for the back office.
/forgot-password   always shows "check your email", regardless
/reset-password    token from the query string
/verify-email      token from the query string, auto-submits
/account           profile · preferences · notifications · devices · consent
/account/registrations   upcoming and past
```

All lazy-loaded. **The public bundle stays under the 150KB gate** — it is currently
66KB JS + 7.3KB CSS, and `/account` must not drag admin components onto the public path.

### The gate component

One `<AccessGate>` reading `resolveAccess`, rendering per `reason`:

| reason | Shown |
|---|---|
| `needs_signin` | Sign in / Create account, returning to this page afterwards |
| `needs_registration` | "Register Free" — one click when already signed in |
| `needs_purchase` | Price and a Buy button (inert until Prompt 13) |
| `needs_subscription` | Plan comparison from `plans`, cheapest qualifying first |
| `not_enrolled` | "This is a cohort programme" + how to join. No purchase path. |
| `unavailable` | Expired or unpublished — say which |

`registration.guest_viewing` controls what a signed-out visitor sees *before* the gate:
`open` shows everything, `soft_gate` shows metadata then prompts, `blocked` sends them
to `/signin` immediately. The homepage already respects `audience` on rows; this extends
the same policy to individual items.

---

## HARD CONSTRAINTS

- **`resolveAccess` is the only access decision in the codebase.** Routes call it. They
  do not re-derive it.
- **Password reset and verification tokens are stored hashed**, single-use, and expire —
  24h for verification, 1h for reset.
- **No account enumeration.** Forgot-password, resend-verification and reset all return
  identical responses for known and unknown addresses.
- **`join_token` never appears in a list response** and never when `can_view` is false.
- **Consent is append-only.** A withdrawal is a new row.
- **`user_id` is never accepted from a request body.**
- **Free registration cannot reach paid content.** The endpoint rejects
  `subscriber`/`purchase`/`cohort` outright rather than checking and hoping.
- **Registrations are cancelled, never deleted** — attendance and reminder state hang
  off them.
- **The 150KB public-payload gate and the two-call first paint hold.** `/account` is a
  separate chunk.

---

## OUT OF SCOPE

Checkout, Paystack payment flows, orders and entitlement granting (**Prompt 13**); the
player, signed URLs, concurrency limits and watermarking (**Prompt 14**). Detail, browse
and speaker pages are already built — Prompt 11. The gate renders a Buy button in this
prompt; it does not yet do anything.

---

## DEFINITION OF DONE

- A visitor can create an account, verify it, sign in, reset a forgotten password, and
  sign out.
- A signed-in viewer can register for a free session, see it in `/account/registrations`,
  and cancel it.
- `resolveAccess` returns the correct reason for all five access levels across
  signed-out, signed-in, registered, subscribed, entitled and cohort viewers.
- Consent history is queryable and shows withdrawal as a distinct later row.
- The migration applies cleanly against a real PostgreSQL database, including the three
  drifted columns.
- `tsc --noEmit` clean both sides; public bundle still under 150KB.
