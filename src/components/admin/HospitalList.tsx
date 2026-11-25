"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ErrorBody } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { admin } from "@/lib/i18n/admin";
import { finder } from "@/lib/i18n/finder";

export type HospitalRow = {
  id: string; slug: string; nameBn: string; nameEn: string; type: string;
  freeService: boolean; liveDataEnabled: boolean; isDemo: boolean; phone: string;
  division: string; district: string; area: string; address: string;
  lat: number; lng: number; archivedAt: string | null;
  createdAt: string; updatedAt: string;
  _count: { resources: number; reservations: number };
};

export type HospitalPageData = { items: HospitalRow[]; total: number; page: number; pageSize: number };
export type ResourceTypeOption = { id: string; code: string; nameBn: string; nameEn: string; kind: "COUNTABLE" | "STATUS" };

const inputCls =
  "min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/25";
const btnCls =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

function slugifyEn(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

export function HospitalList({
  lang, initial, resourceTypes,
}: { lang: Lang; initial: HospitalPageData; resourceTypes: ResourceTypeOption[] }) {
  const [data, setData] = useState<HospitalPageData>(initial);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [liveFilter, setLiveFilter] = useState("");
  const [archivedFilter, setArchivedFilter] = useState("false");
  const [sort, setSort] = useState("nameEn");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const seq = useRef(0);
  const firstRender = useRef(true);

  const fetchList = useCallback(async (opts?: {
    search?: string; typeFilter?: string; liveFilter?: string; archivedFilter?: string; sort?: string; page?: number;
  }) => {
    const mine = ++seq.current;
    const s = opts?.search ?? search;
    const t = opts?.typeFilter ?? typeFilter;
    const l = opts?.liveFilter ?? liveFilter;
    const a = opts?.archivedFilter ?? archivedFilter;
    const so = opts?.sort ?? sort;
    const p = opts?.page ?? page;

    const params = new URLSearchParams();
    if (s) params.set("search", s);
    if (t) params.set("type", t);
    if (l) params.set("liveDataEnabled", l);
    if (a) params.set("archived", a);
    params.set("sort", so);
    params.set("page", String(p));

    const res = await fetch(`/api/admin/hospitals?${params}`, { cache: "no-store" });
    if (mine !== seq.current) return;
    if (res.ok) setData(await res.json() as HospitalPageData);
    setLoading(false);
  }, [search, typeFilter, liveFilter, archivedFilter, sort, page]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => { void fetchList(); }, 150);
    return () => clearTimeout(timer);
  }, [fetchList]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">{admin.hospitals[lang]}</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="import-csv-btn"
            onClick={() => { setShowCreate(false); setEditingId(null); setShowImport((v) => !v); }}
            className={`${btnCls} border border-[var(--border-strong)] bg-[var(--bg-surface)] px-4 hover:bg-[var(--bg-subtle)]`}
          >
            {admin.importCsv[lang]}
          </button>
          <button
            type="button"
            data-testid="create-hospital-btn"
            onClick={() => { setShowImport(false); setEditingId(null); setShowCreate(true); }}
            className={`${btnCls} bg-[var(--brand-primary)] px-4 text-white hover:bg-[var(--brand-primary-hover)]`}
          >
            {admin.createHospital[lang]}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <label htmlFor="hospital-search" className="sr-only">{admin.searchHospitals[lang]}</label>
          <input
            id="hospital-search"
            type="search"
            value={search}
            onChange={(e) => { setLoading(true); setSearch(e.target.value); setPage(1); }}
            placeholder={admin.searchHospitals[lang]}
            className={inputCls}
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setLoading(true); setTypeFilter(e.target.value); setPage(1); }}
          className={inputCls}
          aria-label={admin.filterType[lang]}
        >
          <option value="">{admin.filterType[lang]}: {admin.filterAll[lang]}</option>
          <option value="GOVT">{admin.govt[lang]}</option>
          <option value="PRIVATE">{admin.private[lang]}</option>
        </select>
        <select
          value={liveFilter}
          onChange={(e) => { setLoading(true); setLiveFilter(e.target.value); setPage(1); }}
          className={inputCls}
          aria-label={admin.filterLive[lang]}
        >
          <option value="">{admin.filterLive[lang]}: {admin.filterAll[lang]}</option>
          <option value="true">{admin.filterLive[lang]}</option>
          <option value="false">{admin.filterDirectoryOnly[lang]}</option>
        </select>
        <select
          value={archivedFilter}
          onChange={(e) => { setLoading(true); setArchivedFilter(e.target.value); setPage(1); }}
          className={inputCls}
          aria-label={admin.filterArchived[lang]}
        >
          <option value="false">{admin.filterActive[lang]}</option>
          <option value="true">{admin.filterArchived[lang]}</option>
          <option value="">{admin.filterAll[lang]}</option>
        </select>
        <select
          value={sort}
          onChange={(e) => { setLoading(true); setSort(e.target.value); setPage(1); }}
          className={inputCls}
          aria-label={admin.sortLabel[lang]}
        >
          <option value="nameEn">{admin.sortName[lang]}</option>
          <option value="district">{admin.sortDistrict[lang]}</option>
          <option value="updatedAt">{admin.sortUpdated[lang]}</option>
        </select>
      </div>

      {message && (
        <div
          role={message.ok ? "status" : "alert"}
          className={`rounded-md px-4 py-2 text-sm ${message.ok ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" : "border border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"}`}
        >
          {message.text}
        </div>
      )}

      {showImport && (
        <CsvImportPanel
          lang={lang}
          onClose={() => setShowImport(false)}
          onImported={() => { void fetchList(); }}
        />
      )}

      {showCreate && (
        <HospitalForm
          lang={lang}
          resourceTypes={resourceTypes}
          onClose={() => setShowCreate(false)}
          onSaved={(msg) => {
            setShowCreate(false);
            setMessage({ text: msg, ok: true });
            void fetchList();
          }}
        />
      )}

      {editingId && (
        <HospitalForm
          lang={lang}
          hospitalId={editingId}
          resourceTypes={resourceTypes}
          onClose={() => setEditingId(null)}
          onSaved={(msg) => {
            setEditingId(null);
            setMessage({ text: msg, ok: true });
            void fetchList();
          }}
        />
      )}

      {data.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">{admin.noHospitals[lang]}</p>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label={admin.hospitals[lang]}
          className={`overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xs transition-opacity ${loading ? "opacity-60" : ""}`}
        >
          <table className="w-full text-left text-sm" data-testid="admin-hospitals-table">
            <thead className="border-b border-[var(--border-default)] bg-[var(--bg-subtle)]">
              <tr>
                <th className="px-3 py-2 font-medium">{admin.nameEn[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.type[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.district[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.filterLive[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.resources[lang]}</th>
                <th className="px-3 py-2 font-medium">{admin.actions[lang]}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((h) => (
                <tr key={h.id} data-hospital-slug={h.slug} className={`border-b border-zinc-100 dark:border-zinc-800 ${h.archivedAt ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span>{lang === "bn" ? h.nameBn : h.nameEn}</span>
                      {h.isDemo && (
                        <span
                          data-testid="hospital-demo-tag"
                          className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--warning-text)]"
                        >
                          {finder.demoTag[lang]}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">{h.slug}</div>
                    {h.archivedAt && (
                      <span className="mt-0.5 inline-block rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-medium dark:bg-zinc-700">
                        {admin.archived[lang]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{h.type === "GOVT" ? admin.govt[lang] : admin.private[lang]}</td>
                  <td className="px-3 py-2">{h.district}</td>
                  <td className="px-3 py-2">{h.liveDataEnabled ? "✅" : "—"}</td>
                  <td className="px-3 py-2">{h._count.resources}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {!h.archivedAt && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setShowCreate(false); setEditingId(h.id); }}
                            className={`${btnCls} hover:bg-zinc-100 dark:hover:bg-zinc-800`}
                            aria-label={`${admin.edit[lang]} ${h.nameEn}`}
                          >
                            {admin.edit[lang]}
                          </button>
                          <DeleteButton
                            hospital={h}
                            lang={lang}
                            onDone={(msg, ok) => {
                              setMessage({ text: msg, ok });
                              if (ok) void fetchList();
                            }}
                          />
                        </>
                      )}
                    </div>
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

      <DemoRefreshButton lang={lang} />
    </div>
  );
}

function DeleteButton({
  hospital, lang, onDone,
}: { hospital: HospitalRow; lang: Lang; onDone: (msg: string, ok: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  const doDelete = async () => {
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/hospitals/${encodeURIComponent(hospital.id)}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json() as { action: "deleted" | "archived" };
        onDone(data.action === "deleted" ? admin.hospitalDeleted[lang] : admin.hospitalArchived[lang], true);
      } else {
        const err = (await res.json().catch(() => null)) as Partial<ErrorBody> | null;
        onDone(err?.error?.message?.[lang] || (lang === "bn" ? "ত্রুটি হয়েছে" : "Action failed"), false);
      }
    } catch {
      onDone(lang === "bn" ? "সংযোগে সমস্যা" : "Connection error", false);
    }
    setWorking(false);
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs font-medium text-red-700 dark:text-red-300">
          {hospital._count.reservations > 0 ? admin.confirmArchive[lang] : admin.confirmDelete[lang]}
        </span>
        <button
          type="button"
          onClick={doDelete}
          disabled={working}
          className={`${btnCls} bg-red-700 text-white hover:bg-red-800`}
        >
          {working ? "…" : admin.yes[lang]}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={working}
          className={`${btnCls} border border-zinc-300 dark:border-zinc-700`}
        >
          {admin.no[lang]}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={`${btnCls} text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30`}
      aria-label={`${hospital._count.reservations > 0 ? admin.archiveHospital[lang] : admin.deleteHospital[lang]} ${hospital.nameEn}`}
    >
      {hospital._count.reservations > 0 ? admin.archiveHospital[lang] : admin.deleteHospital[lang]}
    </button>
  );
}

type ResourceDraft = { resourceTypeId: string; total: number; available: number; isAvailable: boolean; availableTouched?: boolean };

function HospitalForm({
  lang, hospitalId, resourceTypes, onClose, onSaved,
}: { lang: Lang; hospitalId?: string; resourceTypes: ResourceTypeOption[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const isEdit = !!hospitalId;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState({
    nameBn: "", nameEn: "", slug: "", type: "GOVT" as "GOVT" | "PRIVATE", freeService: false,
    liveDataEnabled: true, phone: "", division: "", district: "", area: "", address: "",
    lat: 23.8, lng: 90.4, isDemo: false,
  });
  const [resources, setResources] = useState<ResourceDraft[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    fetch(`/api/admin/hospitals/${encodeURIComponent(hospitalId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const h = await res.json();
          setForm({
            nameBn: h.nameBn, nameEn: h.nameEn, slug: h.slug, type: h.type, freeService: h.freeService,
            liveDataEnabled: h.liveDataEnabled, phone: h.phone, division: h.division, district: h.district,
            area: h.area, address: h.address, lat: h.lat, lng: h.lng, isDemo: h.isDemo,
          });
        } else {
          setError(lang === "bn" ? "হাসপাতালের তথ্য লোড করা যায়নি" : "Failed to load hospital");
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(lang === "bn" ? "সংযোগে সমস্যা" : "Connection error");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [hospitalId, lang]);

  const typeById = new Map(resourceTypes.map((t) => [t.id, t]));
  const usedIds = new Set(resources.map((r) => r.resourceTypeId).filter(Boolean));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const url = isEdit ? `/api/admin/hospitals/${encodeURIComponent(hospitalId)}` : "/api/admin/hospitals";
      const method = isEdit ? "PATCH" : "POST";
      const cleanResources = resources
        .filter((r) => r.resourceTypeId)
        .map((r) => {
          const t = typeById.get(r.resourceTypeId);
          return t?.kind === "STATUS"
            ? { resourceTypeId: r.resourceTypeId, total: 0, available: 0, isAvailable: r.isAvailable }
            : { resourceTypeId: r.resourceTypeId, total: r.total, available: r.available };
        });
      const body = isEdit
        ? {
            nameBn: form.nameBn, nameEn: form.nameEn, type: form.type, freeService: form.freeService,
            liveDataEnabled: form.liveDataEnabled, phone: form.phone, division: form.division,
            district: form.district, area: form.area, address: form.address,
            lat: form.lat, lng: form.lng, isDemo: form.isDemo,
          }
        : { ...form, resources: form.liveDataEnabled && cleanResources.length > 0 ? cleanResources : undefined };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onSaved(isEdit ? admin.hospitalUpdated[lang] : admin.hospitalCreated[lang]);
      } else {
        const err = (await res.json().catch(() => null)) as Partial<ErrorBody> | null;
        const firstDetail = Array.isArray(err?.error?.details) && err.error.details[0]
          ? ` (${String((err.error.details[0] as { path?: unknown }).path ?? "")}: ${String((err.error.details[0] as { message?: unknown }).message ?? "")})`
          : "";
        setError((err?.error?.message?.[lang] || (lang === "bn" ? "ত্রুটি" : "Error")) + firstDetail);
      }
    } catch {
      setError(lang === "bn" ? "সংযোগে সমস্যা" : "Connection error");
    }
    setSaving(false);
  };

  if (loading) return <div className="h-48 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />;

  return (
    <form
      onSubmit={save}
      noValidate
      data-testid="hospital-form"
      aria-label={isEdit ? admin.editHospital[lang] : admin.createHospital[lang]}
      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xs"
    >
      <h3 className="mb-4 text-lg font-bold">{isEdit ? admin.editHospital[lang] : admin.createHospital[lang]}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-nameBn" className="text-sm font-medium">{admin.nameBn[lang]}</label>
          <input id="hf-nameBn" type="text" required value={form.nameBn} onChange={(e) => setForm({ ...form, nameBn: e.target.value })} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-nameEn" className="text-sm font-medium">{admin.nameEn[lang]}</label>
          <input
            id="hf-nameEn"
            type="text"
            required
            value={form.nameEn}
            onChange={(e) => {
              const nameEn = e.target.value;
              setForm((f) => ({ ...f, nameEn, slug: !isEdit && !slugTouched ? slugifyEn(nameEn) : f.slug }));
            }}
            className={inputCls}
          />
        </div>
        {!isEdit && (
          <div className="flex flex-col gap-1">
            <label htmlFor="hf-slug" className="text-sm font-medium">{admin.slug[lang]}</label>
            <input
              id="hf-slug"
              type="text"
              required
              value={form.slug}
              onChange={(e) => { setSlugTouched(true); setForm({ ...form, slug: e.target.value }); }}
              className={inputCls}
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-type" className="text-sm font-medium">{admin.type[lang]}</label>
          <select id="hf-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "GOVT" | "PRIVATE" })} className={inputCls}>
            <option value="GOVT">{admin.govt[lang]}</option>
            <option value="PRIVATE">{admin.private[lang]}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-phone" className="text-sm font-medium">{admin.phone[lang]}</label>
          <input id="hf-phone" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-division" className="text-sm font-medium">{admin.division[lang]}</label>
          <input id="hf-division" type="text" required value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-district" className="text-sm font-medium">{admin.district[lang]}</label>
          <input id="hf-district" type="text" required value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-area" className="text-sm font-medium">{admin.area[lang]}</label>
          <input id="hf-area" type="text" required value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="hf-address" className="text-sm font-medium">{admin.address[lang]}</label>
          <input id="hf-address" type="text" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-lat" className="text-sm font-medium">{admin.lat[lang]}</label>
          <input id="hf-lat" type="number" step="any" required value={form.lat} onChange={(e) => setForm({ ...form, lat: Number(e.target.value) })} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hf-lng" className="text-sm font-medium">{admin.lng[lang]}</label>
          <input id="hf-lng" type="number" step="any" required value={form.lng} onChange={(e) => setForm({ ...form, lng: Number(e.target.value) })} className={inputCls} />
        </div>
        <label htmlFor="hf-freeService" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
          <input id="hf-freeService" type="checkbox" checked={form.freeService} onChange={(e) => setForm({ ...form, freeService: e.target.checked })} className="h-5 w-5" />
          {admin.freeService[lang]}
        </label>
        <label htmlFor="hf-liveDataEnabled" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
          <input id="hf-liveDataEnabled" type="checkbox" checked={form.liveDataEnabled} onChange={(e) => setForm({ ...form, liveDataEnabled: e.target.checked })} className="h-5 w-5" />
          {admin.liveDataEnabled[lang]}
        </label>
        <label htmlFor="hf-isDemo" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium">
          <input id="hf-isDemo" type="checkbox" checked={form.isDemo} onChange={(e) => setForm({ ...form, isDemo: e.target.checked })} className="h-5 w-5" />
          {admin.isDemo[lang]}
        </label>
      </div>

      {!isEdit && form.liveDataEnabled && resourceTypes.length > 0 && (
        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h4 className="mb-2 text-sm font-semibold">{admin.initialResources[lang]}</h4>
          {resources.map((r, i) => {
            const rt = typeById.get(r.resourceTypeId);
            return (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  value={r.resourceTypeId}
                  onChange={(e) => {
                    const next = [...resources];
                    next[i] = { ...next[i], resourceTypeId: e.target.value };
                    setResources(next);
                  }}
                  className="min-h-11 flex-1 min-w-[180px] rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  aria-label={`${admin.resourceType[lang]} ${i + 1}`}
                >
                  <option value="">{admin.selectResourceType[lang]}</option>
                  {resourceTypes.map((t) => (
                    <option key={t.id} value={t.id} disabled={usedIds.has(t.id) && t.id !== r.resourceTypeId}>
                      {lang === "bn" ? t.nameBn : t.nameEn}
                    </option>
                  ))}
                </select>
                {rt?.kind === "STATUS" ? (
                  <label className="inline-flex min-h-11 items-center gap-2 px-2 text-sm">
                    <input
                      type="checkbox"
                      checked={r.isAvailable}
                      onChange={(e) => {
                        const next = [...resources];
                        next[i] = { ...next[i], isAvailable: e.target.checked };
                        setResources(next);
                      }}
                      className="h-5 w-5"
                    />
                    {admin.serviceAvailable[lang]}
                  </label>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <label htmlFor={`res-total-${i}`} className="text-xs text-[var(--text-muted)]">{admin.total[lang]}</label>
                      <input
                        id={`res-total-${i}`}
                        type="number"
                        min={0}
                        value={r.total}
                        onChange={(e) => {
                          const total = Number(e.target.value);
                          const next = [...resources];
                          next[i] = {
                            ...next[i],
                            total,
                            available: next[i].availableTouched ? next[i].available : total,
                          };
                          setResources(next);
                        }}
                        className="min-h-11 w-20 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <label htmlFor={`res-avail-${i}`} className="text-xs text-[var(--text-muted)]">{admin.available[lang]}</label>
                      <input
                        id={`res-avail-${i}`}
                        type="number"
                        min={0}
                        value={r.available}
                        onChange={(e) => {
                          const next = [...resources];
                          next[i] = { ...next[i], available: Number(e.target.value), availableTouched: true };
                          setResources(next);
                        }}
                        className="min-h-11 w-20 rounded-md border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setResources(resources.filter((_, j) => j !== i))}
                  aria-label={admin.removeResource[lang]}
                  className={`${btnCls} text-red-700 hover:bg-red-50 dark:text-red-400`}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setResources([...resources, { resourceTypeId: "", total: 5, available: 5, isAvailable: true }])}
            className={`${btnCls} border border-dashed border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800`}
          >
            + {admin.addResource[lang]}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className={`${btnCls} bg-[var(--brand-primary)] px-4 text-white hover:bg-[var(--brand-primary-hover)]`}>
          {saving ? admin.saving[lang] : admin.save[lang]}
        </button>
        <button type="button" onClick={onClose} className={`${btnCls} border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 hover:bg-[var(--bg-subtle)]`}>
          {admin.cancel[lang]}
        </button>
      </div>
    </form>
  );
}

function CsvImportPanel({ lang, onClose, onImported }: { lang: Lang; onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{
    summary: { total: number; created: number; updated: number; unchanged: number; errors: number };
    rows: { rowNumber: number; slug: string; status: string; errors?: string[] }[];
  } | null>(null);

  const runImport = async (e: FormEvent) => {
    e.preventDefault();
    if (running || !csv.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/hospitals/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      if (res.ok) {
        const data = await res.json();
        setReport(data);
        if (data.summary.created + data.summary.updated > 0) onImported();
      } else {
        const err = (await res.json().catch(() => null)) as Partial<ErrorBody> | null;
        setError(err?.error?.message?.[lang] || (lang === "bn" ? "ইমপোর্ট ব্যর্থ হয়েছে" : "Import failed"));
      }
    } catch {
      setError(lang === "bn" ? "সংযোগে সমস্যা" : "Connection error");
    }
    setRunning(false);
  };

  return (
    <form onSubmit={runImport} className="flex flex-col gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">{admin.importCsv[lang]}</h3>
        <button type="button" onClick={onClose} className={`${btnCls} border border-[var(--border-default)] bg-[var(--bg-surface)]`}>{admin.cancel[lang]}</button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{admin.importCsvHint[lang]}</p>
      <div>
        <label htmlFor="csv-file" className="mb-1 block text-sm font-medium">{admin.importCsvFile[lang]}</label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            void f.text().then((t) => setCsv(t));
          }}
          className="block w-full text-sm"
        />
      </div>
      <div>
        <label htmlFor="csv-text" className="mb-1 block text-sm font-medium">{admin.importCsvPaste[lang]}</label>
        <textarea
          id="csv-text"
          rows={4}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-2.5 font-mono text-xs"
        />
      </div>
      {error && <p role="alert" className="text-sm text-[var(--emergency-text)]">{error}</p>}
      {report && (
        <div role="status" className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3 text-xs">
          <p className="font-semibold">
            total: {report.summary.total} · created: {report.summary.created} · updated: {report.summary.updated} · unchanged: {report.summary.unchanged} · errors: {report.summary.errors}
          </p>
          {report.rows.filter((r) => r.status === "error").map((r) => (
            <p key={r.rowNumber} className="mt-1 text-[var(--emergency-text)]">
              Row {r.rowNumber} ({r.slug || "?"}): {r.errors?.join("; ")}
            </p>
          ))}
        </div>
      )}
      <div>
        <button type="submit" disabled={running || !csv.trim()} className={`${btnCls} bg-[var(--brand-primary)] px-4 text-white hover:bg-[var(--brand-primary-hover)]`}>
          {running ? admin.importing[lang] : admin.importCsvRun[lang]}
        </button>
      </div>
    </form>
  );
}

function DemoRefreshButton({ lang }: { lang: Lang }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  const doRefresh = async () => {
    setWorking(true);
    try {
      const res = await fetch("/api/admin/demo-refresh", { method: "POST" });
      if (res.ok) {
        const d = await res.json() as { refreshed: number };
        setStatus({ text: `${admin.refreshSuccess[lang]} (${d.refreshed})`, ok: true });
      } else {
        const err = (await res.json().catch(() => null)) as Partial<ErrorBody> | null;
        setStatus({ text: err?.error?.message?.[lang] || (lang === "bn" ? "ত্রুটি হয়েছে" : "Error"), ok: false });
      }
    } catch {
      setStatus({ text: lang === "bn" ? "সংযোগে সমস্যা" : "Connection error", ok: false });
    }
    setWorking(false);
    setConfirming(false);
  };

  return (
    <div className="mt-4 rounded-xl border border-[var(--warning-border)] bg-[var(--bg-surface)] p-5 shadow-xs">
      <h3 className="mb-2 text-lg font-bold">{admin.demoRefresh[lang]}</h3>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={`mb-2 text-sm font-medium ${status.ok ? "text-[var(--brand-primary-text)]" : "text-[var(--emergency-text)]"}`}>
          {status.text}
        </p>
      )}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{admin.refreshConfirm[lang]}</span>
          <button
            type="button"
            data-testid="demo-refresh-confirm"
            onClick={doRefresh}
            disabled={working}
            className={`${btnCls} bg-[var(--accent-gold)] px-4 text-[#14201B] hover:opacity-90`}
          >
            {working ? admin.refreshing[lang] : admin.yes[lang]}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={working}
            className={`${btnCls} border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 hover:bg-[var(--bg-subtle)]`}
          >
            {admin.no[lang]}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid="demo-refresh-btn"
          onClick={() => setConfirming(true)}
          className={`${btnCls} border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 text-[var(--warning-text)] hover:opacity-90`}
        >
          {admin.refreshDemoStock[lang]}
        </button>
      )}
    </div>
  );
}
