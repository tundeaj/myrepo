# Webinarflix — Roadmap & TODO

Status snapshot as of this document: **948 assertions across 8 suites, all green** (678 e2e + 47 mail + 6 checkout-webhook + 13 payouts-webhook + 8 stripe-webhook + 196 browser), CI passing on every push to PR #1. This file tracks what's built, what's left, and the order the remaining work is planned in. It's updated at the end of each round that closes or adds a gap — treat it as the living source of truth over any single PR description.

---

## 1. What's built

Grouped by area, not chronological order. Everything below has admin CRUD (or a public read path, or both) working end-to-end, is covered by the e2e/browser suites, and is live in the codebase — not stubbed.

**Platform**
Prisma schema, JWT auth + security middleware, admin console shell (sidebar/topbar), dashboard, CI (GitHub Actions running every suite on every push), Redis-backed rate limiting and a real job scheduler (`lib/redis.ts`, `lib/scheduler.ts`).

**Public site & viewer accounts**
Homepage engine (hero carousel, rows), browse/detail/speaker pages, category browsing, registration/sign-in/reset/verify flows, account management (profile, preferences, devices, consent, notification preferences — all ten `NOTIFICATION_EVENT_KEYS`, seeded at signup), a real EN/FR language switcher (stored client preference, `PublicNav`'s `LanguageToggle`) wired to Pages, FAQs, and rating comments.

**Commerce**
Checkout & entitlements over both Paystack (NGN) and Stripe (USD), coupons, subscriptions with plan management, invoices.

**Content delivery**
Signed short-lived playback URLs with concurrency limits, chapters/subtitles, Go Live → public "LIVE NOW" pipeline, real meeting-provider integration (Zoom/Teams/Google Meet/Jitsi) with its own subscription-attribution fix for non-native sessions.

**Revenue operations**
Earnings accrual (with a real scheduled holdback sweep, not just a lazy one), payouts admin workflow, the payouts transfer webhook, a reversed-earning admin reinstate action (the manual, investigate-first path back to payable), subscription revenue accrual (manual admin-run, explicitly a stated simplification — see §3).

**Content operations**
Ratings (viewer submission + aggregate recompute) with comment moderation — reviewer email notifications, bulk approve/reject, and an admin-authored French translation field — FAQs (admin CRUD + public read path, with real per-user helpful-vote dedup for signed-in viewers), Contact Requests (public form + admin inbox, with a real teammate picker for assignment), Categories, Sponsors/Advertisers/Ads, content-sponsor linking with public display across all three placements — session_page ("Sponsored by" on the detail page), player (video overlay badge), and hero (homepage carousel badge) — Promotions (site-wide promo banners on the public homepage), Pages (simple static pages — About/Terms/Privacy/landing pages — at `/p/:slug`, one editor backing both the Pages and Landing Pages nav entries), Bulk Import/Export (dependency-free CSV export + per-row, never-all-or-nothing import for Speakers and Categories), Community (Spaces, Posts & one-level Replies, admin-moderated before anything shows publicly, at `/community`), Orders (a general, filterable admin list across every checkout transaction), and Player/PPV Analytics (real PlaybackSession telemetry and real Order/EarningLine-derived pay-per-view revenue, each read-only and real-data-only).

**Admin management**
Users (list/detail/role management, with self-demotion and last-admin guards), Registrations (list/filter/status), Speakers (full CRUD).

**Discovery**
Trending hero carousel — admin-ordered, Netflix-style scrolling teasers — plus one-click "recently popular" suggestion chips ranked by real watch activity.

---

## 2. Roadmap — remaining gaps, sequenced

Phases are ordered by what unblocks fastest with the least new infrastructure. Each item names the file(s) most likely to change, so this doubles as a work-entry point.

### Phase A — Quick wins (small, self-contained, no new infrastructure) — ✅ done
- [x] **FAQ helpful-votes have no per-user dedup** — `routes/faqs.ts` + `FaqVote` model. Signed-in viewers get real, server-enforced dedup (first vote counts, repeat is a no-op, a flip moves the count); anonymous stays an honest one-vote-per-click, stated as such rather than faked.
- [x] **No teammate picker for contact-request assignment** — `assigned_to` now validates against a real, active, non-viewer account (instructor/admin/super_admin) server-side, and the admin UI's raw numeric-id input is a real picker sourced from `GET /users`.
- [x] **`player` and `hero` sponsorship placements have no public display** — `lib/sponsors.ts`'s shared `resolveActiveSponsors()` now backs all three placements. `Player.tsx` gets a video-overlay badge, `Hero.tsx` gets a carousel badge alongside its LIVE/countdown badges. Found and fixed a real, pre-existing bug along the way: the hero's rotation-indicator pills had no `z-index`, so the content row overlapping the hero's bottom edge (`-mt-8`/`-mt-16`, `z-10`) sat on top of them and made them unclickable for any real visitor at sm+ widths, not just the new browser test.

### Phase B — Medium (admin UI + backend work, no new infrastructure) — ✅ done
- [x] **No reviewer notification on approve/reject** — `routes/ratings.ts`'s moderation `PUT` now emails the comment's own author on a real status transition (approved → "is now live" with a link to the content page; rejected → explains why, reassures them the star rating is unaffected), via the same `sendMail()`/`publicUrl()` pattern every other transactional email already uses. Re-approving an already-approved comment still succeeds but doesn't re-send.
- [x] **No bulk moderation actions** — `routes/ratings.ts`'s new `POST /ratings-moderation/bulk` shares its actual write (`moderateOne`) with the single-item route, so the two can never drift apart; one bad id in a batch degrades only itself, never the rest. `RatingComments.tsx` gets a per-row checkbox, a "Select all," and an "Approve N"/"Reject N" bar.
- [x] **No French-language review display** — re-scoped after investigating: the original framing assumed every other `_fr` field was already visible to French-speaking visitors and ratings was the one outlier missing a column. It isn't — confirmed `publicI18n.tsx` hardcodes `language` to `"en"` with no switcher anywhere on the public site, for any content type. Checked with the user before building; shipped the narrow piece — `Rating.comment_fr` + a moderation-queue textarea, exactly matching every other `_fr` field's existing shape — and recorded the real, larger gap below instead of quietly assuming a display mechanism that doesn't exist.

### Phase C — `PlaceholderPage` routes — ✅ done
Each was its own scoped project (schema check → routes → admin UI → e2e/browser). All 6 placeholder routes, across 6 scoped projects, are now real, built pages — none render `PlaceholderPage` anymore.
- [x] **Promotions** — re-scoped first, same as the French-review item: the placeholder note just said "a future CMS prompt" with zero schema, genuinely undefined unlike every prior gap. Checked with the user, built as site-wide promo banners — new `Promotion` model, `routes/promotions.ts` admin CRUD, `homepageCache.ts`'s `buildActivePromotion()` (highest-priority, in-window promotion, "home" surface only), `pages/promotions/Promotions.tsx`, and `public/components/PromoBanner.tsx` on the public homepage.
- [x] **Pages / Landing Pages** — also undefined (same "future CMS prompt" note). Checked with the user: simple static pages only (title + rich HTML body + SEO fields + published toggle), not a block builder, and one model/editor backs both nav entries. New `Page` model, `routes/pages.ts` (admin CRUD + `publicPagesRouter` at `/api/public-pages/:slug`), `pages/pages/Pages.tsx` mounted at both `/admin/pages` and `/admin/landing-pages`, and `public/StaticPage.tsx` at `/p/:slug`.
- [x] **Bulk Import / Export** — also undefined (same "future data-tools prompt" note). Checked with the user: CSV export + import scoped to the two simplest flat entities already in the schema, Speakers and Categories — not every entity, not a generic import framework. New dependency-free `lib/csv.ts` (RFC 4180-style quoting, hand-rolled since this codebase avoids new npm deps for narrowly-scoped features), `routes/bulkImport.ts` (admin CRUD-adjacent export/import endpoints, 500-row cap, per-row created/failed reporting — one bad row never blocks the rest, same principle as ratings bulk-moderation), `pages/bulkImport/BulkImport.tsx`.
- [x] **Community (Spaces, Posts & Moderation)** — unlike the three items above, this one had real schema waiting: `community_spaces`/`space_members`/`space_posts`/`post_comments` existed since the original seed, untouched by any route. Checked with the user: lightweight discussion threads — a `SpacePost` is a top-level post, a `PostComment` is its one level of reply (the schema itself is the depth limit, not extra validation code). Every post/reply starts `pending` and is invisible publicly until approved. New `CommunityPostStatus` enum + `status` columns (migration), `routes/community.ts` (`communitySpacesRouter`, `communityModerationRouter` — merged post+comment queue, pin, bulk — and `publicCommunityRouter`), `pages/community/{CommunitySpaces,CommunityModeration}.tsx`, `public/Community.tsx` at `/community` and `/community/:slug`. Also wires up `community_reply`, a `NOTIFICATION_EVENT_KEYS` entry that had sat unused since that file was introduced — the post's author is now emailed when their reply is approved, gated on their own notification-preference row when one exists.
- [x] **Subscriptions & Orders** — claimed "Prompt 07 — Settings & Modules" as its builtIn, unlike the other Phase C items' "a future prompt" — and unlike those, half of it really was already built: `subscriberAnalyticsRouter` already covers Subscriptions (list/filter/cancel/CSV export) at `/admin/analytics/subscribers`. Checked with the user: build the missing half only — a general, filterable Orders list across every `order_type` (not just `routes/invoices.ts`'s narrow `corporate_invoice` slice) — and link to the existing Subscriptions page rather than duplicating it. New `routes/orders.ts` (read-only, same call Invoices/Subscriber Analytics both already make for their own lists), `pages/orders/Orders.tsx` at `/admin/subscriptions-orders`.
- [x] **Player / PPV Analytics** — also undefined (same "a future analytics prompt" note). Investigated what's actually measurable from `PlaybackSession` today (device_type, watch_seconds, completion_pct, buffering, quality_changes — all real, all written on every heartbeat) versus schema-provisioned but never-populated columns (os/browser/country/region/network_type/bitrate/load_time) and dead schema (`ContentUsage.revenue_ngn`). Checked with the user: two pages, real data only — `routes/playerAnalytics.ts` (session telemetry aggregates + device mix + top content) and `routes/ppvRevenue.ts` (real PPV revenue from `Order`/`EarningLine`, NGN and USD always reported separately, never summed), `pages/analytics/{PlayerAnalytics,PpvRevenue}.tsx` at the two existing nav routes.

### Phase D — Cross-cutting / infrastructure (bigger, may need a product or infra decision first) — in progress
Phase C is fully closed. Each item below is a bigger, cross-cutting gap rather than a single scoped project. The user reprioritized this phase explicitly (see the order below) after weighing money-correctness, legal/trust, and launch-readiness against each item's actual cost — this list order is now the authoritative sequence, not "pick one."

1. [x] **Scheduler infrastructure + Redis-backed rate limiting** — money correctness: reversed-earning payback and timed status transitions both depended on this. One infra decision served both (a job queue needs Redis anyway). New `lib/redis.ts` (shared `ioredis` connection) and `lib/scheduler.ts` (BullMQ Queue+Worker, in-process — this app's deployment shape is a single instance). `lib/rateLimit.ts`'s `checkRateLimit()` moved off in-process memory onto the same Redis instance (same interface, now async). The one real timed-status-transition this app had: `sweepHoldback()` (accruing→payable once an `EarningLine`'s holdback window elapses) now runs on an actual repeatable job (every 15 min), not just lazily on admin page load. Subscription revenue accrual deliberately stays manual, not automated by the new scheduler — a product decision, not a missing-infrastructure gap. Also closed the other half of the old "no path back from a reversed earning to payable" gap: new `EarningLine.reversed_at` column, new admin `GET /payouts/earnings/reversed` + `POST /payouts/earnings/:id/reinstate` (requires a reason, clears the stale `payout_line_id` so it's genuinely re-eligible), and a "Reversed earnings" panel on the admin Payouts page.
2. [x] **Notification-preferences UI** — consent/opt-out, a legal and trust requirement before emailing or pushing real users. `notification_preferences` + `PUT /account/notifications` already existed (and `GET /account` already returned them) — the gap was no UI and no row seeded at signup. `routes/auth.ts`'s `/register` now seeds one row per `NOTIFICATION_EVENT_KEYS` entry (`email` channel only — the only channel anything in this app actually sends through; `in_app`/`whatsapp` exist on the schema's enum but nothing sends via either yet). New "Notifications" section on the public `Account.tsx` page, all ten events with a label + description, writing through the existing endpoint. Found and fixed a real, pre-existing bug along the way: `routes/ppvRevenue.ts`'s "top content" ranked NGN and USD orders in one combined query/cutoff, so a USD order was compared numerically against NGN amounts on the same scale and systematically lost — fixed by ranking per currency independently, then merging.
3. [ ] **Image upload widgets** — every media reference is a plain URL text field; needed for a credible launch (speaker photos, thumbnails). Storage-backend decision: check Bunny Storage first, since Bunny Stream is already in use for delivery — likely the natural fit before reaching for S3/ImageKit.
4. [ ] **Most `_fr` fields still have no switcher coverage** — `ContentItem`, `Category`, `Speaker`, `CourseModule`/`CourseLesson`, `Chapter`, `FooterLink` are all still admin-authored and stored but never rendered in French (the language-switcher round only reached `Page`, `Faq`, `Rating.comment_fr`). Deprioritized: only valuable if launching in Francophone markets — validate Nigeria first.
5. [ ] **SSR** — for public pages that need search visibility; explicitly skip it for logged-in screens.
6. [ ] **Google Calendar/Outlook sync** — a convenience feature, not launch-blocking.
7. [ ] **`PromoBanner`, `CmsPage`, and `LandingPage` are unused, richer pre-existing schema for concepts already shipped more narrowly** — discovered while scoping Community: `PromoBanner` (multi-placement + audience targeting + impression/click counters) is a materially richer, never-wired version of the `Promotion` model the Promotions round built instead; `CmsPage` + `LandingPage` were meant to be two distinct models, not the single `Page` model the Pages round built to back both nav entries. Confirmed with the user: leave `Promotion`/`Page` shipped as-is — reconcile only if the product actually needs the extra fields.

**Dropped:** ~~Stripe Connect for speaker payouts~~ — not being built; checkout (money in) stays Stripe-alongside-Paystack, payouts (money out) stays Paystack-only.

**New context for a future round:** WebinarFlix needs live sessions inside the app at launch for native meeting capability — the direction is Agora. Not yet scoped or built; the existing Zoom/Teams/Google Meet/Jitsi integration (§3's "can't be verified against real APIs in this sandbox" item) is untouched by this for now. Investigate and check scope before building, same discipline as every item above.

**Phase E (deliberate decisions — not gaps)**: unaffected by this reprioritization. See §3 below.

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
