# Verification

Three suites, 135 assertions. None of them is a unit test, deliberately — every
defect this project has shipped was invisible to `tsc`.

| Suite | Where | Count | Catches |
|---|---|---|---|
| `npm run test:e2e` | `server/` | 92 | access ladder, enumeration, payload allowlists, escalation |
| `npm run test:mail` | `server/` | 23 | messages actually built, sent and their links followed |
| `npm run test:browser` | `web/` | 20 | what a person sees — covered elements, colliding boxes |

## `npm run test:e2e`

Drives the running API over HTTP against a real PostgreSQL database. 92 assertions
across registration, login, password reset, the five-level access ladder,
registrations, the account surface, and the public payload allowlists.

This is not a unit-test suite, deliberately. Every defect this project has shipped
so far was invisible to `tsc` — a migration nobody had applied, a gradient painted
over a button, a seed that produced an empty hero. The server-side equivalents are
an access branch that grants when it should refuse and a payload carrying a column
it shouldn't, so those are what this checks.

### Running it

```bash
# 1. a database
initdb -D <dir> -U postgres --auth=trust
pg_ctl -D <dir> -o '-p 5433 -k /tmp' start
createdb -h /tmp -p 5433 -U postgres webinarflix

export DATABASE_URL="postgresql://postgres@localhost:5433/webinarflix?host=/tmp"

# 2. schema and reference data
npm run db:deploy
npm run db:seed

# 3. the API, in another shell, on the SAME DATABASE_URL
npm run dev

# 4. the suite
npm run test:e2e
```

`API` overrides the base URL (default `http://127.0.0.1:4000`).

### What it assumes

- The seed has run — it uses the seeded plan and the `ada-okafor` speaker.
- The API points at the same `DATABASE_URL`, since some assertions read rows
  directly (a reset token's hash, whether a cancelled registration was kept).

### What it writes

Fixtures are namespaced with a run id and deleted at the end. It is safe to run
repeatedly against a development database.

**Never point it at production.** It creates users, content and subscriptions, and
mutates the seeded speaker's content. There is no guard against this beyond the
`DATABASE_URL` you give it.

### Keeping it honest

A suite that cannot fail is worse than none, so both halves have been checked by
deliberately breaking the code and confirming the assertion fires:

- dropping `source: "cohort"` from the cohort branch → *"a non-cohort entitlement
  does NOT unlock cohort content"* fails
- adding `stream_key` to `DETAIL_SELECT` → *"detail payload excludes stream_key"*
  fails

Do that again whenever you add a section. An assertion nobody has watched fail is
a guess.

---

## `npm run test:mail`

Stands up a real SMTP server in-process, rewrites the `notifications.smtp_*`
settings to point at it, and follows the links out of the delivered messages the
way a person would. The main suite reads reset tokens straight from
`auth_tokens`, which proves the token machinery but says nothing about whether a
message is ever built, addressed and sent.

Restores the settings on the way out, including on failure. Nothing leaves the
process: the capture server accepts every envelope and delivers nothing onward.

Covers: the verification email arrives with a working link; sign-in is refused
until that link is followed; the emailed token is *not* the stored hash; the
reset link works; **no email is sent to an unknown address**, closing enumeration
on the mail channel as well as the HTTP one; and the account owner is told when
their password changes.

`SMTP_PORT` overrides the capture port (default 2525).

---

## `npm run test:browser` (in `web/`)

The class of defect nothing else here catches. Three bugs shipped that `tsc`, the
build and the API suite all passed clean — a gradient painted over the detail
page's entire access gate, a row header landing on the hero's CTAs, and a public
page titled "Webinarflix Admin".

`toBeVisible()` would not have caught the first two either: an element covered by
another is still "visible" to the DOM. So the assertions ask what a person sees —
`elementFromPoint` at an element's own centre to detect covering, and true 2D
box intersection to detect collision.

Needs the web dev server and the API running. `CHROMIUM_PATH` overrides the
browser binary when the bundled build doesn't match the installed Playwright.

Both regression assertions were confirmed by reverting the fixes:

- removing `relative z-10` from `Detail.tsx` → *"the detail title is not covered
  by the gradient overlay"* fails, naming `div.absolute.inset-0.bg-gradient-to-t`
- restoring `sm:pb-12` on the hero → *"no hero control overlaps the first row
  header"* fails, reporting `Register Free` bottom 600 against heading top 596

The second assertion was **wrong on its first two attempts** and passed against
known-broken code both times: first it picked a zero-size hidden mobile-menu
button as "the CTA", then a vertical-only comparison tripped over the hero's
slide-indicator pips, which sit bottom-right and legitimately extend past a
left-aligned heading. It only became a test once it failed on the bug it was
written for. That is the whole reason for the negative-control habit.

---

### Not covered

- **Google and Outlook calendar sync.** Needs real OAuth credentials and a
  third-party consent flow; there is no way to exercise it here, and no schema
  column to store the tokens even if there were.
- **Checkout and the player**, which do not exist yet.
- **Deliverability.** The mail suite proves a message is built and sent
  correctly. Whether a real provider accepts it — SPF, DKIM, reputation — is not
  something a capture server can tell you.
