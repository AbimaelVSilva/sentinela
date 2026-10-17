import { describe, expect, it } from 'vitest';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../src/modules/auth/crypto';
import { extractToken, isPublicRoute } from '../src/modules/auth/guard';

describe('senhas', () => {
  it('hash com salt aleatório e verificação', async () => {
    const a = await hashPassword('2306');
    const b = await hashPassword('2306');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('2306', a)).toBe(true);
    expect(await verifyPassword('2307', a)).toBe(false);
  });
  it('formato desconhecido nunca valida', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'md5$aa$bb')).toBe(false);
  });
});

describe('tokens', () => {
  it('são longos, únicos e o banco guarda só o SHA-256', () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(generateToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
  });
});

describe('guard', () => {
  it('rotas públicas', () => {
    expect(isPublicRoute('GET', '/health')).toBe(true);
    expect(isPublicRoute('POST', '/auth/login')).toBe(true);
    expect(isPublicRoute('POST', '/mediamtx/auth')).toBe(true);
    expect(isPublicRoute('OPTIONS', '/stores')).toBe(true);
    expect(isPublicRoute('GET', '/stores')).toBe(false);
    expect(isPublicRoute('POST', '/users')).toBe(false);
    expect(isPublicRoute('GET', '/auth/login')).toBe(false);
  });

  it('lê Bearer do header e ?token= só em GET', () => {
    expect(
      extractToken({ headers: { authorization: 'Bearer abc' }, method: 'POST', query: {} }),
    ).toBe('abc');
    expect(extractToken({ headers: {}, method: 'GET', query: { token: 'xyz' } })).toBe('xyz');
    expect(extractToken({ headers: {}, method: 'POST', query: { token: 'xyz' } })).toBeNull();
    expect(
      extractToken({ headers: { authorization: 'Basic abc' }, method: 'GET', query: {} }),
    ).toBeNull();
  });
});
