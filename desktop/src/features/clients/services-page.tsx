import { Package, Pencil, Plus } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Textarea } from "@/components/ui/form-controls";
import { Field, Input, Select } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { FormAlert } from "@/features/auth/auth-layout";
import { CURRENCIES } from "@/features/leads/lead-form";
import { ApiError, errorMessage } from "@/lib/api";
import { formatMoney, humanize } from "@/lib/format";
import type { Service } from "@/types/clients";
import { BILLING_LABELS, type BillingType } from "@/types/sales";

import { useSaveService, useServiceCatalog } from "./api";

const CATEGORIES = ["social_media", "content", "graphic_design", "branding", "web_development", "web_maintenance", "seo", "ads", "other"];

/** Services & Packages: the catalog used for proposals and client services. */
export function ServicesCatalogPage() {
  const { can } = useAuth();
  const catalog = useServiceCatalog();
  const [editing, setEditing] = React.useState<Service | "new" | null>(null);
  const writable = can("settings.manage") || can("clients.manage");

  return (
    <>
      <PageHeader
        title="Services & packages"
        description="What the agency sells. Used as presets in proposals and when adding services to clients."
        actions={writable && <Button onClick={() => setEditing("new")}><Plus /> New service</Button>}
      />
      <Card className="overflow-hidden">
        {catalog.isError ? (
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        ) : catalog.isPending ? (
          <div className="p-6"><ListSkeleton rows={6} /></div>
        ) : catalog.data.length === 0 ? (
          <EmptyState icon={Package} title="No services yet" />
        ) : (
          <ul className="divide-y divide-line/60">
            {catalog.data.map((s) => (
              <li key={s.id} className={`group flex items-center gap-4 px-5 py-3.5 ${s.is_active ? "" : "opacity-60"}`}>
                <Package className="size-4 shrink-0 text-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">{s.name}{s.is_package && <Badge tone="accent">Package</Badge>}{!s.is_active && <Badge>Inactive</Badge>}</p>
                  <p className="truncate text-xs text-subtle">{humanize(s.category)} · {BILLING_LABELS[s.billing_type]}{s.description && ` · ${s.description}`}</p>
                </div>
                <span className="text-xs text-subtle">{s.active_clients} client{s.active_clients === 1 ? "" : "s"}</span>
                <span className="w-32 text-right text-sm tabular-nums text-muted">{s.default_price ? formatMoney(s.default_price, s.currency) : "Price not set"}</span>
                {writable && <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil /></Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <ServiceDialog service={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ServiceDialog({ service, onClose }: { service?: Service; onClose: () => void }) {
  const save = useSaveService(service?.id);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [f, setF] = React.useState({
    name: service?.name ?? "",
    category: service?.category ?? "social_media",
    description: service?.description ?? "",
    billing_type: service?.billing_type ?? ("monthly" as BillingType),
    default_price: service?.default_price ? String(Number(service.default_price)) : "",
    currency: service?.currency ?? "PHP",
    is_package: service?.is_package ?? false,
    is_active: service?.is_active ?? true,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={service ? "Edit service" : "New service"} className="max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!f.name.trim()) return setErrors({ name: "Name the service." });
            save.mutate(
              { ...f, name: f.name.trim(), description: f.description || null, default_price: f.default_price || null },
              { onSuccess: onClose, onError: (err) => err instanceof ApiError && setErrors(err.fields) },
            );
          }}
        >
          {save.isError && !(save.error instanceof ApiError && save.error.code === "validation_failed") && <FormAlert>{errorMessage(save.error)}</FormAlert>}
          <Field label="Name" htmlFor="sc-name" error={errors.name}><Input id="sc-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Category" htmlFor="sc-cat"><Select id="sc-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></Field>
            <Field label="Billing" htmlFor="sc-bill"><Select id="sc-bill" value={f.billing_type} onChange={(e) => setF({ ...f, billing_type: e.target.value as BillingType })}>{(Object.keys(BILLING_LABELS) as BillingType[]).map((b) => <option key={b} value={b}>{BILLING_LABELS[b]}</option>)}</Select></Field>
            <Field label="Default price" htmlFor="sc-price" error={errors.default_price}><Input id="sc-price" inputMode="decimal" value={f.default_price} onChange={(e) => setF({ ...f, default_price: e.target.value })} /></Field>
            <Field label="Currency" htmlFor="sc-cur"><Select id="sc-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          </div>
          <Field label="Description" htmlFor="sc-desc"><Textarea id="sc-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="flex gap-6">
            <label className="flex items-center gap-2.5 text-sm text-muted"><Checkbox checked={f.is_package} onChange={(v) => setF({ ...f, is_package: v })} label="Package" /> It's a package (bundle)</label>
            <label className="flex items-center gap-2.5 text-sm text-muted"><Checkbox checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Active" /> Active</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
