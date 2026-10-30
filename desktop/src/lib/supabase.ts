import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { env, missingEnv } from "./env";

/**
 * Session storage. In the desktop app the Supabase session lives in the OS keychain
 * via Tauri commands; in a plain browser (dev/web) it falls back to localStorage.
 */
const keychainStorage: SupportedStorage = {
  getItem: (key) => invoke<string | null>("secure_get", { key }),
  setItem: (key, value) => invoke<void>("secure_set", { key, value }),
  removeItem: (key) => invoke<void>("secure_delete", { key }),
};

/**
 * Supabase is used for AUTHENTICATION ONLY. Business data goes through the ODDLY API
 * (`lib/api.ts`); every table has RLS with no policies, so this client can't read it anyway.
 */
export const supabase = createClient(
  env.supabaseUrl || "http://localhost.invalid",
  env.supabaseAnonKey || "missing-key",
  {
    auth: {
      storage: isTauri() ? keychainStorage : window.localStorage,
      storageKey: "oddly.auth",
      persistSession: true,
      autoRefreshToken: missingEnv.length === 0,
      detectSessionInUrl: false,
    },
  },
);
