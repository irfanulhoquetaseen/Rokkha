import type { ConditionCode } from "./first-aid";

export type RequirementSeed = {
  /** ResourceType code, or "BLOOD" = resolved from the patient's blood group (isBlood). */
  resource: string;
  level: "CRITICAL" | "PREFERRED";
  minQuantity?: number;
};

export type ConditionSeed = {
  code: ConditionCode;
  nameBn: string;
  nameEn: string;
  requirements: RequirementSeed[];
};

const C = "CRITICAL" as const;
const P = "PREFERRED" as const;

export const CONDITIONS: ConditionSeed[] = [
  { code: "STROKE", nameBn: "স্ট্রোক", nameEn: "Stroke", requirements: [
    { resource: "CT_SCAN", level: C }, { resource: "NEUROLOGIST_ON_DUTY", level: C },
    { resource: "ICU_BED", level: P }, { resource: "GENERAL_BED", level: P } ] },
  { code: "HEART_ATTACK", nameBn: "হার্ট অ্যাটাক", nameEn: "Heart attack", requirements: [
    { resource: "CATH_LAB", level: C }, { resource: "CARDIOLOGIST_ON_DUTY", level: C },
    { resource: "CCU_BED", level: C }, { resource: "OXYGEN_CYLINDER", level: P } ] },
  { code: "TRAUMA", nameBn: "সড়ক দুর্ঘটনা / গুরুতর আঘাত", nameEn: "Road accident / trauma", requirements: [
    { resource: "SURGEON_ON_DUTY", level: C }, { resource: "OPERATION_THEATRE", level: C },
    { resource: "BLOOD", level: C }, { resource: "CT_SCAN", level: P },
    { resource: "ICU_BED", level: P }, { resource: "STRETCHER", level: P } ] },
  { code: "DENGUE", nameBn: "গুরুতর ডেঙ্গু", nameEn: "Severe dengue", requirements: [
    { resource: "GENERAL_BED", level: C }, { resource: "PLATELETS", level: P },
    { resource: "ICU_BED", level: P }, { resource: "BLOOD", level: P } ] },
  { code: "BREATHING", nameBn: "শ্বাসকষ্ট (হাঁপানি/সিওপিডি/নিউমোনিয়া)", nameEn: "Breathing emergency (asthma/COPD/pneumonia)", requirements: [
    { resource: "OXYGEN_CYLINDER", level: C }, { resource: "VENTILATOR", level: P }, { resource: "ICU_BED", level: P } ] },
  { code: "PREGNANCY", nameBn: "গর্ভাবস্থা / প্রসবকালীন জরুরি অবস্থা", nameEn: "Pregnancy / delivery emergency", requirements: [
    { resource: "GYNECOLOGIST_ON_DUTY", level: C }, { resource: "OPERATION_THEATRE", level: C },
    { resource: "BLOOD", level: C }, { resource: "NICU_BED", level: P } ] },
  { code: "SNAKEBITE", nameBn: "সাপের কামড়", nameEn: "Snakebite", requirements: [
    { resource: "ANTIVENOM", level: C }, { resource: "ICU_BED", level: P }, { resource: "VENTILATOR", level: P } ] },
  { code: "ANIMAL_BITE", nameBn: "কুকুর/বিড়ালের কামড় (জলাতঙ্ক)", nameEn: "Dog / cat bite (rabies)", requirements: [
    { resource: "RABIES_VACCINE", level: C }, { resource: "RABIES_IG", level: P } ] },
];
