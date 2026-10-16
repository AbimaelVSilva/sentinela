import { AlertTriangleIcon, RotateCwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function QueryError({
  error,
  onRetry,
  title = 'Não foi possível carregar os dados',
}: {
  error: Error | null;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{error?.message ?? 'Erro desconhecido.'}</p>
        {onRetry && (
          <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
            <RotateCwIcon /> Tentar novamente
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
