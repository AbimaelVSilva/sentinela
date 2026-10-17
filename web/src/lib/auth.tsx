import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { api, type AuthUser, queryKeys } from './api';
import { getToken, onTokenChange, setToken } from './auth-token';

interface AuthCtx {
  token: string | null;
  user: AuthUser | null;
  /** Validando o token salvo com /auth/me. */
  checking: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const token = useSyncExternalStore(onTokenChange, getToken);

  const me = useQuery({
    queryKey: [...queryKeys.me, token],
    queryFn: api.me,
    enabled: !!token,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.login(username, password);
      // Dados de outra sessão não podem vazar para a nova.
      qc.clear();
      qc.setQueryData([...queryKeys.me, res.token], { user: res.user });
      setToken(res.token);
      return res.user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // mesmo se a API falhar, sai localmente
    }
    setToken(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthCtx>(
    () => ({
      token,
      user: token ? (me.data?.user ?? null) : null,
      checking: !!token && me.isPending,
      login,
      logout,
    }),
    [token, me.data, me.isPending, login, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
