"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { tokenStore } from "@/lib/auth";
import { Camera, ShieldCheck, Bell } from "lucide-react";

export default function Landing() {
  const router = useRouter();

  useEffect(() => {
    if (tokenStore.getToken()) router.replace("/dashboard");
  }, [router]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="text-2xl font-semibold tracking-tight text-slate-900">
          Snap<span className="text-emerald-600">Park</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="mt-20 grid items-center gap-12 md:grid-cols-2">
        <div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-slate-900 md:text-5xl">
            Report illegal parking with a single photo.
          </h1>
          <p className="mt-6 text-lg text-slate-600">
            SnapPark uses Google Gemini to analyse the image you submit, decide
            whether a violation has occurred, and forward verified cases to
            local authorities — all in seconds.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              href="/register"
              className="rounded-md bg-emerald-600 px-5 py-3 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Create free account
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              I already have one
            </Link>
          </div>
        </div>

        <div className="grid gap-4">
          <FeatureCard
            icon={<Camera className="h-5 w-5" />}
            title="Snap & submit"
            body="Upload up to five images per report. We pre-filter blurry or dark photos before any AI call."
          />
          <FeatureCard
            icon={<ShieldCheck className="h-5 w-5" />}
            title="AI-reasoned decisions"
            body="Gemini returns a confidence score and a written explanation for every case."
          />
          <FeatureCard
            icon={<Bell className="h-5 w-5" />}
            title="Multi-channel alerts"
            body="In-app, email, SMS and push — get notified when your case is reported and resolved."
          />
        </div>
      </section>

      <footer className="mt-24 border-t border-slate-200 pt-6 text-center text-sm text-slate-500">
        SnapPark dissertation project — University of York Europe Campus.
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-emerald-50 p-2 text-emerald-600">
          {icon}
        </div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </div>
  );
}
