export type ID = string;
export type Cents = number; // Inteiro estrito (ex: R$ 45,00 = 4500)
export type UnixMs = number;

export type AppointmentStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELED';
export type TransactionType = 'INCOME' | 'COMMISSION_PAYOUT' | 'EXPENSE';

export type UserRole = 'SUPER_ADMIN' | 'SHOP_OWNER';

export interface Shop {
  readonly id: ID;
  readonly slug: string; // Rota pública Vercel: /b/:slug
  readonly name: string;
  readonly ownerLogin: string;
  readonly passwordHash: string;
  readonly active: boolean;
}

export interface Client {
  readonly id: ID;
  readonly shopId: ID;
  readonly name: string;
  readonly phone: string;
}

export interface Barber {
  readonly id: ID;
  readonly shopId: ID;
  readonly name: string;
  readonly commissionRateBps: number; // Basis points: 4000 = 40.00%
  readonly active: boolean;
}

export interface ServiceItem {
  readonly id: ID;
  readonly shopId: ID;
  readonly name: string;
  readonly priceCents: Cents;
  readonly durationMin: number;
  readonly imageUrl: string; // URL ou Data URI (data:image/...) do estilo de corte
}

export interface Appointment {
  readonly id: ID;
  readonly shopId: ID;
  readonly clientId: ID;
  readonly barberId: ID;
  readonly serviceId: ID;
  readonly startAt: UnixMs;
  readonly endAt: UnixMs;
  readonly status: AppointmentStatus;
}

export interface LedgerEntry {
  readonly id: ID;
  readonly shopId: ID;
  readonly appointmentId?: ID;
  readonly type: TransactionType;
  readonly amountCents: Cents;
  readonly createdAt: UnixMs;
}

export interface StateStore {
  shops: Map<ID, Shop>;
  clients: Map<ID, Client>;
  barbers: Map<ID, Barber>;
  services: Map<ID, ServiceItem>;
  appointments: Map<ID, Appointment>;
  ledger: LedgerEntry[];
}
