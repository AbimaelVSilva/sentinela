import { env } from '../config/env';
import type { PurchaseOrder } from '../domain/types';

/**
 * Cliente mínimo (só leitura) da API Klavi — vendas dos totens das lojas.
 * Guia: docs/guia-api-klavi-consultas.md. O token de gestor vale anos; fica em
 * memória e é renovado sozinho se a API responder 401.
 */

/** Pedidos cancelados (16), recusados (32) e estornados (64) não contam como compra. */
const IGNORED_STATUS = ['16', '32', '64'];

const ORDER_FIELDS = [
  '_id',
  'seq',
  'createdAt',
  'total',
  'paid',
  'paymentMethod',
  'totemClientName',
  'noAuthName',
  'cpfCustomer',
  'items',
  'branch',
];

export class KlaviError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'KlaviError';
  }
}

export interface KlaviBranch {
  id: string;
  name: string;
  active: boolean;
}

interface RawOrder {
  _id: string;
  seq?: number;
  createdAt: string;
  total?: number;
  paid?: boolean;
  paymentMethod?: { label?: string; kind?: string } | null;
  totemClientName?: string | null;
  noAuthName?: string | null;
  cpfCustomer?: string | null;
  items?: { title?: string; quantity?: number; price?: number }[];
  branch: string;
}

export const klaviConfigured = () => !!(env.KLAVI_USERNAME && env.KLAVI_PASSWORD);

let token: string | null = null;

async function login(): Promise<string> {
  if (!klaviConfigured()) throw new KlaviError('Klavi não configurada (KLAVI_USERNAME/PASSWORD).');
  const res = await fetch(`${env.KLAVI_API_URL}/authentication`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      strategy: 'local',
      userStrategy: 'manager',
      username: env.KLAVI_USERNAME,
      password: env.KLAVI_PASSWORD,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new KlaviError(`Login na Klavi falhou (${res.status}).`, res.status);
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) throw new KlaviError('Login na Klavi sem token.');
  token = body.accessToken;
  return token;
}

async function get<T>(path: string, query: [string, string][]): Promise<T> {
  const url = `${env.KLAVI_API_URL}${path}?${new URLSearchParams(query).toString()}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const auth = token ?? (await login());
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { authorization: `Bearer ${auth}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new KlaviError(`Sem conexão com a Klavi: ${err instanceof Error ? err.message : err}`);
    }
    if (res.status === 401 && attempt === 1) {
      token = null; // token expirado/revogado: novo login e tenta de novo
      continue;
    }
    if (!res.ok) throw new KlaviError(`Klavi respondeu ${res.status} em ${path}.`, res.status);
    return (await res.json()) as T;
  }
  throw new KlaviError('Klavi recusou as credenciais.', 401);
}

export async function listBranches(): Promise<KlaviBranch[]> {
  const body = await get<{ data: { _id: string; name?: string; active?: boolean }[] }>(
    '/manager/branches',
    [
      ['$limit', '200'],
      ['$select[]', 'name'],
      ['$select[]', 'active'],
    ],
  );
  return body.data
    .map((b) => ({ id: b._id, name: (b.name ?? '').trim(), active: b.active !== false }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/** Mostra só o início e o fim do CPF (ex.: 071.***.***-92). */
export function maskCpf(cpf: string | null | undefined): string | null {
  const d = (cpf ?? '').replace(/\D/g, '');
  if (d.length < 5) return null;
  return d.length === 11
    ? `${d.slice(0, 3)}.***.***-${d.slice(9)}`
    : `${d.slice(0, 2)}***${d.slice(-2)}`;
}

export function toPurchaseOrder(o: RawOrder): PurchaseOrder {
  return {
    id: o._id,
    seq: o.seq ?? null,
    createdAt: new Date(o.createdAt).toISOString(),
    total: o.total ?? 0,
    paid: !!o.paid,
    paymentMethod: o.paymentMethod?.label ?? o.paymentMethod?.kind ?? null,
    customerName: (o.totemClientName || o.noAuthName || '').trim() || null,
    cpf: maskCpf(o.cpfCustomer),
    items: (o.items ?? []).map((i) => ({
      title: (i.title ?? 'Item').trim(),
      quantity: i.quantity ?? 1,
      price: i.price ?? 0,
    })),
  };
}

/** Pedidos (não cancelados) das filiais no intervalo [from, to], mais antigos primeiro. */
export async function ordersBetween(
  branchIds: string[],
  from: Date,
  to: Date,
): Promise<PurchaseOrder[]> {
  const all: PurchaseOrder[] = [];
  for (const branch of branchIds) {
    const body = await get<{ data: RawOrder[] }>('/manager/orders', [
      ['branch', branch],
      ['createdAt[$gte]', from.toISOString()],
      ['createdAt[$lte]', to.toISOString()],
      ...IGNORED_STATUS.map((s): [string, string] => ['status[$nin][]', s]),
      ['$sort[createdAt]', '1'],
      ['$limit', '100'],
      ...ORDER_FIELDS.map((f): [string, string] => ['$select[]', f]),
    ]);
    all.push(...body.data.map(toPurchaseOrder));
  }
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
