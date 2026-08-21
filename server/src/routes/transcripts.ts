import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { env } from "../lib/env.js";
import type { Request, Response, NextFunction } from "express";

export const transcriptsRouter = Router();

// ─── FUNCTION B — POST /transcripts/generate ─────────────────────────────────
//
// Submits a ready media asset to the configured transcript provider and records
// a transcripts row in `processing`. The provider calls back to the webhook
// below when it finishes; this endpoint never blocks on transcription.

const PROVIDERS: Record<string, { name: string; submitUrl: string }> = {
  assemblyai: { name: "AssemblyAI", submitUrl: "https://api.assemblyai.com/v2/transcript" },
  deepgram: { name: "Deepgram", submitUrl: "https://api.deepgram.com/v1/listen" },
};

/** Submits to the provider and returns its job id. Kept separate so the route
 *  reads as a sequence of decisions rather than a wall of HTTP plumbing. */
async function submitToProvider(audioUrl: string, correlationId: string): Promise<string> {
  const provider = PROVIDERS[env.TRANSCRIPT_PROVIDER];
  if (!provider || !env.TRANSCRIPT_API_KEY) {
    throw new ApiError(503, "Transcription isn't configured yet. Set a transcript provider and API key in Settings → Integrations.");
  }

  try {
    const body = env.TRANSCRIPT_PROVIDER === "assemblyai"
      ? { audio_url: audioUrl, speaker_labels: true }
      : { url: audioUrl };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.TRANSCRIPT_PROVIDER === "assemblyai") headers.authorization = env.TRANSCRIPT_API_KEY;
    else headers.Authorization = `Token ${env.TRANSCRIPT_API_KEY}`;

    const res = await fetch(provider.submitUrl, { method: "POST", headers, body: JSON.stringify(body) });

    if (!res.ok) {
      // The provider's own error text is logged, never forwarded — it can carry
      // account identifiers and quota details the caller has no business seeing.
      const detail = await res.text().catch(() => "");
      console.error(`[${correlationId}] ${provider.name} rejected the job (${res.status}):`, detail.slice(0, 500));
      throw new ApiError(502, `The transcription service rejected this job. Quote reference ${correlationId} if this keeps happening.`);
    }

    const json = (await res.json()) as { id?: string; request_id?: string };
    const jobId = json.id ?? json.request_id;
    if (!jobId) {
      console.error(`[${correlationId}] ${provider.name} returned no job id`);
      throw new ApiError(502, `The transcription service returned an unexpected response. Quote reference ${correlationId}.`);
    }
    return jobId;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error(`[${correlationId}] Transcription submit failed:`, err);
    throw new ApiError(503, "Couldn't reach the transcription service. Check the server's connection and try again.");
  }
}

transcriptsRouter.post("/generate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { media_asset_id } = z.object({ media_asset_id: z.number().int().positive() }).parse(req.body);
    const correlationId = randomUUID();

    const asset = await prisma.mediaAsset.findFirst({ where: { id: media_asset_id } });
    if (!asset) throw new ApiError(404, "Media asset not found.");
    if (asset.transcode_status !== "ready") {
      throw new ApiError(409, "This asset is still processing. Transcription can only start once it's ready.");
    }

    const audioUrl = asset.mp4_url || asset.hls_url;
    if (!audioUrl) {
      throw new ApiError(409, "This asset has no playable URL for the transcription service to read.");
    }

    // One live transcript per asset — a second submission would bill twice and
    // leave two rows racing to be the "real" one.
    const existing = await prisma.transcript.findFirst({
      where: { media_asset_id, status: { in: ["pending", "processing"] } },
      select: { id: true },
    });
    if (existing) {
      throw new ApiError(409, "A transcript is already being generated for this asset.");
    }

    // Link to the content item this asset is attached to, when there is one, so
    // the finished transcript can flip content_items.has_transcript.
    const link = await prisma.contentMedia.findFirst({
      where: { media_asset_id, content_id: { not: null } },
      select: { content_id: true },
    });

    const jobId = await submitToProvider(audioUrl, correlationId);

    const transcript = await prisma.transcript.create({
      data: {
        media_asset_id,
        content_id: link?.content_id ?? null,
        language: "en",
        status: "processing",
        // provider carries the job id so the webhook can match the callback to
        // this row without a second lookup table.
        provider: `${env.TRANSCRIPT_PROVIDER}:${jobId}`,
      },
    });

    res.status(201).json({ transcript_id: transcript.id, status: transcript.status });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── POST /transcripts/:id/complete — provider callback ──────────────────────
//
// On success: writes full_text, word_count and segments, then flips
// content_items.has_transcript. On failure: status='failed', nothing else.

const CompleteSchema = z.object({
  status: z.enum(["ready", "failed"]),
  full_text: z.string().optional(),
  segments: z.array(z.object({
    start_seconds: z.number().nonnegative(),
    end_seconds: z.number().nonnegative(),
    speaker_label: z.string().max(80).nullable().optional(),
    text: z.string(),
  })).optional(),
  error: z.string().max(500).optional(),
});

transcriptsRouter.post("/:id/complete", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid transcript id");

    const transcript = await prisma.transcript.findFirst({ where: { id } });
    if (!transcript) throw new ApiError(404, "Transcript not found.");

    const body = CompleteSchema.parse(req.body);

    if (body.status === "failed") {
      await prisma.transcript.update({ where: { id }, data: { status: "failed" } });
      console.warn(`Transcript ${id} failed:`, body.error ?? "no reason given");
      return res.json({ ok: true, status: "failed" });
    }

    if (!body.full_text || !body.segments?.length) {
      throw new ApiError(422, "A successful transcript needs both full_text and segments.");
    }

    const wordCount = body.full_text.trim().split(/\s+/).filter(Boolean).length;

    // Replace rather than append — a re-delivered webhook shouldn't double the
    // segment list.
    await prisma.transcriptSegment.deleteMany({ where: { transcript_id: id } });
    await prisma.transcriptSegment.createMany({
      data: body.segments.map((s) => ({
        transcript_id: id,
        start_seconds: s.start_seconds,
        end_seconds: s.end_seconds,
        speaker_label: s.speaker_label ?? null,
        text: s.text,
      })),
    });

    await prisma.transcript.update({
      where: { id },
      data: {
        status: "ready",
        full_text: body.full_text,
        word_count: wordCount,
        generated_at: new Date(),
      },
    });

    if (transcript.content_id) {
      await prisma.contentItem.update({
        where: { id: transcript.content_id },
        data: { has_transcript: true },
      });
    }

    res.json({ ok: true, status: "ready", word_count: wordCount, segments: body.segments.length });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /transcripts/:id ────────────────────────────────────────────────────

transcriptsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid transcript id");

    const transcript = await prisma.transcript.findFirst({ where: { id } });
    if (!transcript) throw new ApiError(404, "Transcript not found.");

    const segments = await prisma.transcriptSegment.findMany({
      where: { transcript_id: id },
      orderBy: { start_seconds: "asc" },
    });

    // provider carries "<name>:<job id>" internally; the caller only needs the name.
    const { provider, ...rest } = transcript;
    res.json({
      transcript: { ...rest, provider: provider?.split(":")[0] ?? null },
      segments: segments.map((s) => ({
        id: s.id,
        start_seconds: s.start_seconds != null ? Number(s.start_seconds) : null,
        end_seconds: s.end_seconds != null ? Number(s.end_seconds) : null,
        speaker_label: s.speaker_label,
        text: s.text,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── FUNCTION E — POST /transcripts/:id/generate-vtt ─────────────────────────

/** WebVTT timestamps are HH:MM:SS.mmm. */
function vttTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}

export function buildVtt(
  segments: { start_seconds: number | null; end_seconds: number | null; speaker_label: string | null; text: string | null }[],
): string {
  const cues = segments
    .filter((s) => s.start_seconds != null && s.text?.trim())
    .map((s, i) => {
      const start = Number(s.start_seconds);
      // A missing or non-advancing end time would produce a cue that never
      // displays; fall back to a readable two seconds.
      const rawEnd = s.end_seconds != null ? Number(s.end_seconds) : start;
      const end = rawEnd > start ? rawEnd : start + 2;
      const speaker = s.speaker_label ? `<v ${s.speaker_label}>` : "";
      return `${i + 1}\n${vttTimestamp(start)} --> ${vttTimestamp(end)}\n${speaker}${s.text!.trim()}`;
    });

  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** Uploads the .vtt and returns its URL. Falls back to a data URL when ImageKit
 *  isn't configured, so subtitles still work on a dev install. */
async function uploadVtt(vtt: string, fileName: string, correlationId: string): Promise<string> {
  if (!env.IMAGEKIT_PRIVATE_KEY) {
    return `data:text/vtt;charset=utf-8;base64,${Buffer.from(vtt, "utf8").toString("base64")}`;
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([vtt], { type: "text/vtt" }), fileName);
    form.append("fileName", fileName);
    form.append("folder", "/subtitles");

    const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.IMAGEKIT_PRIVATE_KEY}:`).toString("base64")}`,
      },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[${correlationId}] ImageKit upload failed (${res.status}):`, detail.slice(0, 500));
      throw new ApiError(502, `Couldn't upload the subtitle file. Quote reference ${correlationId} if this keeps happening.`);
    }

    const json = (await res.json()) as { url?: string };
    if (!json.url) throw new ApiError(502, `The image service returned no URL. Quote reference ${correlationId}.`);
    return json.url;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error(`[${correlationId}] ImageKit upload error:`, err);
    throw new ApiError(503, "Couldn't reach the file storage service. Please try again.");
  }
}

transcriptsRouter.post("/:id/generate-vtt", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid transcript id");
    const correlationId = randomUUID();

    const { language } = z.object({
      language: z.string().min(2).max(10).default("en"),
    }).parse(req.body ?? {});

    const transcript = await prisma.transcript.findFirst({ where: { id } });
    if (!transcript) throw new ApiError(404, "Transcript not found.");
    if (transcript.status !== "ready") {
      throw new ApiError(409, "This transcript isn't ready yet. Subtitles can only be generated once transcription finishes.");
    }

    const segments = await prisma.transcriptSegment.findMany({
      where: { transcript_id: id },
      orderBy: { start_seconds: "asc" },
      select: { start_seconds: true, end_seconds: true, speaker_label: true, text: true },
    });
    if (!segments.length) throw new ApiError(409, "This transcript has no segments to convert.");

    const vtt = buildVtt(segments.map((s) => ({
      start_seconds: s.start_seconds != null ? Number(s.start_seconds) : null,
      end_seconds: s.end_seconds != null ? Number(s.end_seconds) : null,
      speaker_label: s.speaker_label,
      text: s.text,
    })));

    const vttUrl = await uploadVtt(vtt, `transcript-${id}-${language}.vtt`, correlationId);

    const track = await prisma.subtitleTrack.create({
      data: {
        content_id: transcript.content_id,
        media_asset_id: transcript.media_asset_id,
        language,
        label: language.toUpperCase(),
        vtt_url: vttUrl,
        source: "generated",
        // Machine output is never marked reviewed — a human has to say so.
        is_reviewed: false,
      },
    });

    res.status(201).json({ subtitle_track_id: track.id, vtt_url: vttUrl, cues: segments.length });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
