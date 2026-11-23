export type Area = { id: string; nameBn: string; nameEn: string; lat: number; lng: number };

/** Selectable origin areas (centre points). Not tied to the stored Hospital.area strings. */
export const AREAS: Area[] = [
  { id: "mirpur", nameBn: "মিরপুর", nameEn: "Mirpur", lat: 23.8069, lng: 90.3687 },
  { id: "dhanmondi", nameBn: "ধানমন্ডি", nameEn: "Dhanmondi", lat: 23.7461, lng: 90.376 },
  { id: "uttara", nameBn: "উত্তরা", nameEn: "Uttara", lat: 23.8759, lng: 90.3795 },
  { id: "mohakhali", nameBn: "মহাখালী", nameEn: "Mohakhali", lat: 23.7777, lng: 90.4057 },
  { id: "motijheel", nameBn: "মতিঝিল", nameEn: "Motijheel", lat: 23.7333, lng: 90.4172 },
  { id: "badda", nameBn: "বাড্ডা", nameEn: "Badda", lat: 23.7806, lng: 90.4258 },
  { id: "jatrabari", nameBn: "যাত্রাবাড়ী", nameEn: "Jatrabari", lat: 23.7104, lng: 90.4348 },
  { id: "mohammadpur", nameBn: "মোহাম্মদপুর", nameEn: "Mohammadpur", lat: 23.7662, lng: 90.3589 },
  { id: "chattogram", nameBn: "চট্টগ্রাম", nameEn: "Chattogram", lat: 22.3569, lng: 91.7832 },
  { id: "rajshahi", nameBn: "রাজশাহী", nameEn: "Rajshahi", lat: 24.3745, lng: 88.6042 },
];

export function findArea(id: string): Area | undefined {
  return AREAS.find((a) => a.id === id);
}
