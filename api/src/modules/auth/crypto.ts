import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;
const KEYLEN = 32;

/** Hash de senha com scrypt e salt aleatório: `scrypt$<salt>$<hash>` (hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Compara em tempo constante. Formatos desconhecidos nunca validam. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Token de sessão opaco (256 bits, url-safe). Só o cliente guarda o token puro. */
export const generateToken = () => randomBytes(32).toString('base64url');

/** O banco guarda só o SHA-256 do token: vazar a tabela não vaza sessões. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
