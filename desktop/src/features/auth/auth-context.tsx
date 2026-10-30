import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Me } from "@/types/api";

interface AuthContextValue {
  /** `undefined` while the stored session is being restored. */
  session: Session | null | undefined;
  me: Me | undefined;
  meLoading: boolean;
  meError: unknown;
  retryMe: () => void;
  setMe: (me: Me) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** UI-only permission check. The API enforces permissions independently. */
  can: (permission?: string) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export const ME_KEY = ["me"] as const;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = React.useState<Session | null | undefined>(undefined);

  React.useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => active && setSession(data.session))
      .catch(() => active && setSession(null));

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) queryClient.clear();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const userId = session?.user.id;
  const meQuery = useQuery({
    queryKey: [...ME_KEY, userId],
    queryFn: () => api<Me>("/me"),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    retry: (count, err) => count < 2 && !(err instanceof Error && "status" in err && (err as { status: number }).status === 403),
  });

  const value = React.useMemo<AuthContextValue>(
    () => ({
      session,
      me: meQuery.data,
      meLoading: meQuery.isPending && !!userId,
      meError: meQuery.error,
      retryMe: () => void meQuery.refetch(),
      setMe: (me) => queryClient.setQueryData([...ME_KEY, userId], me),
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(signInMessage(error.message, error.code));
      },
      signOut: async () => {
        await supabase.auth.signOut({ scope: "local" });
        queryClient.clear();
      },
      can: (permission) => {
        if (!permission) return true;
        const perms = meQuery.data?.permissions ?? [];
        return perms.includes("*") || perms.includes(permission);
      },
    }),
    [session, userId, meQuery, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function signInMessage(message: string, code?: string) {
  if (code === "invalid_credentials") return "That email and password don't match. Try again.";
  if (code === "user_banned") return "This account has been suspended. Contact an administrator.";
  if (code === "over_request_rate_limit") return "Too many attempts. Wait a minute and try again.";
  if (/fetch|network/i.test(message)) return "Can't reach the sign-in service. Check your internet connection.";
  return message;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The signed-in user. Only use below <RequireAuth>. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("useMe used outside an authenticated route");
  return me;
}
