import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Page } from "@/types/leads";
import type {
  Asset,
  AuditRow,
  Maintenance,
  Post,
  PostDetail,
  Project,
  ProjectTemplate,
  Task,
  TaskDetail,
  Website,
  WebsiteDetail,
  Workload,
} from "@/types/ops";

type Query = Record<string, string | number | boolean | undefined>;

function useInvalidate(keys: string[]) {
  const qc = useQueryClient();
  return () => {
    for (const k of [...keys, "dashboard", "notifications", "clients"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

// ---- Projects & tasks ------------------------------------------------------------

export function useProjects(q: { status?: string; client_id?: string; member?: string; search?: string }) {
  return useQuery({ queryKey: ["projects", q], queryFn: () => api<Project[]>("/projects", { query: q as Query }), placeholderData: keepPreviousData });
}

export function useProject(id: string) {
  return useQuery({ queryKey: ["projects", "detail", id], queryFn: () => api<Project>(`/projects/${id}`) });
}

export function useProjectTemplates() {
  return useQuery({ queryKey: ["projects", "templates"], queryFn: () => api<ProjectTemplate[]>("/projects/templates"), staleTime: Infinity });
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  category?: string | null;
  status?: string;
  priority?: string;
  client_id?: string | null;
  start_date?: string | null;
  deadline?: string | null;
  owner_id?: string | null;
  deliverables: string[];
  member_ids: string[];
  template?: string | null;
}

export function useSaveProject(id?: string) {
  const invalidate = useInvalidate(["projects", "tasks"]);
  return useMutation({
    mutationFn: (b: ProjectInput) => (id ? api<Project>(`/projects/${id}`, { method: "PUT", body: b }) : api<Project>("/projects", { method: "POST", body: b })),
    onSuccess: invalidate,
  });
}

export function useDeleteProject() {
  const invalidate = useInvalidate(["projects", "tasks"]);
  return useMutation({ mutationFn: (id: string) => api(`/projects/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export interface TaskQuery {
  project_id?: string;
  client_id?: string;
  assignee?: string;
  status?: string;
  due_from?: string;
  due_to?: string;
  search?: string;
}

export function useTasks(q: TaskQuery, enabled = true) {
  return useQuery({ queryKey: ["tasks", q], queryFn: () => api<Task[]>("/tasks", { query: q as Query }), placeholderData: keepPreviousData, enabled });
}

export function useTask(id: string | null) {
  return useQuery({ queryKey: ["tasks", "detail", id], queryFn: () => api<TaskDetail>(`/tasks/${id}`), enabled: !!id });
}

export interface TaskInput {
  project_id?: string | null;
  client_id?: string | null;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assignee_id?: string | null;
  due_at?: string | null;
}

function useTaskMutation<V>(fn: (v: V) => Promise<TaskDetail>) {
  const qc = useQueryClient();
  const invalidate = useInvalidate(["tasks", "projects"]);
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(["tasks", "detail", data.id], data);
      invalidate();
    },
  });
}

export function useSaveTask(id?: string) {
  return useTaskMutation((b: TaskInput) => (id ? api<TaskDetail>(`/tasks/${id}`, { method: "PUT", body: b }) : api<TaskDetail>("/tasks", { method: "POST", body: b })));
}

export function useMoveTask() {
  return useTaskMutation(({ id, ...b }: { id: string; status: string; position?: number }) => api<TaskDetail>(`/tasks/${id}/move`, { method: "POST", body: b }));
}

export function useTaskParts(id: string) {
  return {
    addSubtask: useTaskMutation((title: string) => api<TaskDetail>(`/tasks/${id}/subtasks`, { method: "POST", body: { title } })),
    toggleSubtask: useTaskMutation(({ sub, is_done }: { sub: string; is_done: boolean }) => api<TaskDetail>(`/tasks/${id}/subtasks/${sub}`, { method: "PUT", body: { is_done } })),
    removeSubtask: useTaskMutation((sub: string) => api<TaskDetail>(`/tasks/${id}/subtasks/${sub}`, { method: "DELETE" })),
    addComment: useTaskMutation((body: string) => api<TaskDetail>(`/tasks/${id}/comments`, { method: "POST", body: { body } })),
    removeComment: useTaskMutation((comment: string) => api<TaskDetail>(`/tasks/${id}/comments/${comment}`, { method: "DELETE" })),
  };
}

export function useDeleteTask() {
  const invalidate = useInvalidate(["tasks", "projects"]);
  return useMutation({ mutationFn: (id: string) => api(`/tasks/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

// ---- Content ----------------------------------------------------------------------

export interface PostQuery {
  client_id?: string;
  stage_id?: string;
  stage_keys?: string;
  platform?: string;
  from?: string;
  to?: string;
  assignee?: string;
  search?: string;
  with_caption?: boolean;
}

export function usePosts(q: PostQuery) {
  return useQuery({ queryKey: ["content", q], queryFn: () => api<Post[]>("/content", { query: q as Query }), placeholderData: keepPreviousData });
}

export function usePost(id: string | null) {
  return useQuery({ queryKey: ["content", "detail", id], queryFn: () => api<PostDetail>(`/content/${id}`), enabled: !!id });
}

export interface PostInput {
  client_id: string;
  title: string;
  platform: string;
  content_type: string;
  category?: string | null;
  campaign?: string | null;
  caption?: string | null;
  hashtags: string[];
  stage_id?: string | null;
  designer_id?: string | null;
  creator_id?: string | null;
  due_at?: string | null;
  publish_at?: string | null;
  published_url?: string | null;
}

function usePostMutation<V>(fn: (v: V) => Promise<PostDetail>) {
  const qc = useQueryClient();
  const invalidate = useInvalidate(["content"]);
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(["content", "detail", data.id], data);
      invalidate();
    },
  });
}

export function useSavePost(id?: string) {
  return usePostMutation((b: PostInput) => (id ? api<PostDetail>(`/content/${id}`, { method: "PUT", body: b }) : api<PostDetail>("/content", { method: "POST", body: b })));
}

export function useMovePost() {
  return usePostMutation(({ id, stage_id }: { id: string; stage_id: string }) => api<PostDetail>(`/content/${id}/stage`, { method: "POST", body: { stage_id } }));
}

export function useReviewPost(id: string) {
  return usePostMutation((b: { decision: string; feedback?: string | null }) => api<PostDetail>(`/content/${id}/review`, { method: "POST", body: b }));
}

export function useDeletePost() {
  const invalidate = useInvalidate(["content"]);
  return useMutation({ mutationFn: (id: string) => api(`/content/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useAssets(q: { client_id?: string; post_id?: string; asset_type?: string; search?: string }, enabled = true) {
  return useQuery({ queryKey: ["content", "assets", q], queryFn: () => api<Asset[]>("/content/assets", { query: q as Query }), enabled, staleTime: 30 * 60_000 });
}

export function useAssetMutations() {
  const invalidate = useInvalidate(["content"]);
  return {
    add: useMutation({
      mutationFn: (b: { client_id: string; file_id: string; post_id?: string | null; asset_type: string; title?: string | null; tags: string[] }) =>
        api("/content/assets", { method: "POST", body: b }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; post_id?: string | null; asset_type: string; title?: string | null; tags: string[] }) =>
        api(`/content/assets/${id}`, { method: "PUT", body: b }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/content/assets/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

export function useContentStageMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["lookups"] });
    void qc.invalidateQueries({ queryKey: ["content"] });
  };
  return {
    create: useMutation({ mutationFn: (b: { name: string; color?: string }) => api("/content/stages", { method: "POST", body: b }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...b }: { id: string; name: string; color?: string }) => api(`/content/stages/${id}`, { method: "PUT", body: b }), onSuccess: done }),
    reorder: useMutation({ mutationFn: (ids: string[]) => api("/content/stages/reorder", { method: "POST", body: { ids } }), onSuccess: done }),
    remove: useMutation({ mutationFn: ({ id, move_to }: { id: string; move_to: string }) => api(`/content/stages/${id}`, { method: "DELETE", query: { move_to } }), onSuccess: done }),
  };
}

// ---- Websites ----------------------------------------------------------------------

export function useWebsites(q: { client_id?: string; status?: string; search?: string; expiring_days?: number }) {
  return useQuery({ queryKey: ["websites", q], queryFn: () => api<Website[]>("/websites", { query: q as Query }), placeholderData: keepPreviousData });
}

export function useWebsite(id: string) {
  return useQuery({ queryKey: ["websites", "detail", id], queryFn: () => api<WebsiteDetail>(`/websites/${id}`) });
}

export interface WebsiteInput {
  client_id: string;
  name: string;
  domain: string;
  url?: string | null;
  status?: string;
  hosting_provider?: string | null;
  tech_stack: string[];
  domain_registrar?: string | null;
  domain_expires_on?: string | null;
  hosting_renews_on?: string | null;
  ssl_expires_on?: string | null;
  maintenance_frequency?: string;
  developer_id?: string | null;
  backup_notes?: string | null;
  notes?: string | null;
}

function useWebsiteMutation<V>(fn: (v: V) => Promise<WebsiteDetail>) {
  const qc = useQueryClient();
  const invalidate = useInvalidate(["websites", "maintenance"]);
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(["websites", "detail", data.id], data);
      invalidate();
    },
  });
}

export function useSaveWebsite(id?: string) {
  return useWebsiteMutation((b: WebsiteInput) => (id ? api<WebsiteDetail>(`/websites/${id}`, { method: "PUT", body: b }) : api<WebsiteDetail>("/websites", { method: "POST", body: b })));
}

export function useCheckWebsite(id: string) {
  return useWebsiteMutation(() => api<WebsiteDetail>(`/websites/${id}/check`, { method: "POST" }));
}

export function useDeleteWebsite() {
  const invalidate = useInvalidate(["websites"]);
  return useMutation({ mutationFn: (id: string) => api(`/websites/${id}`, { method: "DELETE" }), onSuccess: invalidate });
}

export function useMaintenance(q: { website_id?: string; status?: string; assignee?: string }) {
  return useQuery({ queryKey: ["maintenance", q], queryFn: () => api<Maintenance[]>("/maintenance", { query: q as Query }) });
}

export interface MaintenanceInput {
  task_type: string;
  title: string;
  notes?: string | null;
  status?: string;
  scheduled_for?: string | null;
  assigned_to?: string | null;
}

export function useMaintenanceMutations(websiteId?: string) {
  const invalidate = useInvalidate(["maintenance", "websites"]);
  return {
    add: useMutation({ mutationFn: (b: MaintenanceInput) => api(`/websites/${websiteId}/maintenance`, { method: "POST", body: b }), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, ...b }: MaintenanceInput & { id: string }) => api(`/maintenance/${id}`, { method: "PUT", body: b }), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => api(`/maintenance/${id}`, { method: "DELETE" }), onSuccess: invalidate }),
  };
}

export interface SecretInput {
  label: string;
  login_url?: string | null;
  username?: string | null;
  secret?: string | null;
}

export function useSecretMutations(websiteId: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["websites", "detail", websiteId] });
  return {
    add: useMutation({ mutationFn: (b: SecretInput) => api(`/websites/${websiteId}/secrets`, { method: "POST", body: b }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...b }: SecretInput & { id: string }) => api(`/secrets/${id}`, { method: "PUT", body: b }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api(`/secrets/${id}`, { method: "DELETE" }), onSuccess: done }),
  };
}

export function revealSecret(id: string) {
  return api<{ secret: string }>(`/secrets/${id}/reveal`, { method: "POST" });
}

// ---- Team ------------------------------------------------------------------------

export function useWorkload(enabled = true) {
  return useQuery({ queryKey: ["team", "workload"], queryFn: () => api<Workload[]>("/team/workload"), enabled });
}

export function useAuditLog(q: { actor_id?: string; action?: string; page: number }) {
  return useQuery({ queryKey: ["audit", q], queryFn: () => api<Page<AuditRow>>("/audit-log", { query: q as Query }), placeholderData: keepPreviousData });
}
