import Link from "next/link";

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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-8 block text-center text-2xl font-semibold tracking-tight text-slate-900"
        >
          Snap<span className="text-emerald-600">Park</span>
        </Link>
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">
          {altLabel}{" "}
          <Link
            href={altHref}
            className="font-medium text-emerald-600 hover:text-emerald-700"
          >
            {altCta}
          </Link>
        </p>
      </div>
    </main>
  );
}
