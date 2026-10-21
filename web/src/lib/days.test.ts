import { describe, expect, it } from 'vitest';
import { dayLabel, dayRange, msUntilMidnight, startOfDay } from './days';

const today = new Date(2026, 9, 20, 15, 30); // 20/10/2026 15:30 local

describe('dias', () => {
  it('intervalo do dia é [00:00, 00:00 do dia seguinte) no fuso local', () => {
    const { from, to } = dayRange(today, 0);
    expect(from).toEqual(new Date(2026, 9, 20));
    expect(to).toEqual(new Date(2026, 9, 21));
    expect(dayRange(today, 1)).toEqual({ from: new Date(2026, 9, 19), to: new Date(2026, 9, 20) });
    expect(dayRange(today, 20).from).toEqual(new Date(2026, 8, 30)); // atravessa o mês
  });

  it('rótulos: Hoje, Ontem, Anteontem e depois o dia da semana', () => {
    expect(dayLabel(today, 0).title).toBe('Hoje');
    expect(dayLabel(today, 0).subtitle).toContain('20/10');
    expect(dayLabel(today, 1).title).toBe('Ontem');
    expect(dayLabel(today, 2).title).toBe('Anteontem');
    expect(dayLabel(today, 4)).toEqual({ title: 'Sexta-feira', subtitle: '16/10' });
    expect(dayLabel(today, 300).subtitle).toMatch(/2025$/);
  });

  it('meia-noite seguinte', () => {
    expect(msUntilMidnight(today)).toBe(8.5 * 3600 * 1000);
    expect(startOfDay(today).getHours()).toBe(0);
  });
});
