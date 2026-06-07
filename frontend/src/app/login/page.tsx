"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { tokenStore } from "@/lib/auth";
import type { AuthResponse } from "@/lib/types";
import { AuthShell } from "@/components/ui/AuthShell";
import { CheckCircle2 } from "lucide-react";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reset = searchParams.get("reset");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<AuthResponse>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
      tokenStore.set(data.token, data.refreshToken, data.user);
      router.replace("/dashboard");
    } catch (err) {
      // Unverified accounts get bounced back to the OTP screen with a fresh
      // code already on the way. The auth service signals this via 403 +
      // requiresVerification.
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        (err.body as { requiresVerification?: boolean })?.requiresVerification
      ) {
        const target = (err.body as { email?: string })?.email || email;
        router.replace(`/verify-otp?email=${encodeURIComponent(target)}`);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Log in to SnapPark"
      subtitle="Welcome back. Submit a report or check the status of an existing case."
      altLabel="New here?"
      altHref="/register"
      altCta="Create an account"
    >
      {reset === "success" && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-brand-subtle p-3 text-sm text-brand-fg">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Password updated. Please sign in with your new password.
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-brand hover:text-brand-fg"
          >
            Forgot password?
          </Link>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
    </label>
  );
}
