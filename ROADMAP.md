# Webinarflix — Roadmap & TODO

Status snapshot as of this document: **870 assertions across 8 suites, all green** (631 e2e + 47 mail + 6 checkout-webhook + 12 payouts-webhook + 8 stripe-webhook + 166 browser), CI passing on every push to PR #1. This file tracks what's built, what's left, and the order the remaining work is planned in. It's updated at the end of each round that closes or adds a gap — treat it as the living source of truth over any single PR description.

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
Ratings (viewer submission + aggregate recompute) with comment moderation — reviewer email notifications, bulk approve/reject, and an admin-authored French translation field — FAQs (admin CRUD + public read path, with real per-user helpful-vote dedup for signed-in viewers), Contact Requests (public form + admin inbox, with a real teammate picker for assignment), Categories, Sponsors/Advertisers/Ads, content-sponsor linking with public display across all three placements — session_page ("Sponsored by" on the detail page), player (video overlay badge), and hero (homepage carousel badge) — Promotions (site-wide promo banners on the public homepage), Pages (simple static pages — About/Terms/Privacy/landing pages — at `/p/:slug`, one editor backing both the Pages and Landing Pages nav entries), Bulk Import/Export (dependency-free CSV export + per-row, never-all-or-nothing import for Speakers and Categories), Community (Spaces, Posts & one-level Replies, admin-moderated before anything shows publicly, at `/community`), and Orders (a general, filterable admin list across every checkout transaction).

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

### Phase C — `PlaceholderPage` routes still unbuilt (1 remaining)
Each is its own scoped project (schema check → routes → admin UI → e2e/browser), same shape as every closed gap above. Suggested order, easiest first:
- [x] **Promotions** — re-scoped first, same as the French-review item: the placeholder note just said "a future CMS prompt" with zero schema, genuinely undefined unlike every prior gap. Checked with the user, built as site-wide promo banners — new `Promotion` model, `routes/promotions.ts` admin CRUD, `homepageCache.ts`'s `buildActivePromotion()` (highest-priority, in-window promotion, "home" surface only), `pages/promotions/Promotions.tsx`, and `public/components/PromoBanner.tsx` on the public homepage.
- [x] **Pages / Landing Pages** — also undefined (same "future CMS prompt" note). Checked with the user: simple static pages only (title + rich HTML body + SEO fields + published toggle), not a block builder, and one model/editor backs both nav entries. New `Page` model, `routes/pages.ts` (admin CRUD + `publicPagesRouter` at `/api/public-pages/:slug`), `pages/pages/Pages.tsx` mounted at both `/admin/pages` and `/admin/landing-pages`, and `public/StaticPage.tsx` at `/p/:slug`.
- [x] **Bulk Import / Export** — also undefined (same "future data-tools prompt" note). Checked with the user: CSV export + import scoped to the two simplest flat entities already in the schema, Speakers and Categories — not every entity, not a generic import framework. New dependency-free `lib/csv.ts` (RFC 4180-style quoting, hand-rolled since this codebase avoids new npm deps for narrowly-scoped features), `routes/bulkImport.ts` (admin CRUD-adjacent export/import endpoints, 500-row cap, per-row created/failed reporting — one bad row never blocks the rest, same principle as ratings bulk-moderation), `pages/bulkImport/BulkImport.tsx`.
- [x] **Community (Spaces, Posts & Moderation)** — unlike the three items above, this one had real schema waiting: `community_spaces`/`space_members`/`space_posts`/`post_comments` existed since the original seed, untouched by any route. Checked with the user: lightweight discussion threads — a `SpacePost` is a top-level post, a `PostComment` is its one level of reply (the schema itself is the depth limit, not extra validation code). Every post/reply starts `pending` and is invisible publicly until approved. New `CommunityPostStatus` enum + `status` columns (migration), `routes/community.ts` (`communitySpacesRouter`, `communityModerationRouter` — merged post+comment queue, pin, bulk — and `publicCommunityRouter`), `pages/community/{CommunitySpaces,CommunityModeration}.tsx`, `public/Community.tsx` at `/community` and `/community/:slug`. Also wires up `community_reply`, a `NOTIFICATION_EVENT_KEYS` entry that had sat unused since that file was introduced — the post's author is now emailed when their reply is approved, gated on their own notification-preference row when one exists.
- [x] **Subscriptions & Orders** — claimed "Prompt 07 — Settings & Modules" as its builtIn, unlike the other Phase C items' "a future prompt" — and unlike those, half of it really was already built: `subscriberAnalyticsRouter` already covers Subscriptions (list/filter/cancel/CSV export) at `/admin/analytics/subscribers`. Checked with the user: build the missing half only — a general, filterable Orders list across every `order_type` (not just `routes/invoices.ts`'s narrow `corporate_invoice` slice) — and link to the existing Subscriptions page rather than duplicating it. New `routes/orders.ts` (read-only, same call Invoices/Subscriber Analytics both already make for their own lists), `pages/orders/Orders.tsx` at `/admin/subscriptions-orders`.
- [ ] Player / PPV Analytics (needs a decision on what's actually measurable from `PlaybackSession` today vs. what would need new instrumentation) *— up next.*

### Phase D — Cross-cutting / infrastructure (bigger, may need a product or infra decision first)
- [ ] **No public-facing language switcher exists, for any content type** — discovered while scoping the ratings French-display item: every `_fr` field across the schema (FAQs, content titles, categories, speakers, ...) is already admin-authored and stored, but `web/src/public/lib/publicI18n.tsx` hardcodes `language` to `"en"` with no toggle, URL scheme, or persistence anywhere. Needs a product decision (URL path vs. query param vs. a nav toggle + storage) before any UI work starts — ratings' own `comment_fr` (closed this round) is just one more field waiting on the same missing mechanism.
- [ ] **No image upload widgets** — every media reference is a plain URL text field. Needs a storage-backend decision (S3-compatible? ImageKit, already referenced elsewhere for delivery?) before any UI work starts.
- [ ] **Rate limiting is in-process** — needs Redis (or equivalent) before a multi-instance deploy; `lib/rateLimit.ts` is the single choke point to swap.
- [ ] **No scheduler infrastructure** — blocks both "no path back from a reversed earning to payable" and "no scheduled/time-based status transitions anywhere." One infra decision (cron? a queue?) would unblock both.
- [ ] **Stripe Connect for speaker payouts is not built** — checkout (money in) exists; payouts (money out) is still Paystack-only.
- [ ] **Google Calendar/Outlook sync, SSR** — both large, both unchanged since early rounds.
- [ ] **`PromoBanner`, `CmsPage`, and `LandingPage` are unused, richer pre-existing schema for concepts already shipped more narrowly** — discovered while scoping Community: the schema already had `CommunitySpace`/`SpaceMember`/`SpacePost`/`PostComment` sitting untouched (same "nothing ever wrote to it" shape as `Rating` before this build), so this round builds on those directly instead of inventing new models. But checking that turned up two more: `PromoBanner` (multi-placement via `PromoPlacement` — home_top/home_mid/category/session_page/account — plus `PromoAudience` targeting and impression/click counters) is a materially richer, never-wired version of the `Promotion` model the Promotions round built instead; and `CmsPage` + `LandingPage` were meant to be two distinct models (a simple static page with `is_system_page`, vs. a UTM-tracked marketing page with hero/CTA/conversion counters and `is_front_page`), not the single `Page` model the Pages round built to back both nav entries. Confirmed with the user: leave `Promotion`/`Page` shipped as-is rather than rework already-verified, merged-toward code — reconcile onto the richer models only if the product actually needs multi-placement promo targeting or UTM-tracked landing pages. (`BulkImport` was also found unused but checked out as a genuinely different feature — `BulkImportType` is `users | enrol | register`, an async job-log for bulk-enrolling viewers, not Speakers/Categories CSV — so no overlap there.)
- [ ] **No notification-preferences UI exists for a viewer to see or toggle any of it** — discovered while wiring `community_reply` (see Phase C): `notification_preferences` and the `PUT /account/notifications` endpoint it drives have existed since early in this build, and all ten `NOTIFICATION_EVENT_KEYS` are real, named events — but no row is ever seeded at signup, and `Account.tsx` has no section rendering or writing to any of them. `community_reply` is the first event any code path actually checks (gated correctly, default-enabled when no row exists) — but a viewer still has no way to find the toggle and turn it off. Needs the same kind of product check Promotions/Pages/Bulk Import/Community each got before building: is this a flat list of ten on/off switches, grouped by category, or something narrower.

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
