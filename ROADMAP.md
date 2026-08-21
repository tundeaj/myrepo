# Webinarflix — Roadmap & TODO

Status snapshot as of this document: **661 assertions across 8 suites, all green**, CI passing on every push to PR #1. This file tracks what's built, what's left, and the order the remaining work is planned in. It's updated at the end of each round that closes or adds a gap — treat it as the living source of truth over any single PR description.

---

## 1. What's built

Grouped by area, not chronological order. Everything below has admin CRUD (or a public read path, or both) working end-to-end, is covered by the e2e/browser suites, and is live in the codebase — not stubbed.

**Platform**
Prisma schema, JWT auth + security middleware, admin console shell (sidebar/topbar), dashboard, CI (GitHub Actions running every suite on every push).

**Public site & viewer accounts**
Homepage engine (hero carousel, rows), browse/detail/speaker pages, category browsing, registration/sign-in/reset/verify flows, account management (profile, preferences, devices, consent).

**Commerce**
Checkout & entitlements over both Paystack (NGN) and Stripe (USD), coupons, subscriptions with plan management, invoices.

**Content delivery**
Signed short-lived playback URLs with concurrency limits, chapters/subtitles, Go Live → public "LIVE NOW" pipeline, real meeting-provider integration (Zoom/Teams/Google Meet/Jitsi) with its own subscription-attribution fix for non-native sessions.

**Revenue operations**
Earnings accrual, payouts admin workflow, the payouts transfer webhook, subscription revenue accrual (manual admin-run, explicitly a stated simplification — see §3).

**Content operations**
Ratings (viewer submission + aggregate recompute) with comment moderation, FAQs (admin CRUD + public read path, with real per-user helpful-vote dedup for signed-in viewers), Contact Requests (public form + admin inbox), Categories, Sponsors/Advertisers/Ads, content-sponsor linking with its public "Sponsored by" display (session_page placement).

**Admin management**
Users (list/detail/role management, with self-demotion and last-admin guards), Registrations (list/filter/status), Speakers (full CRUD).

**Discovery**
Trending hero carousel — admin-ordered, Netflix-style scrolling teasers — plus one-click "recently popular" suggestion chips ranked by real watch activity.

---

## 2. Roadmap — remaining gaps, sequenced

Phases are ordered by what unblocks fastest with the least new infrastructure. Each item names the file(s) most likely to change, so this doubles as a work-entry point.

### Phase A — Quick wins (small, self-contained, no new infrastructure)
- [x] **FAQ helpful-votes have no per-user dedup** — `routes/faqs.ts` + `FaqVote` model. Signed-in viewers get real, server-enforced dedup (first vote counts, repeat is a no-op, a flip moves the count); anonymous stays an honest one-vote-per-click, stated as such rather than faked.
- [ ] **No teammate picker for contact-request assignment** — `routes/contactRequests.ts`, `pages/contactRequests/*`; `assigned_to` already exists on the schema, just needs a picker sourced from admin/instructor users. *Up next.*
- [ ] **`player` and `hero` sponsorship placements have no public display** — natural extension of the just-shipped `session_page` display; `Player.tsx` needs an overlay treatment, `Hero.tsx` needs a hero-appropriate badge. Two separate small changes, not one.

### Phase B — Medium (admin UI + backend work, no new infrastructure)
- [ ] **No reviewer notification on approve/reject** — hook into the existing mail sender (see `lib/mail.ts` and its `test:mail` suite) from `routes/ratings.ts`'s moderation actions.
- [ ] **No bulk moderation actions** — `pages/moderation/RatingComments.tsx` + a batch endpoint alongside the existing single-item approve/reject.
- [ ] **No French-language review display** — `title_fr`/`answer_html_fr`-style columns already exist elsewhere as a pattern; ratings' `comment` has no `_fr` column yet, so this starts with a schema decision, not just UI.

### Phase C — `PlaceholderPage` routes still unbuilt (9 remaining)
Each is its own scoped project (schema check → routes → admin UI → e2e/browser), same shape as every closed gap above. Suggested order, easiest first:
- [ ] Promotions
- [ ] Pages / Landing Pages (two related, likely worth doing together)
- [ ] Bulk Import
- [ ] Community × 2
- [ ] Subscriptions & Orders (overlaps existing Payouts/Invoices — needs a scoping pass to avoid duplicating what those already cover)
- [ ] Player / PPV Analytics (needs a decision on what's actually measurable from `PlaybackSession` today vs. what would need new instrumentation)

### Phase D — Cross-cutting / infrastructure (bigger, may need a product or infra decision first)
- [ ] **No image upload widgets** — every media reference is a plain URL text field. Needs a storage-backend decision (S3-compatible? ImageKit, already referenced elsewhere for delivery?) before any UI work starts.
- [ ] **Rate limiting is in-process** — needs Redis (or equivalent) before a multi-instance deploy; `lib/rateLimit.ts` is the single choke point to swap.
- [ ] **No scheduler infrastructure** — blocks both "no path back from a reversed earning to payable" and "no scheduled/time-based status transitions anywhere." One infra decision (cron? a queue?) would unblock both.
- [ ] **Stripe Connect for speaker payouts is not built** — checkout (money in) exists; payouts (money out) is still Paystack-only.
- [ ] **Google Calendar/Outlook sync, SSR** — both large, both unchanged since early rounds.

### Phase E — Deliberate, not gaps to close
These are stated design decisions from earlier rounds, not oversights. Re-litigate only if the product direction actually changes:
- Trending is global, not personalized (Netflix's hero is algorithm-driven; this platform's is business/marketing-curated on purpose).
- The suggestions window (7 days) is a fixed, honest default, not a new Settings Hub field.
- No automated popularity signal is a *default* order for Trending — suggestions is a nudge, not a ranking.
- Subscription revenue accrual is a stated simplification.
- Non-native attendance is a credited estimate (fixed per-ping credit), not a real watch-time measurement.
- `content_items.view_count` is dead schema — Trending suggestions correctly ranks by real `PlaybackSession`/`MeetingAttendance` activity instead of this column.
- Stripe checkout, and Zoom/Teams/Google Meet, cannot be verified against their real APIs in this sandbox (no credentials) — same accepted gap Paystack already has.
- No lockfile (`package-lock.json` gitignored repo-wide) — pre-existing, unrelated to any of the above.

---

## 3. Working discipline (for whoever picks up the next item)

- **Verify before claiming done**: typecheck both sides, run `test:e2e` and `test:browser` to a clean pass, and negative-control at least one real invariant per round (break it, confirm the dedicated assertion catches it, restore, reconfirm green).
- **State boundaries explicitly** rather than silently under-scoping — every closed gap above that had a stated boundary (e.g. content-sponsor linking → public display) got picked up as the very next round's work. Do the same: if a fix is deliberately partial, say so in the code comment and in this file's Phase list.
- **Global, not fixture-scoped, test data**: e2e assertions must hold against the live, shared seed database — assert relative order/structural invariants among a test's own fixtures, never fixed absolute counts.
- **Update this file and the PR body** at the end of each round — assertion counts, the Known Gaps list, and the phase this round's work moved between.
