import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  CreateLeadResult,
  DuplicateGroup,
  ImportJob,
  Lead,
  LeadDetail,
  LeadFilters,
  LeadInput,
  LeadList,
  Lookups,
  Page,
  Research,
  SavedFilter,
} from "@/types/leads";

export const leadKeys = {
  all: ["leads"] as const,
  list: (f: LeadFilters) => ["leads", "list", f] as const,
  detail: (id: string) => ["leads", "detail", id] as const,
  research: (id: string) => ["leads", "research", id] as const,
};

type Query = Record<string, string | number | boolean | undefined>;

export function useLookups() {
  return useQuery({ queryKey: ["lookups"], queryFn: () => api<Lookups>("/lookups"), staleTime: 5 * 60_000 });
}

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: leadKeys.list(filters),
    queryFn: ({ signal }) => api<Page<Lead>>("/leads", { query: filters as Query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useLead(id: string) {
  return useQuery({ queryKey: leadKeys.detail(id), queryFn: () => api<LeadDetail>(`/leads/${id}`) });
}

export function useFacets() {
  return useQuery({
    queryKey: ["leads", "facets"],
    queryFn: () => api<{ countries: string[]; industries: string[] }>("/leads/facets"),
    staleTime: 60_000,
  });
}

/** Invalidates everything lead-related plus the dashboard after a change. */
export function useInvalidateLeads() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: leadKeys.all });
    void qc.invalidateQueries({ queryKey: ["lead-lists"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    void qc.invalidateQueries({ queryKey: ["lookups"] });
  };
}

export function useCreateLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: (body: LeadInput & { force?: boolean }) =>
      api<CreateLeadResult>("/leads", { method: "POST", body }),
    onSuccess: (r) => r.result === "created" && invalidate(),
  });
}

export function useUpdateLead(id: string) {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: (body: LeadInput) => api<Lead>(`/leads/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteLead() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: (id: string) => api(`/leads/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export type BulkAction =
  | { action: "assign"; user_id: string | null }
  | { action: "stage"; stage_id: string }
  | { action: "priority"; priority: string }
  | { action: "status"; status: string }
  | { action: "add_to_list"; list_id: string }
  | { action: "remove_from_list"; list_id: string }
  | { action: "delete" };

export function useBulkLeads() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: ({ ids, ...action }: BulkAction & { ids: string[] }) =>
      api<{ affected: number }>("/leads/bulk", { method: "POST", body: { ids, ...action } }),
    onSuccess: invalidate,
  });
}

export function exportLeads(filters: LeadFilters) {
  const { page: _p, per_page: _pp, ...rest } = filters;
  return api<Lead[]>("/leads/export", { query: rest as Query });
}

// ---- Research ---------------------------------------------------------------

export function useResearch(id: string) {
  return useQuery({ queryKey: leadKeys.research(id), queryFn: () => api<Research | null>(`/leads/${id}/research`) });
}

export function useSaveResearch(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Research>) => api<Research>(`/leads/${id}/research`, { method: "PUT", body }),
    onSuccess: (data) => {
      qc.setQueryData(leadKeys.research(id), data);
      void qc.invalidateQueries({ queryKey: leadKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: ["leads", "list"] });
    },
  });
}

// ---- Lists --------------------------------------------------------------------

export function useLeadLists() {
  return useQuery({ queryKey: ["lead-lists"], queryFn: () => api<LeadList[]>("/lead-lists") });
}

export function useLeadList(id: string) {
  return useQuery({ queryKey: ["lead-lists", id], queryFn: () => api<LeadList>(`/lead-lists/${id}`) });
}

export interface LeadListInput {
  name: string;
  description?: string;
  market?: string;
  color?: string;
  assignee_ids: string[];
  archived?: boolean;
}

export function useSaveLeadList(id?: string) {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: (body: LeadListInput) =>
      id ? api<LeadList>(`/lead-lists/${id}`, { method: "PATCH", body }) : api<LeadList>("/lead-lists", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useDeleteLeadList() {
  const invalidate = useInvalidateLeads();
  return useMutation({ mutationFn: (id: string) => api(`/lead-lists/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

// ---- Duplicates, saved filters, import history -------------------------------

export function useDuplicateGroups(enabled: boolean) {
  return useQuery({ queryKey: ["leads", "duplicates"], queryFn: () => api<DuplicateGroup[]>("/leads/duplicates"), enabled });
}

export function useMergeLeads() {
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: (body: { keep_id: string; merge_ids: string[] }) => api<Lead>("/leads/merge", { method: "POST", body }),
    onSuccess: invalidate,
  });
}

export function useSavedFilters() {
  return useQuery({ queryKey: ["saved-filters", "leads"], queryFn: () => api<SavedFilter[]>("/saved-filters", { query: { module: "leads" } }) });
}

export function useSaveFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; filters: LeadFilters; is_shared: boolean }) =>
      api<SavedFilter>("/saved-filters", { method: "POST", body: { ...body, module: "leads" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters", "leads"] }),
  });
}

export function useDeleteSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/saved-filters/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-filters", "leads"] }),
  });
}

export function useImportHistory() {
  return useQuery({ queryKey: ["leads", "imports"], queryFn: () => api<ImportJob[]>("/leads/import/history") });
}
