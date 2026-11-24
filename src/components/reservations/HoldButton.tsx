"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { fmtNum } from "@/components/finder/format";
import { postJson } from "@/lib/api-client";
import type { Bilingual } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { reservations as t } from "@/lib/i18n/reservations";
import { SoldOutPanel, type AlternativeItem } from "./SoldOutPanel";

export type HoldResource = { code: string; nameBn: string; nameEn: string; available: number };

export type HoldButtonProps = {
  hospitalId: string;
  resource: HoldResource;
  conditionCode?: string;
  bloodGroup?: string;
  origin?: { lat: number; lng: number };
  signedIn: boolean;
  loginHref: string;
  lang: Lang;
};

type Failure = { message: Bilingual; limit?: boolean; login?: boolean };

const btn =
  "inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-center text-base font-bold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-wait disabled:opacity-70";

export function holdLabel(resource: HoldResource, lang: Lang): string {
  const name = lang === "bn" ? resource.nameBn : resource.nameEn;
  return t.holdLabel[lang].replace("{name}", name).replace("{n}", fmtNum(resource.available, lang));
}

/**
 * Holds one unit for 30 minutes. One Idempotency-Key per user action: created on the first click and
 * kept until the server gives a definitive answer (2xx/4xx), so a retry after a network error or 5xx
 * can never create a second hold. A ref (not state) blocks the second click of a double-click.
 */
export function HoldButton(props: HoldButtonProps) {
  const { hospitalId, resource, conditionCode, bloodGroup, origin, signedIn, loginHref, lang } = props;
  const router = useRouter();
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativeItem[] | null>(null);

  if (!signedIn) {
    return (
      <a href={loginHref} data-testid="login-to-hold" className={btn}>
        {t.loginToHold[lang]}
      </a>
    );
  }

  async function hold() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    keyRef.current ??= crypto.randomUUID();
    const res = await postJson<{ reservation: { id: string } }>(
      "/api/reservations",
      { hospitalId, resourceCode: resource.code, quantity: 1, conditionCode, bloodGroup, lat: origin?.lat, lng: origin?.lng },
      { idempotencyKey: keyRef.current },
    );

    if (res.ok) {
      // Stay disabled while navigating to the tracker.
      router.push(`/reservations/${encodeURIComponent(res.data.reservation.id)}`);
      return;
    }
    if (!("error" in res) || res.status >= 500) {
      // Network drop or server failure: keep the key, so the retry is the same action.
      setFailure({ message: t.networkProblem });
    } else {
      keyRef.current = null; // definitive answer: the next click is a new action
      const { code, message, details } = res.error;
      if (code === "SOLD_OUT") {
        const list = (details as { alternatives?: AlternativeItem[] } | undefined)?.alternatives;
        setAlternatives(Array.isArray(list) ? list : []);
      } else {
        setFailure({ message, limit: code === "LIMIT_REACHED", login: code === "UNAUTHENTICATED" });
      }
    }
    inFlight.current = false;
    setPending(false);
  }

  if (alternatives) {
    return <SoldOutPanel {...props} alternatives={alternatives} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="hold-button"
        data-resource={resource.code}
        className={btn}
        disabled={pending}
        aria-busy={pending}
        onClick={hold}
      >
        {pending ? t.holding[lang] : holdLabel(resource, lang)}
      </button>
      {failure && (
        <div role="alert" data-testid="hold-error" className="flex flex-col gap-1 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">
          <p>⚠️ {failure.message[lang]}</p>
          {failure.limit && (
            <Link href="/reservations" className="inline-flex min-h-11 items-center font-semibold underline">
              {t.seeMyReservations[lang]}
            </Link>
          )}
          {failure.login && (
            <a href={loginHref} className="inline-flex min-h-11 items-center font-semibold underline">
              {t.loginToHold[lang]}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
