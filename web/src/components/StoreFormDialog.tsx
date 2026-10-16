import { useMutation, useQueryClient } from '@tanstack/react-query';
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

  const mutation = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), address: address.trim() || null };
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
