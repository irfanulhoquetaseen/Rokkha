import type { Bilingual } from "@/lib/errors";

export const reservations = {
  holdExpired: { bn: "এই হোল্ডের মেয়াদ শেষ হয়ে গেছে", en: "This hold has expired" },
  invalidTransition: { bn: "এই অবস্থায় এই কাজটি করা যাবে না", en: "This action is not allowed in the current status" },
  rejectReasonRequired: {
    bn: "প্রত্যাখ্যানের কারণ লিখুন (৩–৩০০ অক্ষর)",
    en: "Please give a reason for rejecting (3–300 characters)",
  },
  cannotHold: { bn: "এই রিসোর্সটি হোল্ড করা যায় না", en: "This resource cannot be held" },
  unknownCondition: { bn: "এই জরুরি অবস্থাটি চেনা যায়নি", en: "Unknown emergency condition" },
  keyReused: {
    bn: "এই অনুরোধ-কী ইতিমধ্যে অন্য একটি অনুরোধে ব্যবহার হয়েছে",
    en: "This request key was already used for a different request",
  },
  limitSameType: {
    bn: "এই ধরনের রিসোর্সের জন্য আপনার ইতিমধ্যে একটি সক্রিয় হোল্ড আছে",
    en: "You already have an active hold for this resource type",
  },
  limitMaxActive: {
    bn: "একসাথে সর্বোচ্চ ২টি সক্রিয় হোল্ড রাখা যায়",
    en: "You can have at most 2 active holds at a time",
  },
  soldOut: {
    bn: "এই হাসপাতালে এটি এইমাত্র শেষ হয়ে গেছে — কাছের বিকল্প দেখুন",
    en: "This just ran out at this hospital — see nearby alternatives",
  },
} as const satisfies Record<string, Bilingual>;
