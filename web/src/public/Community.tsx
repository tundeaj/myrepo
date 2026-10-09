import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import {
  usePublicData,
  PublicShell,
  PublicError,
  PublicPageSkeleton,
  type PublicBootstrap,
} from "./lib/publicPage";

interface SpaceSummary {
  id: number;
  name: string | null;
  slug: string;
  description: string | null;
  space_type: "open" | "cohort" | "course";
}

interface SpacesPayload extends PublicBootstrap {
  spaces: SpaceSummary[];
}

/** /community — every active Space, linking into its own /community/:slug. */
export function Community() {
  const { data, error, loading, retry } = usePublicData<SpacesPayload>("/api/public-community/spaces");

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-24">
        <h1 className="mb-2 text-2xl font-bold text-white">Community</h1>
        <p className="mb-8 text-sm text-slate-400">Discussion spaces for viewers — pick one to read or join in.</p>

        {!data.spaces.length ? (
          <p className="text-sm text-slate-500">No spaces are open yet. Check back soon.</p>
        ) : (
          <div className="space-y-3">
            {data.spaces.map((s) => (
              <Link
                key={s.id}
                to={`/community/${s.slug}`}
                className="block rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition-colors hover:border-slate-700 hover:bg-slate-900/70"
              >
                <h2 className="text-base font-semibold text-white">{s.name}</h2>
                {s.description && <p className="mt-1 text-sm text-slate-400">{s.description}</p>}
              </Link>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}

interface Reply {
  id: number;
  body: string | null;
  created_at: string;
  author_name: string;
  is_mine: boolean;
}

interface Post {
  id: number;
  body: string | null;
  is_pinned: boolean;
  created_at: string;
  author_name: string;
  is_mine: boolean;
  replies: Reply[];
}

interface SpaceDetailPayload extends PublicBootstrap {
  space: { id: number; name: string | null; slug: string; description: string | null };
  posts: Post[];
}

function ReplyComposer({ postId }: { postId: number }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/public-community/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ body: body.trim() }) });
      setBody("");
      // No retry()/reload here on purpose — a reply starts 'pending' and
      // nothing on this page becomes visible until an admin approves it, so
      // reloading would only replace this exact notice with... nothing new.
      setSent(true);
    } catch {
      // the composer stays filled so the viewer can retry rather than losing their draft
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p className="mt-2 text-xs text-slate-600">Your reply is awaiting approval before it's shown.</p>;

  return (
    <div className="mt-3 flex items-start gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply…"
        rows={2}
        maxLength={4000}
        className="w-full min-w-0 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 placeholder:text-slate-600"
      />
      <button
        onClick={submit}
        disabled={busy || !body.trim()}
        className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
      >
        {busy ? "Posting…" : "Reply"}
      </button>
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {post.is_pinned && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300">Pinned</span>}
        <span>{post.author_name}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{post.body}</p>

      {post.replies.length > 0 && (
        <div className="mt-3 space-y-2 border-l border-slate-800 pl-4">
          {post.replies.map((r) => (
            <div key={r.id}>
              <span className="text-xs text-slate-500">{r.author_name}</span>
              <p className="whitespace-pre-wrap text-sm text-slate-300">{r.body}</p>
            </div>
          ))}
        </div>
      )}

      <ReplyComposer postId={post.id} />
    </div>
  );
}

function PostComposer({ slug }: { slug: string }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/public-community/spaces/${encodeURIComponent(slug)}/posts`, { method: "POST", body: JSON.stringify({ body: body.trim() }) });
      setBody("");
      // No retry()/reload here on purpose — a post starts 'pending' and
      // stays invisible until an admin approves it, so reloading the page
      // would only replace this exact notice with... nothing new.
      setSent(true);
    } catch {
      // keep the draft so the viewer doesn't lose it on a failed submit
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <textarea
        value={body}
        onChange={(e) => { setBody(e.target.value); setSent(false); }}
        placeholder="Start a post…"
        rows={3}
        maxLength={4000}
        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
      />
      <div className="mt-2 flex items-center justify-between">
        {sent ? <p className="text-xs text-slate-600">Your post is awaiting approval before it's shown.</p> : <span />}
        <button
          onClick={submit}
          disabled={busy || !body.trim()}
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}

/** /community/:slug — a single Space: its approved posts (pinned first), each
 *  with its one level of approved replies, plus a composer for signed-in
 *  viewers. No likes/reactions, no rich media — see routes/community.ts for
 *  the stated scope boundary. */
export function CommunitySpacePage() {
  const { slug = "" } = useParams();
  const { status } = useAuth();
  const { data, error, loading, retry } = usePublicData<SpaceDetailPayload>(`/api/public-community/spaces/${encodeURIComponent(slug)}`);

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-24">
        <h1 className="mb-2 text-2xl font-bold text-white">{data.space.name}</h1>
        {data.space.description && <p className="mb-6 text-sm text-slate-400">{data.space.description}</p>}

        {status === "signed-in" ? (
          <PostComposer slug={slug} />
        ) : (
          <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            <Link to="/signin" className="text-brand underline">Sign in</Link> to post in this space.
          </div>
        )}

        {!data.posts.length ? (
          <p className="text-sm text-slate-500">No posts yet. Be the first.</p>
        ) : (
          <div className="space-y-4">
            {data.posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
