import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

export interface AiStatus {
  configured: boolean;
  allowed: boolean;
  model: string | null;
}

export interface Conversation {
  id: string;
  title: string | null;
  context_type: "lead" | "client" | null;
  context_id: string | null;
  context_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: string[];
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: AiMessage[];
}

export type DraftKind =
  | "outreach"
  | "follow_up"
  | "proposal_description"
  | "caption"
  | "content_ideas"
  | "meeting_summary"
  | "client_summary"
  | "weekly_summary";

export interface DraftRequest {
  kind: DraftKind;
  lead_id?: string;
  client_id?: string;
  channel?: string;
  tone?: string;
  instructions?: string;
}

export interface Draft {
  kind: DraftKind;
  text: string;
  model: string;
  label: string;
}

export interface LeadAnalysis {
  label: string;
  model: string;
  generated_by: string;
  analysis: {
    summary: string;
    opportunities: { service: string; why: string }[];
    observations: string[];
    outreach_angle: string;
    to_verify: string[];
    data_gaps: string[];
  };
}

export function useAiStatus() {
  return useQuery({ queryKey: ["ai", "status"], queryFn: () => api<AiStatus>("/ai/status"), staleTime: 5 * 60_000 });
}

export function useConversations(enabled = true) {
  return useQuery({ queryKey: ["ai", "conversations"], queryFn: () => api<Conversation[]>("/ai/conversations"), enabled });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ["ai", "conversation", id],
    queryFn: () => api<ConversationDetail>(`/ai/conversations/${id}`),
    enabled: !!id,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { context_type?: "lead" | "client"; context_id?: string }) =>
      api<Conversation>("/ai/conversations", { method: "POST", body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "conversations"] }),
  });
}

export function useSendMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api<{ user_message: AiMessage; assistant_message: AiMessage; conversation: Conversation }>(`/ai/conversations/${id}/messages`, {
        method: "POST",
        body: { content },
      }),
    onSuccess: (res) => {
      qc.setQueryData<ConversationDetail>(["ai", "conversation", id], (old) =>
        old ? { ...old, ...res.conversation, messages: [...old.messages, res.user_message, res.assistant_message] } : old,
      );
      void qc.invalidateQueries({ queryKey: ["ai", "conversations"] });
    },
  });
}

export function useRenameConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api<Conversation>(`/ai/conversations/${id}`, { method: "PATCH", body: { title } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai"] }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/ai/conversations/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "conversations"] }),
  });
}

export function useDraft() {
  return useMutation({ mutationFn: (body: DraftRequest) => api<Draft>("/ai/drafts", { method: "POST", body }) });
}

export function useAnalyzeLead(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<LeadAnalysis>(`/ai/leads/${leadId}/analyze`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useInsights(enabled: boolean) {
  return useQuery({
    queryKey: ["ai", "insights"],
    queryFn: () => api<{ items: string[]; cached: boolean }>("/ai/insights", { method: "POST", body: {} }),
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });
}

export function useRefreshInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ items: string[]; cached: boolean }>("/ai/insights", { method: "POST", body: { refresh: true } }),
    onSuccess: (data) => qc.setQueryData(["ai", "insights"], data),
  });
}
