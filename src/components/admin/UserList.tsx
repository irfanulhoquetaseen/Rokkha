"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ErrorBody } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { admin } from "@/lib/i18n/admin";

export type UserRow = {
  id: string; phone: string; name: string; role: string; hospitalId: string | null;
  hospital: { id: string; nameEn: string; nameBn: string } | null;
  createdAt: string; updatedAt: string;
};
export type UserPageData = { items: UserRow[]; total: number; page: number; pageSize: number };
export type HospitalOption = { id: string; nameEn: string; nameBn: string };

const inputCls =
  "min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/25";
const btnCls =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

export function UserList({
  lang, initial, hospitals,
}: { lang: Lang; initial: UserPageData; hospitals: HospitalOption[] }) {
  const [data, setData] = useState<UserPageData>(initial);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [changingUser, setChangingUser] = useState<UserRow | null>(null);
  const seq = useRef(0);
  const firstRender = useRef(true);

  const fetchUsers = useCallback(async () => {
    const mine = ++seq.current;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (roleFilter) params.set("role", roleFilter);
    params.set("page", String(page));

    const res = await fetch(`/api/admin/users?${params}`, { cache: "no-store" });
    if (mine !== seq.current) return;
    if (res.ok) setData(await res.json() as UserPageData);
    setLoading(false);
  }, [search, roleFilter, page]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => { void fetchUsers(); }, 150);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">{admin.users[lang]}</h2>

      <div className="flex flex-wrap gap-2">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="user-search" className="sr-only">{admin.searchUsers[lang]}</label>
          <input
            id="user-search"
            type="search"
            value={search}
            onChange={(e) => { setLoading(true); setSearch(e.target.value); setPage(1); }}
            placeholder={admin.searchUsers[lang]}
            className={inputCls}
          />
        </div>
        <div className="w-full sm:w-52">
          <label htmlFor="user-role-filter" className="sr-only">{admin.role[lang]}</label>
          <select
            id="user-role-filter"
            value={roleFilter}
            onChange={(e) => { setLoading(true); setRoleFilter(e.target.value); setPage(1); }}
            className={inputCls}
          >
            <option value="">{admin.role[lang]}: {admin.filterAll[lang]}</option>
            <option value="CITIZEN">{admin.citizen[lang]}</option>
            <option value="HOSPITAL_STAFF">{admin.hospitalStaff[lang]}</option>
            <option value="ADMIN">{admin.adminRole[lang]}</option>
          </select>
        </div>
      </div>

      {message && (
        <div
          role={message.ok ? "status" : "alert"}
          className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" : "border border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"}`}
        >
          {message.text}
        </div>
      )}

      {changingUser && (
        <RoleChangeForm
          key={changingUser.id}
          lang={lang}
          target={changingUser}
          hospitals={hospitals}
          onClose={() => setChangingUser(null)}
          onDone={(msg, ok) => {
            setChangingUser(null);
            setMessage({ text: msg, ok });
            if (ok) void fetchUsers();
          }}
        />
      )}

      {data.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">{admin.noUsers[lang]}</p>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label={admin.users[lang]}
          className={`overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xs transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          <table className="w-full text-left text-sm" data-testid="admin-users-table">
            <thead className="border-b border-[var(--border-default)] bg-[var(--bg-subtle)]">
              <tr>
                <th className="px-3 py-2 font-medium">{admin.userName[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.phone[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.role[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.hospitals[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.actions[lang]}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">{u.name}</td>
                  <td className="px-3 py-2">{u.phone}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${u.role === "ADMIN" ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" : u.role === "HOSPITAL_STAFF" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"}`}>
                      {u.role === "ADMIN" ? admin.adminRole[lang] : u.role === "HOSPITAL_STAFF" ? admin.hospitalStaff[lang] : admin.citizen[lang]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm">{u.hospital ? (lang === "bn" ? u.hospital.nameBn : u.hospital.nameEn) : "—"}</td>
                  <td className="px-3 py-2">
                    {u.role !== "ADMIN" && (
                      <button
                        type="button"
                        onClick={() => setChangingUser(u)}
                        className={`${btnCls} hover:bg-zinc-100 dark:hover:bg-zinc-800`}
                        aria-label={`${admin.changeRole[lang]} — ${u.name}`}
                      >
                        {admin.changeRole[lang]}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => { setLoading(true); setPage((p) => Math.max(1, p - 1)); }}
            disabled={page <= 1}
            className={`${btnCls} border border-zinc-300 dark:border-zinc-700`}
          >
            {admin.prev[lang]}
          </button>
          <span>{admin.page[lang]} {page} {admin.of[lang]} {totalPages}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); setPage((p) => Math.min(totalPages, p + 1)); }}
            disabled={page >= totalPages}
            className={`${btnCls} border border-zinc-300 dark:border-zinc-700`}
          >
            {admin.next[lang]}
          </button>
        </div>
      )}
    </div>
  );
}

function RoleChangeForm({
  lang, target, hospitals, onClose, onDone,
}: { lang: Lang; target: UserRow; hospitals: HospitalOption[]; onClose: () => void; onDone: (msg: string, ok: boolean) => void }) {
  const [newRole, setNewRole] = useState<"CITIZEN" | "HOSPITAL_STAFF">(
    target.role === "HOSPITAL_STAFF" ? "CITIZEN" : "HOSPITAL_STAFF",
  );
  const [hospitalId, setHospitalId] = useState(target.hospitalId ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const body: Record<string, string> = { userId: target.id, newRole };
      if (newRole === "HOSPITAL_STAFF" && hospitalId) body.hospitalId = hospitalId;
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onDone(admin.roleChanged[lang], true);
      } else {
        const err = (await res.json().catch(() => null)) as Partial<ErrorBody> | null;
        onDone(err?.error?.message?.[lang] || (lang === "bn" ? "ত্রুটি হয়েছে" : "Error"), false);
      }
    } catch {
      onDone(lang === "bn" ? "সংযোগে সমস্যা" : "Connection error", false);
    }
    setSaving(false);
  };

  return (
    <form
      onSubmit={save}
      noValidate
      aria-label={admin.changeRole[lang]}
      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xs"
    >
      <h3 className="mb-1 font-bold">{admin.changeRole[lang]}</h3>
      <p className="mb-3 text-sm text-[var(--text-muted)]">{target.name} ({target.phone})</p>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="rc-role" className="text-xs font-medium">{admin.role[lang]}</label>
          <select
            id="rc-role"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "CITIZEN" | "HOSPITAL_STAFF")}
            className={inputCls}
          >
            <option value="CITIZEN">{admin.citizen[lang]}</option>
            <option value="HOSPITAL_STAFF">{admin.hospitalStaff[lang]}</option>
          </select>
        </div>
        {newRole === "HOSPITAL_STAFF" && (
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <label htmlFor="rc-hospital" className="text-xs font-medium">{admin.hospitals[lang]}</label>
            <select
              id="rc-hospital"
              value={hospitalId}
              onChange={(e) => setHospitalId(e.target.value)}
              className={inputCls}
            >
              <option value="">{admin.selectHospital[lang]}</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{lang === "bn" ? h.nameBn : h.nameEn}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving || (newRole === "HOSPITAL_STAFF" && !hospitalId)}
          className={`${btnCls} bg-[var(--brand-primary)] px-4 text-white hover:bg-[var(--brand-primary-hover)]`}
        >
          {saving ? admin.saving[lang] : admin.save[lang]}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={`${btnCls} border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 hover:bg-[var(--bg-subtle)]`}
        >
          {admin.cancel[lang]}
        </button>
      </div>
    </form>
  );
}
