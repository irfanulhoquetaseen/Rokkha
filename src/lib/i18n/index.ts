import type { Bilingual } from "@/lib/errors";

export type Lang = "bn" | "en";
export const LANG_COOKIE = "lang";

export function parseLang(v: string | undefined): Lang {
  return v === "en" ? "en" : "bn";
}

export function pick(lang: Lang, b: Bilingual): string {
  return b[lang];
}
