import assert from 'node:assert/strict';
import { createStore, scheduleAppointment, completeAppointment, getFinancialSummary } from './core.js';
import { validateBarber, validateClient, validateService, validateShop, DomainError } from './schemas.js';
import { hashPassword, verifyPassword, signToken, verifyToken, verifyMasterCredentials, assertSuperAdmin } from './auth.js';

const runGate = () => {
  const store = createStore();

  // Gate 0: Validação exclusiva do Super Admin (Samuel22 / 153624sa)
  assert.equal(verifyMasterCredentials('Samuel22', '153624sa'), true);
  assert.equal(verifyMasterCredentials('Samuel22', 'errada'), false);
  assert.equal(verifyMasterCredentials('outro', '153624sa'), false);

  const masterToken = signToken({ role: 'SUPER_ADMIN', shopId: 'MASTER', slug: 'master', login: 'Samuel22' });
  assertSuperAdmin(verifyToken(masterToken));

  const ownerToken = signToken({ role: 'SHOP_OWNER', shopId: 'shop_a', slug: 'navalha-ouro', login: 'dono@navalha.com' });
  assert.throws(
    () => assertSuperAdmin(verifyToken(ownerToken)),
    (err: unknown) => err instanceof DomainError && err.code === 'FORBIDDEN_SUPER_ADMIN_ONLY'
  );

  // Setup de 2 Barbearias independentes (Multi-Tenant)
  const passA = hashPassword('senha123');
  assert.equal(verifyPassword('senha123', passA), true);

  store.shops.set('shop_a', validateShop({
    id: 'shop_a', slug: 'navalha-ouro', name: 'Barbearia Navalha de Ouro', ownerLogin: 'dono@navalha.com', passwordHash: passA, active: true
  }));
  store.shops.set('shop_b', validateShop({
    id: 'shop_b', slug: 'vikings-club', name: 'Vikings Barber Club', ownerLogin: 'dono@vikings.com', passwordHash: hashPassword('viking99'), active: true
  }));

  store.clients.set('c1', validateClient({ id: 'c1', shopId: 'shop_a', name: 'Carlos', phone: '5511999999999' }));
  store.barbers.set('b1', validateBarber({ id: 'b1', shopId: 'shop_a', name: 'João', commissionRateBps: 4000, active: true }));
  store.services.set('s1', validateService({
    id: 's1',
    shopId: 'shop_a',
    name: 'Corte Degradê',
    priceCents: 5000,
    durationMin: 30,
    imageUrl: 'data:image/svg+xml;utf8,<svg></svg>'
  }));

  store.barbers.set('b_viking', validateBarber({ id: 'b_viking', shopId: 'shop_b', name: 'Ragnar', commissionRateBps: 5000, active: true }));

  const t0 = 1700000000000;
  scheduleAppointment(store, { id: 'a1', shopId: 'shop_a', clientId: 'c1', barberId: 'b1', serviceId: 's1', startAt: t0 });

  // Gate 1: Deve bloquear sobreposição parcial na mesma barbearia
  assert.throws(
    () => scheduleAppointment(store, { id: 'a2', shopId: 'shop_a', clientId: 'c1', barberId: 'b1', serviceId: 's1', startAt: t0 + 15 * 60_000 }),
    (err: unknown) => err instanceof DomainError && err.code === 'SCHEDULE_CONFLICT'
  );

  // Gate 2: Isolamento Multi-Tenant (Cross-Tenant Booking & IDOR Protection)
  assert.throws(
    () => scheduleAppointment(store, { id: 'a_cross', shopId: 'shop_a', clientId: 'c1', barberId: 'b_viking', serviceId: 's1', startAt: t0 + 60 * 60_000 }),
    (err: unknown) => err instanceof DomainError && err.code === 'BARBER_UNAVAILABLE'
  );
  assert.throws(
    () => completeAppointment(store, 'shop_b', 'a1', t0 + 30 * 60_000),
    (err: unknown) => err instanceof DomainError && err.code === 'TENANT_MISMATCH'
  );

  // Gate 3: Fechamento financeiro isolado por Barbearia
  completeAppointment(store, 'shop_a', 'a1', t0 + 30 * 60_000);
  const summaryA = getFinancialSummary(store, 'shop_a');
  const summaryB = getFinancialSummary(store, 'shop_b');
  assert.equal(summaryA.grossRevenueCents, 5000);
  assert.equal(summaryA.commissionsCents, 2000);
  assert.equal(summaryA.netProfitCents, 3000);
  assert.equal(summaryB.grossRevenueCents, 0);

  console.log('[GATE PASS] SuperAdmin (Samuel22), Multi-tenancy, Imagens de Cortes e Isolamento Financeiro validados.');
};

runGate();
