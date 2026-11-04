import { useMutation } from "@tanstack/react-query";
import { KeyRound, LogOut } from "lucide-react";
import * as React from "react";
import { Navigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { Me } from "@/types/api";

import { useAuth, useMe } from "./auth-context";
import { AuthLayout, FormAlert } from "./auth-layout";
import { PasswordInput, passwordProblem } from "./password-input";

/** Forced after signing in with a temporary password from an administrator. */
export function ChangePasswordPage() {
  const me = useMe();
  const { setMe, signOut } = useAuth();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => api<Me>("/me/password", { method: "POST", body: { password } }),
    onSuccess: setMe,
    onError: (err) => err instanceof ApiError && setErrors(err.fields),
  });

  if (!me.must_change_password) return <Navigate to="/" replace />;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    const problem = passwordProblem(password);
    if (problem) next.password = problem;
    else if (password !== confirm) next.confirm = "Passwords don't match.";
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  }

  return (
    <AuthLayout
      title="Choose your password"
      subtitle="You signed in with a temporary password. Choose a new one to continue."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && (
          <FormAlert>{errorMessage(save.error)}</FormAlert>
        )}
        <Field label="New password" htmlFor="password" error={errors.password} hint="At least 10 characters, with letters and numbers.">
          <PasswordInput id="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm}>
          <PasswordInput id="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />
        </Field>
        <Button type="submit" size="lg" loading={save.isPending} className="mt-2">
          {!save.isPending && <KeyRound />} Save password
        </Button>
        <Button type="button" variant="ghost" onClick={() => void signOut()}>
          <LogOut /> Sign out
        </Button>
      </form>
    </AuthLayout>
  );
}
