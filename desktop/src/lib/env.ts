/** Build-time configuration. Missing values are reported on screen instead of crashing. */

export const env = {
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "",
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "",
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "",
};

export const missingEnv = [
  !env.apiUrl && "VITE_API_URL",
  !env.supabaseUrl && "VITE_SUPABASE_URL",
  !env.supabaseAnonKey && "VITE_SUPABASE_ANON_KEY",
].filter(Boolean) as string[];
