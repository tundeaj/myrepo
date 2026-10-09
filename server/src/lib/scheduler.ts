import { Queue, Worker, type Job } from "bullmq";
import { redis } from "./redis.js";
import { sweepHoldback } from "./earnings.js";

/**
 * Real, Redis-backed job scheduling — this app's first. Everything that
 * needed a scheduler before now ran lazily instead (see sweepHoldback()'s
 * own doc in lib/earnings.ts) or was left an explicit, stated gap.
 *
 * Single queue, dispatched by job name, run as a Worker inside this same
 * process — matching the existing "a single API instance is the deployment
 * shape here" reasoning lib/rateLimit.ts already stated. A separate worker
 * process would be the right move on a multi-instance deploy; the Queue/
 * Worker split below is exactly the seam that move would use.
 */
const QUEUE_NAME = "scheduler-maintenance";
const SWEEP_HOLDBACK_JOB = "sweep-holdback";

export const maintenanceQueue = new Queue(QUEUE_NAME, { connection: redis });

async function processJob(job: Job): Promise<void> {
  switch (job.name) {
    case SWEEP_HOLDBACK_JOB:
      await sweepHoldback();
      return;
    default:
      // An unrecognised job name is a deploy/version mismatch (an old worker
      // seeing a new job type, or vice versa) — never silently no-op it.
      throw new Error(`Unrecognised scheduled job: ${job.name}`);
  }
}

let worker: Worker | undefined;

/** Called once at boot (index.ts). Registers the repeatable job — idempotent
 *  via upsertJobScheduler's own schedulerId key, so a restart (tsx watch,
 *  every dev reload) never piles up duplicate repeatable entries — and
 *  starts the worker that actually runs it. */
export async function startScheduler(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler(
    SWEEP_HOLDBACK_JOB,
    { every: 15 * 60_000 }, // every 15 minutes — frequent enough that an admin never waits long past a holdback lapsing, cheap enough to run constantly (a single updateMany against an indexed status column)
    { name: SWEEP_HOLDBACK_JOB },
  );

  worker = new Worker(QUEUE_NAME, processJob, { connection: redis });
  worker.on("failed", (job, err) => {
    console.error(`[scheduler] job "${job?.name ?? "unknown"}" failed:`, err.message);
  });
}

export async function stopScheduler(): Promise<void> {
  await worker?.close();
}
