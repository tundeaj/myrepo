import { prisma } from "./prisma.js";
import { findField } from "./settingsSchema.js";

/**
 * Reads one setting, falling back to the catalogue default.
 *
 * Policy settings an admin can see and change must actually govern behaviour —
 * a session-timeout box in the Settings Hub that the token signer ignores is
 * worse than no box at all.
 */
export async function getSetting(key: string): Promise<string> {
  const row = await prisma.setting.findFirst({
    where: { setting_key: key },
    select: { setting_value: true, is_secret: true },
  });
  if (row?.setting_value != null && row.setting_value !== "") return row.setting_value;
  return findField(key)?.default ?? "";
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const value = Number(await getSetting(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function getBoolSetting(key: string, fallback = false): Promise<boolean> {
  const value = (await getSetting(key)).toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
