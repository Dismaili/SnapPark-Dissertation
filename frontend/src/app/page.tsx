"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { tokenStore } from "@/lib/auth";
import {
  Camera,
  ShieldCheck,
  Bell,
  Zap,
  Lock,
  FileSearch,
  Upload,
  Sparkles,
  Send,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

export default function Landing() {
  const router = useRouter();

  useEffect(() => {
    const token = tokenStore.getToken();
    const user  = tokenStore.getUser();
    if (token && user) {
      // Valid session — send straight to the app.
      router.replace("/dashboard");
    } else if (token && !user) {
      // Stale / corrupt token with no user object — clear it so the
      // landing page is shown cleanly instead of bouncing to /login.
      tokenStore.clear();
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-white">
      {/* ─── Top navigation ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-semibold tracking-tight text-slate-900">
            Snap<span className="text-emerald-600">Park</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#how-it-works" className="hover:text-slate-900">How it works</a>
            <a href="#features" className="hover:text-slate-900">Features</a>
            <a href="#about" className="hover:text-slate-900">About</a>
            <a href="#faq" className="hover:text-slate-900">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
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
          </div>
        </div>
      </header>

      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-emerald-50 via-white to-white" />
        <div className="absolute -top-32 right-0 -z-10 h-96 w-96 rounded-full bg-emerald-100 blur-3xl opacity-60" />
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid items-center gap-12 md:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                <Sparkles className="h-3 w-3" /> AI-powered parking enforcement
              </span>
              <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight text-slate-900 md:text-6xl">
                Report illegal parking with a single photo
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-slate-600">
                SnapPark turns ordinary citizens into civic helpers. Take a photo
                of a parking violation, our AI verifies it in seconds, and the case
                is forwarded to local authorities — automatically.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                >
                  Create free account
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  I already have one
                </Link>
              </div>
              <p className="mt-5 text-xs text-slate-500">
                Free to use · No credit card required · Verified by AI
              </p>
            </div>

            {/* Mock preview card */}
            <div className="relative">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                  <div className="h-9 w-9 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">New report submitted</div>
                    <div className="text-xs text-slate-500">2 seconds ago · Athens, Greece</div>
                  </div>
                </div>
                <div className="mt-4 aspect-video rounded-md bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                  <Camera className="h-10 w-10 text-slate-400" />
                </div>
                <div className="mt-4 rounded-md bg-red-50 p-3 ring-1 ring-red-200">
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                    <ShieldCheck className="h-4 w-4" />
                    Violation detected: Blocking sidewalk
                  </div>
                  <div className="mt-1 text-xs text-red-600">Confidence: 96%</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-emerald-50 px-2 py-2">
                    <div className="text-xs font-semibold text-emerald-700">Analysed</div>
                    <CheckCircle2 className="mx-auto mt-1 h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="rounded bg-emerald-50 px-2 py-2">
                    <div className="text-xs font-semibold text-emerald-700">Reported</div>
                    <CheckCircle2 className="mx-auto mt-1 h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="rounded bg-slate-50 px-2 py-2">
                    <div className="text-xs font-semibold text-slate-500">Resolved</div>
                    <div className="mx-auto mt-1 h-4 w-4 rounded-full border-2 border-slate-300 border-dashed" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="border-t border-slate-100 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <span className="text-sm font-semibold uppercase tracking-wide text-emerald-600">
              How it works
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              From photo to resolution in three steps
            </h2>
            <p className="mt-4 text-slate-600">
              No paperwork, no phone calls, no chasing officials. Just submit and let SnapPark do the rest.
            </p>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            <Step
              number="01"
              icon={<Upload className="h-6 w-6" />}
              title="Snap a photo"
              body="Open SnapPark, take a clear photo of the violation, and submit. Up to 5 images per report. Quality is checked automatically."
            />
            <Step
              number="02"
              icon={<Sparkles className="h-6 w-6" />}
              title="AI analyses it"
              body="SnapPark's AI identifies the violation type, returns a confidence score, and writes a plain-English explanation."
            />
            <Step
              number="03"
              icon={<Send className="h-6 w-6" />}
              title="Authorities are notified"
              body="Verified cases are forwarded to municipal traffic departments. You get email and SMS updates as the case progresses."
            />
          </div>
        </div>
      </section>

      {/* ─── Features grid ───────────────────────────────────────────────── */}
      <section id="features" className="border-t border-slate-100 bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <span className="text-sm font-semibold uppercase tracking-wide text-emerald-600">
              Features
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Built for citizens, designed for accountability
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <Feature
              icon={<Sparkles className="h-5 w-5" />}
              title="AI-powered verdicts"
              body="A multimodal vision model classifies violations and returns calibrated confidence scores."
            />
            <Feature
              icon={<Bell className="h-5 w-5" />}
              title="Multi-channel alerts"
              body="Choose how to get notified: in-app, email, or SMS via Twilio. Set it once and forget it."
            />
            <Feature
              icon={<FileSearch className="h-5 w-5" />}
              title="Full audit trail"
              body="Every case has a tamper-proof event history — submission, analysis, reporting, resolution."
            />
            <Feature
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Quality pre-filtering"
              body="Blurry, dark, or low-resolution photos are rejected before they hit the AI — saving compute and improving accuracy."
            />
            <Feature
              icon={<Lock className="h-5 w-5" />}
              title="Secure by design"
              body="JWT-based auth, bcrypt-hashed passwords, role-based access, and email verification on every account."
            />
            <Feature
              icon={<Zap className="h-5 w-5" />}
              title="Microservices architecture"
              body="Three independent services behind an API gateway, message broker for events, and database-per-service."
            />
          </div>
        </div>
      </section>

      {/* ─── About ───────────────────────────────────────────────────────── */}
      <section id="about" className="border-t border-slate-100 py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <span className="text-sm font-semibold uppercase tracking-wide text-emerald-600">
              About
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Why SnapPark exists
            </h2>
          </div>
          <div className="mt-10 space-y-5 text-base leading-relaxed text-slate-600">
            <p>
              In cities across Europe, illegal parking is more than an inconvenience — it blocks
              ambulances, forces wheelchair users into traffic, and makes pedestrian crossings
              unsafe. Yet reporting a violation traditionally means a phone call, a long wait,
              and no way to track what happens next.
            </p>
            <p>
              <strong className="font-semibold text-slate-900">SnapPark</strong> exists to close
              that gap. By combining a smartphone camera with state-of-the-art vision AI, any
              citizen can flag a parking violation in under thirty seconds. The platform takes
              care of validation, classification, and forwarding — and gives the reporter a
              clear, auditable record of the case.
            </p>
            <p>
              This project is the dissertation work of Drin Ismaili at City College, University
              of York Europe Campus, supervised by Dr. Veloudis. It demonstrates a practical
              application of microservice architecture, multimodal AI, and event-driven
              communication to a problem that affects millions of people every day.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Tech stack ──────────────────────────────────────────────────── */}
      <section className="border-t border-slate-100 bg-slate-50 py-16">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Built with
          </h3>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm font-medium text-slate-600">
            <span>Next.js 15</span>
            <span>·</span>
            <span>Express</span>
            <span>·</span>
            <span>PostgreSQL</span>
            <span>·</span>
            <span>RabbitMQ</span>
            <span>·</span>
            <span>Twilio</span>
            <span>·</span>
            <span>Docker</span>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="border-t border-slate-100 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center">
            <span className="text-sm font-semibold uppercase tracking-wide text-emerald-600">
              Frequently asked
            </span>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
              Common questions
            </h2>
          </div>
          <div className="mt-10 space-y-4">
            <Faq
              q="Is SnapPark free to use?"
              a="Yes — for citizens it's completely free. The platform is funded as research by the University of York Europe Campus."
            />
            <Faq
              q="What happens to my data?"
              a="Your photos are analysed by SnapPark's AI and stored securely with your account. They are only forwarded to authorities when you confirm the report. You can delete cases at any time."
            />
            <Faq
              q="What if the AI gets it wrong?"
              a="Every verdict comes with a confidence score and a written explanation. You can review the result before forwarding to authorities — nothing is reported automatically."
            />
            <Faq
              q="Which violations does it detect?"
              a="Blocking sidewalks, blocking crosswalks, parking on disabled spaces without a permit, double parking, parking in fire lanes, and more."
            />
            <Faq
              q="Where does SnapPark operate?"
              a="The current dissertation prototype is configured for Greek and Albanian cities, but the model is region-agnostic and the platform can be deployed anywhere."
            />
          </div>
        </div>
      </section>

      {/* ─── Final CTA ───────────────────────────────────────────────────── */}
      <section className="border-t border-slate-100">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
            Ready to make your street safer?
          </h2>
          <p className="mt-4 text-slate-600">
            Create a free account in under a minute and submit your first report.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Get started — it's free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col items-center justify-between gap-4 text-sm text-slate-500 md:flex-row">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight text-slate-700">
                Snap<span className="text-emerald-600">Park</span>
              </span>
              <span>·</span>
              <span>Dissertation Project</span>
            </div>
            <div className="flex items-center gap-5">
              <a href="#how-it-works" className="hover:text-slate-700">How it works</a>
              <a href="#features" className="hover:text-slate-700">Features</a>
              <a href="#faq" className="hover:text-slate-700">FAQ</a>
              <Link href="/login" className="hover:text-slate-700">Log in</Link>
            </div>
          </div>
          <div className="mt-6 border-t border-slate-200 pt-5 text-center text-xs text-slate-400">
            © {new Date().getFullYear()} SnapPark — University of York Europe Campus, City College.
            Supervised by Dr. Veloudis.
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Step({
  number,
  icon,
  title,
  body,
}: {
  number: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="absolute -top-3 right-5 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold tracking-wider text-emerald-700">
        {number}
      </div>
      <div className="flex h-11 w-11 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-emerald-50 p-2 text-emerald-600">{icon}</div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-900">
        {q}
        <span className="ml-4 text-slate-400 transition group-open:rotate-45">+</span>
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{a}</p>
    </details>
  );
}
