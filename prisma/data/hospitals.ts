/**
 * 25 FICTIONAL hospitals (CLAUDE.md §5: demo data, never real availability).
 * Coordinates are real area centres with small per-hospital offsets.
 */
export type HospitalProfile = "full" | "mid" | "small" | "rural";

/** Total per resource code per profile; absent code = capability not present (total 0). */
const PROFILE_COUNTS: Record<HospitalProfile, Record<string, number>> = {
  full: { GENERAL_BED: 120, ICU_BED: 12, CCU_BED: 8, NICU_BED: 6, VENTILATOR: 8, STRETCHER: 15, OXYGEN_CYLINDER: 40, PLATELETS: 20, ANTIVENOM: 10, RABIES_VACCINE: 60, RABIES_IG: 8, BLOOD_A_POS: 10, BLOOD_A_NEG: 5, BLOOD_B_POS: 10, BLOOD_B_NEG: 5, BLOOD_O_POS: 12, BLOOD_O_NEG: 6, BLOOD_AB_POS: 6, BLOOD_AB_NEG: 4 },
  mid: { GENERAL_BED: 50, ICU_BED: 4, CCU_BED: 2, NICU_BED: 2, VENTILATOR: 3, STRETCHER: 6, OXYGEN_CYLINDER: 15, PLATELETS: 8, ANTIVENOM: 4, RABIES_VACCINE: 30, RABIES_IG: 3, BLOOD_A_POS: 5, BLOOD_A_NEG: 2, BLOOD_B_POS: 5, BLOOD_B_NEG: 2, BLOOD_O_POS: 6, BLOOD_O_NEG: 3, BLOOD_AB_POS: 3, BLOOD_AB_NEG: 2 },
  small: { GENERAL_BED: 25, ICU_BED: 1, STRETCHER: 4, OXYGEN_CYLINDER: 8, RABIES_VACCINE: 15, BLOOD_A_POS: 3, BLOOD_B_POS: 3, BLOOD_O_POS: 3 },
  rural: { GENERAL_BED: 20, STRETCHER: 3, OXYGEN_CYLINDER: 6, ANTIVENOM: 5, RABIES_VACCINE: 20, RABIES_IG: 2, BLOOD_A_POS: 2, BLOOD_B_POS: 2, BLOOD_O_POS: 2 },
};

/** Status resources that are ON per profile; all other status codes are off. */
const PROFILE_STATUS_ON: Record<HospitalProfile, string[]> = {
  full: ["CT_SCAN", "CATH_LAB", "OPERATION_THEATRE", "NEUROLOGIST_ON_DUTY", "CARDIOLOGIST_ON_DUTY", "SURGEON_ON_DUTY", "GYNECOLOGIST_ON_DUTY"],
  mid: ["CT_SCAN", "OPERATION_THEATRE", "CARDIOLOGIST_ON_DUTY", "SURGEON_ON_DUTY", "GYNECOLOGIST_ON_DUTY"],
  small: ["OPERATION_THEATRE", "SURGEON_ON_DUTY", "GYNECOLOGIST_ON_DUTY"],
  rural: ["OPERATION_THEATRE", "SURGEON_ON_DUTY"],
};

export type HospitalSeed = {
  slug: string;
  nameBn: string;
  nameEn: string;
  type: "GOVT" | "PRIVATE";
  freeService: boolean;
  live: boolean;
  division: string;
  district: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
  profile: HospitalProfile;
  /** All resources of this hospital get updatedAt = now - 45 min. */
  stale?: boolean;
  /** Status codes forced off. */
  statusOff?: string[];
  /** code -> [total, available] explicit overrides. */
  stock?: Record<string, [number, number]>;
  phone: string;
};

type Def = Omit<HospitalSeed, "phone" | "live"> & { live?: boolean };

const DEFS: Def[] = [
  // --- Dhaka (17) ---
  { slug: "dhanmondi-care-general", nameBn: "ধানমন্ডি কেয়ার জেনারেল হাসপাতাল", nameEn: "Dhanmondi Care General Hospital", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Dhanmondi", address: "Road 8, Dhanmondi, Dhaka", lat: 23.7478, lng: 90.3755, profile: "full", stock: { ICU_BED: [6, 1], GENERAL_BED: [120, 74] } },
  { slug: "mirpur-shastho-medical", nameBn: "মিরপুর স্বাস্থ্য মেডিকেল কলেজ হাসপাতাল", nameEn: "Mirpur Shastho Medical College Hospital", type: "GOVT", freeService: true, division: "Dhaka", district: "Dhaka", area: "Mirpur", address: "Section 10, Mirpur, Dhaka", lat: 23.8085, lng: 90.3668, profile: "full" },
  { slug: "mirpur-lakeview-clinic", nameBn: "মিরপুর লেকভিউ ক্লিনিক", nameEn: "Mirpur Lakeview Clinic", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Mirpur", address: "Section 1, Mirpur, Dhaka", lat: 23.7957, lng: 90.3536, profile: "small", stale: true },
  { slug: "mirpur-janata-health-complex", nameBn: "মিরপুর জনতা হেলথ কমপ্লেক্স", nameEn: "Mirpur Janata Health Complex", type: "GOVT", freeService: true, division: "Dhaka", district: "Dhaka", area: "Mirpur", address: "Section 14, Mirpur, Dhaka", lat: 23.7983, lng: 90.3846, profile: "mid", stock: { ICU_BED: [4, 0], ANTIVENOM: [4, 0] } },
  { slug: "dhanmondi-lalmatia-medical-centre", nameBn: "ধানমন্ডি লালমাটিয়া মেডিকেল সেন্টার", nameEn: "Lalmatia Medical Centre", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Dhanmondi", address: "Block D, Lalmatia, Dhaka", lat: 23.7545, lng: 90.3697, profile: "mid", statusOff: ["NEUROLOGIST_ON_DUTY"] },
  { slug: "dhanmondi-rapha-specialized", nameBn: "ধানমন্ডি রাফা স্পেশালাইজড হাসপাতাল", nameEn: "Rapha Specialized Hospital", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Dhanmondi", address: "Satmasjid Road, Dhanmondi, Dhaka", lat: 23.7399, lng: 90.3711, profile: "full", live: false },
  { slug: "uttara-sunrise-general", nameBn: "উত্তরা সানরাইজ জেনারেল হাসপাতাল", nameEn: "Uttara Sunrise General Hospital", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Uttara", address: "Sector 7, Uttara, Dhaka", lat: 23.8651, lng: 90.4, profile: "full", statusOff: ["CATH_LAB"] },
  { slug: "uttara-adhunik-medical", nameBn: "উত্তরা আধুনিক মেডিকেল কলেজ হাসপাতাল", nameEn: "Uttara Adhunik Medical College Hospital", type: "GOVT", freeService: true, division: "Dhaka", district: "Dhaka", area: "Uttara", address: "Sector 9, Uttara, Dhaka", lat: 23.8759, lng: 90.3795, profile: "mid", stale: true, stock: { VENTILATOR: [3, 0] } },
  { slug: "mohakhali-central-specialty", nameBn: "মহাখালী সেন্ট্রাল স্পেশালিটি হাসপাতাল", nameEn: "Mohakhali Central Specialty Hospital", type: "GOVT", freeService: true, division: "Dhaka", district: "Dhaka", area: "Mohakhali", address: "Mohakhali, Dhaka", lat: 23.7791, lng: 90.4032, profile: "full", statusOff: ["CARDIOLOGIST_ON_DUTY"] },
  { slug: "mohakhali-nirapod-clinic", nameBn: "মহাখালী নিরাপদ ক্লিনিক", nameEn: "Nirapod Clinic Mohakhali", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Mohakhali", address: "DOHS Road, Mohakhali, Dhaka", lat: 23.7764, lng: 90.4078, profile: "small", live: false },
  { slug: "motijheel-city-medical", nameBn: "মতিঝিল সিটি মেডিকেল হাসপাতাল", nameEn: "Motijheel City Medical Hospital", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Motijheel", address: "Dilkusha C/A, Motijheel, Dhaka", lat: 23.7345, lng: 90.4151, profile: "mid", stock: { OXYGEN_CYLINDER: [15, 0] } },
  { slug: "motijheel-shahid-memorial", nameBn: "মতিঝিল শহীদ স্মৃতি হাসপাতাল", nameEn: "Shahid Smriti Hospital Motijheel", type: "GOVT", freeService: true, division: "Dhaka", district: "Dhaka", area: "Motijheel", address: "Fakirapool, Motijheel, Dhaka", lat: 23.7311, lng: 90.4196, profile: "mid" },
  { slug: "badda-pragati-hospital", nameBn: "বাড্ডা প্রগতি হাসপাতাল", nameEn: "Badda Pragati Hospital", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Badda", address: "Link Road, Badda, Dhaka", lat: 23.7823, lng: 90.4249, profile: "mid", stale: true },
  { slug: "badda-sheba-clinic", nameBn: "বাড্ডা সেবা ক্লিনিক", nameEn: "Badda Sheba Clinic", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Badda", address: "Middle Badda, Dhaka", lat: 23.779, lng: 90.4302, profile: "small", live: false },
  { slug: "jatrabari-east-dhaka-medical", nameBn: "যাত্রাবাড়ী ইস্টার্ন হাসপাতাল", nameEn: "Jatrabari Eastern Hospital", type: "GOVT", freeService: true, division: "Dhaka", district: "Dhaka", area: "Jatrabari", address: "Jatrabari, Dhaka", lat: 23.7119, lng: 90.4331, profile: "mid", statusOff: ["SURGEON_ON_DUTY"], stock: { PLATELETS: [8, 0] } },
  { slug: "mohammadpur-green-life", nameBn: "মোহাম্মদপুর গ্রিন লাইফ হাসপাতাল", nameEn: "Green Life Hospital Mohammadpur", type: "PRIVATE", freeService: false, division: "Dhaka", district: "Dhaka", area: "Mohammadpur", address: "Town Hall Road, Mohammadpur, Dhaka", lat: 23.7648, lng: 90.3572, profile: "full" },
  { slug: "mohammadpur-community-health-centre", nameBn: "মোহাম্মদপুর কমিউনিটি হেলথ সেন্টার", nameEn: "Mohammadpur Community Health Centre", type: "GOVT", freeService: true, division: "Dhaka", district: "Dhaka", area: "Mohammadpur", address: "Japan Garden City, Mohammadpur, Dhaka", lat: 23.7689, lng: 90.3611, profile: "small" },
  // --- Chattogram (3) ---
  { slug: "chattogram-port-city-general", nameBn: "চট্টগ্রাম পোর্ট সিটি জেনারেল হাসপাতাল", nameEn: "Port City General Hospital", type: "PRIVATE", freeService: false, division: "Chattogram", district: "Chattogram", area: "Chattogram", address: "Agrabad, Chattogram", lat: 22.3254, lng: 91.8123, profile: "full" },
  { slug: "chattogram-karnaphuli-medical", nameBn: "কর্ণফুলী মেডিকেল কলেজ হাসপাতাল", nameEn: "Karnaphuli Medical College Hospital", type: "GOVT", freeService: true, division: "Chattogram", district: "Chattogram", area: "Chattogram", address: "Panchlaish, Chattogram", lat: 22.3631, lng: 91.8319, profile: "mid", statusOff: ["NEUROLOGIST_ON_DUTY"], stock: { ICU_BED: [4, 1] } },
  { slug: "chattogram-halishahar-hospital", nameBn: "হালিশহর কমিউনিটি হাসপাতাল", nameEn: "Halishahar Community Hospital", type: "PRIVATE", freeService: false, division: "Chattogram", district: "Chattogram", area: "Chattogram", address: "Halishahar, Chattogram", lat: 22.3354, lng: 91.7762, profile: "small", live: false },
  // --- Rajshahi (5) ---
  { slug: "rajshahi-padma-riverside-medical", nameBn: "পদ্মা রিভারসাইড মেডিকেল কলেজ হাসপাতাল", nameEn: "Padma Riverside Medical College Hospital", type: "GOVT", freeService: true, division: "Rajshahi", district: "Rajshahi", area: "Rajshahi", address: "Laxmipur, Rajshahi", lat: 24.3721, lng: 88.6019, profile: "full", statusOff: ["CATH_LAB"] },
  { slug: "rajshahi-barind-care-clinic", nameBn: "বরেন্দ্র কেয়ার ক্লিনিক", nameEn: "Barind Care Clinic", type: "PRIVATE", freeService: false, division: "Rajshahi", district: "Rajshahi", area: "Rajshahi", address: "Shaheb Bazar, Rajshahi", lat: 24.3668, lng: 88.6087, profile: "small", live: false },
  { slug: "godagari-upazila-health-complex", nameBn: "গোদাগাড়ী উপজেলা স্বাস্থ্য কমপ্লেক্স", nameEn: "Godagari Upazila Health Complex", type: "GOVT", freeService: true, division: "Rajshahi", district: "Rajshahi", area: "Godagari", address: "Godagari, Rajshahi", lat: 24.4786, lng: 88.3436, profile: "rural", stale: true, stock: { ANTIVENOM: [6, 2], OXYGEN_CYLINDER: [6, 0] } },
  { slug: "tanore-upazila-health-complex", nameBn: "তানোর উপজেলা স্বাস্থ্য কমপ্লেক্স", nameEn: "Tanore Upazila Health Complex", type: "GOVT", freeService: true, division: "Rajshahi", district: "Rajshahi", area: "Tanore", address: "Tanore, Rajshahi", lat: 24.517, lng: 88.519, profile: "rural", stock: { ANTIVENOM: [5, 1] } },
  { slug: "rajshahi-puthia-medical-centre", nameBn: "পুঠিয়া মেডিকেল সেন্টার", nameEn: "Puthia Medical Centre", type: "PRIVATE", freeService: false, division: "Rajshahi", district: "Rajshahi", area: "Puthia", address: "Puthia, Rajshahi", lat: 24.356, lng: 88.842, profile: "small", stock: { ANTIVENOM: [3, 3], RABIES_VACCINE: [15, 9] } },
];

export const HOSPITALS: HospitalSeed[] = DEFS.map((d, i) => ({
  ...d,
  live: d.live ?? true,
  phone: `01900-0000${String(i + 1).padStart(2, "0")}`,
}));

export function profileCounts(p: HospitalProfile): Record<string, number> {
  return PROFILE_COUNTS[p];
}
export function profileStatusOn(p: HospitalProfile): string[] {
  return PROFILE_STATUS_ON[p];
}
