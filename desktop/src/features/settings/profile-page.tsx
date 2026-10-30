import { useMutation } from "@tanstack/react-query";
import { Check, KeyRound, Save } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { FormAlert } from "@/features/auth/auth-layout";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { PasswordInput, passwordProblem } from "@/features/auth/password-input";
import { api, ApiError, errorMessage } from "@/lib/api";
import { humanize } from "@/lib/format";
import type { Me } from "@/types/api";

const TIME_ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Asia/Manila", "UTC"];
  }
})();

export function ProfilePage() {
  return (
    <>
      <PageHeader title="My profile" description="Your details and sign-in settings." />
      <div className="grid max-w-5xl grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <DetailsCard />
        <PasswordCard />
      </div>
    </>
  );
}

function DetailsCard() {
  const me = useMe();
  const { setMe } = useAuth();
  const [form, setForm] = React.useState({
    full_name: me.full_name,
    job_title: me.job_title ?? "",
    phone: me.phone ?? "",
    timezone: me.timezone,
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api<Me>("/me", { method: "PATCH", body: form }),
    onSuccess: (next) => {
      setMe(next);
      setErrors({});
    },
    onError: (err) => err instanceof ApiError && setErrors(err.fields),
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    save.reset();
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const dirty =
    form.full_name !== me.full_name ||
    form.job_title !== (me.job_title ?? "") ||
    form.phone !== (me.phone ?? "") ||
    form.timezone !== me.timezone;

  return (
    <Card>
      <CardHeader title="Details" />
      <CardBody>
        <div className="mb-6 flex items-center gap-4">
          <Avatar name={me.full_name} className="size-14 text-lg" />
          <div className="min-w-0">
            <p className="truncate font-medium">{me.full_name}</p>
            <p className="truncate text-sm text-subtle">{me.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {me.roles.map((r) => (
                <Badge key={r} tone="accent">
                  {humanize(r)}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <form
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.full_name.trim()) {
              setErrors({ full_name: "Enter your name." });
              return;
            }
            save.mutate();
          }}
          noValidate
        >
          {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && (
            <div className="md:col-span-2">
              <FormAlert>{errorMessage(save.error)}</FormAlert>
            </div>
          )}
          <Field label="Full name" htmlFor="full_name" error={errors.full_name}>
            <Input id="full_name" value={form.full_name} onChange={set("full_name")} aria-invalid={!!errors.full_name} />
          </Field>
          <Field label="Job title" htmlFor="job_title" error={errors.job_title}>
            <Input id="job_title" value={form.job_title} onChange={set("job_title")} placeholder="e.g. Sales Lead" />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <Input id="phone" value={form.phone} onChange={set("phone")} placeholder="+63 9xx xxx xxxx" />
          </Field>
          <Field label="Time zone" htmlFor="timezone" error={errors.timezone} hint="Dates and the dashboard's 'today' use this.">
            <Select id="timezone" value={form.timezone} onChange={set("timezone")}>
              {TIME_ZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-end gap-3 md:col-span-2">
            {save.isSuccess && !dirty && (
              <span className="flex items-center gap-1.5 text-sm text-[#86efac]">
                <Check className="size-4" /> Saved
              </span>
            )}
            <Button type="submit" disabled={!dirty} loading={save.isPending}>
              {!save.isPending && <Save />} Save changes
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PasswordCard() {
  const { setMe } = useAuth();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api<Me>("/me/password", { method: "POST", body: { password } }),
    onSuccess: (next) => {
      setMe(next);
      setPassword("");
      setConfirm("");
    },
    onError: (err) => err instanceof ApiError && setErrors(err.fields),
  });

  return (
    <Card className="self-start">
      <CardHeader title="Password" description="At least 10 characters, with letters and numbers." />
      <CardBody>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const next: Record<string, string> = {};
            const problem = passwordProblem(password);
            if (problem) next.password = problem;
            else if (password !== confirm) next.confirm = "Passwords don't match.";
            setErrors(next);
            if (Object.keys(next).length === 0) save.mutate();
          }}
        >
          {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && (
            <FormAlert>{errorMessage(save.error)}</FormAlert>
          )}
          {save.isSuccess && <FormAlert tone="info">Password updated.</FormAlert>}
          <Field label="New password" htmlFor="new-password" error={errors.password}>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                save.reset();
                setPassword(e.target.value);
              }}
            />
          </Field>
          <Field label="Confirm password" htmlFor="confirm-password" error={errors.confirm}>
            <PasswordInput id="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" loading={save.isPending} disabled={!password}>
            {!save.isPending && <KeyRound />} Update password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
