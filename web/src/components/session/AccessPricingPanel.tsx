import { Panel, Field, selectClass, inputClass } from "./Panel";

export type AccessLevel = "public" | "registered" | "subscriber" | "purchase" | "cohort";
export type PriceMode = "fixed" | "pay_what_you_can" | "free" | "sponsored";

interface Props {
  accessLevel: AccessLevel;
  priceMode: PriceMode;
  priceNgn: string;
  compareAtPriceNgn: string;
  suggestedPriceNgn: string;
  minimumPriceNgn: string;
  freePreviewSeconds: string;
  onAccessLevel: (v: AccessLevel) => void;
  onPriceMode: (v: PriceMode) => void;
  onPriceNgn: (v: string) => void;
  onCompareAtPriceNgn: (v: string) => void;
  onSuggestedPriceNgn: (v: string) => void;
  onMinimumPriceNgn: (v: string) => void;
  onFreePreviewSeconds: (v: string) => void;
  errors: Record<string, string>;
}

const ACCESS_LEVELS: { value: AccessLevel; label: string; note: string }[] = [
  { value: "public", label: "Public", note: "Anyone can watch without signing in." },
  { value: "registered", label: "Registered", note: "Free to watch for anyone with an account." },
  { value: "subscriber", label: "Subscriber", note: "Requires an active subscription plan." },
  { value: "purchase", label: "One-time Purchase", note: "Viewers pay once for access." },
  { value: "cohort", label: "Cohort", note: "Enrolled cohort members only." },
];

const PRICE_MODES: { value: PriceMode; label: string }[] = [
  { value: "fixed", label: "Fixed price" },
  { value: "pay_what_you_can", label: "Pay what you can" },
  { value: "free", label: "Free" },
  { value: "sponsored", label: "Sponsored" },
];

function formatNaira(v: string): string {
  const n = parseFloat(v);
  if (!v || isNaN(n)) return "";
  return `₦${n.toLocaleString("en-NG")}`;
}

function buildSummary(
  access: AccessLevel,
  mode: PriceMode,
  price: string,
  preview: string,
): string {
  const previewMins = Math.floor((parseInt(preview) || 0) / 60);
  const previewNote = previewMins > 0 ? ` First ${previewMins} minutes free.` : "";

  switch (access) {
    case "public": return `Anyone can watch for free without signing in.${previewNote}`;
    case "registered": return `Free for registered users.${previewNote}`;
    case "subscriber": return `Active subscribers only.${previewNote}`;
    case "purchase":
      if (mode === "fixed" && price) return `Viewers pay ${formatNaira(price)} for lifetime access.${previewNote}`;
      if (mode === "pay_what_you_can") return `Viewers choose their price.${previewNote}`;
      if (mode === "free") return `Listed as purchase but priced at ₦0.${previewNote}`;
      if (mode === "sponsored") return `Sponsored access — viewer pays nothing.${previewNote}`;
      return `Paid access.${previewNote}`;
    case "cohort": return `Cohort enrolment required.${previewNote}`;
    default: return "";
  }
}

export function AccessPricingPanel({
  accessLevel,
  priceMode,
  priceNgn,
  compareAtPriceNgn,
  suggestedPriceNgn,
  minimumPriceNgn,
  freePreviewSeconds,
  onAccessLevel,
  onPriceMode,
  onPriceNgn,
  onCompareAtPriceNgn,
  onSuggestedPriceNgn,
  onMinimumPriceNgn,
  onFreePreviewSeconds,
  errors,
}: Props) {
  const isPurchase = accessLevel === "purchase";
  const isPwyc = isPurchase && priceMode === "pay_what_you_can";
  const showPrice = isPurchase && priceMode === "fixed";
  const summary = buildSummary(accessLevel, priceMode, priceNgn, freePreviewSeconds);

  return (
    <Panel title="Access & Pricing">
      <div className="space-y-4">
        {/* Access Level — radio buttons for clarity */}
        <Field label="Access Level" required>
          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
            {ACCESS_LEVELS.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-3"
              >
                <input
                  type="radio"
                  name="access_level"
                  value={opt.value}
                  checked={accessLevel === opt.value}
                  onChange={() => onAccessLevel(opt.value)}
                  className="mt-1 accent-brand"
                />
                <div>
                  <span className="text-sm text-slate-100">{opt.label}</span>
                  <p className="text-xs text-slate-500">{opt.note}</p>
                </div>
              </label>
            ))}
          </div>
        </Field>

        {/* Price mode — only shown for purchase */}
        {isPurchase && (
          <Field label="Price Mode">
            <select
              className={selectClass}
              value={priceMode}
              onChange={(e) => onPriceMode(e.target.value as PriceMode)}
            >
              {PRICE_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
        )}

        {/* Price */}
        {showPrice && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (₦)" required error={errors.priceNgn}>
              <input
                type="number"
                className={inputClass}
                min={0}
                step={100}
                value={priceNgn}
                onChange={(e) => onPriceNgn(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Compare-at price (₦)" hint="Shown struck-through as 'was' price.">
              <input
                type="number"
                className={inputClass}
                min={0}
                step={100}
                value={compareAtPriceNgn}
                onChange={(e) => onCompareAtPriceNgn(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </div>
        )}

        {/* PWYC */}
        {isPwyc && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Suggested price (₦)">
              <input
                type="number"
                className={inputClass}
                min={0}
                step={100}
                value={suggestedPriceNgn}
                onChange={(e) => onSuggestedPriceNgn(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Minimum price (₦)" error={errors.minimumPriceNgn}>
              <input
                type="number"
                className={inputClass}
                min={0}
                step={100}
                value={minimumPriceNgn}
                onChange={(e) => onMinimumPriceNgn(e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
        )}

        {/* Free preview */}
        <Field label="Free preview (minutes)" hint="Let any visitor watch the first N minutes before requiring sign-in or payment.">
          <input
            type="number"
            className={inputClass}
            min={0}
            value={freePreviewSeconds ? String(Math.floor(parseInt(freePreviewSeconds) / 60)) : "0"}
            onChange={(e) => onFreePreviewSeconds(String((parseInt(e.target.value) || 0) * 60))}
            placeholder="0"
          />
        </Field>

        {/* Plain-English summary */}
        {summary && (
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <p className="text-xs text-slate-300">{summary}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}
