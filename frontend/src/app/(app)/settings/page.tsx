"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { tokenStore } from "@/lib/auth";
import type { NotificationPreferences } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckCircle2, Loader2, User, Lock, Bell } from "lucide-react";

// ─── Notification channels (Firebase removed) ─────────────────────────────────

const CHANNELS: {
  key: "in_app" | "email" | "sms";
  label: string;
  description: string;
  addressField?: keyof NotificationPreferences;
  addressLabel?: string;
  addressPlaceholder?: string;
  addressType?: string;
}[] = [
  {
    key: "in_app",
    label: "In-app notifications",
    description: "Always available — visible from the bell icon in the sidebar.",
  },
  {
    key: "email",
    label: "Email",
    description: "We'll email you when your case is analysed, reported, or resolved.",
    addressField: "email_addr",
    addressLabel: "Email address",
    addressPlaceholder: "you@example.com",
    addressType: "email",
  },
  {
    key: "sms",
    label: "SMS (Twilio)",
    description: "Short text messages for the most important updates.",
    addressField: "phone",
    addressLabel: "Phone number (E.164)",
    addressPlaceholder: "+447700900000",
    addressType: "tel",
  },
];

// ─── Shared components ────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
        <Icon className="h-4 w-4 text-emerald-600" />
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function SaveFeedback({ savedAt, error }: { savedAt: number | null; error: string | null }) {
  return (
    <div className="flex items-center justify-end gap-3 pt-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      {savedAt && !error && (
        <p className="inline-flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> Saved
        </p>
      )}
    </div>
  );
}

// ─── Profile section ──────────────────────────────────────────────────────────

function ProfileSection({ user }: { user: NonNullable<ReturnType<typeof tokenStore.getUser>> }) {
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ firstName: string; lastName: string }>("/auth/profile", {
        method: "PATCH",
        body: { firstName, lastName },
      }),
    onSuccess: (data) => {
      // Update localStorage so the sidebar name refreshes
      const stored = tokenStore.getUser();
      if (stored) {
        tokenStore.set(
          tokenStore.getToken()!,
          tokenStore.getRefreshToken()!,
          { ...stored, firstName: data.firstName, lastName: data.lastName },
        );
      }
      setSavedAt(Date.now());
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save."),
  });

  return (
    <Section icon={User} title="Profile">
      <form
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">First name</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Last name</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Email address</span>
          <input
            type="email"
            value={user.email}
            disabled
            className="mt-1 block w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
          />
          <span className="mt-1 block text-xs text-slate-400">Email cannot be changed.</span>
        </label>
        <div className="flex items-center justify-between pt-1">
          <SaveFeedback savedAt={savedAt} error={error} />
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {save.isPending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </Section>
  );
}

// ─── Security section ─────────────────────────────────────────────────────────

function SecuritySection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/auth/password", {
        method: "PATCH",
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: () => {
      setSavedAt(Date.now());
      setError(null);
      setCurrent(""); setNext(""); setConfirm("");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to update password."),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("Passwords do not match."); return; }
    save.mutate();
  };

  return (
    <Section icon={Lock} title="Security">
      <form onSubmit={onSubmit} className="space-y-4">
        {(["Current password", "New password", "Confirm new password"] as const).map((label, i) => {
          const value = [current, next, confirm][i];
          const setter = [setCurrent, setNext, setConfirm][i];
          return (
            <label key={label} className="block">
              <span className="text-xs font-medium text-slate-600">{label}</span>
              <input
                type="password"
                value={value}
                onChange={(e) => setter(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </label>
          );
        })}
        <div className="flex items-center justify-between pt-1">
          <SaveFeedback savedAt={savedAt} error={error} />
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {save.isPending ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </Section>
  );
}

// ─── Notifications section ────────────────────────────────────────────────────

function NotificationsSection({ user }: { user: NonNullable<ReturnType<typeof tokenStore.getUser>> }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<NotificationPreferences | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["preferences", user.id],
    queryFn: () =>
      apiFetch<NotificationPreferences>(`/notifications/preferences/${user.id}`),
    enabled: !!user,
  });

  useEffect(() => {
    if (!data) return;
    setForm({ ...data, email_addr: data.email_addr || user.email || null });
  }, [data, user.email]);

  const save = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      apiFetch(`/notifications/preferences/${user.id}`, { method: "PUT", body: next }),
    onSuccess: () => {
      setSavedAt(Date.now());
      setError(null);
      qc.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to save."),
  });

  return (
    <Section icon={Bell} title="Notifications">
      {isLoading || !form ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(form); }} className="space-y-4">
          {CHANNELS.map((ch) => {
            const enabled = form[ch.key] as boolean;
            return (
              <div key={ch.key} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{ch.label}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">{ch.description}</p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={enabled}
                      onChange={(e) => setForm({ ...form, [ch.key]: e.target.checked })}
                    />
                    <div className="h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:bg-emerald-600 peer-checked:after:translate-x-5" />
                  </label>
                </div>
                {ch.addressField && enabled && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-600">{ch.addressLabel}</label>
                    <input
                      type={ch.addressType}
                      placeholder={ch.addressPlaceholder}
                      value={(form[ch.addressField] as string) || ""}
                      onChange={(e) => setForm({ ...form, [ch.addressField as string]: e.target.value })}
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1">
            <SaveFeedback savedAt={savedAt} error={error} />
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const user = tokenStore.getUser();
  if (!user) return null;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your profile, password, and notification preferences."
      />
      <div className="max-w-2xl space-y-6 p-4 sm:p-6 md:p-8">
        <ProfileSection user={user} />
        <SecuritySection />
        <NotificationsSection user={user} />
      </div>
    </>
  );
}
