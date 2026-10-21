import { useQuery } from '@tanstack/react-query';
import { BellIcon, CheckCheckIcon, Volume2Icon, VolumeXIcon } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { EventIcon } from '@/components/EventIcon';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isAlertMuted, onAlertMutedChange, setAlertMuted } from '@/lib/alert-sound';
import { eventLink, getAlertsReadAt, onAlertsReadChange, setAlertsReadAt } from '@/lib/alerts-read';
import { api, type AlertItem, queryKeys } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SEVERITY_CLASSES, formatRelative } from '@/lib/labels';
import { cn } from '@/lib/utils';

/**
 * Sino de notificações: alertas recentes (produto retirado/movido) de todas as lojas,
 * com loja e câmera, contador de não lidos e atalho "Ver" para a ocorrência.
 */
export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Marco de leitura no momento em que o sino foi aberto (para destacar os novos).
  const [seenBefore, setSeenBefore] = useState(0);

  const readAt = useSyncExternalStore(onAlertsReadChange, () => getAlertsReadAt(user?.id));
  const muted = useSyncExternalStore(onAlertMutedChange, isAlertMuted);
  const { data } = useQuery({
    queryKey: queryKeys.alerts,
    queryFn: api.listAlerts,
    refetchInterval: 60_000,
  });
  const items = data?.items ?? [];
  const unread = items.filter((a) => new Date(a.event.createdAt).getTime() > readAt).length;

  const markAllRead = () => {
    const newest = items[0] ? new Date(items[0].event.createdAt).getTime() : 0;
    if (user && newest > readAt) setAlertsReadAt(user.id, newest);
  };

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setSeenBefore(readAt);
      markAllRead();
    }
  };

  const go = (a: AlertItem) => {
    setOpen(false);
    void navigate(eventLink(a.storeId, a.cameraId, a.event.id));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={unread ? `Alertas: ${unread} não lido(s)` : 'Alertas'}
              className="relative"
            >
              <BellIcon />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-severity-alert px-1 text-[10px] font-semibold text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Alertas</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <span className="text-sm font-medium">Alertas</span>
          <span className="text-xs text-muted-foreground">retirados e movidos</span>
          <div className="ml-auto flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={muted ? 'Ativar som dos alertas' : 'Silenciar alertas'}
                  onClick={() => setAlertMuted(!muted)}
                >
                  {muted ? <VolumeXIcon /> : <Volume2Icon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{muted ? 'Som desligado' : 'Som ligado'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Marcar todos como lidos"
                  onClick={markAllRead}
                >
                  <CheckCheckIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Marcar todos como lidos</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum alerta por enquanto.
          </p>
        ) : (
          <ScrollArea className="max-h-[min(28rem,70svh)]">
            <ul className="divide-y">
              {items.map((a) => {
                const sev = SEVERITY_CLASSES[a.event.severity];
                const isNew = new Date(a.event.createdAt).getTime() > seenBefore;
                return (
                  <li
                    key={a.event.id}
                    className={cn('flex gap-3 px-3 py-2.5', isNew && 'bg-accent/40')}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-white',
                        sev.dot,
                      )}
                    >
                      <EventIcon type={a.event.type} className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={cn('truncate text-sm font-medium', sev.text)}>
                        {a.event.label}
                      </p>
                      <p className="truncate text-xs font-medium">
                        {a.storeName} · {a.cameraName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{a.event.summary}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatRelative(a.event.createdAt)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-center"
                      onClick={() => go(a)}
                    >
                      Ver
                    </Button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
