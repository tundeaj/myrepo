import { useParams } from "react-router-dom";
import { buildImageUrl, focalPosition } from "./lib/images";
import {
  usePublicData,
  PublicShell,
  PublicError,
  PublicPageSkeleton,
  type PublicBootstrap,
} from "./lib/publicPage";
import { Card } from "./components/Card";
import type { ContentCard } from "./lib/types";

interface SpeakerPayload extends PublicBootstrap {
  speaker: {
    id: number;
    slug: string;
    full_name: string;
    title: string | null;
    organisation: string | null;
    bio: string | null;
    master_image_url: string | null;
    focal_x: number;
    focal_y: number;
    linkedin_url: string | null;
  };
  items: ContentCard[];
}

export function SpeakerProfile() {
  const { slug = "" } = useParams();
  const { data, error, loading, retry } = usePublicData<SpeakerPayload>(
    `/api/public-speakers/${encodeURIComponent(slug)}`,
  );

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  const { speaker, items } = data;

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-5xl px-6 pb-16 pt-24">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {speaker.master_image_url ? (
            <img
              src={buildImageUrl(speaker.master_image_url, 320) ?? undefined}
              alt=""
              className="h-32 w-32 flex-shrink-0 rounded-full object-cover"
              style={{ objectPosition: focalPosition(speaker) }}
            />
          ) : (
            <div className="flex h-32 w-32 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-3xl text-slate-400">
              {speaker.full_name.slice(0, 1)}
            </div>
          )}

          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-bold text-white">{speaker.full_name}</h1>
            {(speaker.title || speaker.organisation) && (
              <p className="text-sm text-slate-400">
                {[speaker.title, speaker.organisation].filter(Boolean).join(" · ")}
              </p>
            )}
            {speaker.linkedin_url && (
              <a
                href={speaker.linkedin_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-block text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
              >
                LinkedIn
              </a>
            )}
          </div>
        </header>

        {speaker.bio && (
          <p className="mt-6 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-slate-300">
            {speaker.bio}
          </p>
        )}

        <section className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Sessions &amp; courses
          </h2>
          {!items.length ? (
            <p className="text-sm text-slate-500">Nothing published yet.</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {items.map((item) => (
                <Card key={item.id} item={item} variant="poster" kind="content" />
              ))}
            </div>
          )}
        </section>
      </div>
    </PublicShell>
  );
}
