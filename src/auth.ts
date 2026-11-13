import crypto from 'node:crypto';
import { ID, UserRole } from './types.js';
import { DomainError } from './schemas.js';

const SECRET = process.env['AUTH_SECRET'] ?? 'barber-core-dev-secret-change-in-prod-supabase';

// Credenciais exclusivas do Super Admin Master (Samuel22)
const MASTER_LOGIN = 'Samuel22';
const MASTER_PASS_HASH = (() => {
  const salt = 'master_samuel22_salt';
  const derived = crypto.scryptSync('153624sa', salt, 64).toString('hex');
  return `${salt}:${derived}`;
})();

export interface SessionPayload {
  readonly role: UserRole;
  readonly shopId: ID; // 'MASTER' para Samuel22 ou ID da barbearia para o vendedor
  readonly slug: string;
  readonly login: string;
  readonly exp: number;
}

export const verifyMasterCredentials = (login: string, password: string): boolean =>
  login === MASTER_LOGIN && verifyPassword(password, MASTER_PASS_HASH);

export const assertSuperAdmin = (session: SessionPayload): void => {
  if (session.role !== 'SUPER_ADMIN' || session.login !== MASTER_LOGIN) {
    throw new DomainError('FORBIDDEN_SUPER_ADMIN_ONLY', 'Apenas o administrador mestre (Samuel22) pode criar ou gerenciar barbearias.');
  }
};

export const hashPassword = (password: string): string => {
  if (password.length < 6) throw new DomainError('WEAK_PASSWORD', 'A senha deve ter no mínimo 6 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
};

export const verifyPassword = (password: string, storedHash: string): boolean => {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const keyBuf = Buffer.from(key, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  return keyBuf.length === derivedBuf.length && crypto.timingSafeEqual(keyBuf, derivedBuf);
};

export const signToken = (payload: Omit<SessionPayload, 'exp'>, ttlMs = 12 * 3600_000): string => {
  const fullPayload: SessionPayload = { ...payload, exp: Date.now() + ttlMs };
  const data = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
};

export const verifyToken = (token: string): SessionPayload => {
  const [data, sig] = token.split('.');
  if (!data || !sig) throw new DomainError('UNAUTHORIZED', 'Token ausente ou malformado.');
  const expectedSig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new DomainError('UNAUTHORIZED', 'Assinatura de sessão inválida.');
  }
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as SessionPayload;
  if (Date.now() > payload.exp) {
    throw new DomainError('SESSION_EXPIRED', 'Sessão expirada. Faça login novamente.');
  }
  return payload;
};
