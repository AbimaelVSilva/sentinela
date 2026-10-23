import { ShieldCheckIcon } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { useSSE } from '@/lib/sse';
import { ApiStatus } from './ApiStatus';
import { NotificationBell } from './NotificationBell';
import { SettingsButton } from './SettingsDialog';
import { UserMenu } from './UserMenu';
import { ThemeToggle } from './ThemeToggle';

export function AppLayout() {
  // Uma conexão SSE global mantém status, estados e eventos atualizados em todas as telas.
  useSSE();
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <ShieldCheckIcon className="size-5 text-severity-attention" />
            Sentinela
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Principal">
            {[
              {
                to: '/',
                label: 'Lojas',
                active: pathname === '/' || pathname.startsWith('/lojas'),
              },
              { to: '/alertas', label: 'Alertas', active: pathname.startsWith('/alertas') },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                aria-current={l.active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  l.active && 'bg-accent font-medium text-foreground',
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ApiStatus />
            <NotificationBell />
            <SettingsButton />
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
