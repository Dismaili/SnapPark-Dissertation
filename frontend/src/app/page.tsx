"use client";

import Link from "next/link";
import Image from "next/image";
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
import { ThemeToggle } from "@/components/ui/ThemeToggle";

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
    <div className="min-h-screen bg-card">
      {/* ─── Top navigation ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-semibold tracking-tight text-fg">
            Snap<span className="text-brand">Park</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted-fg md:flex">
            <a href="#how-it-works" className="hover:text-fg">How it works</a>
            <a href="#features" className="hover:text-fg">Features</a>
            <a href="#about" className="hover:text-fg">About</a>
            <a href="#faq" className="hover:text-fg">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="rounded-md px-4 py-2 text-sm font-medium text-fg-soft hover:bg-muted"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      <section className="border-b border-line bg-gradient-to-b from-brand-subtle/50 to-card">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="grid items-center gap-12 md:grid-cols-2 lg:gap-16">
            <div>
              <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-fg md:text-5xl">
                Report illegal parking with a single photo
              </h1>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-fg">
                Take a photo of a parking violation, let the AI verify it in
                seconds, and the case is forwarded to local authorities —
                automatically.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
                >
                  Create free account
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-md border border-line-strong px-5 py-2.5 text-sm font-semibold text-fg-soft hover:bg-muted"
                >
                  I already have one
                </Link>
              </div>
            </div>

            {/* Mock preview card */}
            <div className="relative">
              <div className="rounded-xl border border-line bg-card p-6 shadow-sm">
                <div className="flex items-center gap-3 border-b border-line pb-4">
                  <div className="h-9 w-9 rounded-md bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center text-white">
                    <Camera className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-fg">New report submitted</div>
                    <div className="text-xs text-muted-fg">2 seconds ago · Athens, Greece</div>
                  </div>
                </div>
                <div className="relative mt-4 aspect-video overflow-hidden rounded-md bg-muted">
                  <Image
                    src="/hero-example.png"
                    alt="A car parked illegally, blocking the sidewalk"
                    fill
                    sizes="(min-width: 768px) 28rem, 100vw"
                    className="object-cover"
                    priority
                  />
                </div>
                <div className="mt-4 rounded-md bg-red-50 dark:bg-red-950/40 p-3 ring-1 ring-red-200 dark:ring-red-900">
                  <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                    <ShieldCheck className="h-4 w-4" />
                    Violation detected: Blocking sidewalk
                  </div>
                  <div className="mt-1 text-xs text-red-600 dark:text-red-400">Confidence: 96%</div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-brand-subtle px-2 py-2">
                    <div className="text-xs font-semibold text-brand-fg">Analysed</div>
                    <CheckCircle2 className="mx-auto mt-1 h-4 w-4 text-brand" />
                  </div>
                  <div className="rounded bg-brand-subtle px-2 py-2">
                    <div className="text-xs font-semibold text-brand-fg">Reported</div>
                    <CheckCircle2 className="mx-auto mt-1 h-4 w-4 text-brand" />
                  </div>
                  <div className="rounded bg-app px-2 py-2">
                    <div className="text-xs font-semibold text-muted-fg">Resolved</div>
                    <div className="mx-auto mt-1 h-4 w-4 rounded-full border-2 border-line-strong border-dashed" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-fg">
              How it works
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              From photo to resolution in three steps
            </h2>
          </div>

          <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-3">
            <Step
              icon={<Upload className="h-6 w-6" />}
              title="Snap a photo"
              body="Open SnapPark, take a clear photo of the violation, and submit. Up to 5 images per report. Quality is checked automatically."
            />
            <Step
              icon={<Sparkles className="h-6 w-6" />}
              title="AI analyses it"
              body="SnapPark's AI identifies the violation type, returns a confidence score, and writes a plain-English explanation."
            />
            <Step
              icon={<Send className="h-6 w-6" />}
              title="Authorities are notified"
              body="Verified cases are forwarded to municipal traffic departments. You get email and SMS updates as the case progresses."
            />
          </div>
        </div>
      </section>

      {/* ─── Features grid ───────────────────────────────────────────────── */}
      <section id="features" className="border-t border-line bg-app py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-fg">
              Features
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              Built for citizens, designed for accountability
            </h2>
          </div>

          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
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
      <section id="about" className="border-t border-line py-20">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-fg">
            About
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            Why SnapPark exists
          </h2>
          <div className="mt-8 space-y-5 text-base leading-relaxed text-muted-fg">
            <p>
              In cities across Europe, illegal parking is more than an inconvenience — it blocks
              ambulances, forces wheelchair users into traffic, and makes pedestrian crossings
              unsafe. Yet reporting a violation traditionally means a phone call, a long wait,
              and no way to track what happens next.
            </p>
            <p>
              <strong className="font-semibold text-fg">SnapPark</strong> exists to close
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

      {/* ─── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="border-t border-line py-20">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-fg">
            FAQ
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
            Common questions
          </h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
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
      <section className="border-t border-line bg-app">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-16 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              Ready to make your street safer?
            </h2>
            <p className="mt-2 text-muted-fg">
              Create a free account in under a minute and submit your first report.
            </p>
          </div>
          <Link
            href="/register"
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-line bg-app">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex flex-col items-center justify-between gap-4 text-sm text-muted-fg md:flex-row">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold tracking-tight text-fg-soft">
                Snap<span className="text-brand">Park</span>
              </span>
              <span>·</span>
              <span>Dissertation Project</span>
            </div>
            <div className="flex items-center gap-5">
              <a href="#how-it-works" className="hover:text-fg-soft">How it works</a>
              <a href="#features" className="hover:text-fg-soft">Features</a>
              <a href="#faq" className="hover:text-fg-soft">FAQ</a>
              <Link href="/login" className="hover:text-fg-soft">Log in</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Step({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="border-t border-line pt-5">
      <span className="text-brand">{icon}</span>
      <h3 className="mt-4 text-base font-semibold text-fg">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-fg">{body}</p>
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
    <div className="bg-card p-6 transition-colors hover:bg-muted/40">
      <div className="flex items-center gap-2.5 text-brand">
        {icon}
        <h3 className="font-semibold text-fg">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-fg">{body}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-fg">
        {q}
        <span className="text-lg font-normal leading-none text-muted-fg transition group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-fg">{a}</p>
    </details>
  );
}
