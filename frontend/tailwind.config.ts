import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic tokens — values come from CSS variables in globals.css and
        // switch automatically between light and dark. rgb(var ... ) form keeps
        // Tailwind opacity modifiers (e.g. bg-card/80) working.
        app: "rgb(var(--app) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        muted: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          fg: "rgb(var(--muted-fg) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          soft: "rgb(var(--fg-soft) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          strong: "rgb(var(--line-strong) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          hover: "rgb(var(--brand-hover) / <alpha-value>)",
          fg: "rgb(var(--brand-fg) / <alpha-value>)",
          subtle: "rgb(var(--brand-subtle) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
