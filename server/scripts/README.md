# Verification

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

### Not covered

- Email delivery. No SMTP is configured in development, so reset and verification
  tokens are read from the database rather than followed from a message.
- The browser. Page rendering, the access gate's own states, and the registration
  form are exercised by hand — the three defects fixed in `ad79e55` were all found
  that way, and nothing here would have caught them.
- Checkout and the player, which do not exist yet.
