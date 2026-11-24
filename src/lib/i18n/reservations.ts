import type { Bilingual } from "@/lib/errors";

export const reservations = {
  holdExpired: { bn: "এই হোল্ডের মেয়াদ শেষ হয়ে গেছে", en: "This hold has expired" },
  invalidTransition: { bn: "এই অবস্থায় এই কাজটি করা যাবে না", en: "This action is not allowed in the current status" },
  rejectReasonRequired: {
    bn: "প্রত্যাখ্যানের কারণ লিখুন (৩–৩০০ অক্ষর)",
    en: "Please give a reason for rejecting (3–300 characters)",
  },
} as const satisfies Record<string, Bilingual>;
