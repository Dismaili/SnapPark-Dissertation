"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { tokenStore } from "@/lib/auth";
import type { AuthResponse } from "@/lib/types";
import { AuthShell } from "@/components/ui/AuthShell";
import { OtpInput } from "@/components/ui/OtpInput";

const OTP_LENGTH = 4;

function VerifyOtpInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info,  setInfo]  = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending,  setResending]  = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (code.length !== OTP_LENGTH) {
      setError(`Please enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    if (!email) {
      setError("Missing email — please restart registration.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiFetch<AuthResponse>("/auth/verify-otp", {
        method: "POST",
        auth: false,
        body: { email, code },
      });
      tokenStore.set(data.token, data.refreshToken, data.user);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setInfo(null);
    if (!email) {
      setError("Missing email — please restart registration.");
      return;
    }
    setResending(true);
    try {
      await apiFetch<{ message: string }>("/auth/resend-otp", {
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
      title="Verify your email"
      subtitle={
        email
          ? `Enter the ${OTP_LENGTH}-digit code we sent to ${email}.`
          : `Enter the ${OTP_LENGTH}-digit code we sent to your email.`
      }
      altLabel="Wrong email?"
      altHref="/register"
      altCta="Start over"
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <OtpInput value={code} onChange={setCode} length={OTP_LENGTH} disabled={submitting} />

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}
        {info && (
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{info}</p>
        )}

        <button
          type="submit"
          disabled={submitting || code.length !== OTP_LENGTH}
          className="w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Verifying…" : "Verify and continue"}
        </button>

        <p className="text-center text-sm text-slate-600">
          Didn&apos;t receive a code?{" "}
          <button
            type="button"
            onClick={onResend}
            disabled={resending}
            className="font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-60"
          >
            {resending ? "Sending…" : "Resend"}
          </button>
        </p>
      </form>
    </AuthShell>
  );
}

export default function VerifyOtpPage() {
  // useSearchParams must be inside a Suspense boundary in Next.js app router.
  return (
    <Suspense fallback={null}>
      <VerifyOtpInner />
    </Suspense>
  );
}
