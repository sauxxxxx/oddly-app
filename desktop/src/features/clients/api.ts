import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ClientDetail, ClientRow, Contract, FileRow, HistoryItem, Service } from "@/types/clients";
import type { LeadInput, Page } from "@/types/leads";

type Query = Record<string, string | number | boolean | undefined>;

function useInvalidateClients() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["clients", "contracts", "services", "lookups", "dashboard"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

export function useClients(q: { status?: string; search?: string; manager?: string; market?: string; sort?: string; page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ["clients", "list", q],
    queryFn: () => api<Page<ClientRow>>("/clients", { query: { per_page: 50, ...q } as Query }),
    placeholderData: keepPreviousData,
  });
}

export function useClient(id: string) {
  return useQuery({ queryKey: ["clients", "detail", id], queryFn: () => api<ClientDetail>(`/clients/${id}`) });
}

/** Mutations that return the updated client detail write it straight into the cache. */
function useClientMutation<V>(id: string, fn: (v: V) => Promise<ClientDetail>) {
  const qc = useQueryClient();
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(["clients", "detail", id], data);
      invalidate();
    },
  });
}

export type ClientInput = Omit<LeadInput, "status"> & {
  status?: string;
  account_manager_id?: string | null;
  client_since?: string | null;
  billing_email?: string | null;
  billing_address?: string | null;
  billing_notes?: string | null;
  notes?: string | null;
  force?: boolean;
};

export function useCreateClient() {
  const invalidate = useInvalidateClients();
  return useMutation({ mutationFn: (b: ClientInput) => api<ClientDetail>("/clients", { method: "POST", body: b }), onSuccess: invalidate });
}

export function useUpdateClient(id: string) {
  return useClientMutation(id, (b: ClientInput) => api<ClientDetail>(`/clients/${id}`, { method: "PUT", body: b }));
}

export function useClientStatus(id: string) {
  return useClientMutation(id, (status: string) => api<ClientDetail>(`/clients/${id}/status`, { method: "POST", body: { status } }));
}

export function useDeleteClient() {
  const invalidate = useInvalidateClients();
  return useMutation({ mutationFn: (id: string) => api(`/clients/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export interface ContactInput {
  full_name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary: boolean;
  notes?: string | null;
}

export function useContactMutations(id: string) {
  return {
    add: useClientMutation(id, (b: ContactInput) => api<ClientDetail>(`/clients/${id}/contacts`, { method: "POST", body: b })),
    update: useClientMutation(id, ({ contactId, ...b }: ContactInput & { contactId: string }) =>
      api<ClientDetail>(`/clients/${id}/contacts/${contactId}`, { method: "PUT", body: b }),
    ),
    remove: useClientMutation(id, (contactId: string) => api<ClientDetail>(`/clients/${id}/contacts/${contactId}`, { method: "DELETE" })),
  };
}

export interface ServiceInput {
  service_id?: string | null;
  name: string;
  price: string;
  currency: string;
  billing_type: string;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
}

export function useClientServiceMutations(id: string) {
  return {
    add: useClientMutation(id, (b: ServiceInput) => api<ClientDetail>(`/clients/${id}/services`, { method: "POST", body: b })),
    update: useClientMutation(id, ({ serviceId, ...b }: ServiceInput & { serviceId: string }) =>
      api<ClientDetail>(`/clients/${id}/services/${serviceId}`, { method: "PUT", body: b }),
    ),
    remove: useClientMutation(id, (serviceId: string) => api<ClientDetail>(`/clients/${id}/services/${serviceId}`, { method: "DELETE" })),
  };
}

export function useOnboarding(id: string) {
  return {
    start: useClientMutation(id, () => api<ClientDetail>(`/clients/${id}/onboarding`, { method: "POST" })),
    toggle: useClientMutation(id, ({ taskId, done }: { taskId: string; done: boolean }) =>
      api<ClientDetail>(`/clients/${id}/onboarding/${taskId}`, { method: "POST", body: { done } }),
    ),
  };
}

export function useClientHistory(id: string) {
  return useQuery({ queryKey: ["clients", "history", id], queryFn: () => api<HistoryItem[]>(`/clients/${id}/history`) });
}

export function useClientFeed(page: number) {
  return useQuery({
    queryKey: ["clients", "feed", page],
    queryFn: () => api<Page<HistoryItem>>("/clients/activity", { query: { page } }),
    placeholderData: keepPreviousData,
  });
}

// ---- Contracts -----------------------------------------------------------------

export function useContracts(q: { client_id?: string; status?: string; expiring_days?: number }) {
  return useQuery({ queryKey: ["contracts", q], queryFn: () => api<Contract[]>("/contracts", { query: q as Query }) });
}

export interface ContractInput {
  title: string;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
  value?: string | null;
  currency?: string;
  billing_cycle?: string | null;
  notes?: string | null;
}

export function useSaveContract(clientId: string, id?: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (b: ContractInput) =>
      id ? api<Contract>(`/contracts/${id}`, { method: "PUT", body: b }) : api<Contract>(`/clients/${clientId}/contracts`, { method: "POST", body: b }),
    onSuccess: invalidate,
  });
}

export function useDeleteContract() {
  const invalidate = useInvalidateClients();
  return useMutation({ mutationFn: (id: string) => api(`/contracts/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

// ---- Catalog -------------------------------------------------------------------

export function useServiceCatalog() {
  return useQuery({ queryKey: ["services"], queryFn: () => api<Service[]>("/services") });
}

export interface CatalogInput {
  name: string;
  category: string;
  description?: string | null;
  billing_type: string;
  default_price?: string | null;
  currency: string;
  is_package?: boolean;
  is_active?: boolean;
}

export function useSaveService(id?: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (b: CatalogInput) => (id ? api<Service>(`/services/${id}`, { method: "PUT", body: b }) : api<Service>("/services", { method: "POST", body: b })),
    onSuccess: invalidate,
  });
}

// ---- Files ---------------------------------------------------------------------

export function useFiles(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ["files", entityType, entityId],
    queryFn: () => api<FileRow[]>("/files", { query: { entity_type: entityType, entity_id: entityId } }),
  });
}
