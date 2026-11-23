"use client";

import { useRef, useState, type MouseEvent } from "react";

type Labels = { use: string; locating: string; denied: string };

/**
 * Asks the browser for the current position, fills the hidden lat/lng inputs of the enclosing
 * GET form, clears the area choice and submits. The only client JS on the Finder page.
 */
export function LocationButton({ labels }: { labels: Labels }) {
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "locating" | "error">("idle");

  function locate(e: MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    if (!form || !("geolocation" in navigator)) {
      setState("error");
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = latRef.current;
        const lng = lngRef.current;
        if (!lat || !lng) return;
        lat.value = pos.coords.latitude.toFixed(4);
        lng.value = pos.coords.longitude.toFixed(4);
        lat.disabled = false;
        lng.disabled = false;
        const area = form.elements.namedItem("area");
        if (area instanceof HTMLSelectElement) area.value = "";
        form.requestSubmit();
      },
      () => setState("error"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Disabled until a position is known, so they are never submitted empty. */}
      <input ref={latRef} type="hidden" name="lat" disabled />
      <input ref={lngRef} type="hidden" name="lng" disabled />
      <button
        type="button"
        onClick={locate}
        disabled={state === "locating"}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-400 px-3 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
      >
        <span aria-hidden="true">📍</span>
        {state === "locating" ? labels.locating : labels.use}
      </button>
      {state === "error" && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400">
          {labels.denied}
        </p>
      )}
    </div>
  );
}
