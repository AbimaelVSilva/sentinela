import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskCpf, ordersBetween, toPurchaseOrder } from '../src/integrations/klavi';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ORDER = {
  _id: 'o1',
  seq: 49103,
  createdAt: '2026-10-22T20:39:26.182Z',
  total: 7.98,
  paid: false,
  paymentMethod: { label: 'Maquininha', kind: 'Totem' },
  totemClientName: ' Maria Silva ',
  cpfCustomer: '07112345692',
  items: [{ title: 'Halls Extra Forte', quantity: 2, price: 3.99 }],
  branch: '64a3741fc69863558e5e48eb',
};

afterEach(() => vi.unstubAllGlobals());

describe('Klavi', () => {
  it('mascara o CPF e resume o pedido', () => {
    expect(maskCpf('071.123.456-92')).toBe('071.***.***-92');
    expect(maskCpf('')).toBeNull();
    expect(toPurchaseOrder(ORDER)).toEqual({
      id: 'o1',
      seq: 49103,
      createdAt: '2026-10-22T20:39:26.182Z',
      total: 7.98,
      paid: false,
      paymentMethod: 'Maquininha',
      customerName: 'Maria Silva',
      cpf: '071.***.***-92',
      items: [{ title: 'Halls Extra Forte', quantity: 2, price: 3.99 }],
    });
  });

  it('busca por filial e período, sem cancelados, e refaz o login se o token expirar', async () => {
    const calls: string[] = [];
    let logins = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.endsWith('/authentication')) {
          logins++;
          const body = JSON.parse(String(init?.body)) as Record<string, string>;
          expect(body).toMatchObject({ strategy: 'local', userStrategy: 'manager' });
          return json({ accessToken: `tok${logins}` });
        }
        const auth = (init?.headers as Record<string, string>).authorization;
        // Primeiro token "expira": a API responde 401 e o cliente faz login de novo.
        if (auth === 'Bearer tok1') return json({ message: 'jwt expired' }, 401);
        return json({ total: 1, data: [ORDER] });
      }),
    );

    const from = new Date('2026-10-22T20:38:00.000Z');
    const to = new Date('2026-10-22T20:41:00.000Z');
    const orders = await ordersBetween(['64a3741fc69863558e5e48eb'], from, to);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.customerName).toBe('Maria Silva');
    expect(logins).toBe(2);

    const q = new URL(calls.at(-1)!).searchParams;
    expect(new URL(calls.at(-1)!).pathname).toBe('/manager/orders');
    expect(q.get('branch')).toBe('64a3741fc69863558e5e48eb');
    expect(q.get('createdAt[$gte]')).toBe(from.toISOString());
    expect(q.get('createdAt[$lte]')).toBe(to.toISOString());
    expect(q.getAll('status[$nin][]')).toEqual(['16', '32', '64']);
  });
});
