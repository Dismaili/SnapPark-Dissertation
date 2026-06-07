"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/ui/AuthShell";
import { OtpInput } from "@/components/ui/OtpInput";

const OTP_LENGTH = 4;

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info,  setInfo]  = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending,  setResending]  = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!email) {
      setError("Missing email — please restart the reset flow.");
      return;
    }
    if (code.length !== OTP_LENGTH) {
      setError(`Please enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch<{ message: string }>("/auth/reset-password", {
        method: "POST",
        auth: false,
        body: { email, code, newPassword },
      });
      router.replace("/login?reset=success");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setInfo(null);
    if (!email) {
      setError("Missing email — please restart the reset flow.");
      return;
    }
    setResending(true);
    try {
      await apiFetch<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        auth: false,
        body: { email },
      });
      setInfo("A new code has been sent. Check your inbox.");
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to resend code.");
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle={
        email
          ? `Enter the ${OTP_LENGTH}-digit code we sent to ${email} and choose a new password.`
          : `Enter the ${OTP_LENGTH}-digit code we sent and choose a new password.`
      }
      altLabel="Remembered it?"
      altHref="/login"
      altCta="Back to sign in"
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <OtpInput value={code} onChange={setCode} length={OTP_LENGTH} disabled={submitting} />

        <Field
          label="New password"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
          minLength={8}
          required
          hint="At least 8 characters."
        />
        <Field
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          minLength={8}
          required
        />

        {error && (
          <p className="rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>
        )}
        {info && (
          <p className="rounded-md bg-brand-subtle p-3 text-sm text-brand-fg">{info}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Updating password…" : "Set new password"}
        </button>

        <p className="text-center text-sm text-muted-fg">
          Didn&apos;t receive a code?{" "}
          <button
            type="button"
            onClick={onResend}
            disabled={resending}
            className="font-medium text-brand hover:text-brand-fg disabled:opacity-60"
          >
            {resending ? "Sending…" : "Resend"}
          </button>
        </p>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-fg-soft">{label}</span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm placeholder:text-muted-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
      {hint && <span className="mt-1 block text-xs text-muted-fg">{hint}</span>}
    </label>
  );
}
