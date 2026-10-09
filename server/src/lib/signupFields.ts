import { prisma } from "./prisma.js";
import { ApiError } from "./errors.js";

/**
 * The signup form is data, not code. `signup_fields` decides which inputs a
 * context collects, in what order, and which are required — so registration
 * validates against those rows rather than a hardcoded shape. An admin adding a
 * field must not require a deploy.
 */

export type FieldContext = "public" | "checkout" | "corporate_seat" | "instructor";

export interface PublicSignupField {
  field_key: string;
  label: string;
  field_type: string;
  is_required: boolean;
  display_order: number;
  options: string[];
  help_text: string | null;
}

/** Columns on `users` a signup field is allowed to write. A field_key outside
 *  this set is ignored rather than trusted — the table is admin-editable, and
 *  an arbitrary key must never become an arbitrary column write. */
const WRITABLE_COLUMNS = new Set([
  "full_name",
  "country",
  "timezone",
  "preferred_language",
  "industry",
  "job_role",
  "company_name",
  "headline",
  "bio",
]);

/** Handled by the auth flow itself, not written as profile columns. */
const CREDENTIAL_KEYS = new Set(["email", "password"]);

export async function listSignupFields(context: FieldContext): Promise<PublicSignupField[]> {
  const rows = await prisma.signupField.findMany({
    where: { context, is_enabled: true },
    orderBy: { display_order: "asc" },
    select: {
      field_key: true,
      label: true,
      field_type: true,
      is_required: true,
      display_order: true,
      options: true,
      help_text: true,
    },
  });

  return rows
    .filter((r) => r.field_key && r.field_type)
    .map((r) => ({
      field_key: r.field_key!,
      label: r.label ?? r.field_key!,
      field_type: r.field_type!,
      is_required: r.is_required,
      display_order: r.display_order,
      options: parseOptions(r.options),
      help_text: r.help_text,
    }));
}

function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    // Tolerate a comma-separated list — likelier than JSON from a hand-edited row.
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

export interface ValidatedSignup {
  /** Profile columns to write to `users`. */
  profile: Record<string, string>;
}

/**
 * Validates a submitted body against the field definitions and returns only the
 * profile columns safe to write. Throws 400 on a missing required field.
 */
export function validateSignup(
  fields: PublicSignupField[],
  body: Record<string, unknown>,
): ValidatedSignup {
  const profile: Record<string, string> = {};

  for (const field of fields) {
    if (CREDENTIAL_KEYS.has(field.field_key)) continue;

    const raw = body[field.field_key];
    const value = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();

    if (!value) {
      if (field.is_required) throw new ApiError(400, `${field.label} is required.`);
      continue;
    }

    if (field.field_type === "select" && field.options.length && !field.options.includes(value)) {
      throw new ApiError(400, `Choose one of the listed options for ${field.label}.`);
    }

    if (!WRITABLE_COLUMNS.has(field.field_key)) continue;

    profile[field.field_key] = value.slice(0, columnLimit(field.field_key));
  }

  return { profile };
}

/** Mirrors the VarChar widths in schema.prisma, so an over-long value is
 *  trimmed here rather than rejected by the database as a 500. */
function columnLimit(key: string): number {
  switch (key) {
    case "country":
      return 2;
    case "preferred_language":
      return 10;
    case "timezone":
      return 64;
    case "industry":
    case "job_role":
      return 80;
    case "full_name":
    case "company_name":
      return 150;
    case "headline":
      return 200;
    default:
      return 1000;
  }
}

/**
 * Where a multi-step form splits: credentials first, everything optional after.
 * Derived from the field list rather than hardcoded, so an admin reordering
 * fields moves the boundary with them.
 */
export function stepBoundary(fields: PublicSignupField[]): number {
  const firstOptional = fields.findIndex((f) => !f.is_required);
  return firstOptional === -1 ? fields.length : firstOptional;
}
