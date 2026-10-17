import { InfoIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Ícone de informação ao lado de um título; o texto explicativo aparece no tooltip. */
export function InfoTip({
  children,
  label = 'Mais informações',
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors',
            'hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            className,
          )}
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
