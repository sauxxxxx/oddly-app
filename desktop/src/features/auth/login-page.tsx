import { useQuery } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import * as React from "react";
import { Navigate } from "react-router";

import { FullScreenLoader } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import type { SetupStatus } from "@/types/api";

import { useAuth } from "./auth-context";
import { AuthLayout, FormAlert } from "./auth-layout";
import { PasswordInput } from "./password-input";

export function LoginPage() {
  const { session, signIn } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const setup = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => api<SetupStatus>("/setup/status", { anonymous: true }),
    retry: 1,
  });

  if (session === undefined || setup.isPending) return <FullScreenLoader />;
  if (session) return <Navigate to="/" replace />;
  if (setup.data?.setup_required) return <Navigate to="/setup" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in with the account your administrator created for you.">
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        {setup.isError && (
          <FormAlert tone="info">
            {errorMessage(setup.error)} You can still sign in, but data won't load until the server is reachable.
          </FormAlert>
        )}
        {error && <FormAlert>{error}</FormAlert>}

        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@agency.com"
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" size="lg" loading={submitting} className="mt-1">
          {!submitting && <LogIn />} Sign in
        </Button>
        <p className="text-center text-xs text-subtle">
          Forgot your password? Ask an administrator to reset it from Team Members.
        </p>
      </form>
    </AuthLayout>
  );
}
