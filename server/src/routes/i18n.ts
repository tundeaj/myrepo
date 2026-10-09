import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const i18nRouter = Router();

// Public — the whole point of ui_translations is that logged-out visitors see
// translated strings too. Returns { [translation_key]: { en, fr } }.
i18nRouter.get("/", async (_req, res) => {
  const rows = await prisma.uiTranslation.findMany();
  const dict: Record<string, { en: string | null; fr: string | null }> = {};
  for (const row of rows) {
    dict[row.translation_key] = { en: row.en, fr: row.fr };
  }
  res.json({ translations: dict });
});
