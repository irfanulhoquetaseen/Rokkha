/** Same values as the Prisma `BloodGroup` enum (kept local so matching stays pure). */
export type BloodGroup = "A_POS" | "A_NEG" | "B_POS" | "B_NEG" | "O_POS" | "O_NEG" | "AB_POS" | "AB_NEG";

export type LatLng = { lat: number; lng: number };

export type MatchRequirement = {
  /** ResourceType code; null when `isBlood` (resolved from the patient's blood group). */
  resourceCode: string | null;
  isBlood: boolean;
  level: "CRITICAL" | "PREFERRED";
  minQuantity: number;
  nameBn: string;
  nameEn: string;
};

export type MatchResource = {
  code: string;
  kind: "COUNTABLE" | "STATUS";
  available: number;
  total: number;
  isAvailable: boolean;
  updatedAt: Date;
  bloodGroup: BloodGroup | null;
  nameBn: string;
  nameEn: string;
};

export type MatchHospital = { id: string; lat: number; lng: number; resources: MatchResource[] };

export type MatchInput = {
  requirements: MatchRequirement[];
  bloodGroup: BloodGroup | null;
  origin: LatLng | null;
  now: Date;
  hospitals: MatchHospital[];
  /** recipient -> donor groups whose red cells the recipient can receive */
  compatibleDonors: Record<BloodGroup, BloodGroup[]>;
};

export type Reason = { kind: "ok" | "warn" | "missing"; bn: string; en: string };

export type RankedHospital = {
  hospitalId: string;
  score: number;
  rank: number;
  suitable: boolean;
  distanceKm: number | null;
  stale: boolean;
  reasons: Reason[];
  /**
   * Oldest update among requirement-matched rows (the value that drives `stale`); if no row
   * matches a requirement, the newest update of any row; null when the hospital has no rows.
   */
  lastUpdatedAt: Date | null;
};
