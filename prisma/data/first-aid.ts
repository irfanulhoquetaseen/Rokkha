/**
 * Sourced first-aid guidance for the 8 supported conditions (bn + en).
 *
 * Rules (CLAUDE.md §6): every point below is a plain-language paraphrase of the
 * cited source page. No diagnosis, no drug dosing. Points without a reliable
 * source were left out. The comment above each entry maps each point to the
 * section / phrase of the source it relies on.
 *
 * IFRC 2020 = "International first aid, resuscitation, and education
 * guidelines 2020", IFRC Global First Aid Reference Centre.
 */

export type ConditionCode =
  | "STROKE"
  | "HEART_ATTACK"
  | "TRAUMA"
  | "DENGUE"
  | "BREATHING"
  | "PREGNANCY"
  | "SNAKEBITE"
  | "ANIMAL_BITE";

export type FirstAidSeed = {
  conditionCode: ConditionCode;
  dosBn: string[];
  dosEn: string[];
  dontsBn: string[];
  dontsEn: string[];
  sourceName: string;
  sourceUrl: string;
};

const IFRC_2020_NAME =
  "IFRC International First Aid, Resuscitation and Education Guidelines 2020";
const IFRC_2020_URL =
  "https://www.ifrc.org/sites/default/files/2022-02/EN_GFARC_GUIDELINES_2020.pdf";

/** Chapter-level IFRC citation; `page` is the PDF page (equals the printed page number). */
function ifrc(
  chapter: string,
  page: number,
): Pick<FirstAidSeed, "sourceName" | "sourceUrl"> {
  return {
    sourceName: `${IFRC_2020_NAME} — ${chapter}`,
    sourceUrl: `${IFRC_2020_URL}#page=${page}`,
  };
}

export const FIRST_AID: FirstAidSeed[] = [
  // STROKE — IFRC 2020, "Stroke" (pp. 271–273)
  // do1 FAST check            -> "FAST ... FACE ... ARM ... SPEECH ... TIME" (Early recognition)
  // do2 call 999 at once      -> First aid step 2 "access EMS immediately"; Key action
  // do3 note start time       -> First aid step 2 "Note the time it started"; FAST "TIME"
  // do4 comfortable position, support from falling -> First aid step 3
  // do5 reassure, keep talking, watch breathing     -> First aid step 4
  // dont1 don't wait / even if recovered            -> Recovery "Even if the person seems to have recovered, they should still access medical care"; TIA good practice point
  // dont2 don't give oxygen                         -> Guideline "First aid providers should NOT administer oxygen to a person experiencing a suspected stroke"
  {
    conditionCode: "STROKE",
    dosEn: [
      "Check FAST: Face drooping on one side? Arm weak on one side? Speech slurred or strange?",
      "If you see any of these signs, call 999 or go to the nearest hospital immediately.",
      "Note the time the symptoms started and tell the doctor.",
      "Help the person sit or lie in a comfortable position; support them so they do not fall.",
      "Stay with them, keep talking to calm them, and watch their breathing.",
    ],
    dosBn: [
      "FAST দেখুন: মুখের এক পাশ বেঁকে গেছে? এক হাত দুর্বল? কথা জড়িয়ে যাচ্ছে বা অস্বাভাবিক?",
      "এর কোনো একটি লক্ষণ দেখলে সঙ্গে সঙ্গে ৯৯৯-এ কল করুন বা নিকটস্থ হাসপাতালে যান।",
      "লক্ষণ কখন শুরু হয়েছে সেই সময়টি মনে রাখুন এবং ডাক্তারকে জানান।",
      "রোগীকে আরামদায়কভাবে বসতে বা শুতে সাহায্য করুন; যেন পড়ে না যান সেজন্য ধরে রাখুন।",
      "রোগীর পাশে থাকুন, কথা বলে আশ্বস্ত করুন এবং শ্বাস-প্রশ্বাস খেয়াল রাখুন।",
    ],
    dontsEn: [
      "Do not wait to see if it passes — even if the signs go away, the person still needs a hospital.",
      "Do not give oxygen yourself.",
    ],
    dontsBn: [
      "ঠিক হয়ে যায় কি না দেখার জন্য অপেক্ষা করবেন না — লক্ষণ চলে গেলেও রোগীকে হাসপাতালে নিতে হবে।",
      "নিজে থেকে অক্সিজেন দেবেন না।",
    ],
    ...ifrc("Stroke, p. 271", 271),
  },

  // HEART_ATTACK — IFRC 2020, "Chest pain" (pp. 264–266)
  // do1 call 999 immediately          -> Good practice point "If a heart attack is suspected, EMS should be accessed immediately"; First aid step 2
  // do2 help sit comfortably, rest    -> First aid step 1; Good practice point "comfortable position; the person should refrain from physical activity"
  // do3 help take prescribed angina medicine -> Good practice point "If the person has medication, is diagnosed with angina and showing signs of acute chest pain, the first aid provider should assist them to take their medication"; First aid step 1
  // do4 reassure, watch breathing; CPR if unresponsive & abnormal breathing -> First aid step 4; NOTE "If the person becomes Unresponsive with abnormal breathing, start CPR"
  // dont1 no physical activity / walking  -> Good practice point "refrain from physical activity"
  // dont2 don't wait even if short pain   -> Good practice point "Access EMS even if the pain has only lasted a couple of minutes"
  // dont3 don't dismiss as indigestion    -> Access help "a heart attack is often mistaken for indigestion"
  {
    conditionCode: "HEART_ATTACK",
    dosEn: [
      "Call 999 or go to the nearest hospital immediately.",
      "Help the person sit down in a comfortable position and rest.",
      "If they have been prescribed medicine for chest pain (angina), help them take it.",
      "Stay with them, reassure them and watch their breathing. If they collapse and are not breathing normally, start CPR.",
    ],
    dosBn: [
      "সঙ্গে সঙ্গে ৯৯৯-এ কল করুন বা নিকটস্থ হাসপাতালে যান।",
      "রোগীকে আরামদায়কভাবে বসতে সাহায্য করুন এবং বিশ্রাম নিতে দিন।",
      "বুকে ব্যথার (অ্যানজাইনা) জন্য ডাক্তারের দেওয়া ওষুধ থাকলে তা খেতে সাহায্য করুন।",
      "রোগীর পাশে থাকুন, আশ্বস্ত করুন এবং শ্বাস-প্রশ্বাস খেয়াল রাখুন। অজ্ঞান হয়ে গেলে ও স্বাভাবিকভাবে শ্বাস না নিলে সিপিআর শুরু করুন।",
    ],
    dontsEn: [
      "Do not let the person walk around or do any physical work.",
      "Do not wait — get help even if the pain has lasted only a couple of minutes.",
      "Do not assume it is just gas or indigestion.",
    ],
    dontsBn: [
      "রোগীকে হাঁটাহাঁটি বা কোনো পরিশ্রমের কাজ করতে দেবেন না।",
      "দেরি করবেন না — ব্যথা মাত্র দু-এক মিনিট থাকলেও সাহায্য নিন।",
      "শুধু গ্যাস বা বদহজম ভেবে অবহেলা করবেন না।",
    ],
    ...ifrc("Chest pain, p. 264", 264),
  },

  // TRAUMA — IFRC 2020, "Severe bleeding" (pp. 187–189) and "Spinal injury" (pp. 228–229)
  // do1 possible neck/back injury: keep still -> Spinal Key action "keep as still as possible"; GPP "advised to keep as still as possible"; First aid step 1;
  //     Early recognition "fallen from a height greater than standing", "involved in a road traffic collision"
  // do2 call 999 / emergency help -> Severe bleeding GPP "EMS should be accessed for all severe bleeding"; Spinal GPP "always access EMS when suspecting a spinal injury"
  // do3 firm direct pressure with cloth -> Severe bleeding Key action + Guideline "direct manual compression"; GPP clean clothes/towels; NOTE barrier cloth/plastic
  // do4 soaked -> add second layer, press harder -> Severe bleeding First aid step 4
  // do5 no spinal signs: lie on back + keep warm; else keep still + warm where found -> Severe bleeding First aid steps 2 and 6 ("lie down on their back and keep them warm");
  //     Spinal First aid step 3 "Ensure minimal handling or movement"; unresponsive case "Leave the person as you have found them"
  // dont1 don't remove embedded object -> Severe bleeding GPP "apply pressure around an embedded object ... Avoid removing the object"
  // dont2 don't move possible spine injury unless danger; if must, 2 people, head in line -> Spinal NOTE (p. 230) "Do not move the person if you suspect a spinal injury.
  //     If the person has to be moved, (e.g., there is imminent danger) this is best done with at least two first aid providers, where one can keep the person's head in line with their spine"
  // dont3 don't strap head/neck / collar -> Spinal Guideline "should not apply a cervical collar"; GPP "should not strap their head or neck"
  // dont4 don't remove tourniquet once applied -> Severe bleeding GPP "Once a tourniquet has been applied, keep it in place until EMS arrives"
  {
    conditionCode: "TRAUMA",
    dosEn: [
      "After a road crash or a fall from a height, if the neck or back may be hurt, ask the person to stay as still as possible.",
      "Call 999 or get emergency medical help quickly.",
      "Press firmly and directly on the bleeding wound with a clean cloth or bandage.",
      "If blood soaks through, put another cloth on top and press harder.",
      "If a neck or back injury is not suspected, help them lie down on their back and keep them warm; otherwise keep them still and warm where they are.",
    ],
    dosBn: [
      "সড়ক দুর্ঘটনা বা উঁচু থেকে পড়ার পর ঘাড় বা পিঠে আঘাত থাকতে পারলে রোগীকে যতটা সম্ভব নড়াচড়া না করতে বলুন।",
      "৯৯৯-এ কল করুন বা দ্রুত জরুরি চিকিৎসা সহায়তা নিন।",
      "রক্ত পড়া ক্ষতের ওপর পরিষ্কার কাপড় বা ব্যান্ডেজ দিয়ে সরাসরি জোরে চেপে ধরুন।",
      "কাপড় রক্তে ভিজে গেলে তার ওপর আরেকটি কাপড় দিয়ে আরও জোরে চাপুন।",
      "ঘাড় বা পিঠে আঘাতের সন্দেহ না থাকলে আহত ব্যক্তিকে চিত করে শুইয়ে দিন এবং গরম রাখুন; আঘাতের সন্দেহ থাকলে যেখানে আছেন সেখানেই স্থির ও গরম রাখুন।",
    ],
    dontsEn: [
      "Do not pull out an object stuck in the wound — press around it instead.",
      "Do not move a person who may have a neck or back injury unless they are in immediate danger; if you must, use at least two people and keep the head in line with the spine.",
      "Do not tie or strap the head or neck.",
      "If a tourniquet has been put on, do not remove it — leave it for the medical team.",
    ],
    dontsBn: [
      "ক্ষতে কিছু গেঁথে থাকলে টেনে বের করবেন না — এর চারপাশে চাপ দিন।",
      "ঘাড় বা পিঠে আঘাত থাকতে পারে এমন ব্যক্তিকে তাৎক্ষণিক বিপদ না থাকলে সরাবেন না; সরাতেই হলে অন্তত দুজন মিলে মাথা ও মেরুদণ্ড এক সোজা রেখায় রেখে সরান।",
      "মাথা বা ঘাড় বেঁধে দেবেন না।",
      "টুর্নিকেট (শক্ত বাঁধন) দেওয়া হয়ে থাকলে খুলবেন না — চিকিৎসকদের জন্য রেখে দিন।",
    ],
    ...ifrc("Severe bleeding, p. 187; Spinal injury, p. 228", 187),
  },

  // DENGUE — WHO fact sheet "Dengue and severe dengue"
  // do1 warning signs list -> Symptoms "severe abdominal pain, persistent vomiting, rapid breathing, bleeding gums or nose, blood in vomit or stool, ... pale and cold skin ... restlessness"
  // do2 seek care immediately -> "People with these severe symptoms should seek care immediately"
  // do3 rest + plenty of fluids -> Treatment "Rest ... drink plenty of liquids"
  // dont1 don't assume over when fever goes -> "The symptoms of severe dengue often come after the fever has gone away"
  // dont2 avoid ibuprofen/aspirin -> Treatment "avoid non-steroidal anti-inflammatory medication such as ibuprofen and aspirin ... can increase the risk of bleeding"
  {
    conditionCode: "DENGUE",
    dosEn: [
      "Watch for danger signs: severe belly pain, repeated vomiting, fast breathing, bleeding from gums or nose, blood in vomit or stool, cold pale skin, restlessness.",
      "If any danger sign appears, go to a hospital immediately.",
      "Until you reach care, let the person rest and drink plenty of fluids.",
    ],
    dosBn: [
      "বিপদের লক্ষণ খেয়াল করুন: পেটে তীব্র ব্যথা, বারবার বমি, দ্রুত শ্বাস, মাড়ি বা নাক দিয়ে রক্ত, বমি বা পায়খানায় রক্ত, ফ্যাকাশে ঠান্ডা ত্বক, অস্থিরতা।",
      "কোনো বিপদের লক্ষণ দেখা দিলে সঙ্গে সঙ্গে হাসপাতালে যান।",
      "চিকিৎসা পাওয়া পর্যন্ত রোগীকে বিশ্রামে রাখুন এবং প্রচুর তরল পান করান।",
    ],
    dontsEn: [
      "Do not think the danger is over when the fever goes down — severe signs often come after the fever.",
      "Do not give ibuprofen or aspirin-type painkillers; they can increase bleeding.",
    ],
    dontsBn: [
      "জ্বর কমে গেলেই বিপদ কেটে গেছে ভাববেন না — গুরুতর লক্ষণ প্রায়ই জ্বর কমার পরে দেখা দেয়।",
      "আইবুপ্রোফেন বা অ্যাসপিরিন জাতীয় ব্যথানাশক দেবেন না; এতে রক্তক্ষরণ বাড়তে পারে।",
    ],
    sourceName: "WHO — Dengue and severe dengue (fact sheet)",
    sourceUrl:
      "https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue",
  },

  // BREATHING — IFRC 2020, "Breathing difficulties" (p. 175) and "Asthma attack" (pp. 180–181)
  // do1 comfortable position, usually seated / leaning forward -> Breathing difficulties Key action + Guideline "seated position or an arm bracing position"
  // do2 help use own inhaler/medicine -> Asthma First aid step 2; Breathing GPP "assist the person to take their medication"
  // do3 loosen tight clothing -> Asthma First aid step 2; GPP
  // do4 move away from smoke/dust -> Asthma GPP "move the person away from things that may be triggering the attack such as smoke or dust"
  // do5 call 999 if no inhaler / not working / blue lips / confused / tired -> Asthma First aid step 3 a–f
  // dont1 don't leave alone -> Asthma First aid step 5 "Stay with the person and continue to observe them"
  // dont2 don't wait if inhaler not helping in a few minutes -> Asthma step 3b "the inhaler is ineffective within a few minutes"
  {
    conditionCode: "BREATHING",
    dosEn: [
      "Help the person sit up in a comfortable position, leaning forward if that helps.",
      "If they have their own inhaler or prescribed medicine, help them use it.",
      "Loosen any tight clothing.",
      "Move them away from smoke, dust or anything that may be causing the attack.",
      "Call 999 or go to hospital immediately if lips or fingers turn bluish, they become confused or very tired, or breathing gets worse.",
    ],
    dosBn: [
      "রোগীকে আরামদায়কভাবে সোজা হয়ে বসতে সাহায্য করুন; সুবিধা হলে সামনের দিকে ঝুঁকে বসতে দিন।",
      "নিজের ইনহেলার বা ডাক্তারের দেওয়া ওষুধ থাকলে তা ব্যবহার করতে সাহায্য করুন।",
      "আঁটসাঁট পোশাক ঢিলা করে দিন।",
      "ধোঁয়া, ধুলা বা যা থেকে শ্বাসকষ্ট হচ্ছে তা থেকে রোগীকে দূরে সরিয়ে নিন।",
      "ঠোঁট বা আঙুল নীলচে হয়ে গেলে, রোগী বিভ্রান্ত বা খুব ক্লান্ত হয়ে পড়লে বা শ্বাসকষ্ট বাড়লে সঙ্গে সঙ্গে ৯৯৯-এ কল করুন বা হাসপাতালে যান।",
    ],
    dontsEn: [
      "Do not leave the person alone.",
      "Do not keep waiting if the inhaler does not help within a few minutes or there is no inhaler — get help.",
    ],
    dontsBn: [
      "রোগীকে একা রেখে যাবেন না।",
      "ইনহেলারে কয়েক মিনিটের মধ্যে কাজ না হলে বা ইনহেলার না থাকলে অপেক্ষা করবেন না — সাহায্য নিন।",
    ],
    ...ifrc("Breathing difficulties, p. 175; Asthma attack, p. 180", 180),
  },

  // PREGNANCY — IFRC 2020, "Emergency childbirth" (pp. 313–316)
  // do1 call for help (EMS / hospital / midwife) -> First aid step 1; Access help "Phone EMS, medical facilities"
  // do2 heavy bleeding after birth: lie down, keep warm, get help -> First aid step 8 "If bleeding is severe, help the woman to lie down and keep her warm ... until medical help arrives"
  // do3 clean hands + clean cloth -> First aid step 5; CAUTION hygiene
  // do4 dry baby, wrap, cover head, on mother's chest -> First aid step 7
  // do5 cord around neck: check loose, ease over head -> CAUTION "carefully ease it over the baby's head"
  // dont1 don't pull baby's head/shoulders -> CAUTION
  // dont2 don't push on stomach -> CAUTION "Do not push on the woman's stomach during labour or after delivery"
  // dont3 don't pull umbilical cord -> CAUTION
  // dont4 don't cut cord if baby breathing normally -> CAUTION "no immediate need to cut the umbilical cord, which should be performed by a medical professional"
  {
    conditionCode: "PREGNANCY",
    dosEn: [
      "Call 999, the hospital or a midwife right away and follow their instructions.",
      "If the mother bleeds heavily, help her lie down, keep her warm and get medical help urgently.",
      "If the baby is coming, wash your hands with soap and water and put a clean cloth under the mother.",
      "After birth, dry the baby with a clean cloth, wrap it, cover its head and place it on the mother's chest.",
      "If the cord is around the baby's neck, check it is loose and gently slip it over the head.",
    ],
    dosBn: [
      "সঙ্গে সঙ্গে ৯৯৯, হাসপাতাল বা ধাত্রী/মিডওয়াইফকে ফোন করুন এবং তাঁদের নির্দেশনা মানুন।",
      "মায়ের অনেক রক্তক্ষরণ হলে তাঁকে শুইয়ে দিন, গরম রাখুন এবং জরুরি চিকিৎসা সহায়তা নিন।",
      "শিশু বেরিয়ে আসতে থাকলে সাবান-পানি দিয়ে হাত ধুয়ে নিন এবং মায়ের নিচে পরিষ্কার কাপড় বিছিয়ে দিন।",
      "জন্মের পর পরিষ্কার কাপড় দিয়ে শিশুকে মুছে দিন, কাপড়ে জড়িয়ে মাথা ঢেকে দিন এবং মায়ের বুকে রাখুন।",
      "নাড়ি শিশুর গলায় পেঁচানো থাকলে দেখুন ঢিলা আছে কি না, তারপর আলতো করে মাথার ওপর দিয়ে সরিয়ে দিন।",
    ],
    dontsEn: [
      "Do not pull the baby's head or shoulders.",
      "Do not press or push on the mother's belly, during or after delivery.",
      "Do not pull on the umbilical cord.",
      "If the baby is breathing normally, do not rush to cut the cord — leave it for a health worker.",
    ],
    dontsBn: [
      "শিশুর মাথা বা কাঁধ ধরে টানবেন না।",
      "প্রসবের সময় বা পরে মায়ের পেটে চাপ দেবেন না।",
      "নাড়ি (আম্বিলিক্যাল কর্ড) ধরে টানবেন না।",
      "শিশু স্বাভাবিকভাবে শ্বাস নিলে তাড়াহুড়ো করে নাড়ি কাটবেন না — স্বাস্থ্যকর্মীর জন্য রেখে দিন।",
    ],
    ...ifrc("Emergency childbirth, p. 313", 313),
  },

  // SNAKEBITE — WHO "Snakebite envenoming — Treatment", Box 1 "First aid for snakebites"
  // do1 move away from the snake -> "Immediately move away from the area where the bite occurred"
  // do2 remove rings/bangles/tight items -> "Remove anything tight from around the bitten part of the body (e.g.: rings, anklets, bracelets)"
  // do3 reassure -> "Reassure the victim. Many snake bites are caused by non-venomous snakes ... risk of death is not immediate"
  // do4 keep completely still, splint, carry -> "Immobilize the person completely. Splint the limb to keep it still. Use a makeshift stretcher to carry the person"
  // do5 to hospital ASAP -> "Transport the person to a health facility as soon as possible"
  // do6 vomiting -> left side -> "Vomiting may occur, so place the person on their left side in the recovery position"
  // dont1 no tight tourniquet -> "Never use a tight arterial tourniquet"
  // dont2 no traditional healers/chanting/herbal/unproven -> "Avoid traditional first aid methods, herbal medicines and other unproven or unsafe forms of first aid"
  // dont3 don't let them walk -> "Immobilize the person completely ... makeshift stretcher to carry the person"
  {
    conditionCode: "SNAKEBITE",
    dosEn: [
      "Move away from the snake right away.",
      "Remove rings, bangles, anklets or anything tight near the bite before swelling starts.",
      "Keep the person calm — many snakebites are not venomous, and danger is usually not immediate.",
      "Keep the person completely still; keep the bitten limb still with a splint.",
      "Take them to a hospital as fast as possible.",
      "If they vomit, lay them on their left side.",
    ],
    dosBn: [
      "সঙ্গে সঙ্গে সাপ থেকে দূরে সরে যান।",
      "ফোলা শুরুর আগেই কামড়ের জায়গার কাছ থেকে আংটি, চুড়ি, নূপুর বা আঁটসাঁট কিছু খুলে ফেলুন।",
      "রোগীকে শান্ত রাখুন — অনেক সাপের কামড় বিষাক্ত নয়, আর বিপদ সাধারণত সঙ্গে সঙ্গে হয় না।",
      "রোগীকে একদম স্থির রাখুন; কামড়ানো হাত বা পা কাঠ/স্প্লিন্ট দিয়ে নড়াচড়া বন্ধ রাখুন।",
      "যত দ্রুত সম্ভব হাসপাতালে নিয়ে যান।",
      "বমি করলে রোগীকে বাম কাত করে শুইয়ে দিন।",
    ],
    dontsEn: [
      "Do not tie a tight band or tourniquet.",
      "Do not use traditional healers (ojha), chanting/incantations, herbs or other unproven treatments.",
      "Do not let the person walk — carry them.",
    ],
    dontsBn: [
      "শক্ত করে বাঁধন বা টুর্নিকেট দেবেন না।",
      "ওঝা, ঝাড়ফুঁক, গাছগাছড়া বা অপ্রমাণিত কোনো চিকিৎসা করাবেন না।",
      "রোগীকে হাঁটতে দেবেন না — বহন করে নিয়ে যান।",
    ],
    sourceName: "WHO — Snakebite envenoming: Treatment (Box 1: First aid for snakebites)",
    sourceUrl:
      "https://www.who.int/teams/control-of-neglected-tropical-diseases/snakebite-envenoming/treatment",
  },

  // ANIMAL_BITE — WHO fact sheet "Rabies"
  // do1 wash 15 min soap + water immediately -> Key facts "immediately and always wash the wound with water and soap for at least 15 minutes"; PEP "extensive wound washing ... soon after an exposure"
  // do2 go to hospital quickly for vaccine -> "seek medical attention"; "rabies deaths are preventable with prompt post exposure prophylaxis (PEP)"; PEP "a course of rabies vaccine"
  // do3 deep bites may also need immunoglobulin -> PEP "administration of rabies immunoglobulin ... into the wound, if indicated"; Category III "transdermal bites"
  // dont1 don't ignore small scratches -> Category II "minor scratches or abrasions without bleeding (exposure)"; "Category II and III exposures require human rabies vaccination"
  // dont2 don't wait for symptoms -> "Once clinical symptoms appear, rabies is virtually 100% fatal"
  {
    conditionCode: "ANIMAL_BITE",
    dosEn: [
      "Immediately wash the wound with soap and water for at least 15 minutes.",
      "Then go to a hospital or health centre quickly to get the rabies vaccine.",
      "For deep bites or bleeding wounds, ask whether rabies immunoglobulin (RIG) is also needed.",
    ],
    dosBn: [
      "সঙ্গে সঙ্গে ক্ষতস্থান সাবান ও পানি দিয়ে অন্তত ১৫ মিনিট ধরে ধুয়ে ফেলুন।",
      "এরপর জলাতঙ্কের টিকা নিতে দ্রুত হাসপাতাল বা স্বাস্থ্যকেন্দ্রে যান।",
      "গভীর কামড় বা রক্ত পড়া ক্ষত হলে জলাতঙ্কের ইমিউনোগ্লোবুলিন (RIG) লাগবে কি না জিজ্ঞেস করুন।",
    ],
    dontsEn: [
      "Do not ignore small scratches or nibbles on bare skin — they also need medical care and vaccine.",
      "Do not wait for symptoms — once rabies symptoms appear it is almost always fatal.",
    ],
    dontsBn: [
      "খালি ত্বকে ছোট আঁচড় বা হালকা কামড়কেও অবহেলা করবেন না — এগুলোতেও চিকিৎসা ও টিকা দরকার।",
      "লক্ষণ দেখা দেওয়ার অপেক্ষা করবেন না — জলাতঙ্কের লক্ষণ একবার দেখা দিলে প্রায় সবসময়ই মৃত্যু হয়।",
    ],
    sourceName: "WHO — Rabies (fact sheet)",
    sourceUrl: "https://www.who.int/news-room/fact-sheets/detail/rabies",
  },
];
