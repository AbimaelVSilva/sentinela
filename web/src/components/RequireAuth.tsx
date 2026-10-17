import { ShieldCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '@/lib/auth';

/** Protege as rotas: sem sessão válida, manda para /login (e volta depois). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, user, checking } = useAuth();
  const location = useLocation();

  if (!token || (!checking && !user)) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        <ShieldCheckIcon className="size-6 animate-pulse text-severity-attention" />
      </div>
    );
  }
  return children;
}
