import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Page } from "@/types/leads";
import type {
  Deal,
  FollowUp,
  Interaction,
  Meeting,
  PipelineColumn,
  ProposalDetail,
  ProposalItem,
  ProposalSummary,
} from "@/types/sales";

type Query = Record<string, string | number | boolean | undefined>;

/** After any sales change: refresh sales lists, leads, the dashboard and notifications. */
export function useInvalidateSales() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["pipeline", "interactions", "follow-ups", "meetings", "deals", "proposals", "leads", "dashboard", "notifications", "clients"]) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

function useSalesMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>) {
  const invalidate = useInvalidateSales();
  return useMutation({ mutationFn: fn, onSuccess: invalidate });
}

// ---- Pipeline -----------------------------------------------------------------

export function usePipeline(filters: { search?: string; market?: string; assigned?: string }) {
  return useQuery({
    queryKey: ["pipeline", filters],
    queryFn: () => api<PipelineColumn[]>("/pipeline", { query: filters as Query }),
    placeholderData: keepPreviousData,
  });
}

export function useMoveLead() {
  const qc = useQueryClient();
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: ({ id, stage_id }: { id: string; stage_id: string; filtersKey: unknown }) =>
      api(`/leads/${id}/stage`, { method: "POST", body: { stage_id } }),
    // Optimistic: move the card immediately, roll back on error.
    onMutate: async ({ id, stage_id, filtersKey }) => {
      const key = ["pipeline", filtersKey];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PipelineColumn[]>(key);
      if (prev) {
        const card = prev.flatMap((c) => c.cards).find((c) => c.id === id);
        if (card) {
          qc.setQueryData<PipelineColumn[]>(
            key,
            prev.map((col) => ({
              ...col,
              count: col.count + (col.id === stage_id ? 1 : 0) - (col.id === card.stage_id ? 1 : 0),
              cards:
                col.id === stage_id
                  ? [{ ...card, stage_id }, ...col.cards]
                  : col.cards.filter((c) => c.id !== id),
            })),
          );
        }
      }
      return { prev, key };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(ctx.key, ctx.prev),
    onSettled: invalidate,
  });
}

export interface StageInput {
  name: string;
  kind?: string;
  color?: string;
}

export function useStageMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["pipeline"] });
    void qc.invalidateQueries({ queryKey: ["lookups"] });
  };
  return {
    create: useMutation({ mutationFn: (b: StageInput) => api("/pipeline/stages", { method: "POST", body: b }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...b }: StageInput & { id: string }) => api(`/pipeline/stages/${id}`, { method: "PATCH", body: b }), onSuccess: done }),
    reorder: useMutation({ mutationFn: (ids: string[]) => api("/pipeline/stages/reorder", { method: "POST", body: { ids } }), onSuccess: done }),
    remove: useMutation({
      mutationFn: ({ id, move_to }: { id: string; move_to: string }) => api(`/pipeline/stages/${id}`, { method: "DELETE", query: { move_to } }),
      onSuccess: done,
    }),
  };
}

// ---- Interactions --------------------------------------------------------------

export function useInteractions(q: { lead_id?: string; channel?: string; user_id?: string; search?: string; page?: number }) {
  return useQuery({
    queryKey: ["interactions", q],
    queryFn: () => api<Page<Interaction>>("/interactions", { query: { per_page: 50, ...q } as Query }),
    placeholderData: keepPreviousData,
  });
}

export interface LogInteractionInput {
  channel: string;
  direction?: string;
  subject?: string | null;
  body?: string | null;
  outcome?: string | null;
  occurred_at?: string | null;
  next_action?: string | null;
  next_action_due_at?: string | null;
  follow_up?: { title: string; due_at: string; priority?: string } | null;
}

export function useLogInteraction(leadId: string) {
  return useSalesMutation((b: LogInteractionInput) => api(`/leads/${leadId}/interactions`, { method: "POST", body: b }));
}

export function useDeleteInteraction() {
  return useSalesMutation((id: string) => api(`/interactions/${id}`, { method: "DELETE" }));
}

// ---- Follow-ups ------------------------------------------------------------------

export function useFollowUps(q: { scope?: string; status?: string; due?: string; lead_id?: string; client_id?: string; page?: number; per_page?: number }) {
  return useQuery({
    queryKey: ["follow-ups", q],
    queryFn: () => api<Page<FollowUp>>("/follow-ups", { query: { per_page: 100, ...q } as Query }),
    placeholderData: keepPreviousData,
  });
}

export interface FollowUpInput {
  lead_id?: string | null;
  deal_id?: string | null;
  client_id?: string | null;
  title: string;
  notes?: string | null;
  due_at: string;
  priority?: string;
  recurrence?: string | null;
  assigned_to?: string | null;
}

export function useSaveFollowUp(id?: string) {
  return useSalesMutation((b: FollowUpInput) =>
    id ? api<FollowUp>(`/follow-ups/${id}`, { method: "PATCH", body: b }) : api<FollowUp>("/follow-ups", { method: "POST", body: b }),
  );
}

export function useCompleteFollowUp() {
  return useSalesMutation((id: string) => api<FollowUp>(`/follow-ups/${id}/complete`, { method: "POST" }));
}

export function useDeleteFollowUp() {
  return useSalesMutation((id: string) => api(`/follow-ups/${id}`, { method: "DELETE" }));
}

// ---- Meetings ------------------------------------------------------------------

export function useMeetings(q: { from?: string; to?: string; lead_id?: string; client_id?: string; scope?: string }) {
  return useQuery({ queryKey: ["meetings", q], queryFn: () => api<Meeting[]>("/meetings", { query: q as Query }) });
}

export interface MeetingInput {
  title: string;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  meeting_url?: string | null;
  lead_id?: string | null;
  client_id?: string | null;
  deal_id?: string | null;
  notes?: string | null;
  outcome?: string | null;
  next_action?: string | null;
  status?: string;
  participant_ids: string[];
  external: { name: string; email?: string | null }[];
}

export function useSaveMeeting(id?: string) {
  return useSalesMutation((b: MeetingInput) =>
    id ? api<Meeting>(`/meetings/${id}`, { method: "PATCH", body: b }) : api<Meeting>("/meetings", { method: "POST", body: b }),
  );
}

export function useDeleteMeeting() {
  return useSalesMutation((id: string) => api(`/meetings/${id}`, { method: "DELETE" }));
}

// ---- Deals ---------------------------------------------------------------------

export function useDeals(q: { status?: string; search?: string; owner?: string; lead_id?: string; page?: number }) {
  return useQuery({
    queryKey: ["deals", q],
    queryFn: () => api<Page<Deal>>("/deals", { query: { per_page: 50, ...q } as Query }),
    placeholderData: keepPreviousData,
  });
}

export interface DealInput {
  lead_id?: string;
  title: string;
  value: string;
  currency: string;
  expected_close_date?: string | null;
  owner_id?: string | null;
}

export function useSaveDeal(id?: string) {
  return useSalesMutation((b: DealInput) =>
    id ? api<Deal>(`/deals/${id}`, { method: "PATCH", body: b }) : api<Deal>("/deals", { method: "POST", body: b }),
  );
}

export function useCloseDeal() {
  return useSalesMutation(({ id, ...b }: { id: string; status: string; lost_reason?: string | null }) =>
    api<Deal>(`/deals/${id}/close`, { method: "POST", body: b }),
  );
}

export function useDeleteDeal() {
  return useSalesMutation((id: string) => api(`/deals/${id}`, { method: "DELETE" }));
}

// ---- Proposals -----------------------------------------------------------------

export function useProposals(q: { status?: string; search?: string; templates?: boolean; lead_id?: string; page?: number }) {
  return useQuery({
    queryKey: ["proposals", q],
    queryFn: () => api<Page<ProposalSummary>>("/proposals", { query: { per_page: 50, ...q } as Query }),
    placeholderData: keepPreviousData,
  });
}

export function useProposal(id: string) {
  return useQuery({ queryKey: ["proposals", "detail", id], queryFn: () => api<ProposalDetail>(`/proposals/${id}`) });
}

export function useCreateProposal() {
  return useSalesMutation((b: { lead_id?: string; deal_id?: string; template_id?: string; title?: string; is_template?: boolean }) =>
    api<ProposalDetail>("/proposals", { method: "POST", body: b }),
  );
}

export interface ProposalSave {
  title: string;
  currency: string;
  discount_type: string;
  discount_value: string;
  tax_rate: string;
  valid_until: string | null;
  introduction: string | null;
  terms: string | null;
  items: ProposalItem[];
}

export function useSaveProposal(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (b: ProposalSave) => api<ProposalDetail>(`/proposals/${id}`, { method: "PUT", body: b }),
    onSuccess: (data) => {
      qc.setQueryData(["proposals", "detail", id], data);
      invalidate();
    },
  });
}

export function useProposalStatus(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (status: string) => api<ProposalDetail>(`/proposals/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: (data) => {
      qc.setQueryData(["proposals", "detail", id], data);
      invalidate();
    },
  });
}

export function useDuplicateProposal() {
  return useSalesMutation(({ id, as_template }: { id: string; as_template: boolean }) =>
    api<ProposalDetail>(`/proposals/${id}/duplicate`, { method: "POST", body: { as_template } }),
  );
}

export function useDeleteProposal() {
  return useSalesMutation((id: string) => api(`/proposals/${id}`, { method: "DELETE" }));
}

// ---- Conversion ----------------------------------------------------------------

export interface ConvertInput {
  account_manager_id?: string | null;
  status?: string;
  client_since?: string | null;
  deal_id?: string | null;
  proposal_id?: string | null;
  notes?: string | null;
  services: { service_id?: string | null; name: string; price: string; currency: string; billing_type: string }[];
}

export function useConvertLead(leadId: string) {
  return useSalesMutation((b: ConvertInput) =>
    api<{ client_id: string; already_client: boolean }>(`/leads/${leadId}/convert`, { method: "POST", body: b }),
  );
}
