export type BloodCode = "A_POS" | "A_NEG" | "B_POS" | "B_NEG" | "O_POS" | "O_NEG" | "AB_POS" | "AB_NEG";

/** Red-cell compatibility: donor -> recipients that can safely receive. */
export const BLOOD_COMPATIBILITY: Record<BloodCode, BloodCode[]> = {
  O_NEG: ["O_NEG", "O_POS", "A_NEG", "A_POS", "B_NEG", "B_POS", "AB_NEG", "AB_POS"],
  O_POS: ["O_POS", "A_POS", "B_POS", "AB_POS"],
  A_NEG: ["A_NEG", "A_POS", "AB_NEG", "AB_POS"],
  A_POS: ["A_POS", "AB_POS"],
  B_NEG: ["B_NEG", "B_POS", "AB_NEG", "AB_POS"],
  B_POS: ["B_POS", "AB_POS"],
  AB_NEG: ["AB_NEG", "AB_POS"],
  AB_POS: ["AB_POS"],
};
