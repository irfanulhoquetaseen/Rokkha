"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { Bilingual, ErrorBody } from "@/lib/errors";
import { auth } from "@/lib/i18n/auth";
import { common } from "@/lib/i18n/common";
import type { Lang } from "@/lib/i18n";
import { bdPhoneSchema } from "@/lib/validation/phone";

type Mode = "login" | "signup";
type Field = "name" | "phone" | "password";
type FieldErrors = Partial<Record<Field, Bilingual>>;

const FIELD_ORDER: Field[] = ["name", "phone", "password"];
const inputCls =
  "min-h-12 w-full rounded-md border border-zinc-300 bg-transparent px-3 text-base outline-none focus:border-red-700 focus:ring-2 focus:ring-red-700/30 aria-[invalid=true]:border-red-600 dark:border-zinc-600";

/** Same rules as the server (auth service); messages are bilingual so a lang switch re-translates them. */
function validate(mode: Mode, v: Record<Field, string>): FieldErrors {
  const errors: FieldErrors = {};
  if (mode === "signup") {
    const n = v.name.trim().length;
    if (n < 2 || n > 80) errors.name = auth.nameInvalid;
  }
  if (!bdPhoneSchema.safeParse(v.phone).success) errors.phone = common.phoneInvalid;
  if (!v.password) errors.password = auth.passwordRequired;
  else if (mode === "signup" && v.password.length < 8) errors.password = auth.passwordTooShort;
  else if (new TextEncoder().encode(v.password).length > 72) errors.password = auth.passwordTooLong;
  return errors;
}

/** Server VALIDATION_ERROR details carry English-only Zod messages; map them to dictionary entries. */
function fieldErrorsFromDetails(mode: Mode, details: unknown): FieldErrors {
  if (!Array.isArray(details)) return {};
  const errors: FieldErrors = {};
  for (const d of details as { path?: unknown }[]) {
    if (d.path === "phone") errors.phone = common.phoneInvalid;
    if (d.path === "name") errors.name = auth.nameInvalid;
    if (d.path === "password") errors.password = mode === "signup" ? auth.passwordTooShort : auth.passwordRequired;
  }
  return errors;
}

export function AuthForm({ mode, lang, next }: { mode: Mode; lang: Lang; next: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<Bilingual | null>(null);

  function focusFirstInvalid(errors: FieldErrors) {
    const first = FIELD_ORDER.find((f) => errors[f]);
    if (first) formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return; // double-submit guard (the button is also disabled)
    const fd = new FormData(e.currentTarget);
    const values: Record<Field, string> = {
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      password: String(fd.get("password") ?? ""),
    };
    const errors = validate(mode, values);
    setFieldErrors(errors);
    setServerError(null);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid(errors);
      return;
    }

    setPending(true);
    const payload = mode === "signup" ? values : { phone: values.phone, password: values.password };
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // Stay "pending" while navigating; refresh re-renders the header with the new session.
        router.replace(next);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as ErrorBody | null;
      if (body?.error.code === "VALIDATION_ERROR") {
        const mapped = fieldErrorsFromDetails(mode, body.error.details);
        setFieldErrors(mapped);
        focusFirstInvalid(mapped);
      }
      setServerError(body?.error.message ?? common.retry);
    } catch {
      setServerError(auth.networkError);
    }
    setPending(false);
  }

  const fieldProps = (f: Field) => ({
    id: `auth-${f}`,
    name: f,
    "aria-invalid": fieldErrors[f] ? true : undefined,
    "aria-describedby": fieldErrors[f] ? `auth-${f}-error` : f === "password" && mode === "signup" ? "auth-password-hint" : undefined,
    className: inputCls,
  });

  const fieldError = (f: Field) => {
    const err = fieldErrors[f];
    return err ? (
      <p id={`auth-${f}-error`} className="text-sm text-red-700 dark:text-red-400">
        {err[lang]}
      </p>
    ) : null;
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {serverError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {serverError[lang]}
        </div>
      )}

      {mode === "signup" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="auth-name" className="text-sm font-medium">{auth.name[lang]}</label>
          <input {...fieldProps("name")} type="text" autoComplete="name" maxLength={80} required />
          {fieldError("name")}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="auth-phone" className="text-sm font-medium">{auth.phone[lang]}</label>
        <input
          {...fieldProps("phone")}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="01712345678"
          maxLength={20}
          required
        />
        {fieldError("phone")}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="auth-password" className="text-sm font-medium">{auth.password[lang]}</label>
        <input
          {...fieldProps("password")}
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
        />
        {mode === "signup" && !fieldErrors.password && (
          <p id="auth-password-hint" className="text-xs text-zinc-600 dark:text-zinc-400">{auth.passwordHint[lang]}</p>
        )}
        {fieldError("password")}
      </div>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="min-h-12 rounded-md bg-red-700 px-4 text-base font-semibold text-white hover:bg-red-800 disabled:opacity-60"
      >
        {pending ? auth.submitting[lang] : mode === "signup" ? auth.signupSubmit[lang] : auth.loginSubmit[lang]}
      </button>
    </form>
  );
}
