/** Detecta violação de unique do Postgres (opcionalmente de uma constraint específica). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = findPgError(err);
  return !!e && e.code === '23505' && (!constraint || e.constraint_name === constraint);
}

interface PgError {
  code?: string;
  constraint_name?: string;
}

function findPgError(err: unknown): PgError | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    if ('code' in cur && typeof (cur as PgError).code === 'string') return cur as PgError;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}
