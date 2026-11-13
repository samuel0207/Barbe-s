import { Barber, Client, ServiceItem, Shop, Cents } from './types.js';

export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'DomainError';
  }
}

export const assertIntPositive = (val: number, field: string): void => {
  if (!Number.isInteger(val) || val <= 0) {
    throw new DomainError('INVALID_INT', `${field} deve ser inteiro positivo.`);
  }
};

export const validateShop = (s: Shop): Shop => {
  if (!s.id || s.name.trim().length < 2) throw new DomainError('INVALID_SHOP', 'Nome da barbearia inválido.');
  if (!/^[a-z0-9-]{3,40}$/.test(s.slug)) throw new DomainError('INVALID_SLUG', 'Slug público inválido (use letras minúsculas, números e hífens).');
  if (s.ownerLogin.trim().length < 3) throw new DomainError('INVALID_LOGIN', 'Login do proprietário deve ter ao menos 3 caracteres.');
  return s;
};

export const validateClient = (c: Client): Client => {
  if (!c.id || !c.shopId || c.name.trim().length < 2) throw new DomainError('INVALID_CLIENT', 'Nome inválido.');
  if (!/^\+?\d{10,15}$/.test(c.phone)) throw new DomainError('INVALID_PHONE', 'Telefone inválido (apenas dígitos, 10 a 15).');
  return c;
};

export const validateBarber = (b: Barber): Barber => {
  if (!b.id || !b.shopId || b.name.trim().length < 2) throw new DomainError('INVALID_BARBER', 'Barbeiro inválido.');
  if (!Number.isInteger(b.commissionRateBps) || b.commissionRateBps < 0 || b.commissionRateBps > 10000) {
    throw new DomainError('INVALID_COMMISSION', 'Comissão deve estar entre 0 e 10000 bps.');
  }
  return b;
};

export const validateService = (s: ServiceItem): ServiceItem => {
  if (!s.id || !s.shopId || s.name.trim().length < 2) throw new DomainError('INVALID_SERVICE', 'Estilo de corte inválido.');
  assertIntPositive(s.priceCents as Cents, 'priceCents');
  assertIntPositive(s.durationMin, 'durationMin');
  if (s.imageUrl && !/^(https?:\/\/|data:image\/)/i.test(s.imageUrl)) {
    throw new DomainError('INVALID_IMAGE', 'Imagem deve ser uma URL válida ou arquivo de imagem anexado.');
  }
  return s;
};
