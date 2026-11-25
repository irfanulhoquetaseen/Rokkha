import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { getCurrentUser } from "@/server/auth/current-user";
import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { getLang } from "@/server/i18n/lang";

/**
 * Defense-in-depth server guard for every /admin page:
 * - Signed-out → redirect to /login?next=...
 * - Signed-in non-admin → AUTHZ_DENIED audit + real 404 (notFound)
 */
export async function requireAdminPage(nextPath: string): Promise<{ user: SessionUser; lang: Lang }> {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  try {
    await requireRole(user, "ADMIN");
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return { user, lang };
}
