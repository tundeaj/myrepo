import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Thrown deliberately by route handlers; caught and rendered as plain English. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Global error handler. Never leaks a raw database/framework error to the client —
 * logs the real error server-side with a correlation ID and returns a plain-English
 * message plus that ID, so a user can quote it back to support.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const correlationId = randomUUID();

  if (err instanceof ApiError) {
    if (err.status >= 500) {
      console.error(`[${correlationId}] ${req.method} ${req.path}:`, err);
    }
    return res.status(err.status).json({ error: err.message, correlationId });
  }

  console.error(`[${correlationId}] ${req.method} ${req.path}:`, err);
  return res.status(500).json({
    error: "Something went wrong on our end. Please try again.",
    correlationId,
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: "Not found", correlationId: randomUUID() });
}
