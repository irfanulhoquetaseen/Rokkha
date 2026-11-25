"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { admin } from "@/lib/i18n/admin";

export type AuditRow = {
  id: string; actorUserId: string | null; action: string;
  actor: { id: string; name: string; phone: string } | null;
  entityType: string; entityId: string | null;
  before: unknown; after: unknown; ip: string | null;
  createdAt: string;
};
export type AuditPageData = { items: AuditRow[]; total: number; page: number; pageSize: number };

const inputCls =
  "min-h-11 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/25";
const btnCls =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

function summarize(row: AuditRow): string {
  const b = (row.before && typeof row.before === "object" ? row.before : null) as Record<string, unknown> | null;
  const a = (row.after && typeof row.after === "object" ? row.after : null) as Record<string, unknown> | null;

  if (row.action === "STOCK_CHANGE" && b && a) {
    if ("available" in b && "available" in a) return `${b.available}→${a.available} / ${a.total}`;
  }
  if (row.action === "RESERVATION_TRANSITION" && a?.status) {
    return `${b?.status ? `${String(b.status)} → ` : ""}${String(a.status)}`;
  }
  if (row.action === "ADMIN_CHANGE") {
    if (a?.action) return `${String(a.action)}${a.nameEn ? ` (${String(a.nameEn)})` : ""}`;
    if (b?.role && a?.role) return `${String(b.role)} → ${String(a.role)}`;
  }
  if (row.action === "AUTHZ_DENIED" && a?.reason) {
    return `${String(a.reason)} (${String(a.role ?? "")})`;
  }
  if (a?.reason) return String(a.reason);
  return row.entityType + (row.entityId ? ` ${row.entityId.slice(0, 8)}…` : "");
}

export function AuditLogViewer({
  lang, initial, actions,
}: { lang: Lang; initial: AuditPageData; actions: string[] }) {
  const [data, setData] = useState<AuditPageData>(initial);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const seq = useRef(0);
  const firstRender = useRef(true);

  const fetchLogs = useCallback(async () => {
    const mine = ++seq.current;
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    if (from) params.set("from", new Date(`${from}T00:00:00.000`).toISOString());
    if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
    params.set("page", String(page));

    const res = await fetch(`/api/admin/audit?${params}`, { cache: "no-store" });
    if (mine !== seq.current) return;
    if (res.ok) setData(await res.json() as AuditPageData);
    setLoading(false);
  }, [actionFilter, from, to, page]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void fetchLogs();
  }, [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold">{admin.auditLog[lang]}</h2>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-action" className="text-xs font-medium">{admin.filterByAction[lang]}</label>
          <select
            id="audit-action"
            value={actionFilter}
            onChange={(e) => { setLoading(true); setActionFilter(e.target.value); setPage(1); }}
            className={inputCls}
          >
            <option value="">{admin.filterAll[lang]}</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-from" className="text-xs font-medium">{admin.from[lang]}</label>
          <input
            id="audit-from"
            type="date"
            value={from}
            onChange={(e) => { setLoading(true); setFrom(e.target.value); setPage(1); }}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-to" className="text-xs font-medium">{admin.to[lang]}</label>
          <input
            id="audit-to"
            type="date"
            value={to}
            onChange={(e) => { setLoading(true); setTo(e.target.value); setPage(1); }}
            className={inputCls}
          />
        </div>
      </div>

      {data.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">{admin.noAuditLogs[lang]}</p>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label={admin.auditLog[lang]}
          className={`overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xs transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          <table className="w-full text-left text-sm" data-testid="admin-audit-table">
            <thead className="border-b border-[var(--border-default)] bg-[var(--bg-subtle)]">
              <tr>
                <th className="px-3 py-2 font-medium">{admin.time[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.actor[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.action[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.entity[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.summary[lang]}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const summary = summarize(row);
                const actorLabel = row.actor
                  ? `${row.actor.name} (${row.actor.phone})`
                  : row.actorUserId
                    ? `${row.actorUserId.slice(0, 8)}…`
                    : admin.systemActor[lang];
                return (
                  <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {new Date(row.createdAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-US")}
                    </td>
                    <td className="px-3 py-2 text-xs">{actorLabel}</td>
                    <td className="px-3 py-2">
                      <span className="inline-block rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs dark:bg-zinc-800">
                        {row.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.entityType}{row.entityId ? ` ${row.entityId.slice(0, 8)}…` : ""}
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-2 text-xs" title={summary}>{summary}</td>
                  </tr>
                );
              })}
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
