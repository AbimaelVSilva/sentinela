/** Utilitários de dia no fuso do navegador (o usuário vê o dia da loja/dele). */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Soma dias de calendário (correto em mudança de horário de verão). */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Intervalo [from, to) do dia `offset` dias antes de `today` (0 = hoje). */
export function dayRange(today: Date, offset: number): { from: Date; to: Date } {
  const from = addDays(startOfDay(today), -offset);
  return { from, to: addDays(from, 1) };
}

const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const full = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Rótulo do dia: só hoje tem nome ("Hoje · quarta-feira, 21/10"); os demais, "Terça-feira · 20/10". */
export function dayLabel(today: Date, offset: number): { title: string; subtitle: string } {
  const { from } = dayRange(today, offset);
  const sameYear = from.getFullYear() === today.getFullYear();
  const date = sameYear ? dayMonth.format(from) : full.format(from);
  const wd = weekday.format(from);
  if (offset === 0) return { title: 'Hoje', subtitle: `${wd}, ${date}` };
  return { title: wd.charAt(0).toUpperCase() + wd.slice(1), subtitle: date };
}

/** Milissegundos até a próxima meia-noite local. */
export const msUntilMidnight = (now: Date) => addDays(startOfDay(now), 1).getTime() - now.getTime();
