import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";

// ─── Payout details — Paystack-verified bank account.
// The resolved account name comes from the BANK, never typed by the instructor.
// ⚠️ We do not collect BVN or any national identity number, by design.

interface PayoutInfo {
  bank_name: string | null;
  account_number_masked: string | null;
  account_name_resolved: string | null;
  payout_verified: boolean;
}

interface Bank {
  name: string;
  code: string;
}

export function PayoutDetails() {
  const [payout, setPayout] = useState<PayoutInfo | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();

  // Form state
  const [editing, setEditing] = useState(false);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolvedBankName, setResolvedBankName] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ payout: PayoutInfo }>("/portal/payout-details"),
      api<{ banks: Bank[] }>("/portal/banks"),
    ])
      .then(([p, b]) => {
        setPayout(p.payout);
        setBanks(b.banks);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message ?? "Failed to load payout details.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const accountValid = /^\d{10}$/.test(accountNumber);

  async function verify() {
    setFormErr(null);
    if (!bankCode) { setFormErr("Select your bank."); return; }
    if (!accountValid) { setFormErr("Account number must be exactly 10 digits."); return; }
    setVerifying(true);
    try {
      const res = await api<{ account_name: string; bank_name: string }>("/portal/payout-details/verify", {
        method: "POST",
        body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber }),
      });
      setResolvedName(res.account_name);
      setResolvedBankName(res.bank_name);
    } catch (e: any) {
      setFormErr(e.message ?? "Could not verify the account. Check the details and try again.");
      setResolvedName(null);
    } finally {
      setVerifying(false);
    }
  }

  async function confirm() {
    if (!resolvedName) return;
    setConfirming(true);
    setFormErr(null);
    try {
      const res = await api<{ payout: PayoutInfo }>("/portal/payout-details/confirm", {
        method: "POST",
        body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber, account_name: resolvedName }),
      });
      setPayout(res.payout);
      setEditing(false);
      setBankCode("");
      setAccountNumber("");
      setResolvedName(null);
      setResolvedBankName(null);
    } catch (e: any) {
      setFormErr(e.message ?? "Failed to save payout details.");
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56 w-full max-w-lg" />
      </div>
    );
  }
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Payout Details</h1>
        <p className="text-sm text-slate-500">Where we send your earnings each payout cycle</p>
      </div>

      <div className="max-w-lg space-y-5">
        {/* Current status */}
        {payout?.payout_verified && !editing ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                ✓ Verified
              </span>
            </div>
            <dl className="space-y-3">
              <div>
                <dt className="text-xs font-medium text-slate-500">Bank</dt>
                <dd className="mt-0.5 text-sm text-slate-100">{payout.bank_name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Account number</dt>
                <dd className="mt-0.5 font-mono text-sm text-slate-100">{payout.account_number_masked}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-slate-500">Account name</dt>
                <dd className="mt-0.5 text-sm text-slate-100">{payout.account_name_resolved}</dd>
              </div>
            </dl>
            <button
              onClick={() => setEditing(true)}
              className="mt-5 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Change bank account
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            {!payout?.payout_verified && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                Add and verify your bank account to receive payouts. Earnings accrue either way — they're just held until this is set up.
              </div>
            )}

            <div className="space-y-4">
              {/* Bank select — stores bank_code, never free text */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Bank</label>
                <select
                  value={bankCode}
                  onChange={(e) => { setBankCode(e.target.value); setResolvedName(null); }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
                >
                  <option value="">Select your bank…</option>
                  {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                </select>
              </div>

              {/* 10-digit account number */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">Account number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  value={accountNumber}
                  onChange={(e) => {
                    setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10));
                    setResolvedName(null);
                  }}
                  placeholder="0123456789"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-brand focus:outline-none"
                />
                {accountNumber && !accountValid && (
                  <p className="mt-1 text-xs text-amber-400">{10 - accountNumber.length} more digit{10 - accountNumber.length === 1 ? "" : "s"} needed</p>
                )}
              </div>

              {/* Verify */}
              {!resolvedName ? (
                <button
                  onClick={verify}
                  disabled={verifying || !bankCode || !accountValid}
                  className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {verifying ? "Verifying with your bank…" : "Verify account"}
                </button>
              ) : (
                <div className="space-y-3">
                  {/* Resolved name — READ-ONLY, from the bank */}
                  <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-4">
                    <p className="text-xs font-medium text-emerald-400">Account name (from {resolvedBankName})</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-200">{resolvedName}</p>
                    <p className="mt-1 text-xs text-emerald-400/70">
                      This name comes directly from the bank and can't be edited. If it's not you, check the account number.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setResolvedName(null)}
                      className="flex-1 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
                    >
                      Change details
                    </button>
                    <button
                      onClick={confirm}
                      disabled={confirming}
                      className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                    >
                      {confirming ? "Saving…" : "Confirm — this is me"}
                    </button>
                  </div>
                </div>
              )}

              {formErr && <p className="text-sm text-red-400">{formErr}</p>}

              {editing && (
                <button onClick={() => { setEditing(false); setFormErr(null); setResolvedName(null); }} className="text-xs text-slate-500 hover:text-slate-300">
                  Cancel — keep my current account
                </button>
              )}
            </div>
          </div>
        )}

        {/* Privacy note */}
        <p className="text-xs text-slate-600">
          We only need your bank account to pay you. We never ask for your BVN or any national identity number —
          if anyone claiming to be Webinarflix asks for these, it's a scam.
        </p>
      </div>
    </div>
  );
}
