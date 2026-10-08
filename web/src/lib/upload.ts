import { getToken, ApiRequestError } from "./api";

/**
 * Real file upload to /api/media/upload-image — multipart/form-data, so it
 * can't reuse api()'s fetch wrapper, which always sends Content-Type:
 * application/json. Same error-shape handling as api() itself, so a caller
 * can show err.message exactly the same way either call's failure would.
 *
 * Returns the real, durable URL ImageKit hands back — never a
 * URL.createObjectURL() blob: reference, which only ever resolves in the
 * current tab and is already broken the moment the page reloads.
 */
export async function uploadImage(file: File): Promise<string> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);

  let res: Response;
  try {
    res = await fetch("/api/media/upload-image", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
  } catch {
    throw new ApiRequestError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    let correlationId: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      correlationId = body?.correlationId;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new ApiRequestError(res.status, message, correlationId);
  }

  const body = (await res.json()) as { url: string };
  return body.url;
}
