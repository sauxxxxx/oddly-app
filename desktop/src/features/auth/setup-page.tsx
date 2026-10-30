import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import * as React from "react";
import { Navigate } from "react-router";

import { ErrorState, FullScreenLoader } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { SetupStatus } from "@/types/api";

import { useAuth } from "./auth-context";
import { AuthLayout, FormAlert } from "./auth-layout";
import { PasswordInput, passwordProblem } from "./password-input";

/** First run only: creates the workspace owner (Super Admin). */
export function SetupPage() {
  const { session, signIn } = useAuth();
  const [form, setForm] = React.useState({ full_name: "", email: "", password: "", confirm: "", setup_token: "" });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const status = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => api<SetupStatus>("/setup/status", { anonymous: true }),
  });

  const create = useMutation({
    mutationFn: async () => {
      await api("/setup", {
        method: "POST",
        anonymous: true,
        body: {
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          setup_token: form.setup_token || undefined,
        },
      });
      await signIn(form.email, form.password);
    },
    onError: (err) => {
      if (err instanceof ApiError) setFieldErrors(err.fields);
    },
  });

  if (session) return <Navigate to="/" replace />;
  if (status.isPending) return <FullScreenLoader />;
  if (status.isError) {
    return (
      <AuthLayout title="Set up ODDLY" subtitle="We couldn't reach the ODDLY server.">
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      </AuthLayout>
    );
  }
  if (!status.data.setup_required) return <Navigate to="/login" replace />;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!form.full_name.trim()) errors.full_name = "Enter your name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = "Enter a valid email address.";
    const pw = passwordProblem(form.password);
    if (pw) errors.password = pw;
    else if (form.password !== form.confirm) errors.confirm = "Passwords don't match.";
    if (status.data?.setup_token_required && !form.setup_token) errors.setup_token = "Enter the setup token.";
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) create.mutate();
  }

  return (
    <AuthLayout
      title="Set up your workspace"
      subtitle="Create the owner account. It becomes the Super Admin and can invite the rest of the team."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {create.isError && !(create.error instanceof ApiError && create.error.code === "validation_failed") && (
          <FormAlert>{errorMessage(create.error)}</FormAlert>
        )}
        <Field label="Full name" htmlFor="full_name" error={fieldErrors.full_name}>
          <Input id="full_name" autoFocus value={form.full_name} onChange={set("full_name")} aria-invalid={!!fieldErrors.full_name} />
        </Field>
        <Field label="Work email" htmlFor="email" error={fieldErrors.email}>
          <Input id="email" type="email" autoComplete="username" value={form.email} onChange={set("email")} aria-invalid={!!fieldErrors.email} />
        </Field>
        <Field label="Password" htmlFor="password" error={fieldErrors.password} hint="At least 10 characters, with letters and numbers.">
          <PasswordInput id="password" autoComplete="new-password" value={form.password} onChange={set("password")} aria-invalid={!!fieldErrors.password} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={fieldErrors.confirm}>
          <PasswordInput id="confirm" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} aria-invalid={!!fieldErrors.confirm} />
        </Field>
        {status.data.setup_token_required && (
          <Field label="Setup token" htmlFor="setup_token" error={fieldErrors.setup_token} hint="Set as SETUP_TOKEN on the server.">
            <Input id="setup_token" value={form.setup_token} onChange={set("setup_token")} aria-invalid={!!fieldErrors.setup_token} />
          </Field>
        )}
        <Button type="submit" size="lg" loading={create.isPending} className="mt-2">
          {!create.isPending && <ShieldCheck />} Create owner account
        </Button>
      </form>
    </AuthLayout>
  );
}
