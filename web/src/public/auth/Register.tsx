import { useState, useEffect, useMemo } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth, type AuthUser } from "../../lib/AuthContext";
import { fetchPublic, postPublic } from "../lib/publicPage";
import { AuthShell, fieldClass, submitClass, FormError, FormNotice, Label } from "./AuthShell";

/**
 * Registration, rendered from `signup_fields` rather than a hardcoded form.
 *
 * The step boundary comes from the server too — it is the index of the first
 * optional field — so an admin reordering fields moves where step one ends
 * without a deploy.
 */

interface SignupField {
  field_key: string;
  label: string;
  field_type: string;
  is_required: boolean;
  options: string[];
  help_text: string | null;
}

interface FieldsPayload {
  fields: SignupField[];
  flow: "single_step" | "multi_step";
  step_boundary: number;
}

interface RegisterResponse {
  token?: string;
  user: AuthUser;
  verification_required: boolean;
  message?: string;
}

function inputType(fieldType: string): string {
  switch (fieldType) {
    case "email":
      return "email";
    case "password":
      return "password";
    case "phone":
      return "tel";
    default:
      return "text";
  }
}

function autoComplete(key: string): string | undefined {
  switch (key) {
    case "email":
      return "email";
    case "password":
      return "new-password";
    case "full_name":
      return "name";
    case "company_name":
      return "organization";
    case "phone":
      return "tel";
    case "country":
      return "country";
    default:
      return undefined;
  }
}

export function Register() {
  const { adoptSession, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [config, setConfig] = useState<FieldsPayload | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    fetchPublic<FieldsPayload>("/api/signup/fields")
      .then(setConfig)
      .catch(() => setLoadFailed(true));
  }, []);

  const steps = useMemo(() => {
    if (!config) return [] as SignupField[][];
    if (config.flow === "single_step" || config.step_boundary >= config.fields.length) {
      return [config.fields];
    }
    return [config.fields.slice(0, config.step_boundary), config.fields.slice(config.step_boundary)];
  }, [config]);

  if (status === "signed-in") return <Navigate to={from} replace />;

  if (loadFailed) {
    return (
      <AuthShell title="Create an account" subtitle="Something went wrong.">
        <p className="text-sm text-slate-400">
          We couldn't load the signup form. Refresh the page and try again.
        </p>
      </AuthShell>
    );
  }

  if (!config) {
    return (
      <AuthShell title="Create an account">
        <div className="space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-800/60" />
          ))}
        </div>
      </AuthShell>
    );
  }

  const isLastStep = step === steps.length - 1;
  const currentFields = steps[step] ?? [];

  function missingRequired(fields: SignupField[]): string | null {
    for (const f of fields) {
      if (f.is_required && !(values[f.field_key] ?? "").trim()) return `${f.label} is required.`;
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const missing = missingRequired(currentFields);
    if (missing) {
      setError(missing);
      return;
    }

    // Step two is skippable, so "Continue" only advances — it never submits.
    if (!isLastStep) {
      setStep(step + 1);
      return;
    }

    setBusy(true);
    try {
      const body = await postPublic<RegisterResponse>("/api/auth/register", values);

      if (body.verification_required || !body.token) {
        // No session: an unverified account cannot hold one.
        setNotice(body.message ?? "Check your email for a confirmation link.");
        return;
      }

      adoptSession(body.token, body.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      // The server's wording is deliberate — "an account with this email
      // already exists" is more useful than a generic failure.
      setError(err?.message ?? "We couldn't create your account. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (notice) {
    return (
      <AuthShell title="Almost there" subtitle="One step left.">
        <FormNotice message={notice} />
        <p className="mt-4 text-xs text-slate-500">
          The link is good for 24 hours. If it doesn't arrive, check your spam folder.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create an account"
      subtitle={
        steps.length > 1 ? `Step ${step + 1} of ${steps.length}` : "It takes less than a minute."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link to="/signin" state={{ from }} className="text-white underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />

        {currentFields.map((field) => (
          <div key={field.field_key}>
            <Label htmlFor={field.field_key}>
              {field.label}
              {!field.is_required && <span className="ml-1 text-slate-600">(optional)</span>}
            </Label>

            {field.field_type === "select" ? (
              <select
                id={field.field_key}
                value={values[field.field_key] ?? ""}
                onChange={(e) => setValues({ ...values, [field.field_key]: e.target.value })}
                className={fieldClass}
              >
                <option value="">Choose…</option>
                {field.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={field.field_key}
                type={inputType(field.field_type)}
                autoComplete={autoComplete(field.field_key)}
                value={values[field.field_key] ?? ""}
                onChange={(e) => setValues({ ...values, [field.field_key]: e.target.value })}
                className={fieldClass}
              />
            )}

            {field.help_text && <p className="mt-1 text-xs text-slate-600">{field.help_text}</p>}
          </div>
        ))}

        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? "Creating your account…" : isLastStep ? "Create account" : "Continue"}
        </button>

        {/* Step two collects profile detail only — nothing here is needed to
            have an account, so skipping it must be a visible option. */}
        {!isLastStep ? null : steps.length > 1 && step > 0 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="block w-full text-center text-xs text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline"
          >
            Back
          </button>
        ) : null}
      </form>
    </AuthShell>
  );
}
