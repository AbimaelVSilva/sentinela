import { SearchXIcon } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <EmptyState
        icon={SearchXIcon}
        title="Página não encontrada"
        description="O endereço acessado não existe."
        action={
          <Button asChild>
            <Link to="/">Voltar para as lojas</Link>
          </Button>
        }
      />
    </div>
  );
}
