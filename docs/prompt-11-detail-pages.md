# PROMPT 11 — DETAIL, BROWSE & SPEAKER PAGES

*Drafted from the schema and settings already in the repo — the master prompt ends at
Prompt 10. Every table, column, enum and setting referenced below already exists unless
marked **NEW**.*

*Supersedes the earlier ordering. Viewer accounts move to Prompt 12; the reasoning is in
"Why this comes first" below.*

---

## Why this comes first

The homepage is currently a dead end. Cards link to `/watch/:slug`, tiles to
`/browse/:slug`, speakers to `/speakers/:slug` — none of those routes exist, so the
catch-all in `App.tsx` bounces every click back to `/`. The site looks finished and does
nothing.

Accounts were the obvious first move on dependency order, but they are blocked behind a
migration that has never run against a real database in this project, plus two new schema
objects. Putting the largest unknown in the plan ahead of all visible progress is bad
sequencing. The detail page needs **no migration at all**, and for
`access_level = 'public'` content it is genuinely finished rather than partial.

**This prompt does not stub the access gate.** It writes `resolveAccess` for real and
implements its signed-out branch completely — see section C. Prompt 12 fills in the
signed-in branches. Filling branches is not rework; replacing a fake would be.

---

## SERVER

### A — Public content detail (`routes/content.ts`, NEW)

```
GET /content/:slug          (unauthenticated)
```

Returns one published content item with everything the page renders. Reads the token if
present, so a signed-in viewer gets their own access result from the same call — but the
endpoint never *requires* auth.

**The response shape is a Prisma `select` allowlist, exactly as `homepageCache.ts`
does it.** Not a fetch-then-delete. This endpoint is served to anyone on the internet,
and a `select` means a sensitive column added to `content_items` next year is excluded by
default rather than leaking until someone notices.

Never in the payload, at any access level:

| Excluded | Why |
|---|---|
| `stream_key` | Already the project's hardest rule — reveal is a separate admin-gated POST |
| `playback_id`, `stream_provider` | Playback identifiers belong to the player endpoint in Prompt 13, issued per-viewer |
| `pre_roll_ad_id`, `mid_roll_ad_id`, `mid_roll_offset_seconds` | Ad decisions are made server-side at playback, not published as a manifest |
| `restream_enabled`, `restream_cutoff_minutes` | Operational configuration |
| `created_by`, `last_reviewed_by` | Internal staff identifiers |
| `capacity` (raw) | Publish "X spots left" or nothing — the raw number invites scraping |
| Speaker `email`, `phone`, `bank_*`, `account_*`, `paystack_*`, `commission_pct` | `serializeSpeaker` already masks these; reuse it rather than re-deriving |
| `ContentSpeaker.revenue_share_pct` | Commercial terms between the platform and the speaker |

Included: title, slug, descriptions, artwork with focal point, `content_type`,
`session_format`, `language`, `content_rating`, scheduled time and duration, timezone,
`access_level`, price fields, `avg_rating`, `rating_count`, `view_count`,
`registration_count`, `has_transcript`, `has_chapters`, `is_cohort`,
`cohort_start_date`, `content_last_updated_at`, SEO fields, and `search_tags`.

Plus, in the same call:

- **Speakers** — via `content_speakers` ordered by role then id, each through
  `serializeSpeaker`, carrying `role` from the join.
- **Categories** — via `content_categories`, for breadcrumbs and related content.
- **Curriculum** (courses only) — `course_modules` → `course_lessons` ordered by
  `display_order`. Per lesson: title, `lesson_type`, `is_preview`, and duration. **Lesson
  duration comes from the linked `MediaAsset`, never from `course_lessons.duration_seconds`
  typed by hand** — that rule was set in Prompt 04 and this is the first surface where a
  viewer sees the number. `vod_playback_url` is NOT returned; a preview lesson still goes
  through the player endpoint.
- **Outcomes and certification** — parsed from `outcomes_json` / `cert_config_json`.
- **Session interaction** — `session_config` chat/qa/polls flags, so the page can say
  what the session will be like.
- **Access** — the `AccessResult` from section C.

404 for anything not `status='published'`, plus `is_active=false`, plus `expires_at` in
the past. A draft and a non-existent slug return the same response; a distinct "not
published yet" reply tells a competitor what is coming.

```
GET /content/:slug/related      up to 12 published items sharing a category,
                                excluding this one, newest first
GET /categories/:slug           category + its published content, paginated
GET /speakers/:slug             one speaker via serializeSpeaker + their published content
```

All three reuse `CARD_SELECT` from `lib/homepageCache.ts` for the item lists. One card
payload shape across the whole public site — the `Card` component already consumes it,
and a second shape means two allowlists to keep in step.

### B — Content rating (`content_ratings`) — deliberately out of scope

`content_items` carries `avg_rating` and `rating_count`, but there is **no ratings table
in the schema** — nothing can write those columns. The detail page displays them when
`rating_count > 0` and shows nothing when it is zero. Do not invent a ratings table here;
it needs its own design pass covering who may rate, when, and whether ratings are
moderated.

### C — `resolveAccess` (`lib/access.ts`, NEW) — written for real

```ts
resolveAccess(userId: number | null, contentId: number): Promise<AccessResult>

type AccessResult = {
  can_view: boolean;
  reason: "public" | "registered" | "entitled" | "subscribed" | "cohort"
        | "needs_signin" | "needs_registration" | "needs_purchase"
        | "needs_subscription" | "not_enrolled" | "unavailable";
  preview_seconds: number;      // content_items.free_preview_seconds
  price_ngn: number | null;
  registration_id: number | null;
  join_token: string | null;    // ONLY when can_view is true
}
```

**Implemented completely in this prompt:**

- Unpublished, inactive, or expired content → `unavailable`, whoever is asking.
- `access_level='public'` → `can_view: true`, reason `public`, signed in or not.
- **Any other level with `userId === null` → `needs_signin`.** Not `needs_purchase` or
  `needs_subscription` — a signed-out visitor might already own the thing. The honest
  answer is "sign in and I'll tell you", and it is the correct answer for all four
  gated levels.
- `price_ngn` is populated whenever `access_level='purchase'`, **including when signed
  out**. The price is public information — the homepage already prints it on cards. The
  gate is the buying, not the knowing.

**Left as explicit `TODO(prompt-12)` branches, each throwing rather than guessing:** the
signed-in paths for `registered` (confirmed `registrations` row), `subscriber`
(`subscriptions` in `LIVE_STATUSES`, reused from `routes/plans.ts` — one definition of a
live subscription, not two that drift), `purchase` (`entitlements` unexpired), and
`cohort` (`entitlements` with `source='cohort'`, never inferable from a subscription).

⚠️ **`resolveAccess` is the only access decision permitted in the codebase.** Routes call
it; they do not re-derive the ladder. This constraint exists from this prompt onward
precisely because the detail page ships before the signed-in branches do — a route that
hand-rolls "is this public?" today is the hole the paywall leaks through in Prompt 13.

⚠️ `join_token` is a capability: possession is access to that session. Returned only when
`can_view` is true, never in a list response.

---

## WEB

### Routes (all lazy-loaded)

```
/watch/:slug        content detail — the card and hero destination
/browse/:slug       category listing — the tile destination
/speakers/:slug     speaker profile + their sessions
/browse             all categories
```

The catch-all redirect stays, but stops swallowing real links.

### Detail page

Full-bleed 16:9 hero using the existing focal-point and ImageKit helpers from
`public/lib/images.ts` — a raw master URL is never rendered. Below it: title, meta strip
(type · format · duration · language · rating when `rating_count > 0`), description,
speakers, and per type:

- **Webinar** — date and time in the viewer's timezone, countdown when upcoming, LIVE
  pulse when live, "what this session includes" from `session_config`.
- **Video** — duration, chapters and transcript availability.
- **Course** — curriculum accordion by module, lesson counts and total duration, preview
  lessons marked, outcomes, certification details, drip schedule when
  `drip_days_after_enrolment > 0`.

Then related content as a `Row`, reusing the homepage carousel.

### The gate component

One `<AccessGate>` driven by `AccessResult.reason`:

| reason | Rendered | Wired up? |
|---|---|---|
| `public` | Watch now | Prompt 13 |
| `needs_signin` | "Sign in to continue", with price shown when there is one | Prompt 12 |
| `unavailable` | Plainly says expired or unavailable | now |
| `needs_registration` / `needs_purchase` / `needs_subscription` / `not_enrolled` | Written now, unreachable until Prompt 12 | Prompt 12 |

⚠️ **Every CTA that cannot yet work must say so.** A "Register Free" button that appears
to succeed and silently does nothing is worse than one reading "Sign in to register"
that routes to a page which doesn't exist yet. Inert and honest, never fake and cheerful.

`registration.guest_viewing` governs what a signed-out visitor sees before the gate:
`open` shows the full page, `soft_gate` shows metadata then prompts, `blocked` sends them
straight to sign-in. The homepage already honours `audience` on rows; this extends the
same policy to a single item.

### Known limitation — SEO

This is a client-rendered SPA with no server rendering. The detail page is the primary
SEO surface on the whole platform, and a crawler currently receives an empty shell.
`seo_title`, `seo_meta_description` and `seo_canonical_url` are populated per item by the
admin console and will be set into the document head at runtime, which serves Google
(it executes JS) but not most social-preview crawlers — link cards on WhatsApp, LinkedIn
and X will be blank.

I am not solving this in Prompt 11. The realistic options, in ascending cost, are a
prerender service for crawler user-agents, static generation of published detail pages at
build time, or moving the public site to SSR. This is worth a decision before launch, not
before this prompt.

---

## HARD CONSTRAINTS

- **`resolveAccess` is the only access decision.** No route re-derives it.
- **The detail payload is a Prisma `select` allowlist**, not a filtered dump.
- **`stream_key`, `playback_id` and ad identifiers never appear** in any public response.
- **Speaker payouts, commission and revenue share never appear** — reuse
  `serializeSpeaker`.
- **Lesson durations come from the linked `MediaAsset`.**
- **`join_token` only when `can_view` is true.**
- **Draft, expired and non-existent all 404 identically.**
- **Unwired CTAs are visibly unwired.**
- **The public bundle stays under 150KB** (currently 66KB JS + 7.3KB CSS) and the
  homepage keeps its two-call first paint. Detail pages are separate chunks.

---

## OUT OF SCOPE

Viewer accounts, registration and the signed-in access branches (**Prompt 12**);
checkout, Paystack and entitlement granting (**Prompt 12**); the player, signed URLs,
concurrency limits and watermarking (**Prompt 13**); a ratings table (needs its own
design pass).

---

## DEFINITION OF DONE

- Every card, tile, hero CTA and speaker link on the homepage lands on a real page.
- A signed-out visitor can read any published item's full detail page, and watch one
  whose `access_level` is `public`.
- Gated items show an honest sign-in prompt, with the price when there is one.
- Course curriculum renders with durations sourced from `MediaAsset`.
- The detail payload contains no excluded field — verified by reading the `select`, not
  by inspecting a response.
- `tsc --noEmit` clean both sides; public bundle still under 150KB.
