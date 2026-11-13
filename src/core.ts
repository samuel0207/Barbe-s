import { Appointment, Cents, ID, Shop, StateStore, UnixMs } from './types.js';
import { DomainError } from './schemas.js';

export const createStore = (): StateStore => ({
  shops: new Map(),
  clients: new Map(),
  barbers: new Map(),
  services: new Map(),
  appointments: new Map(),
  ledger: [],
});

export const findShopBySlug = (store: StateStore, slug: string): Shop | undefined => {
  for (const shop of store.shops.values()) {
    if (shop.slug === slug) return shop;
  }
  return undefined;
};

export const findShopByLogin = (store: StateStore, login: string): Shop | undefined => {
  const norm = login.trim().toLowerCase();
  for (const shop of store.shops.values()) {
    if (shop.ownerLogin.toLowerCase() === norm) return shop;
  }
  return undefined;
};

/** Detecta colisão de horário: [startA, endA) intersecta [startB, endB) */
export const hasTimeOverlap = (startA: UnixMs, endA: UnixMs, startB: UnixMs, endB: UnixMs): boolean =>
  startA < endB && startB < endA;

export const scheduleAppointment = (
  store: StateStore,
  params: { id: ID; shopId: ID; clientId: ID; barberId: ID; serviceId: ID; startAt: UnixMs }
): Appointment => {
  const shop = store.shops.get(params.shopId);
  if (!shop || !shop.active) throw new DomainError('SHOP_UNAVAILABLE', 'Barbearia inativa ou inexistente.');

  const client = store.clients.get(params.clientId);
  if (!client || client.shopId !== params.shopId) {
    throw new DomainError('TENANT_MISMATCH', 'Cliente inválido para esta barbearia.');
  }

  const barber = store.barbers.get(params.barberId);
  if (!barber || !barber.active || barber.shopId !== params.shopId) {
    throw new DomainError('BARBER_UNAVAILABLE', 'Barbeiro inativo ou não pertence a esta barbearia.');
  }

  const service = store.services.get(params.serviceId);
  if (!service || service.shopId !== params.shopId) {
    throw new DomainError('SERVICE_NOT_FOUND', 'Serviço inválido para esta barbearia.');
  }

  const endAt = params.startAt + service.durationMin * 60_000;

  for (const appt of store.appointments.values()) {
    if (
      appt.shopId === params.shopId &&
      appt.barberId === params.barberId &&
      appt.status === 'SCHEDULED' &&
      hasTimeOverlap(params.startAt, endAt, appt.startAt, appt.endAt)
    ) {
      throw new DomainError('SCHEDULE_CONFLICT', 'Este barbeiro já possui agendamento neste horário.');
    }
  }

  const appointment: Appointment = { ...params, endAt, status: 'SCHEDULED' };
  store.appointments.set(appointment.id, appointment);
  return appointment;
};

/** Conclui atendimento exigindo isolamento estrito por shopId (RLS equivalente) */
export const completeAppointment = (
  store: StateStore,
  shopId: ID,
  appointmentId: ID,
  now: UnixMs = Date.now()
): void => {
  const appt = store.appointments.get(appointmentId);
  if (!appt || appt.shopId !== shopId) {
    throw new DomainError('TENANT_MISMATCH', 'Acesso negado: agendamento não pertence à sua barbearia.');
  }
  if (appt.status !== 'SCHEDULED') {
    throw new DomainError('INVALID_APPT_STATE', 'Agendamento não pode ser concluído.');
  }

  const service = store.services.get(appt.serviceId)!;
  const barber = store.barbers.get(appt.barberId)!;

  const commissionCents: Cents = Math.round((service.priceCents * barber.commissionRateBps) / 10_000);

  store.appointments.set(appointmentId, { ...appt, status: 'COMPLETED' });

  store.ledger.push(
    { id: `inc_${appt.id}`, shopId, appointmentId: appt.id, type: 'INCOME', amountCents: service.priceCents, createdAt: now },
    { id: `com_${appt.id}`, shopId, appointmentId: appt.id, type: 'COMMISSION_PAYOUT', amountCents: -commissionCents, createdAt: now }
  );
};

export const cancelAppointment = (store: StateStore, shopId: ID, appointmentId: ID): void => {
  const appt = store.appointments.get(appointmentId);
  if (!appt || appt.shopId !== shopId) {
    throw new DomainError('TENANT_MISMATCH', 'Acesso negado: agendamento não pertence à sua barbearia.');
  }
  if (appt.status !== 'SCHEDULED') {
    throw new DomainError('INVALID_APPT_STATE', 'Agendamento não pode ser cancelado.');
  }
  store.appointments.set(appointmentId, { ...appt, status: 'CANCELED' });
};

export const getFinancialSummary = (store: StateStore, shopId: ID) => {
  let grossRevenueCents = 0;
  let commissionsCents = 0;
  let expensesCents = 0;

  for (const entry of store.ledger) {
    if (entry.shopId !== shopId) continue;
    if (entry.type === 'INCOME') grossRevenueCents += entry.amountCents;
    else if (entry.type === 'COMMISSION_PAYOUT') commissionsCents += Math.abs(entry.amountCents);
    else if (entry.type === 'EXPENSE') expensesCents += Math.abs(entry.amountCents);
  }

  return {
    grossRevenueCents,
    commissionsCents,
    expensesCents,
    netProfitCents: grossRevenueCents - commissionsCents - expensesCents,
  };
};
