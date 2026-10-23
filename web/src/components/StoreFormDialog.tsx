import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, LoaderCircleIcon } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { api, queryKeys, type Store } from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store?: Store;
  onSaved?: (store: Store) => void;
};

export function StoreFormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* O formulário monta a cada abertura, então o estado inicial vem sempre das props. */}
        <StoreForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function StoreForm({ onOpenChange, store, onSaved }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(store?.name ?? '');
  const [address, setAddress] = useState(store?.address ?? '');
  const [branches, setBranches] = useState<string[]>(store?.klaviBranchIds ?? []);
  const klavi = useQuery({
    queryKey: queryKeys.klavi,
    queryFn: api.getKlavi,
    staleTime: 5 * 60_000,
  });
  const toggleBranch = (id: string) =>
    setBranches((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        address: address.trim() || null,
        ...(klavi.data?.configured ? { klaviBranchIds: branches } : {}),
      };
      return store ? api.updateStore(store.id, body) : api.createStore(body);
    },
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.store(saved.id), saved);
      void qc.invalidateQueries({ queryKey: queryKeys.stores });
      toast.success(store ? 'Loja atualizada' : 'Loja criada');
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (err) => toast.error('Não foi possível salvar a loja', { description: err.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{store ? 'Editar loja' : 'Nova loja'}</DialogTitle>
        <DialogDescription>
          {store ? 'Atualize os dados da loja.' : 'Cadastre uma loja para adicionar a câmera.'}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="store-name">Nome</Label>
        <Input
          id="store-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Mercadinho Centro"
          autoFocus
          required
          maxLength={120}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="store-address">Endereço (opcional)</Label>
        <Input
          id="store-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Rua, número, bairro"
          maxLength={300}
        />
      </div>
      {klavi.isPending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3 animate-spin" /> Carregando filiais da Klavi…
        </p>
      ) : klavi.data?.configured ? (
        <div className="grid gap-2">
          <Label>Filial na Klavi (vendas do totem)</Label>
          {klavi.data.error ? (
            <p className="text-xs text-destructive">{klavi.data.error}</p>
          ) : (
            <div
              role="group"
              aria-label="Filiais da Klavi"
              className="max-h-48 divide-y overflow-y-auto rounded-md border"
            >
              {klavi.data.branches.map((b) => {
                const on = branches.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleBranch(b.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50',
                      on && 'bg-primary/5 font-medium',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        on && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {on && <CheckIcon className="size-3" />}
                    </span>
                    <span className="truncate">{b.name}</span>
                    {!b.active && (
                      <span className="ml-auto text-xs text-muted-foreground">inativa</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Cada ocorrência mostra as compras feitas nessas filiais durante a passagem (1 min antes
            e depois).
          </p>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  );
}
