import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, KeyRoundIcon, LoaderCircleIcon, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { QueryError } from '@/components/QueryError';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type AppSettings, api, type Effort, queryKeys, type VisionProviderId } from '@/lib/api';
import { cn } from '@/lib/utils';

const CUSTOM = '__custom__';
const EFFORT_LABEL: Record<Effort, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto' };

/** Botão de engrenagem no cabeçalho que abre as configurações. */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Configurações"
            onClick={() => setOpen(true)}
          >
            <SettingsIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Configurações</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Configurações</DialogTitle>
            <DialogDescription>
              Escolha qual IA analisa as prateleiras. Vale a partir da próxima análise, sem
              reiniciar nada.
            </DialogDescription>
          </DialogHeader>
          {open && <SettingsBody onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettingsBody({ onClose }: { onClose: () => void }) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.getSettings,
    staleTime: 0,
  });
  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    );
  }
  if (isError) return <QueryError error={error} onRetry={() => void refetch()} />;
  return <SettingsForm settings={data} onClose={onClose} />;
}

function SettingsForm({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<VisionProviderId>(settings.vision.provider);
  const [models, setModels] = useState(settings.vision.models);
  const [custom, setCustom] = useState(false);
  const [effort, setEffort] = useState<Effort>(settings.vision.effort);

  const info = settings.providers.find((p) => p.id === provider)!;
  const model = models[provider] ?? info.defaultModel;
  const setModel = (m: string) => setModels((cur) => ({ ...cur, [provider]: m }));

  const list = useQuery({
    queryKey: queryKeys.models(provider),
    queryFn: () => api.listModels(provider),
    staleTime: 5 * 60_000,
  });
  const options = list.data ? [...new Set([model, ...list.data.models])] : [model];

  const save = useMutation({
    mutationFn: () =>
      api.updateSettings({
        provider,
        model: provider === 'mock' ? undefined : model.trim(),
        effort,
      }),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.settings, saved);
      void qc.invalidateQueries({ queryKey: ['health'] });
      const p = saved.providers.find((x) => x.id === saved.vision.provider);
      toast.success('Configurações salvas', {
        description: `${p?.label ?? saved.vision.provider} · ${saved.vision.model}`,
      });
      onClose();
    },
    onError: (err) => toast.error('Não foi possível salvar', { description: err.message }),
  });

  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <Label>IA de visão</Label>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="IA de visão">
          {settings.providers.map((p) => {
            const selected = p.id === provider;
            const card = (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!p.configured}
                onClick={() => {
                  setProvider(p.id);
                  setCustom(false);
                }}
                className={cn(
                  'flex w-full flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                  'hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                  selected && 'border-foreground/40 bg-accent/40 ring-1 ring-foreground/20',
                )}
              >
                <span className="flex w-full items-center gap-2 font-medium">
                  {p.label}
                  {selected && <CheckIcon className="ml-auto size-4" />}
                </span>
                {p.id === 'mock' ? (
                  <span className="text-xs text-muted-foreground">Só para testes, sem custo</span>
                ) : p.configured ? (
                  <Badge variant="outline" className="border-success/50 text-success">
                    <KeyRoundIcon /> Chave configurada
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Sem chave
                  </Badge>
                )}
              </button>
            );
            return p.configured ? (
              card
            ) : (
              <Tooltip key={p.id}>
                <TooltipTrigger asChild>
                  <span>{card}</span>
                </TooltipTrigger>
                <TooltipContent>
                  Defina <code>{p.keyEnv}</code> no .env do servidor e reinicie a API
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </section>

      {provider !== 'mock' && (
        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="vision-model">Modelo</Label>
            <span className="text-xs text-muted-foreground">
              {list.isFetching ? (
                <span className="flex items-center gap-1">
                  <LoaderCircleIcon className="size-3 animate-spin" /> buscando modelos…
                </span>
              ) : list.data?.source === 'live' ? (
                `${list.data.models.length} modelos disponíveis na sua conta`
              ) : (
                'Sugestões'
              )}
            </span>
          </div>
          {custom ? (
            <div className="flex gap-2">
              <Input
                id="vision-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="id do modelo, ex.: gpt-5.1"
                autoFocus
              />
              <Button type="button" variant="outline" onClick={() => setCustom(false)}>
                Lista
              </Button>
            </div>
          ) : (
            <Select
              value={model}
              onValueChange={(v) => (v === CUSTOM ? setCustom(true) : setModel(v))}
            >
              <SelectTrigger id="vision-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {options.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                    {m === info.defaultModel && (
                      <span className="text-xs text-muted-foreground">(padrão)</span>
                    )}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Outro…</SelectItem>
              </SelectContent>
            </Select>
          )}
          {list.data?.error && (
            <p className="text-xs text-severity-attention">
              Não foi possível listar os modelos da conta ({list.data.error}). Mostrando sugestões.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Use um modelo com suporte a imagens. Modelos maiores costumam acertar mais, mas custam
            mais por análise.
          </p>
        </section>
      )}

      {provider !== 'mock' && (
        <section className="grid gap-2">
          <Label>Esforço de raciocínio</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            value={effort}
            onValueChange={(v) => v && setEffort(v as Effort)}
            className="grid w-full grid-cols-3"
          >
            {(['low', 'medium', 'high'] as Effort[]).map((e) => (
              <ToggleGroupItem key={e} value={e}>
                {EFFORT_LABEL[e]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {provider === 'google'
              ? 'O Gemini decide sozinho quanto raciocinar; este ajuste não se aplica.'
              : 'Mais esforço = análise mais cuidadosa, porém mais lenta e cara.'}
          </p>
        </section>
      )}

      <Separator />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !model.trim()}>
          {save.isPending && <LoaderCircleIcon className="animate-spin" />} Salvar
        </Button>
      </DialogFooter>
    </div>
  );
}
