import { env } from "./env.js";
import { ApiError } from "./errors.js";

/**
 * Generic ImageKit file upload — the real mechanism behind this app's one
 * genuinely-working upload path (routes/transcripts.ts's uploadVtt(), which
 * posts a generated .vtt file the exact same way). Extracted here so
 * routes/media.ts's image-upload endpoint doesn't duplicate the auth/error
 * handling, and uploadVtt() below now calls this instead of repeating it.
 *
 * ImageKit's own delivery/transform layer is already wired on the public
 * site (web/src/public/lib/images.ts, which rewrites any URL under the
 * configured ImageKit endpoint into a resized tr: variant) — this is the
 * other half: getting a real file there in the first place, with a real
 * URL back, rather than the admin console's previous local-blob-URL or
 * simulated-progress-bar stand-ins.
 */
export async function uploadToImageKit(file: Buffer, fileName: string, folder: string, correlationId: string): Promise<string> {
  if (!env.IMAGEKIT_PRIVATE_KEY) {
    throw new ApiError(503, "Image uploads aren't configured yet. Add an ImageKit private key in Settings → Integrations.");
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([file]), fileName);
    form.append("fileName", fileName);
    form.append("folder", folder);
    // Left at ImageKit's default (a random suffix appended to fileName) —
    // two admins uploading two different files both named "photo.jpg" must
    // never collide. The previous upload a replace leaves behind is simply
    // orphaned on ImageKit's side, not deleted; cleaning those up would need
    // tracking each field's prior file_id through ImageKit's management API,
    // out of scope for this round.

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
      throw new ApiError(502, `Couldn't upload the file. Quote reference ${correlationId} if this keeps happening.`);
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
