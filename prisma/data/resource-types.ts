export type ResourceTypeSeed = {
  code: string;
  kind: "COUNTABLE" | "STATUS";
  consumable: boolean;
  nameBn: string;
  nameEn: string;
  bloodGroup?: "A_POS" | "A_NEG" | "B_POS" | "B_NEG" | "O_POS" | "O_NEG" | "AB_POS" | "AB_NEG";
};

const c = (code: string, nameBn: string, nameEn: string, consumable = false): ResourceTypeSeed => ({
  code, kind: "COUNTABLE", consumable, nameBn, nameEn,
});
const s = (code: string, nameBn: string, nameEn: string): ResourceTypeSeed => ({
  code, kind: "STATUS", consumable: false, nameBn, nameEn,
});
const blood = (group: NonNullable<ResourceTypeSeed["bloodGroup"]>, label: string, bn: string): ResourceTypeSeed => ({
  code: `BLOOD_${group}`, kind: "COUNTABLE", consumable: true, bloodGroup: group,
  nameBn: `রক্ত ${bn}`, nameEn: `Blood ${label}`,
});

/** Order here is the sortOrder. */
export const RESOURCE_TYPES: ResourceTypeSeed[] = [
  c("GENERAL_BED", "সাধারণ বেড", "General bed"),
  c("ICU_BED", "আইসিইউ বেড", "ICU bed"),
  c("CCU_BED", "সিসিইউ বেড", "CCU bed"),
  c("NICU_BED", "এনআইসিইউ বেড", "NICU bed"),
  c("VENTILATOR", "ভেন্টিলেটর", "Ventilator"),
  c("STRETCHER", "স্ট্রেচার/হুইলচেয়ার", "Stretcher / wheelchair"),
  c("OXYGEN_CYLINDER", "অক্সিজেন সিলিন্ডার", "Oxygen cylinder", true),
  c("PLATELETS", "প্লাটিলেট", "Platelets", true),
  c("ANTIVENOM", "অ্যান্টিভেনম (সাপের বিষের প্রতিষেধক)", "Antivenom vials", true),
  c("RABIES_VACCINE", "জলাতঙ্ক টিকা", "Rabies vaccine doses", true),
  c("RABIES_IG", "র‍্যাবিস ইমিউনোগ্লোবুলিন (RIG)", "Rabies immunoglobulin (RIG)", true),
  blood("A_POS", "A+", "A+"),
  blood("A_NEG", "A-", "A-"),
  blood("B_POS", "B+", "B+"),
  blood("B_NEG", "B-", "B-"),
  blood("O_POS", "O+", "O+"),
  blood("O_NEG", "O-", "O-"),
  blood("AB_POS", "AB+", "AB+"),
  blood("AB_NEG", "AB-", "AB-"),
  s("CT_SCAN", "সিটি স্ক্যান", "CT scan"),
  s("CATH_LAB", "ক্যাথ ল্যাব", "Cath lab"),
  s("OPERATION_THEATRE", "অপারেশন থিয়েটার", "Operation theatre"),
  s("NEUROLOGIST_ON_DUTY", "নিউরোলজিস্ট ডিউটিতে", "Neurologist on duty"),
  s("CARDIOLOGIST_ON_DUTY", "কার্ডিওলজিস্ট ডিউটিতে", "Cardiologist on duty"),
  s("SURGEON_ON_DUTY", "সার্জন ডিউটিতে", "Surgeon on duty"),
  s("GYNECOLOGIST_ON_DUTY", "গাইনি বিশেষজ্ঞ ডিউটিতে", "Gynecologist on duty"),
];
