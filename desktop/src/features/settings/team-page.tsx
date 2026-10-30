import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, MoreHorizontal, ShieldOff, ShieldCheck, UserPlus, Users } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, Select } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { FormAlert } from "@/features/auth/auth-layout";
import { useAuth, useMe } from "@/features/auth/auth-context";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import type { CreatedMember, Role, TeamMember } from "@/types/api";

import { WorkloadCard } from "./team-extras";

const MEMBERS_KEY = ["team", "members"];
export const ROLES_KEY = ["team", "roles"];

export function useRoles() {
  return useQuery({ queryKey: ROLES_KEY, queryFn: () => api<Role[]>("/roles"), staleTime: 10 * 60_000 });
}

export function TeamPage() {
  const { can } = useAuth();
  const me = useMe();
  const members = useQuery({ queryKey: MEMBERS_KEY, queryFn: () => api<TeamMember[]>("/team/members") });
  const roles = useRoles();
  const [adding, setAdding] = React.useState(false);
  const [secret, setSecret] = React.useState<{ name: string; email: string; password: string; reset: boolean } | null>(null);
  const manage = can("team.manage");

  const roleName = (key: string) => roles.data?.find((r) => r.key === key)?.name ?? key;

  return (
    <>
      <PageHeader
        title="Team members"
        description="Everyone has their own account. Roles decide what each person can see and do."
        actions={
          manage && (
            <Button onClick={() => setAdding(true)}>
              <UserPlus /> Add member
            </Button>
          )
        }
      />

      <Card className="overflow-hidden">
        {members.isPending ? (
          <div className="p-6">
            <ListSkeleton rows={5} />
          </div>
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : members.data.length === 0 ? (
          <EmptyState icon={Users} title="No team members" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-[0.06em] text-subtle">
                <th className="px-6 py-3.5 font-medium">Member</th>
                <th className="px-4 py-3.5 font-medium">Role</th>
                <th className="px-4 py-3.5 font-medium">Status</th>
                <th className="px-4 py-3.5 font-medium">Last active</th>
                <th className="w-14 px-4 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {members.data.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  roles={roles.data ?? []}
                  roleName={roleName}
                  editable={manage && m.id !== me.id && (!m.roles.includes("super_admin") || me.roles.includes("super_admin"))}
                  isSelf={m.id === me.id}
                  onPasswordReset={(password) => setSecret({ name: m.full_name, email: m.email, password, reset: true })}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {manage && (
        <AddMemberDialog
          open={adding}
          onOpenChange={setAdding}
          roles={(roles.data ?? []).filter((r) => r.key !== "super_admin" || me.roles.includes("super_admin"))}
          onCreated={(created) => {
            setAdding(false);
            setSecret({
              name: created.member.full_name,
              email: created.member.email,
              password: created.temporary_password,
              reset: false,
            });
          }}
        />
      )}

      <WorkloadCard />
      <TemporaryPasswordDialog secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}

function MemberRow({
  member: m,
  roles,
  roleName,
  editable,
  isSelf,
  onPasswordReset,
}: {
  member: TeamMember;
  roles: Role[];
  roleName: (key: string) => string;
  editable: boolean;
  isSelf: boolean;
  onPasswordReset: (password: string) => void;
}) {
  const queryClient = useQueryClient();
  const me = useMe();
  const [error, setError] = React.useState<string | null>(null);

  const update = useMutation({
    mutationFn: (body: { role_key?: string; status?: string }) =>
      api<TeamMember>(`/team/members/${m.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ROLES_KEY });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const reset = useMutation({
    mutationFn: () => api<{ temporary_password: string }>(`/team/members/${m.id}/reset-password`, { method: "POST" }),
    onSuccess: (res) => {
      setError(null);
      onPasswordReset(res.temporary_password);
      void queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const currentRole = m.roles[0] ?? "";
  const grantable = roles.filter((r) => r.key !== "super_admin" || me.roles.includes("super_admin"));

  return (
    <tr className="border-b border-line/70 last:border-0 hover:bg-raised/30">
      <td className="px-6 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar name={m.full_name} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">
              {m.full_name} {isSelf && <span className="text-subtle">(you)</span>}
            </p>
            <p className="truncate text-xs text-subtle">
              {m.email}
              {m.job_title && ` · ${m.job_title}`}
            </p>
            {error && <p className="mt-1 text-xs text-danger">{error}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        {editable ? (
          <Select
            aria-label={`Role for ${m.full_name}`}
            value={currentRole}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ role_key: e.target.value })}
            className="h-9 w-48"
          >
            {!currentRole && <option value="">No role</option>}
            {grantable.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {m.roles.length === 0 ? <Badge>No role</Badge> : m.roles.map((r) => <Badge key={r} tone="accent">{roleName(r)}</Badge>)}
          </div>
        )}
      </td>
      <td className="px-4 py-3.5">
        {m.status === "suspended" ? (
          <Badge tone="danger" dot>Suspended</Badge>
        ) : m.must_change_password ? (
          <Badge tone="warning" dot>Awaiting first sign-in</Badge>
        ) : (
          <Badge tone="success" dot>Active</Badge>
        )}
      </td>
      <td className="px-4 py-3.5 text-muted">{m.last_seen_at ? formatRelative(m.last_seen_at) : "Never"}</td>
      <td className="px-4 py-3.5 text-right">
        {editable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.full_name}`} disabled={update.isPending || reset.isPending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => reset.mutate()}>
                <KeyRound /> Reset password
              </DropdownMenuItem>
              {m.status === "active" ? (
                <DropdownMenuItem destructive onSelect={() => update.mutate({ status: "suspended" })}>
                  <ShieldOff /> Suspend access
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => update.mutate({ status: "active" })}>
                  <ShieldCheck /> Reactivate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
    </tr>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: Role[];
  onCreated: (c: CreatedMember) => void;
}) {
  const queryClient = useQueryClient();
  const empty = { full_name: "", email: "", job_title: "", role_key: "sales_rep" };
  const [form, setForm] = React.useState(empty);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: () => api<CreatedMember>("/team/members", { method: "POST", body: form }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ROLES_KEY });
      setForm(empty);
      onCreated(created);
    },
    onError: (err) => err instanceof ApiError && setErrors(err.fields),
  });

  React.useEffect(() => {
    if (!open) {
      setErrors({});
      create.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the dialog closes

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a team member"
        description="They'll get a temporary password from you and choose their own at first sign-in."
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const next: Record<string, string> = {};
            if (!form.full_name.trim()) next.full_name = "Enter their name.";
            if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
            if (!form.role_key) next.role_key = "Choose a role.";
            setErrors(next);
            if (Object.keys(next).length === 0) create.mutate();
          }}
        >
          {create.isError && !(create.error instanceof ApiError && create.error.code === "validation_failed") && (
            <FormAlert>{errorMessage(create.error)}</FormAlert>
          )}
          <Field label="Full name" htmlFor="m-name" error={errors.full_name}>
            <Input id="m-name" autoFocus value={form.full_name} onChange={set("full_name")} aria-invalid={!!errors.full_name} />
          </Field>
          <Field label="Email" htmlFor="m-email" error={errors.email}>
            <Input id="m-email" type="email" value={form.email} onChange={set("email")} aria-invalid={!!errors.email} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Job title" htmlFor="m-title" error={errors.job_title}>
              <Input id="m-title" value={form.job_title} onChange={set("job_title")} placeholder="Optional" />
            </Field>
            <Field label="Role" htmlFor="m-role" error={errors.role_key}>
              <Select id="m-role" value={form.role_key} onChange={set("role_key")}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              {!create.isPending && <UserPlus />} Add member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemporaryPasswordDialog({
  secret,
  onClose,
}: {
  secret: { name: string; email: string; password: string; reset: boolean } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    setCopied(false);
  }, [secret]);

  return (
    <Dialog open={!!secret} onOpenChange={(o) => !o && onClose()}>
      {secret && (
        <DialogContent
          title={secret.reset ? "Password reset" : `${secret.name} has been added`}
          description="Share this temporary password privately. It's shown only once — ODDLY doesn't store it."
        >
          <div className="rounded-control border border-line bg-raised p-4">
            <p className="text-xs text-subtle">Email</p>
            <p className="text-sm">{secret.email}</p>
            <p className="mt-3 text-xs text-subtle">Temporary password</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <code className="font-mono text-[15px] tracking-wide text-fg">{secret.password}</code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard
                    .writeText(secret.password)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <p className="mt-3 text-xs text-subtle">They'll be asked to choose their own password when they first sign in.</p>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
