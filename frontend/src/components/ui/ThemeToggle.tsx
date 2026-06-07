"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import clsx from "clsx";

/**
 * Light/dark theme toggle. The actual <html class="dark"> is set as early as
 * possible by the inline bootstrap script in the root layout (see themeInit),
 * so there is no flash of the wrong theme. This component only reflects and
 * flips that state, persisting the choice to localStorage.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* localStorage may be unavailable (private mode) — ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Toggle theme"}
      title={mounted ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Toggle theme"}
      className={clsx(
        "inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-fg-soft transition-colors hover:bg-muted",
        className,
      )}
    >
      {/* Render both and toggle visibility to avoid hydration mismatch */}
      <Sun className="h-[18px] w-[18px] dark:hidden" />
      <Moon className="hidden h-[18px] w-[18px] dark:block" />
    </button>
  );
}

/**
 * Inline script string injected into <head> before paint. Sets the dark class
 * based on the saved preference, falling back to the OS setting. Kept tiny and
 * dependency-free so it can run synchronously.
 */
export const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;
