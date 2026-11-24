import type { Bilingual } from "@/lib/errors";

export const realtime = {
  reconnecting: { bn: "আবার সংযোগ হচ্ছে…", en: "Reconnecting…" },
  availableNow: { bn: "এখন খালি", en: "Available now" },
  liveNote: { bn: "নিজে থেকেই আপডেট হয় — রিলোড করার দরকার নেই।", en: "Updates live — no need to reload." },
  stockTitle: { bn: "এখনকার মজুদ ও সেবা", en: "Live stock and services" },
  colResource: { bn: "রিসোর্স", en: "Resource" },
  colAvailable: { bn: "খালি / মোট", en: "Available / total" },
  colUpdated: { bn: "আপডেট", en: "Updated" },
  statusOn: { bn: "চালু", en: "On" },
  statusOff: { bn: "বন্ধ", en: "Off" },
  noLiveData: {
    bn: "এই হাসপাতাল লাইভ তথ্য দেয় না — যাওয়ার আগে ফোন করে জেনে নিন।",
    en: "This hospital does not share live data — call before you go.",
  },
  findHospital: { bn: "জরুরি অবস্থার জন্য হাসপাতাল খুঁজুন", en: "Find a hospital for an emergency" },
} as const satisfies Record<string, Bilingual>;
