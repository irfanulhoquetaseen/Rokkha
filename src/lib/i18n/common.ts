import type { Bilingual } from "@/lib/errors";

export const common = {
  phoneInvalid: { bn: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (যেমন 01712345678)", en: "Enter a valid Bangladeshi mobile number (e.g. 01712345678)" },
  loading: { bn: "লোড হচ্ছে…", en: "Loading…" },
  retry: { bn: "আবার চেষ্টা করুন", en: "Try again" },
} as const satisfies Record<string, Bilingual>;
