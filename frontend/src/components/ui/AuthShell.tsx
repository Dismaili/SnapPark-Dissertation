import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export function AuthShell({
  title,
  subtitle,
  children,
  altLabel,
  altHref,
  altCta,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  altLabel: string;
  altHref: string;
  altCta: string;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-app px-4 py-12">
      <Link
        href="/"
        aria-label="Back to home"
        title="Back to home"
        className="absolute left-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-fg-soft transition-colors hover:bg-muted"
      >
        <ArrowLeft className="h-[18px] w-[18px]" />
      </Link>
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-8 block text-center text-2xl font-semibold tracking-tight text-fg"
        >
          Snap<span className="text-brand">Park</span>
        </Link>
        <div className="rounded-xl border border-line bg-card p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-fg">{title}</h1>
          <p className="mt-1 text-sm text-muted-fg">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-6 text-center text-sm text-muted-fg">
          {altLabel}{" "}
          <Link
            href={altHref}
            className="font-medium text-brand hover:text-brand-fg"
          >
            {altCta}
          </Link>
        </p>
      </div>
    </main>
  );
}
