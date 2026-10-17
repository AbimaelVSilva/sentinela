import { ShieldCheckIcon } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { useSSE } from '@/lib/sse';
import { ApiStatus } from './ApiStatus';
import { SettingsButton } from './SettingsDialog';
import { ThemeToggle } from './ThemeToggle';

export function AppLayout() {
  // Uma conexão SSE global mantém status, estados e eventos atualizados em todas as telas.
  useSSE();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <ShieldCheckIcon className="size-5 text-severity-attention" />
            Sentinela
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ApiStatus />
            <SettingsButton />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
