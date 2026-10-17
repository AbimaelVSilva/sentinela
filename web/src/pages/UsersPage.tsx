import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon, PlusIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { QueryError } from '@/components/QueryError';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api, queryKeys, type UserRow } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRelative } from '@/lib/labels';

export function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<UserRow | null>(null);
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.listUsers,
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => {
      toast.success('Usuário removido');
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: queryKeys.users });
    },
    onError: (err) => toast.error('Não foi possível remover', { description: err.message }),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">Quem pode acessar o painel do Sentinela.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon /> Novo usuário
        </Button>
      </div>

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState icon={UsersIcon} title="Nenhum usuário" />
      ) : (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {data.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{u.name || u.username}</span>
                    {u.id === me?.id && <Badge variant="secondary">você</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    @{u.username} · criado {formatRelative(u.createdAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${u.username}`}
                  disabled={u.id === me?.id}
                  onClick={() => setRemoving(u)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <NewUserDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remover @${removing?.username ?? ''}?`}
        description="A pessoa perde o acesso imediatamente."
        confirmLabel="Remover"
        destructive
        pending={del.isPending}
        onConfirm={() => removing && del.mutate(removing.id)}
      />
    </div>
  );
}

function NewUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription>Crie um acesso ao painel.</DialogDescription>
        </DialogHeader>
        {open && <NewUserForm onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewUserForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== password;

  const create = useMutation({
    mutationFn: () =>
      api.createUser({ username: username.trim(), name: name.trim() || null, password }),
    onSuccess: (u) => {
      toast.success(`Usuário @${u.username} criado`);
      void qc.invalidateQueries({ queryKey: queryKeys.users });
      onClose();
    },
    onError: (err) => toast.error('Não foi possível criar', { description: err.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch) create.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="nu-user">Usuário</Label>
        <Input
          id="nu-user"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoComplete="off"
          pattern="[a-zA-Z0-9._\-]+"
          title="Letras, números, ponto, hífen ou sublinhado"
          minLength={2}
          maxLength={40}
          required
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="nu-name">Nome (opcional)</Label>
        <Input
          id="nu-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="nu-pass">Senha</Label>
          <Input
            id="nu-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={4}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nu-confirm">Confirmar senha</Label>
          <Input
            id="nu-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch}
            required
          />
        </div>
      </div>
      {mismatch && <p className="-mt-2 text-xs text-destructive">As senhas não conferem.</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={create.isPending || mismatch}>
          {create.isPending && <LoaderCircleIcon className="animate-spin" />} Criar usuário
        </Button>
      </DialogFooter>
    </form>
  );
}
