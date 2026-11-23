import { cookies } from "next/headers";
import { LANG_COOKIE, parseLang, type Lang } from "@/lib/i18n";

/** The UI language for this request (from the `lang` cookie; Bangla by default). Request-time: use inside <Suspense>. */
export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}
