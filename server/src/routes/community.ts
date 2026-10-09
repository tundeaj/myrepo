import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyToken } from "../lib/jwt.js";
import { sendMail, publicUrl } from "../lib/mail.js";
import { publicSettings, publicStrings } from "../lib/homepageCache.js";
import type { Request, Response, NextFunction } from "express";

/**
 * `/admin/community/spaces` and `/admin/community/moderation` were both
 * PlaceholderPages — but unlike Promotions/Pages/Bulk Import, this one
 * actually had real schema waiting: `community_spaces`, `space_members`,
 * `space_posts`, and `post_comments` have existed since the original
 * Prompt 01-C seed, completely untouched by any route — the same
 * "nothing ever wrote to it" shape `Rating` was in before this build.
 * This builds on those tables directly rather than inventing new ones.
 *
 * Checked scope with the user before building: lightweight discussion
 * threads, not a full forum. A `SpacePost` is a top-level post in a Space;
 * a `PostComment` is the one level of reply it supports — there's no
 * further self-nesting in the schema, so that table IS the depth limit,
 * not something this code has to separately enforce. No likes/reactions,
 * no rich media (space_posts.attachment_url stays unused and unexposed,
 * same "sensitive/relational fields deliberately excluded" boundary
 * Bulk Import stated). `space_members` (role: member/moderator) also
 * stays unused this round — moderation here is admin-only, not a
 * per-space moderator role; posting doesn't require first "joining" a
 * space, matching how Ratings/FAQs need no membership step either.
 *
 * Every post and reply starts 'pending' and is invisible on the public
 * read path until an admin approves it — same review_required shape
 * ratings' own comment_status uses, just without a settings toggle since
 * this feature has no auto_publish mode.
 *
 * `community_reply` has sat in NOTIFICATION_EVENT_KEYS
 * (constants/notificationEvents.ts) since that file was introduced, with
 * nothing in the codebase ever checking it — this is its first real
 * consumer. When a reply is approved, the original post's author is
 * emailed (same sendMail/publicUrl pattern every other transactional
 * email already uses), gated on their own notification_preferences row
 * for (event_key: "community_reply", channel: "email") when one exists —
 * absent a row, the default is enabled, matching this table's own stated
 * intent ("apply it per-user at signup ... is_enabled=true"). No
 * preferences UI exists yet for a viewer to actually see/set this toggle
 * (a separate, bigger gap — see ROADMAP.md) — the API has simply never
 * had a real caller to respect until now.
 */
export const communitySpacesRouter = Router();
export const communityModerationRouter = Router();
export const publicCommunityRouter = Router();

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160);
}

function optionalUserId(req: Request): number | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return verifyToken(header.slice(7)).sub;
  } catch {
    return null;
  }
}

// ─── Admin — Spaces CRUD ────────────────────────────────────────────────────

const SpaceSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(150),
  description: z.string().trim().max(2000).nullable().optional(),
  space_type: z.enum(["open", "cohort", "course"]).default("open"),
  linked_content_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().default(true),
});

communitySpacesRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const spaces = await prisma.communitySpace.findMany({ orderBy: { id: "asc" } });
    const counts = await prisma.spacePost.groupBy({ by: ["space_id"], _count: { _all: true } });
    const countBySpace = new Map(counts.map((c) => [c.space_id, c._count._all]));
    res.json({ spaces: spaces.map((s) => ({ ...s, post_count: countBySpace.get(s.id) ?? 0 })) });
  } catch (err) {
    next(err);
  }
});

communitySpacesRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = SpaceSchema.parse(req.body);
    if (body.space_type !== "open" && !body.linked_content_id) {
      throw new ApiError(422, "A cohort or course space needs a linked content id.");
    }

    const baseSlug = slugify(body.name) || "space";
    const clash = await prisma.communitySpace.findFirst({ where: { slug: baseSlug }, select: { id: true } });
    const slug = clash ? `${baseSlug}-${Date.now()}` : baseSlug;

    const space = await prisma.communitySpace.create({
      data: {
        name: body.name,
        slug,
        description: body.description ?? null,
        space_type: body.space_type,
        linked_content_id: body.space_type === "open" ? null : body.linked_content_id,
        is_active: body.is_active,
      },
    });
    res.status(201).json({ space });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /:id — slug never changes on rename, same rule Category/Page already follow.
communitySpacesRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid space id");
    const existing = await prisma.communitySpace.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Space not found");

    const body = SpaceSchema.parse(req.body);
    if (body.space_type !== "open" && !body.linked_content_id) {
      throw new ApiError(422, "A cohort or course space needs a linked content id.");
    }

    const space = await prisma.communitySpace.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description ?? null,
        space_type: body.space_type,
        linked_content_id: body.space_type === "open" ? null : body.linked_content_id,
        is_active: body.is_active,
      },
    });
    res.json({ space });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /:id — a space with any posts can't be deleted outright, same
// "block, don't silently orphan" call Categories already makes.
communitySpacesRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid space id");
    const existing = await prisma.communitySpace.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Space not found");

    const inUse = await prisma.spacePost.count({ where: { space_id: id } });
    if (inUse > 0) {
      throw new ApiError(409, `${inUse} post${inUse === 1 ? "" : "s"} already exist in this space. Deactivate it instead of deleting.`);
    }

    await prisma.communitySpace.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Admin — Moderation queue ───────────────────────────────────────────────

type ModerationKind = "post" | "comment";

async function notifyReplyApproved(commentId: number) {
  const comment = await prisma.postComment.findFirst({ where: { id: commentId } });
  if (!comment) return;
  const post = await prisma.spacePost.findFirst({ where: { id: comment.post_id } });
  if (!post || post.user_id === comment.user_id) return; // never notify yourself

  const pref = await prisma.notificationPreference.findUnique({
    where: { user_id_event_key_channel: { user_id: post.user_id, event_key: "community_reply", channel: "email" } },
    select: { is_enabled: true },
  });
  if (pref && !pref.is_enabled) return; // absent row = default enabled

  const [author, space] = await Promise.all([
    prisma.user.findUnique({ where: { id: post.user_id }, select: { email: true } }),
    prisma.communitySpace.findFirst({ where: { id: post.space_id }, select: { slug: true, name: true } }),
  ]);
  if (!author?.email || !space) return;

  await sendMail({
    to: author.email,
    subject: `New reply to your post in ${space.name ?? "the community"}`,
    lines: ["Someone replied to your post."],
    action: { label: "View it", url: publicUrl(`/community/${space.slug}`) },
  });
}

async function moderatePost(id: number, status: "approved" | "rejected") {
  const existing = await prisma.spacePost.findFirst({ where: { id } });
  if (!existing) throw new ApiError(404, "Post not found");
  return prisma.spacePost.update({ where: { id }, data: { status } });
}

async function moderateComment(id: number, status: "approved" | "rejected") {
  const existing = await prisma.postComment.findFirst({ where: { id } });
  if (!existing) throw new ApiError(404, "Reply not found");
  const wasPending = existing.status !== "approved";
  const updated = await prisma.postComment.update({ where: { id }, data: { status } });
  if (status === "approved" && wasPending) await notifyReplyApproved(id);
  return updated;
}

// GET /?status=pending — a merged feed of posts and replies awaiting the
// given status (default 'pending'), each tagged with its own `kind` so one
// moderation queue UI can list both.
communityModerationRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    if (!["pending", "approved", "rejected"].includes(status)) throw new ApiError(400, "Invalid status");

    // SpacePost/PostComment carry no Prisma relations (plain Int FK columns,
    // same as every other table in this seed) — authors/spaces/parent posts
    // are joined manually below rather than via `include`.
    const [posts, comments] = await Promise.all([
      prisma.spacePost.findMany({ where: { status: status as "pending" | "approved" | "rejected" }, orderBy: { created_at: "desc" } }),
      prisma.postComment.findMany({ where: { status: status as "pending" | "approved" | "rejected" }, orderBy: { created_at: "desc" } }),
    ]);

    const userIds = [...new Set([...posts.map((p) => p.user_id), ...comments.map((c) => c.user_id)])];
    const spaceIds = [...new Set(posts.map((p) => p.space_id))];
    const postIds = [...new Set(comments.map((c) => c.post_id))];
    const [users, spaces, parentPosts] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true, email: true } }),
      prisma.communitySpace.findMany({ where: { id: { in: spaceIds } }, select: { id: true, name: true, slug: true } }),
      prisma.spacePost.findMany({ where: { id: { in: postIds } }, select: { id: true, body: true, space_id: true } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const spaceById = new Map(spaces.map((s) => [s.id, s]));
    const postById = new Map(parentPosts.map((p) => [p.id, p]));

    const items = [
      ...posts.map((p) => ({
        kind: "post" as ModerationKind,
        id: p.id,
        body: p.body,
        status: p.status,
        is_pinned: p.is_pinned,
        created_at: p.created_at,
        author: userById.get(p.user_id) ?? null,
        space: spaceById.get(p.space_id) ?? null,
      })),
      ...comments.map((c) => ({
        kind: "comment" as ModerationKind,
        id: c.id,
        body: c.body,
        status: c.status,
        created_at: c.created_at,
        author: userById.get(c.user_id) ?? null,
        parent_post: postById.get(c.post_id) ?? null,
      })),
    ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const ModerateSchema = z.object({ status: z.enum(["approved", "rejected"]) });

communityModerationRouter.put("/posts/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid post id");
    const body = ModerateSchema.parse(req.body);
    const post = await moderatePost(id, body.status);
    res.json({ post });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

communityModerationRouter.put("/comments/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid reply id");
    const body = ModerateSchema.parse(req.body);
    const comment = await moderateComment(id, body.status);
    res.json({ comment });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

communityModerationRouter.put("/posts/:id/pin", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid post id");
    const body = z.object({ is_pinned: z.boolean() }).parse(req.body);
    const existing = await prisma.spacePost.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Post not found");
    const post = await prisma.spacePost.update({ where: { id }, data: { is_pinned: body.is_pinned } });
    res.json({ post });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

const BulkModerateSchema = z.object({
  items: z
    .array(z.object({ kind: z.enum(["post", "comment"]), id: z.number().int().positive() }))
    .min(1, "At least one item is required.")
    .max(100, "At most 100 at a time."),
  status: z.enum(["approved", "rejected"]),
});

// POST /bulk — one bad id degrades only itself, never the rest of the batch,
// same principle ratings-moderation's own /bulk already applies.
communityModerationRouter.post("/bulk", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = BulkModerateSchema.parse(req.body);
    const results: { kind: ModerationKind; id: number; ok: boolean; error?: string }[] = [];
    for (const item of body.items) {
      try {
        if (item.kind === "post") await moderatePost(item.id, body.status);
        else await moderateComment(item.id, body.status);
        results.push({ kind: item.kind, id: item.id, ok: true });
      } catch (err) {
        results.push({ kind: item.kind, id: item.id, ok: false, error: err instanceof ApiError ? err.message : "Failed to moderate." });
      }
    }
    res.json({ results });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

communityModerationRouter.delete("/posts/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid post id");
    const existing = await prisma.spacePost.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Post not found");
    // No DB-level cascade (these tables carry no FK constraints at all, only
    // plain Int columns) — delete the post's own replies first in one
    // transaction so deleting a post never leaves orphaned comment rows.
    await prisma.$transaction([
      prisma.postComment.deleteMany({ where: { post_id: id } }),
      prisma.spacePost.delete({ where: { id } }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

communityModerationRouter.delete("/comments/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid reply id");
    const existing = await prisma.postComment.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Reply not found");
    await prisma.postComment.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Public read path + viewer write path ───────────────────────────────────

// GET /spaces — every active space, for the /community index page. Doubles
// as that page's sole bootstrap request, same PublicBootstrap contract
// every other standalone public page already follows.
publicCommunityRouter.get("/spaces", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [spaces, settings, strings] = await Promise.all([
      prisma.communitySpace.findMany({
        where: { is_active: true },
        orderBy: { id: "asc" },
        select: { id: true, name: true, slug: true, description: true, space_type: true },
      }),
      publicSettings(),
      publicStrings(),
    ]);
    res.json({ spaces, settings, strings });
  } catch (err) {
    next(err);
  }
});

// GET /spaces/:slug — a single active space, its approved posts (pinned
// first, then newest), each with its own approved replies nested under it.
// A caller may carry a token (optionalUserId) so the client can tell "this
// post is yours" apart from everyone else's, same purpose faqs.ts's own
// optionalUserId serves.
publicCommunityRouter.get("/spaces/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const space = await prisma.communitySpace.findFirst({ where: { slug: req.params.slug, is_active: true } });
    if (!space) throw new ApiError(404, "Space not found");

    const [posts, settings, strings] = await Promise.all([
      prisma.spacePost.findMany({
        where: { space_id: space.id, status: "approved" },
        orderBy: [{ is_pinned: "desc" }, { created_at: "desc" }],
      }),
      publicSettings(),
      publicStrings(),
    ]);

    const postIds = posts.map((p) => p.id);
    const [comments, authors] = await Promise.all([
      postIds.length
        ? prisma.postComment.findMany({ where: { post_id: { in: postIds }, status: "approved" }, orderBy: { created_at: "asc" } })
        : Promise.resolve([]),
      prisma.user.findMany({
        where: { id: { in: [...new Set(posts.map((p) => p.user_id))] } },
        select: { id: true, full_name: true },
      }),
    ]);
    const commentAuthors = await prisma.user.findMany({
      where: { id: { in: [...new Set(comments.map((c) => c.user_id))] } },
      select: { id: true, full_name: true },
    });
    const authorById = new Map([...authors, ...commentAuthors].map((u) => [u.id, u.full_name]));
    const commentsByPost = new Map<number, typeof comments>();
    for (const c of comments) {
      const list = commentsByPost.get(c.post_id) ?? [];
      list.push(c);
      commentsByPost.set(c.post_id, list);
    }

    const viewerId = optionalUserId(req);
    res.json({
      space,
      posts: posts.map((p) => ({
        id: p.id,
        body: p.body,
        is_pinned: p.is_pinned,
        created_at: p.created_at,
        author_name: authorById.get(p.user_id) ?? "A viewer",
        is_mine: viewerId != null && viewerId === p.user_id,
        replies: (commentsByPost.get(p.id) ?? []).map((c) => ({
          id: c.id,
          body: c.body,
          created_at: c.created_at,
          author_name: authorById.get(c.user_id) ?? "A viewer",
          is_mine: viewerId != null && viewerId === c.user_id,
        })),
      })),
      settings,
      strings,
    });
  } catch (err) {
    next(err);
  }
});

const PostBodySchema = z.object({ body: z.string().trim().min(1, "Write something first.").max(4000) });

// POST /spaces/:slug/posts — requireAuth inline (this router has no
// app-level auth — its GETs are unauthenticated by design), same per-route
// pattern auth.ts's own GET /me already uses.
publicCommunityRouter.post("/spaces/:slug/posts", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const space = await prisma.communitySpace.findFirst({ where: { slug: req.params.slug, is_active: true } });
    if (!space) throw new ApiError(404, "Space not found");
    const body = PostBodySchema.parse(req.body);

    const post = await prisma.spacePost.create({
      data: { space_id: space.id, user_id: req.user!.sub, body: body.body, status: "pending" },
    });
    res.status(201).json({ post: { ...post, author_name: null, is_mine: true, replies: [] } });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// POST /posts/:id/comments — the one reply level this feature supports.
// Can only reply to a post that's itself live (approved, in an active
// space) — replying to a pending/rejected/since-deactivated post would let
// a reply "leak" context about content no other visitor can even see yet.
publicCommunityRouter.post("/posts/:id/comments", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const postId = Number(req.params.id);
    if (!postId) throw new ApiError(400, "Invalid post id");
    const post = await prisma.spacePost.findFirst({ where: { id: postId, status: "approved" } });
    if (!post) throw new ApiError(404, "Post not found");
    const space = await prisma.communitySpace.findFirst({ where: { id: post.space_id, is_active: true } });
    if (!space) throw new ApiError(404, "Post not found");

    const body = PostBodySchema.parse(req.body);
    const comment = await prisma.postComment.create({
      data: { post_id: postId, user_id: req.user!.sub, body: body.body, status: "pending" },
    });
    res.status(201).json({ comment: { ...comment, author_name: null, is_mine: true } });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
