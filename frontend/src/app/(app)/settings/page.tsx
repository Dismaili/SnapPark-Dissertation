"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { tokenStore } from "@/lib/auth";
import type { NotificationPreferences } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckCircle2, Loader2 } from "lucide-react";

const CHANNELS: {
  key: "in_app" | "email" | "sms" | "push";
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
  {
    key: "push",
    label: "Push notifications (Firebase)",
    description: "Mobile push via Firebase Cloud Messaging.",
    addressField: "fcm_token",
    addressLabel: "FCM device token",
    addressPlaceholder: "Paste your FCM token",
    addressType: "text",
  },
];

export default function SettingsPage() {
  const user = tokenStore.getUser();
  const qc = useQueryClient();
  const [form, setForm] = useState<NotificationPreferences | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["preferences", user?.id],
    queryFn: () =>
      apiFetch<NotificationPreferences>(
        `/notifications/preferences/${user!.id}`,
      ),
    enabled: !!user,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      apiFetch(`/notifications/preferences/${user!.id}`, {
        method: "PUT",
        body: next,
      }),
    onSuccess: () => {
      setSavedAt(Date.now());
      setError(null);
      qc.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to save.");
    },
  });

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="Notification preferences"
        description="Choose where and how you'd like SnapPark to reach you."
      />

      <div className="max-w-2xl p-8">
        {isLoading || !form ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
            className="space-y-4"
          >
            {CHANNELS.map((ch) => {
              const enabled = form[ch.key];
              return (
                <div
                  key={ch.key}
                  className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {ch.label}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {ch.description}
                      </p>
                    </div>
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={enabled}
                        onChange={(e) =>
                          setForm({ ...form, [ch.key]: e.target.checked })
                        }
                      />
                      <div className="h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:bg-emerald-600 peer-checked:after:translate-x-5"></div>
                    </label>
                  </div>

                  {ch.addressField && enabled && (
                    <div className="mt-4">
                      <label className="block text-xs font-medium text-slate-600">
                        {ch.addressLabel}
                      </label>
                      <input
                        type={ch.addressType}
                        placeholder={ch.addressPlaceholder}
                        value={(form[ch.addressField] as string) || ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            [ch.addressField as string]: e.target.value,
                          })
                        }
                        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      />
                    </div>
                  )}
                </div>
              );
            })}

            <div className="flex items-center justify-end gap-3 pt-2">
              {error && <p className="text-xs text-red-600">{error}</p>}
              {savedAt && !error && (
                <p className="inline-flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                </p>
              )}
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
      </div>
    </>
  );
}
