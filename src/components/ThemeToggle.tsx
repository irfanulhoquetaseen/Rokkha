"use client";

import { useSyncExternalStore } from "react";
import type { Lang } from "@/lib/i18n";

export const THEME_STORAGE_KEY = "rokkha-theme";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener("rokkha-theme-change", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("rokkha-theme-change", cb);
  };
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

const getServerSnapshot = () => false;

/** Compact light/dark mode switch; defaults to LIGHT and stores preference in localStorage safely. */
export function ThemeToggle({ lang }: { lang: Lang }) {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const nextDark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", nextDark);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextDark ? "dark" : "light");
    } catch {
      // Storage may be unavailable in private browsing or restricted contexts.
    }
    window.dispatchEvent(new Event("rokkha-theme-change"));
  }

  const label = isDark
    ? lang === "bn" ? "হালকা মোডে যান" : "Switch to light theme"
    : lang === "bn" ? "অন্ধকার মোডে যান" : "Switch to dark theme";

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggle}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
    >
      {/* Sun icon shown when in dark mode; Moon icon shown when in light mode (via CSS so zero hydration flash). */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="hidden dark:inline"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="inline dark:hidden"
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    </button>
  );
}
