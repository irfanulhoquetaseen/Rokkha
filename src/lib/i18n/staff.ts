import type { Bilingual } from "@/lib/errors";

export const staff = {
  title: { bn: "হাসপাতাল রিসোর্স কনসোল", en: "Hospital resource console" },
  intro: {
    bn: "বেড, রক্ত, ওষুধ ও সেবার সর্বশেষ অবস্থা এখানে হালনাগাদ করুন। পরিবর্তন সাথে সাথে রোগীরা দেখতে পান।",
    en: "Keep beds, blood, medicines and services up to date here. Patients see every change immediately.",
  },
  groupBeds: { bn: "বেড ও যন্ত্রপাতি", en: "Beds & equipment" },
  groupBlood: { bn: "রক্ত, ওষুধ ও ব্যবহার্য সামগ্রী", en: "Blood, medicines & consumables" },
  groupServices: { bn: "সেবা ও বিশেষজ্ঞ", en: "Services & specialists" },
  search: { bn: "নাম দিয়ে খুঁজুন", en: "Search by name" },
  filter: { bn: "ফিল্টার", en: "Filter" },
  filterAll: { bn: "সব", en: "All" },
  filterLow: { bn: "কম মজুদ (≤ ১)", en: "Low stock (≤ 1)" },
  filterStale: { bn: "পুরনো তথ্য", en: "Stale" },
  noMatch: { bn: "এই খোঁজ/ফিল্টারে কিছু পাওয়া যায়নি", en: "Nothing matches this search/filter" },
  available: { bn: "খালি", en: "Available" },
  total: { bn: "মোট", en: "Total" },
  increase: { bn: "এক বাড়ান", en: "Increase by one" },
  decrease: { bn: "এক কমান", en: "Decrease by one" },
  set: { bn: "সেট করুন", en: "Set" },
  save: { bn: "সংরক্ষণ", en: "Save" },
  cancel: { bn: "বাতিল", en: "Cancel" },
  saving: { bn: "সংরক্ষণ হচ্ছে…", en: "Saving…" },
  on: { bn: "চালু", en: "On" },
  off: { bn: "বন্ধ", en: "Off" },
  stale: { bn: "৩০ মিনিটের বেশি পুরনো — নিশ্চিত করুন", en: "Older than 30 min — please confirm" },
  justNow: { bn: "এইমাত্র হালনাগাদ", en: "Updated just now" },
  setInvalid: {
    bn: "খালি ও মোট ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে, আর খালি মোটের বেশি হতে পারবে না",
    en: "Available and total must be whole numbers ≥ 0, and available cannot exceed total",
  },
  conflictTitle: { bn: "অন্য একজন স্টাফ এটি পরিবর্তন করেছেন", en: "Another staff member changed this" },
  conflictCurrent: { bn: "সার্ভারে এখনকার মান", en: "Current value on the server" },
  conflictYours: { bn: "আপনার পরিবর্তন", en: "Your change" },
  reload: { bn: "নতুন মান নিন", en: "Reload" },
  reapply: { bn: "আমারটা আবার দিন", en: "Re-apply" },
  networkError: { bn: "সংযোগে সমস্যা, আবার চেষ্টা করুন", en: "Connection problem, please try again" },
} as const satisfies Record<string, Bilingual>;

/** Strings with a number inside. */
export const staffFmt = {
  updatedAgo(min: number): Bilingual {
    return min < 1 ? staff.justNow : { bn: `${min} মিনিট আগে হালনাগাদ`, en: `Updated ${min} min ago` };
  },
};
