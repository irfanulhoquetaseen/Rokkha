import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ConsoleSkeleton } from "@/components/staff/ConsoleSkeleton";
import { getCurrentUser } from "@/server/auth/current-user";
import { firstLiveHospitalId } from "@/server/resources/queries";

export const metadata: Metadata = { title: "Staff console — JibonSetu" };

/** /staff only routes to the right hospital console; the session is request-time, hence <Suspense>. */
export default function StaffPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
      <Suspense fallback={<ConsoleSkeleton />}>
        <StaffRedirect />
      </Suspense>
    </main>
  );
}

async function StaffRedirect(): Promise<null> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fstaff");
  if (user.role === "HOSPITAL_STAFF" && user.hospitalId) redirect(`/staff/hospitals/${user.hospitalId}`);
  if (user.role === "ADMIN") {
    const id = await firstLiveHospitalId();
    if (id) redirect(`/staff/hospitals/${id}`);
  }
  notFound();
}
