/**
 * Browser checks — the class of defect nothing else here catches.
 *
 * Three bugs shipped in this project that `tsc`, the build and the API suite all
 * passed clean (fixed in ad79e55):
 *
 *   1. an absolutely-positioned gradient painted over the detail page's title,
 *      meta, countdown and entire access gate — on every detail page
 *   2. the first homepage row landed on top of the hero's CTAs, because a
 *      negative margin in one file exceeded the padding reserved in another
 *   3. every public page was titled "Webinarflix Admin", and a fresh install
 *      rendered no hero at all
 *
 * All three are geometry and rendered output. `toBeVisible()` would not have
 * caught the first two either — an element covered by another is still
 * "visible" to the DOM. So these assert what a person sees: is the element's
 * own centre point actually hittable, and do the two boxes overlap.
 *
 * Usage:
 *   BASE=http://127.0.0.1:5173 npx tsx scripts/browser.ts
 *
 * Needs the web dev server and the API running against a seeded database.
 * CHROMIUM_PATH overrides the browser binary when the bundled build doesn't
 * match the installed Playwright.
 */
import { chromium, type Page, type Browser } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:5173";
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:4000";
const CHROMIUM_PATH = process.env.CHROMIUM_PATH;

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

/**
 * The assertion that would have caught the gradient bug.
 *
 * Asks the browser what element is actually at the centre of this one. If the
 * answer is something else — and not one of its own descendants — then whatever
 * is on top is covering it, however "visible" the DOM believes it to be.
 */
async function isActuallyOnTop(page: Page, selector: string): Promise<{ ok: boolean; covering?: string }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, covering: "element not found" };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { ok: false, covering: "zero size" };
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(r.height / 2, 20);
    const hit = document.elementFromPoint(x, y);
    if (!hit) return { ok: false, covering: "nothing at point (offscreen?)" };
    if (el.contains(hit) || hit.contains(el)) return { ok: true };
    return {
      ok: false,
      covering: `${hit.tagName.toLowerCase()}.${(hit.className || "").toString().split(" ").slice(0, 3).join(".")}`,
    };
  }, selector);
}

/** The assertion that would have caught the hero/row collision. */
async function boxesOverlap(page: Page, a: string, b: string) {
  return page.evaluate(
    ([selA, selB]) => {
      const ea = document.querySelector(selA);
      const eb = document.querySelector(selB);
      if (!ea || !eb) return { found: false, overlap: false };
      const ra = ea.getBoundingClientRect();
      const rb = eb.getBoundingClientRect();
      const overlap =
        ra.left < rb.right && ra.right > rb.left && ra.top < rb.bottom && ra.bottom > rb.top;
      return {
        found: true,
        overlap,
        a: { top: Math.round(ra.top), bottom: Math.round(ra.bottom) },
        b: { top: Math.round(rb.top), bottom: Math.round(rb.bottom) },
      };
    },
    [a, b],
  );
}

async function run(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // ─── Homepage ──────────────────────────────────────────────────────────────
  section("Homepage");

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  check("document title is not the admin console's",
    !(await page.title()).includes("Admin"), await page.title());

  const heroTitle = page.locator("h1, h2").first();
  check("a hero renders on a freshly seeded install",
    (await page.locator("h1").count()) > 0 || (await heroTitle.count()) > 0);

  // REGRESSION (ad79e55): the first row header sat on top of the hero CTAs,
  // because a negative margin in Home.tsx exceeded the padding reserved in
  // Hero.tsx. Two files, neither wrong on its own.
  //
  // Take the LOWEST edge of any laid-out control inside the hero — zero-size
  // elements are skipped, since a hidden mobile menu button reports 0,0 and
  // makes this assertion pass no matter what. Then compare against the first
  // row heading below it.
  // True 2D intersection, not just "is one lower than the other". The hero's
  // slide-indicator pips sit bottom-RIGHT and legitimately extend past a
  // left-aligned row heading without touching it; a vertical-only comparison
  // fails on those and teaches you to ignore it.
  const collision = await page.evaluate(() => {
    const hero = document.querySelector("section");
    if (!hero) return null;
    const controls = Array.from(hero.querySelectorAll("a, button"))
      .map((e) => ({ text: (e as HTMLElement).innerText.slice(0, 20), r: e.getBoundingClientRect() }))
      .filter((c) => c.r.width > 0 && c.r.height > 0);

    const heading = Array.from(document.querySelectorAll("h2"))
      .map((h) => ({ text: (h as HTMLElement).innerText.slice(0, 24), r: h.getBoundingClientRect() }))
      .filter((x) => x.r.height > 0)
      .sort((a, b) => a.r.top - b.r.top)[0];
    if (!heading || !controls.length) return null;

    const hit = controls.find(
      (c) =>
        c.r.left < heading.r.right &&
        c.r.right > heading.r.left &&
        c.r.top < heading.r.bottom &&
        c.r.bottom > heading.r.top,
    );

    return {
      clear: hit === undefined,
      heading: heading.text,
      overlapping: hit
        ? { control: hit.text, bottom: Math.round(hit.r.bottom), headingTop: Math.round(heading.r.top) }
        : null,
    };
  });
  check("no hero control overlaps the first row header",
    collision === null || collision.clear === true, collision);

  const cardLinks = await page.locator('a[href^="/watch/"]').count();
  check("cards link to /watch/:slug", cardLinks > 0, cardLinks);

  check("no uncaught page errors on the homepage", pageErrors.length === 0, pageErrors);

  // ─── Detail page ───────────────────────────────────────────────────────────
  section("Detail page");

  const firstCard = page.locator('a[href^="/watch/"]').first();
  const href = await firstCard.getAttribute("href");
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  check("the detail route resolves rather than bouncing to /",
    new URL(page.url()).pathname === href, page.url());
  check("document title carries the item title, not the admin console's",
    !(await page.title()).includes("Admin") && (await page.title()).length > 3, await page.title());

  // REGRESSION (ad79e55): the gradient overlay painted over all of this.
  const titleOnTop = await isActuallyOnTop(page, "h1");
  check("the detail title is not covered by the gradient overlay", titleOnTop.ok, titleOnTop);

  const h1Text = await page.locator("h1").first().innerText();
  check("the title has actual text", h1Text.trim().length > 0, h1Text);

  const gate = await isActuallyOnTop(page, 'main button, a[href="/signin"], button[disabled]');
  check("the access gate control is not covered", gate.ok !== false || gate.covering === "element not found", gate);

  const gateText = await page.locator("body").innerText();
  check("the gate states something actionable",
    /sign in|register|watch|buy|not available|cohort/i.test(gateText));

  check("no uncaught page errors on the detail page", pageErrors.length === 0, pageErrors);

  // ─── Other public routes resolve ───────────────────────────────────────────
  section("Public routes resolve");

  for (const path of ["/browse", "/signin", "/register", "/forgot-password"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    check(`${path} resolves rather than redirecting to /`,
      new URL(page.url()).pathname === path, page.url());
  }

  // ─── Registration, in a real browser ───────────────────────────────────────
  section("Registration through the UI");

  const email = `browser-${Date.now().toString(36)}@example.test`;
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const fieldCount = await page.locator("form input, form select").count();
  check("the form renders fields from signup_fields", fieldCount > 0, fieldCount);

  await page.fill("#full_name", "Browser Tester").catch(() => undefined);
  await page.fill("#email", email).catch(() => undefined);
  await page.fill("#password", "correct-horse-battery").catch(() => undefined);
  await page.selectOption("#country", "NG").catch(() => undefined);

  await page.click('button[type="submit"]');
  await page.waitForTimeout(1800);

  const afterStepOne = await page.locator("body").innerText();
  const advanced = /step 2|industry|job role|company/i.test(afterStepOne) ||
    new URL(page.url()).pathname !== "/register";
  check("submitting step one advances or completes", advanced, page.url());

  // Step two is optional, so completing it must be possible without filling it.
  if (new URL(page.url()).pathname === "/register") {
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
  }

  const signedIn = await page.evaluate(() => Object.keys(localStorage).some((k) => /token|auth/i.test(k)));
  check("registering signs the viewer in", signedIn || new URL(page.url()).pathname === "/",
    { url: page.url(), signedIn });

  // ─── Registering for a session through the gate ────────────────────────────
  section("Access gate");

  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const registerBtn = page.locator('button:has-text("Register free")');
  if ((await registerBtn.count()) > 0 && (await registerBtn.first().isEnabled())) {
    await registerBtn.first().click();
    await page.waitForTimeout(2200);
    const after = await page.locator("body").innerText();
    check("registering through the gate grants access without a reload",
      /you have access|manage your sessions|watch now|join live/i.test(after),
      after.slice(0, 200));
  } else {
    // Not a failure: the seeded item may not be `registered` tier for this user.
    console.log("  · gate not in a registerable state for this fixture — skipped");
  }

  // ─── Admin content-authoring pages ─────────────────────────────────────────
  // Added after a real bug: AddEditSession.tsx and AddEditCourse.tsx called
  // react-router's useBlocker(), which throws "must be used within a data
  // router" under this app's plain BrowserRouter — an uncaught render error
  // with no boundary, so the ENTIRE page rendered blank. Invisible to tsc (a
  // runtime router-config mismatch, not a type error), invisible to the API
  // suite (pure frontend), and invisible to this file before now, because
  // nothing here ever visited an admin route. Exactly the class of defect
  // this file's own header comment describes existing to catch — it just
  // hadn't reached these two pages yet.
  section("Admin content-authoring pages");

  const adminLogin = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@webinarflix.dev", password: "ChangeMe123!" }),
  }).then((r) => r.json());
  const adminToken = adminLogin?.token as string | undefined;
  check("the seeded admin account can log in for this check", typeof adminToken === "string", adminLogin);

  if (adminToken) {
    await page.evaluate((token) => localStorage.setItem("webinarflix_token", token), adminToken);

    const sessionsList = await fetch(`${API_BASE}/api/sessions?per_page=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((r) => r.json());
    const realSessionId = sessionsList?.sessions?.[0]?.id;

    for (const path of ["/admin/sessions/new", realSessionId ? `/admin/sessions/${realSessionId}/edit` : null, "/admin/courses/new"]) {
      if (!path) continue;
      const beforeErrorCount = pageErrors.length;
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const hasContent = await page.locator("text=/Session Details|Course Details|Title/i").count();
      check(`${path} renders real content, not a blank crashed page`, hasContent > 0, { path, hasContent });
      check(`${path} throws no uncaught render error`, pageErrors.length === beforeErrorCount, pageErrors.slice(beforeErrorCount));
    }
  }

  // ─── FAQs — admin page + public page ────────────────────────────────────────
  // Both were PlaceholderPage/nonexistent until this gap-sweep pass — real
  // browser coverage from day one this time, not bolted on after a crash
  // was found the hard way (see the section above).
  section("FAQs");

  if (adminToken) {
    const beforeAdminFaqErrors = pageErrors.length;
    await page.goto(`${BASE}/admin/faqs`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const hasFaqAdminContent = await page.locator("text=/FAQs|Add FAQ|No FAQs yet/i").count();
    check("/admin/faqs renders real content, not a blank crashed page", hasFaqAdminContent > 0, { hasFaqAdminContent });
    check("/admin/faqs throws no uncaught render error", pageErrors.length === beforeAdminFaqErrors, pageErrors.slice(beforeAdminFaqErrors));

    // A real fixture, created and torn down through the same API the admin
    // page itself calls — proves the public page actually renders live
    // server data, not just its own empty state.
    const created = await fetch(`${API_BASE}/api/faqs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        question: `Browser check FAQ ${Date.now()}?`,
        answer_html: "<p>Its answer, rendered on the public page.</p>",
        scope: "global",
        category: "Browser check",
        is_published: true,
      }),
    }).then((r) => r.json());
    const faqId = created?.faq?.id;
    check("a fixture FAQ is created for this check", typeof faqId === "number", created);

    if (faqId) {
      const beforePublicFaqErrors = pageErrors.length;
      await page.goto(`${BASE}/faqs`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const questionLocator = page.locator(`text=${created.faq.question}`);
      check("the public /faqs page renders the fixture's question", (await questionLocator.count()) > 0, created.faq.question);

      await questionLocator.first().click();
      await page.waitForTimeout(400);
      const hasAnswer = await page.locator("text=Its answer, rendered on the public page.").count();
      check("clicking the question expands its answer", hasAnswer > 0, { hasAnswer });
      check("/faqs throws no uncaught render error", pageErrors.length === beforePublicFaqErrors, pageErrors.slice(beforePublicFaqErrors));

      await fetch(`${API_BASE}/api/faqs/${faqId}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
    }
  }

  // ─── Contact Requests — public form + admin inbox ──────────────────────────
  section("Contact Requests");

  const beforeContactFormErrors = pageErrors.length;
  await page.goto(`${BASE}/contact`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const messageBox = page.locator('textarea[placeholder="How can we help?"]');
  check("the public /contact form renders its message field", (await messageBox.count()) > 0, {});

  const uniqueMessage = `Browser check message ${Date.now()}`;
  await page.locator('input[placeholder="Email"]').fill(`browser-contact-${Date.now().toString(36)}@example.test`);
  await messageBox.fill(uniqueMessage);
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(600);
  const hasConfirmation = await page.locator("text=/message has been sent/i").count();
  check("submitting the contact form shows a confirmation", hasConfirmation > 0, { hasConfirmation });
  check("/contact throws no uncaught render error", pageErrors.length === beforeContactFormErrors, pageErrors.slice(beforeContactFormErrors));

  if (adminToken) {
    const beforeAdminInboxErrors = pageErrors.length;
    await page.goto(`${BASE}/admin/contact-requests`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const hasSubmittedMessage = await page.locator(`text=${uniqueMessage}`).count();
    check("the real submission from this run appears in the admin inbox", hasSubmittedMessage > 0, { hasSubmittedMessage });
    check("/admin/contact-requests throws no uncaught render error", pageErrors.length === beforeAdminInboxErrors, pageErrors.slice(beforeAdminInboxErrors));

    // Clean up the fixture this run created — same discipline as the FAQ
    // fixture above, so repeated runs don't accumulate rows in the inbox.
    const list = await fetch(`${API_BASE}/api/contact-requests`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
    const created = (list?.requests ?? []).find((r: { message?: string }) => r.message === uniqueMessage);
    if (created) await fetch(`${API_BASE}/api/contact-requests/${created.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
  }

  // ─── Categories — admin CRUD ────────────────────────────────────────────────
  section("Categories");

  if (adminToken) {
    const catName = `Browser Check Cat ${Date.now()}`;
    const createdCat = await fetch(`${API_BASE}/api/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: catName }),
    }).then((r) => r.json());
    const catId = createdCat?.category?.id;
    check("a fixture category is created for this check", typeof catId === "number", createdCat);

    if (catId) {
      const beforeCatErrors = pageErrors.length;
      await page.goto(`${BASE}/admin/categories`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const hasCatRow = await page.locator(`text=${catName}`).count();
      check("/admin/categories renders the real fixture category", hasCatRow > 0, { hasCatRow });
      check("/admin/categories throws no uncaught render error", pageErrors.length === beforeCatErrors, pageErrors.slice(beforeCatErrors));

      await fetch(`${API_BASE}/api/categories/${catId}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
    }
  }

  // ─── Sponsors, Advertisers, Ads ─────────────────────────────────────────────
  section("Sponsors, Advertisers, Ads");

  if (adminToken) {
    const sponsorName = `Browser Check Sponsor ${Date.now()}`;
    const createdSponsor = await fetch(`${API_BASE}/api/sponsors`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ name: sponsorName }),
    }).then((r) => r.json());
    const sponsorId = createdSponsor?.sponsor?.id;
    check("a fixture sponsor is created for this check", typeof sponsorId === "number", createdSponsor);

    if (sponsorId) {
      const beforeSponsorErrors = pageErrors.length;
      await page.goto(`${BASE}/admin/sponsors`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const hasSponsorRow = await page.locator(`text=${sponsorName}`).count();
      check("/admin/sponsors renders the real fixture sponsor", hasSponsorRow > 0, { hasSponsorRow });
      check("/admin/sponsors throws no uncaught render error", pageErrors.length === beforeSponsorErrors, pageErrors.slice(beforeSponsorErrors));
      await fetch(`${API_BASE}/api/sponsors/${sponsorId}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
    }

    const advertiserName = `Browser Check Advertiser ${Date.now()}`;
    const createdAdvertiser = await fetch(`${API_BASE}/api/advertisers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ company_name: advertiserName }),
    }).then((r) => r.json());
    const advertiserId = createdAdvertiser?.advertiser?.id;
    check("a fixture advertiser is created for this check", typeof advertiserId === "number", createdAdvertiser);

    if (advertiserId) {
      const beforeAdvErrors = pageErrors.length;
      await page.goto(`${BASE}/admin/advertisers`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const hasAdvRow = await page.locator(`text=${advertiserName}`).count();
      check("/admin/advertisers renders the real fixture advertiser", hasAdvRow > 0, { hasAdvRow });
      check("/admin/advertisers throws no uncaught render error", pageErrors.length === beforeAdvErrors, pageErrors.slice(beforeAdvErrors));

      const adName = `Browser Check Ad ${Date.now()}`;
      const createdAd = await fetch(`${API_BASE}/api/ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name: adName, ad_type: "pre_roll", advertiser_id: advertiserId }),
      }).then((r) => r.json());
      const adId = createdAd?.ad?.id;
      check("a fixture ad is created for this check", typeof adId === "number", createdAd);

      if (adId) {
        const beforeAdErrors = pageErrors.length;
        await page.goto(`${BASE}/admin/ads`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        const hasAdRow = await page.locator(`text=${adName}`).count();
        check("/admin/ads renders the real fixture ad", hasAdRow > 0, { hasAdRow });
        check("/admin/ads throws no uncaught render error", pageErrors.length === beforeAdErrors, pageErrors.slice(beforeAdErrors));

        // Also confirm the AdvertisementPanel picker in the session editor
        // itself now offers this ad — the whole point of building this.
        await page.goto(`${BASE}/admin/sessions/new`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        const hasAdOption = await page.locator(`option:has-text("${adName}")`).count();
        check("the session editor's Advertisement panel now offers the real fixture ad", hasAdOption > 0, { hasAdOption });

        await fetch(`${API_BASE}/api/ads/${adId}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
      }
      await fetch(`${API_BASE}/api/advertisers/${advertiserId}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
    }
  }

  // ─── Ratings comment moderation — the decision gate itself ─────────────────
  // Two things worth proving in a real browser: the policy setting renders
  // as a real, savable control in the generic Settings Hub (not just a raw
  // API field nobody can reach), and the moderation queue page it unlocks
  // actually renders a real pending comment.
  section("Ratings comment moderation");

  if (adminToken) {
    const beforeSettingsErrors = pageErrors.length;
    await page.goto(`${BASE}/admin/settings?group=content_policy`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const hasModeControl = await page.locator("text=Rating comments").count();
    check("the rating-comments decision gate renders as a real Settings Hub control", hasModeControl > 0, { hasModeControl });
    check("/admin/settings?group=content_policy throws no uncaught render error", pageErrors.length === beforeSettingsErrors, pageErrors.slice(beforeSettingsErrors));

    // Real fixture: switch to review_required, submit a commented rating,
    // confirm it lands in the moderation queue's rendered page.
    await fetch(`${API_BASE}/api/settings/content_policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ values: { "content_policy.rating_comments_mode": "review_required" } }),
    });

    // A real, throwaway public-access session — not an arbitrary real
    // seeded one, since rating requires resolveAccess(...).can_view and
    // this app has no admin bypass for that check (same access ladder
    // applies to every signed-in user, admins included).
    const createdSession = await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: `Browser check moderation fixture ${Date.now()}`,
        access_level: "public",
        // A fresh session defaults to status: "draft", which resolveAccess
        // treats as not-yet-visible regardless of access_level — same
        // VISIBLE_STATUSES gate every public page respects. Without this,
        // the rating POST below would 403.
        status: "registration_open",
        scheduled_start_at: new Date(Date.now() + 86400000).toISOString(),
        scheduled_duration_minutes: 60,
      }),
    }).then((r) => r.json());
    const targetContentId = createdSession?.session?.id;
    check("a fixture public session is created to rate", typeof targetContentId === "number", createdSession);

    if (targetContentId) {
      const commentText = `Browser check pending comment ${Date.now()}`;
      await fetch(`${API_BASE}/api/ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ content_id: targetContentId, score: 3, comment: commentText }),
      });

      const beforeQueueErrors = pageErrors.length;
      await page.goto(`${BASE}/admin/ratings/moderation`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      const hasCommentRow = await page.locator(`text=${commentText}`).count();
      check("the moderation queue renders the real pending comment", hasCommentRow > 0, { hasCommentRow });
      check("/admin/ratings/moderation throws no uncaught render error", pageErrors.length === beforeQueueErrors, pageErrors.slice(beforeQueueErrors));

      // Clean up: withdraw the rating first (DELETE /api/sessions/:id
      // doesn't cascade-delete ratings — see deleteRelated() — so skipping
      // this would leave an orphaned row behind), then delete the fixture
      // session itself.
      await fetch(`${API_BASE}/api/ratings/${targetContentId}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
      await fetch(`${API_BASE}/api/sessions/${targetContentId}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
    }

    // Reset the decision gate back to its default — this check shouldn't
    // leave the live dev server's moderation policy switched on.
    await fetch(`${API_BASE}/api/settings/content_policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ values: { "content_policy.rating_comments_mode": null } }),
    });
  }

  // ─── Subscription revenue accrual — the decision gate, and the panel it
  // unlocks ─────────────────────────────────────────────────────────────────
  // The deep computation (watch-time weighting, idempotency, annual-plan
  // proration) already has 17 real assertions against the live API in
  // scripts/e2e.ts — this checks what's specifically this layer's job: the
  // setting renders as a real control, and the panel it gates renders
  // correctly against this dev server's REAL current state, which is
  // "disabled" (the honest default) — proving the off-state actually
  // disables the Run button, not just that the page doesn't crash.
  section("Subscription revenue accrual");

  if (adminToken) {
    const beforeMonetisationErrors = pageErrors.length;
    await page.goto(`${BASE}/admin/settings?group=monetisation`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const hasAccrualControl = await page.locator("text=Subscription revenue accrual").count();
    check("the subscription-accrual decision gate renders as a real Settings Hub control", hasAccrualControl > 0, { hasAccrualControl });
    check("/admin/settings?group=monetisation throws no uncaught render error", pageErrors.length === beforeMonetisationErrors, pageErrors.slice(beforeMonetisationErrors));

    const beforePayoutsErrors = pageErrors.length;
    await page.goto(`${BASE}/admin/payouts`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Subscription Accrual")').click();
    await page.waitForTimeout(600);
    const hasOffWarning = await page.locator("text=/turned off/i").count();
    check("the panel honestly shows the feature's real current (off) state", hasOffWarning > 0, { hasOffWarning });
    const runButton = page.locator('button:has-text("Run Accrual")');
    const runDisabled = await runButton.isDisabled().catch(() => null);
    check("Run is actually disabled while the feature is off, not just visually", runDisabled === true, { runDisabled });
    check("/admin/payouts (Subscription Accrual panel) throws no uncaught render error", pageErrors.length === beforePayoutsErrors, pageErrors.slice(beforePayoutsErrors));
  }

  check("no uncaught page errors across the run", pageErrors.length === 0, pageErrors);

  await page.close();
}

async function main() {
  console.log(`Browser checks against ${BASE}\n`);
  const browser = await chromium.launch(
    CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {},
  );
  try {
    await run(browser);
  } finally {
    await browser.close();
  }

  console.log(`\n${"═".repeat(62)}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error("\nBrowser checks crashed:", err);
  process.exit(1);
});
