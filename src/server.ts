import http from 'node:http';
import {
  createStore,
  scheduleAppointment,
  completeAppointment,
  cancelAppointment,
  getFinancialSummary,
  findShopBySlug,
  findShopByLogin,
} from './core.js';
import { validateBarber, validateClient, validateService, validateShop, DomainError, assertIntPositive } from './schemas.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  verifyMasterCredentials,
  assertSuperAdmin,
  SessionPayload,
} from './auth.js';
import {
  hydrateFromSupabase,
  dbUpsertShop,
  dbUpsertBarber,
  dbDeleteBarber,
  dbUpsertService,
  dbDeleteService,
  dbUpsertClient,
  dbUpsertAppointment,
  dbInsertLedger,
  isSupabaseConfigured,
} from './supabase.js';

const store = createStore();

const makeServiceIconSvg = (type: 'scissors' | 'razor' | 'towel' | 'custom', label: string) => {
  const paths: Record<string, string> = {
    scissors: `<circle cx="22" cy="48" r="7" stroke="#141824" stroke-width="3" fill="none"/><circle cx="42" cy="48" r="7" stroke="#141824" stroke-width="3" fill="none"/><path d="M26 42 L44 14 M38 42 L20 14" stroke="#141824" stroke-width="3" stroke-linecap="round"/>`,
    razor: `<path d="M16 46 L34 28 L46 16 C49 19 49 24 46 27 L32 41 Z" stroke="#141824" stroke-width="2.8" fill="#df9a43" fill-opacity="0.25"/><path d="M14 48 L24 38" stroke="#141824" stroke-width="4" stroke-linecap="round"/>`,
    towel: `<rect x="18" y="14" width="28" height="36" rx="4" stroke="#141824" stroke-width="2.8" fill="#df9a43" fill-opacity="0.2"/><line x1="23" y1="24" x2="41" y2="24" stroke="#141824" stroke-width="2.5"/><line x1="23" y1="32" x2="41" y2="32" stroke="#141824" stroke-width="2.5"/>`,
    custom: `<circle cx="32" cy="32" r="22" stroke="#df9a43" stroke-width="2.5" fill="#141824"/><text x="32" y="36" font-family="sans-serif" font-size="10" font-weight="bold" fill="#fffdf9" text-anchor="middle">${label.slice(0, 6)}</text>`,
  };
  return (
    `data:image/svg+xml;utf8,` +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="12" fill="#f6efe2"/>
        ${paths[type] ?? paths['custom']}
      </svg>`
    )
  );
};

const seed = () => {
  const shop1 = validateShop({
    id: 'shop_1',
    slug: 'navalha-ouro',
    name: 'Barbearia Navalha de Ouro',
    ownerLogin: 'dono@navalha.com',
    passwordHash: hashPassword('123456'),
    active: true,
  });
  store.shops.set(shop1.id, shop1);

  store.barbers.set('b1', validateBarber({ id: 'b1', shopId: shop1.id, name: 'Alex — Barbeiro Mestre', commissionRateBps: 4500, active: true }));
  store.barbers.set('b2', validateBarber({ id: 'b2', shopId: shop1.id, name: 'Matheus — Especialista em Degradê', commissionRateBps: 4000, active: true }));
  store.barbers.set('b3', validateBarber({ id: 'b3', shopId: shop1.id, name: 'Samuel — Barba Tradicional', commissionRateBps: 4000, active: true }));

  store.services.set('s1', validateService({
    id: 's1', shopId: shop1.id, name: 'Corte Clássico e Degradê', priceCents: 5500, durationMin: 40,
    imageUrl: makeServiceIconSvg('scissors', 'Corte'),
  }));
  store.services.set('s2', validateService({
    id: 's2', shopId: shop1.id, name: 'Alinhamento de Barba', priceCents: 3500, durationMin: 30,
    imageUrl: makeServiceIconSvg('razor', 'Barba'),
  }));
  store.services.set('s3', validateService({
    id: 's3', shopId: shop1.id, name: 'Barba na Toalha Quente', priceCents: 6500, durationMin: 45,
    imageUrl: makeServiceIconSvg('towel', 'Toalha'),
  }));

  store.clients.set('c1', validateClient({ id: 'c1', shopId: shop1.id, name: 'Carlos Mendes', phone: '5511998765432' }));
  store.clients.set('c2', validateClient({ id: 'c2', shopId: shop1.id, name: 'Rafael Souza', phone: '5511987654321' }));

  const baseDate = new Date();
  baseDate.setHours(9, 0, 0, 0);
  const t9h = baseDate.getTime();

  scheduleAppointment(store, { id: 'a1', shopId: shop1.id, clientId: 'c1', barberId: 'b1', serviceId: 's3', startAt: t9h });
  completeAppointment(store, shop1.id, 'a1', t9h + 60 * 60_000);
  scheduleAppointment(store, { id: 'a2', shopId: shop1.id, clientId: 'c2', barberId: 'b1', serviceId: 's1', startAt: t9h + 60 * 60_000 });

  const shop2 = validateShop({
    id: 'shop_2',
    slug: 'vikings-club',
    name: 'Barbearia Vikings',
    ownerLogin: 'dono@vikings.com',
    passwordHash: hashPassword('123456'),
    active: true,
  });
  store.shops.set(shop2.id, shop2);

  store.barbers.set('b4', validateBarber({ id: 'b4', shopId: shop2.id, name: 'Ragnar — Mestre em Barba', commissionRateBps: 5000, active: true }));
  store.services.set('s4', validateService({
    id: 's4', shopId: shop2.id, name: 'Corte Lenhador + Hidratação', priceCents: 7000, durationMin: 45,
    imageUrl: makeServiceIconSvg('scissors', 'Viking'),
  }));
  store.clients.set('c3', validateClient({ id: 'c3', shopId: shop2.id, name: 'Lucas Ferreira', phone: '5511976543210' }));
  scheduleAppointment(store, { id: 'a3', shopId: shop2.id, clientId: 'c3', barberId: 'b4', serviceId: 's4', startAt: t9h + 120 * 60_000 });
};

seed();

const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const pre = (req as { body?: unknown }).body;
    if (pre && typeof pre === 'object') {
      resolve(pre as Record<string, unknown>);
      return;
    }
    if (typeof pre === 'string' && pre.length > 0) {
      try { resolve(JSON.parse(pre) as Record<string, unknown>); return; }
      catch (e) { reject(e); return; }
    }
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 4_000_000) reject(new DomainError('PAYLOAD_TOO_LARGE', 'Imagem muito grande (máx 3MB).'));
    });
    req.on('end', () => {
      try { resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });

const sendJson = (res: http.ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const requireAuth = (req: http.IncomingMessage): SessionPayload => {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return verifyToken(token);
};

// ============================================================================
// PÁGINA PÚBLICA DA BARBEARIA (/b/:slug) — TELA INTEIRA & 100% RESPONSIVA
// ============================================================================
const renderPublicShopHtml = (slug: string) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sharp Cut Barbershop — Agendamento Online</title>
  <style>
    :root {
      --navy: #141824;
      --cream-bg: #faf3e6;
      --card-white: #fffdf9;
      --border-sand: #e8decb;
      --text-dark: #141824;
      --text-muted: #6e6a63;
      --gold: #df9a43;
      --gold-dark: #c5832b;
      --green: #257942;
      --red: #c93b3b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    html { scroll-behavior: smooth; }
    body {
      background: var(--cream-bg);
      color: var(--text-dark);
      min-height: 100vh;
      width: 100%;
      display: flex;
      flex-direction: column;
      border: 10px solid var(--navy);
    }
    .container {
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
    }
    /* Navbar Tela Cheia */
    .navbar {
      background: var(--card-white);
      border-bottom: 1px solid var(--border-sand);
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .navbar-inner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      max-width: 1200px;
      margin: 0 auto;
      flex-wrap: wrap;
      gap: 12px;
    }
    .brand-title {
      font-size: clamp(1.1rem, 2vw, 1.4rem);
      font-weight: 800;
      color: var(--text-dark);
      letter-spacing: -0.5px;
    }
    .nav-links {
      display: flex;
      gap: clamp(14px, 3vw, 28px);
      align-items: center;
      flex-wrap: wrap;
    }
    .nav-links a {
      text-decoration: none;
      color: var(--text-dark);
      font-size: 0.92rem;
      font-weight: 600;
      transition: color 0.15s;
    }
    .nav-links a:hover { color: var(--gold-dark); }

    /* Hero Banner Tela Cheia */
    .hero {
      width: 100%;
      padding: clamp(56px, 10vw, 110px) 20px;
      text-align: center;
      color: #fffdf9;
      background-color: #1c1917;
      background-image:
        linear-gradient(180deg, rgba(20, 24, 36, 0.65) 0%, rgba(20, 24, 36, 0.85) 100%),
        url('https://images.unsplash.com/photo-1585747860715-2ba37e788b70?auto=format&fit=crop&w=1600&q=80');
      background-size: cover;
      background-position: center;
    }
    .hero h1 {
      font-size: clamp(2.1rem, 5vw, 3.6rem);
      font-weight: 800;
      line-height: 1.08;
      letter-spacing: -1px;
      color: #faf3e6;
      margin-bottom: 14px;
    }
    .hero p {
      font-size: clamp(0.95rem, 2vw, 1.15rem);
      color: #e6dec8;
      margin-bottom: 28px;
    }
    .btn-hero {
      display: inline-block;
      background: var(--gold);
      color: var(--text-dark);
      font-weight: 800;
      font-size: 0.98rem;
      padding: 14px 30px;
      border-radius: 8px;
      text-decoration: none;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      transition: transform 0.15s, background 0.15s;
    }
    .btn-hero:hover { background: var(--gold-dark); color: #fff; transform: translateY(-1px); }

    /* Seções */
    .section {
      padding: clamp(32px, 5vw, 56px) 0 16px 0;
    }
    .section-title {
      text-align: center;
      font-size: clamp(1.05rem, 2vw, 1.25rem);
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: var(--text-dark);
      margin-bottom: 24px;
    }

    /* Services & Pricing */
    .services-card {
      background: var(--card-white);
      border-radius: 14px;
      border: 1px solid var(--border-sand);
      box-shadow: 0 6px 20px rgba(20, 24, 36, 0.05);
      overflow: hidden;
    }
    .service-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 24px;
      border-bottom: 1px solid var(--border-sand);
      cursor: pointer;
      transition: background 0.15s;
      gap: 12px;
    }
    .service-row:last-child { border-bottom: none; }
    .service-row:hover { background: #fdf8ee; }
    .service-row.selected {
      background: #fbf1df;
      border-left: 5px solid var(--gold);
    }
    .service-left {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
    }
    .service-thumb {
      width: 60px;
      height: 60px;
      border-radius: 10px;
      object-fit: cover;
      border: 1px solid var(--border-sand);
      background: #f6efe2;
      flex-shrink: 0;
    }
    .service-name {
      font-size: clamp(0.95rem, 1.8vw, 1.08rem);
      font-weight: 700;
      color: var(--text-dark);
    }
    .service-desc {
      font-size: 0.84rem;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .service-price {
      font-size: clamp(1.05rem, 2vw, 1.25rem);
      font-weight: 800;
      color: var(--gold-dark);
      white-space: nowrap;
    }

    /* Meet Our Barbers */
    .barbers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 36px;
    }
    .barber-card {
      background: var(--card-white);
      border: 1px solid var(--border-sand);
      border-radius: 14px;
      padding: 26px 18px;
      text-align: center;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(20, 24, 36, 0.04);
      transition: transform 0.15s, border-color 0.15s;
    }
    .barber-card:hover { transform: translateY(-3px); border-color: var(--gold); }
    .barber-card.selected {
      border: 2px solid var(--gold);
      background: #fbf1df;
    }
    .barber-avatar {
      width: 92px;
      height: 92px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0 auto 14px auto;
      display: block;
      border: 3px solid var(--border-sand);
      background: #eee5d5;
    }
    .barber-name { font-size: 1.05rem; font-weight: 800; color: var(--text-dark); }
    .barber-role { font-size: 0.84rem; font-weight: 600; color: var(--gold-dark); margin-top: 4px; }

    /* Book Your Appointment (Full-Width Navy Footer Section) */
    .booking-section {
      margin-top: auto;
      background: var(--navy);
      padding: clamp(36px, 6vw, 60px) 20px 32px 20px;
      text-align: center;
      width: 100%;
    }
    .booking-heading {
      color: var(--gold);
      font-size: clamp(1.3rem, 2.5vw, 1.6rem);
      font-weight: 800;
      margin-bottom: 24px;
    }
    .booking-card {
      background: var(--cream-bg);
      border-radius: 14px;
      padding: clamp(20px, 4vw, 32px);
      text-align: left;
      max-width: 820px;
      margin: 0 auto;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px 20px;
    }
    .form-group label {
      display: block;
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--text-dark);
      margin-bottom: 6px;
    }
    .form-group input, .form-group select {
      width: 100%;
      background: var(--card-white);
      border: 1px solid #dfd5c3;
      color: var(--text-dark);
      padding: 11px 12px;
      border-radius: 8px;
      font-size: 0.94rem;
    }
    .btn-confirm {
      margin-top: 20px;
      width: 100%;
      background: var(--gold);
      color: var(--text-dark);
      font-weight: 800;
      font-size: 1rem;
      border: none;
      padding: 14px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-confirm:hover { background: var(--gold-dark); color: #fff; }
    .busy-bar {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--border-sand);
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .busy-pill {
      display: inline-block;
      background: rgba(201, 59, 59, 0.12);
      color: var(--red);
      border: 1px solid rgba(201, 59, 59, 0.3);
      padding: 3px 9px;
      border-radius: 4px;
      margin: 4px 4px 0 0;
      font-weight: 600;
    }
    #msg {
      display: none;
      padding: 12px 14px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 0.9rem;
      font-weight: 700;
    }
    .msg-ok { background: rgba(37, 121, 66, 0.14); border: 1px solid var(--green); color: var(--green); }
    .msg-err { background: rgba(201, 59, 59, 0.14); border: 1px solid var(--red); color: var(--red); }

    footer {
      margin-top: 32px;
      color: #b5b0a6;
      font-size: 0.8rem;
      line-height: 1.6;
      text-align: center;
    }
    @media (max-width: 600px) {
      body { border-width: 6px; }
      .navbar-inner { justify-content: center; text-align: center; }
      .service-row { padding: 14px 16px; }
    }
  </style>
</head>
<body>
  <nav class="navbar">
    <div class="navbar-inner">
      <div class="brand-title" id="shop-name">Barbearia</div>
      <div class="nav-links">
        <a href="#services">Serviços</a>
        <a href="#barbers">Barbeiros</a>
        <a href="#book">Agendar</a>
        <a href="/">Login</a>
      </div>
    </div>
  </nav>

  <section class="hero">
    <h1>Visual Impecável,<br/>Cortes Precisos</h1>
    <p>Estilo clássico. Acabamento perfeito. Tradição e pontualidade.</p>
    <a href="#book" class="btn-hero">Agendar Horário →</a>
  </section>

  <div class="container">
    <section class="section" id="services">
      <h2 class="section-title">SERVIÇOS E PREÇOS</h2>
      <div class="services-card" id="srv-list"></div>
    </section>

    <section class="section" id="barbers">
      <h2 class="section-title">NOSSOS BARBEIROS</h2>
      <div class="barbers-grid" id="barbers-grid"></div>
    </section>
  </div>

  <section class="booking-section" id="book">
    <h2 class="booking-heading">Agende Seu Horário</h2>
    <div class="booking-card">
      <div id="msg"></div>
      <form id="book-form">
        <div class="form-grid">
          <div class="form-group">
            <label>Seu Nome</label>
            <input type="text" id="inp-name" placeholder="Digite seu nome completo" required />
          </div>
          <div class="form-group">
            <label>Estilo de Corte</label>
            <select id="sel-service" required></select>
          </div>
          <div class="form-group">
            <label>WhatsApp / Telefone</label>
            <input type="text" id="inp-phone" placeholder="5511999998888" value="55119" required />
          </div>
          <div class="form-group">
            <label>Barbeiro</label>
            <select id="sel-barber" required></select>
          </div>
          <div class="form-group">
            <label>Data</label>
            <input type="date" id="inp-date" required />
          </div>
          <div class="form-group">
            <label>Horário</label>
            <input type="time" id="inp-time" value="11:00" required />
          </div>
        </div>
        <div class="busy-bar" id="busy-slots"></div>
        <button type="submit" class="btn-confirm">Confirmar Agendamento</button>
      </form>
    </div>

    <footer>
      <div id="footer-shop">Barbearia • Ter–Sáb • 09:00–20:00</div>
      <div>© 2026 Sistema de Gestão para Barbearias • Todos os direitos reservados</div>
    </footer>
  </section>

  <script>
    const _origFetchPub = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (typeof input === 'string' && input.startsWith('/api/')) {
        const headers = { ...(init.headers || {}), 'x-barber-route': input };
        return _origFetchPub('/api?__route=' + encodeURIComponent(input), { ...init, headers });
      }
      return _origFetchPub(input, init);
    };
    const SLUG = ${JSON.stringify(slug)};
    const fmtBRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtTime = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const BARBER_AVATARS = [
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=240&q=80',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=240&q=80',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=240&q=80'
    ];

    document.getElementById('inp-date').valueAsDate = new Date();

    function showMsg(txt, isErr) {
      const el = document.getElementById('msg');
      el.style.display = 'block';
      el.className = isErr ? 'msg-err' : 'msg-ok';
      el.textContent = txt;
    }

    async function loadPublicShop() {
      const res = await fetch('/api/public/' + SLUG);
      const data = await res.json();
      if (!res.ok) {
        document.getElementById('shop-name').textContent = 'Barbearia Indisponível';
        document.getElementById('book-form').style.display = 'none';
        showMsg(data.error || 'Barbearia inativa ou não encontrada.', true);
        return;
      }

      document.getElementById('shop-name').textContent = data.shop.name;
      document.getElementById('footer-shop').textContent = data.shop.name + ' • Ter–Sáb • 09:00–20:00 • Agendamento Online';

      const selSrv = document.getElementById('sel-service');
      const currentSrv = selSrv.value || (data.services[0] && data.services[0].id) || '';

      const cleanPt = (txt) => String(txt || '')
        .replace(/\s*\((Haircut|Beard Trim|Hot Towel Shave)\)/gi, '')
        .replace(/Master Barber/gi, 'Barbeiro Mestre')
        .replace(/Fade Specialist/gi, 'Especialista em Degradê')
        .replace(/Traditional Shave/gi, 'Barba Tradicional');

      selSrv.innerHTML = data.services.map(s =>
        \`<option value="\${s.id}" \${s.id === currentSrv ? 'selected' : ''}>\${cleanPt(s.name)} — \${fmtBRL(s.priceCents)}</option>\`
      ).join('');

      document.getElementById('srv-list').innerHTML = data.services.map(s => \`
        <div class="service-row \${s.id === selSrv.value ? 'selected' : ''}" onclick="pickService('\${s.id}')">
          <div class="service-left">
            <img class="service-thumb" src="\${s.imageUrl}" alt="\${cleanPt(s.name)}" />
            <div>
              <div class="service-name">\${cleanPt(s.name)}</div>
              <div class="service-desc">Acabamento completo & estilo • Duração: \${s.durationMin} min</div>
            </div>
          </div>
          <div class="service-price">\${fmtBRL(s.priceCents)}</div>
        </div>
      \`).join('');

      const selBarber = document.getElementById('sel-barber');
      const currentBarber = selBarber.value || (data.barbers[0] && data.barbers[0].id) || '';

      selBarber.innerHTML = data.barbers.map(b =>
        \`<option value="\${b.id}" \${b.id === currentBarber ? 'selected' : ''}>\${cleanPt(b.name)}</option>\`
      ).join('');

      document.getElementById('barbers-grid').innerHTML = data.barbers.map((b, idx) => {
        const parts = b.name.split('—');
        const mainName = parts[0].trim();
        const rawSpec = (parts[1] || 'Barbeiro Mestre').trim();
        const specialty = rawSpec
          .replace(/Master Barber/gi, 'Barbeiro Mestre')
          .replace(/Fade Specialist/gi, 'Especialista em Degradê')
          .replace(/Traditional Shave/gi, 'Barba Tradicional');
        const avatar = BARBER_AVATARS[idx % BARBER_AVATARS.length];
        return \`
          <div class="barber-card \${b.id === selBarber.value ? 'selected' : ''}" onclick="pickBarber('\${b.id}')">
            <img class="barber-avatar" src="\${avatar}" alt="\${mainName}" />
            <div class="barber-name">\${mainName}</div>
            <div class="barber-role">\${specialty}</div>
          </div>
        \`;
      }).join('');

      const busyEl = document.getElementById('busy-slots');
      if (data.busySlots.length === 0) {
        busyEl.innerHTML = '<span style="color:var(--green);font-weight:600;">✔ Todos os horários disponíveis hoje!</span>';
      } else {
        const barberMap = Object.fromEntries(data.barbers.map(b => [b.id, b.name.split('—')[0].trim()]));
        busyEl.innerHTML = 'Horários já reservados: ' + data.busySlots.map(slot =>
          \`<span class="busy-pill">\${barberMap[slot.barberId] || 'Barbeiro'}: \${fmtTime(slot.startAt)}–\${fmtTime(slot.endAt)}</span>\`
        ).join('');
      }
    }

    window.pickService = (id) => {
      document.getElementById('sel-service').value = id;
      loadPublicShop();
    };

    window.pickBarber = (id) => {
      document.getElementById('sel-barber').value = id;
      loadPublicShop();
    };

    document.getElementById('sel-service').addEventListener('change', loadPublicShop);
    document.getElementById('sel-barber').addEventListener('change', loadPublicShop);

    document.getElementById('book-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const [hh, mm] = document.getElementById('inp-time').value.split(':').map(Number);
      const dateStr = document.getElementById('inp-date').value;
      const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
      d.setHours(hh, mm, 0, 0);

      const res = await fetch('/api/public/' + SLUG + '/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: document.getElementById('sel-service').value,
          barberId: document.getElementById('sel-barber').value,
          clientName: document.getElementById('inp-name').value,
          clientPhone: document.getElementById('inp-phone').value,
          startAt: d.getTime()
        })
      });
      const out = await res.json();
      if (!res.ok) {
        showMsg(out.error || 'Erro ao agendar', true);
      } else {
        showMsg('✔ Agendamento confirmado! Seu horário já aparece no painel exclusivo do barbeiro. Você receberá uma mensagem via WhatsApp 30 minutos antes do horário para confirmar seu atendimento.', false);
        document.getElementById('inp-name').value = '';
        loadPublicShop();
      }
    });

    loadPublicShop();
  </script>
</body>
</html>`;

// ============================================================================
// PORTAL PRINCIPAL (TELA INTEIRA + RESPONSIVO + ABAS ESTILO NAVEGADOR)
// ============================================================================
const PORTAL_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sharp Cut SaaS — Painel em Abas</title>
  <style>
    :root {
      --navy: #141824;
      --navy-tab-bar: #1d2233;
      --navy-tab-inactive: #282f44;
      --cream-bg: #faf3e6;
      --card-white: #fffdf9;
      --border-sand: #e6dac6;
      --text-dark: #141824;
      --muted: #6e6a63;
      --gold: #df9a43;
      --gold-dark: #c5832b;
      --green: #257942;
      --red: #c93b3b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    html, body {
      width: 100%;
      min-height: 100vh;
      background: var(--cream-bg);
      color: var(--text-dark);
    }
    /* Estrutura Full-Screen (100% da tela em qualquer aparelho) */
    .app-shell {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      width: 100%;
      border: 8px solid var(--navy);
    }
    header {
      background: var(--navy);
      color: #fffdf9;
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    header h1 {
      font-size: clamp(1.1rem, 2vw, 1.35rem);
      font-weight: 800;
      color: #faf3e6;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      background: rgba(223, 154, 67, 0.2);
      border: 1px solid var(--gold);
      color: var(--gold);
      font-size: 0.75rem;
      padding: 5px 12px;
      border-radius: 999px;
      font-weight: 700;
      letter-spacing: 0.4px;
    }
    .workspace {
      flex: 1;
      width: 100%;
      max-width: 1600px;
      margin: 0 auto;
      padding: clamp(14px, 2.5vw, 28px);
      display: flex;
      flex-direction: column;
    }

    /* Banner Superior de Identificação da Barbearia */
    .top-banner {
      background: var(--card-white);
      border: 1px solid var(--border-sand);
      border-left: 5px solid var(--gold);
      padding: 12px 18px;
      border-radius: 10px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--navy);
      color: var(--navy);
      width: auto;
      margin-top: 0;
      padding: 7px 14px;
      font-size: 0.8rem;
      border-radius: 6px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-outline:hover { background: var(--navy); color: #fff; }

    /* KPIs Responsivos */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }
    .kpi {
      background: var(--navy);
      color: #fffdf9;
      border-radius: 10px;
      padding: 16px 18px;
      box-shadow: 0 4px 12px rgba(20, 24, 36, 0.12);
    }
    .kpi span { font-size: 0.73rem; color: #c7bfb1; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi strong { display: block; font-size: clamp(1.3rem, 2.2vw, 1.65rem); margin-top: 4px; color: var(--gold); }

    /* ========================================================================
       BARRA DE ABAS ESTILO NAVEGADOR (CHROME/BROWSER TABS)
       ======================================================================== */
    .browser-window {
      flex: 1;
      display: flex;
      flex-direction: column;
      border: 2px solid var(--navy);
      border-radius: 12px;
      overflow: hidden;
      background: var(--card-white);
      box-shadow: 0 10px 30px rgba(20, 24, 36, 0.08);
    }
    .browser-tabs-bar {
      background: var(--navy);
      padding: 10px 12px 0 12px;
      display: flex;
      align-items: flex-end;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: thin;
      -webkit-overflow-scrolling: touch;
    }
    .browser-tab {
      background: var(--navy-tab-inactive);
      color: #b8b2a6;
      border: none;
      padding: 11px 20px;
      border-radius: 10px 10px 0 0;
      font-size: 0.86rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
      width: auto;
      margin-top: 0;
      transition: background 0.15s, color 0.15s;
      position: relative;
    }
    .browser-tab:hover {
      background: #343d57;
      color: #fff;
    }
    .browser-tab.active {
      background: var(--card-white);
      color: var(--navy);
      box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.15);
      z-index: 2;
    }
    .tab-badge {
      background: rgba(223, 154, 67, 0.25);
      color: var(--gold);
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 800;
    }
    .browser-tab.active .tab-badge {
      background: var(--navy);
      color: var(--gold);
    }
    .browser-tab-content {
      display: none;
      padding: clamp(16px, 3vw, 28px);
      background: var(--card-white);
      flex: 1;
    }
    .browser-tab-content.active {
      display: block;
    }

    /* Formulários e Tabelas Responsivas */
    .card {
      background: var(--card-white);
      border: 1px solid var(--border-sand);
      border-radius: 12px;
      padding: clamp(16px, 2.5vw, 24px);
      margin-bottom: 18px;
    }
    .form-box {
      max-width: 680px;
      background: var(--cream-bg);
      border: 1px solid var(--border-sand);
      border-radius: 12px;
      padding: clamp(18px, 3vw, 26px);
    }
    .form-row-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
    }
    label { display: block; font-size: 0.82rem; font-weight: 700; color: var(--text-dark); margin-top: 12px; margin-bottom: 5px; }
    input, select {
      width: 100%;
      background: #fff;
      border: 1px solid #dcd0bc;
      color: var(--text-dark);
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 0.92rem;
    }
    .btn-primary {
      cursor: pointer;
      background: var(--gold);
      color: var(--navy);
      font-weight: 800;
      border: none;
      padding: 12px 18px;
      border-radius: 8px;
      width: 100%;
      margin-top: 18px;
      font-size: 0.95rem;
      transition: background 0.15s;
    }
    .btn-primary:hover { background: var(--gold-dark); color: #fff; }
    .btn-sm { width: auto; margin-top: 0; padding: 6px 12px; font-size: 0.78rem; background: var(--green); color: #fff; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; }
    .btn-cancel { background: transparent; border: 1px solid var(--red); color: var(--red); margin-left: 6px; }

    .table-wrap {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; min-width: 540px; }
    th, td { text-align: left; padding: 12px 10px; border-bottom: 1px solid var(--border-sand); vertical-align: middle; }
    th { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.4px; }
    .status { padding: 4px 9px; border-radius: 4px; font-size: 0.73rem; font-weight: 800; display: inline-block; }
    .status-SCHEDULED, .status-ACTIVE { background: rgba(37, 121, 66, 0.14); color: var(--green); }
    .status-COMPLETED { background: rgba(223, 154, 67, 0.2); color: var(--gold-dark); }
    .status-CANCELED, .status-INACTIVE { background: rgba(201, 59, 59, 0.14); color: var(--red); }

    .demo-pill {
      display: inline-block;
      background: var(--cream-bg);
      border: 1px solid #d5c7b0;
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      margin-top: 8px;
      cursor: pointer;
      margin-right: 6px;
    }
    .demo-pill:hover { border-color: var(--gold-dark); background: #fbf1df; }
    .cut-thumb { width: 54px; height: 54px; border-radius: 10px; object-fit: cover; border: 1px solid var(--border-sand); background: #f6efe2; }
    .preview-box { margin-top: 10px; display: flex; align-items: center; gap: 12px; }
    #alert { display: none; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.88rem; font-weight: 700; }
    .err { background: rgba(201, 59, 59, 0.14); border: 1px solid var(--red); color: var(--red); }
    .ok { background: rgba(37, 121, 66, 0.14); border: 1px solid var(--green); color: var(--green); }

    @media (max-width: 640px) {
      .app-shell { border-width: 4px; }
      header { padding: 12px 16px; }
      .browser-tab { padding: 9px 14px; font-size: 0.8rem; }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <header>
      <h1>💈 Sharp Cut SaaS <span style="font-weight:400;color:#b8b2a6;font-size:0.86rem;">| Gestão Multi-Barbearias</span></h1>
      <span id="role-badge" class="badge">ACESSO RESTRITO</span>
    </header>

    <div class="workspace">
      <div id="alert"></div>

      <!-- 1. TELA DE LOGIN LIMPA E DIRETA -->
      <div id="auth-view" style="max-width:440px;width:100%;margin:auto;">
        <div class="card">
          <h2 style="margin-bottom:14px;font-size:1.15rem;text-align:center;">🔐 Acesso ao Painel</h2>
          <form id="form-login">
            <label>Login ou E-mail</label>
            <input type="text" id="login-user" placeholder="Digite seu login ou e-mail" required />
            <label>Senha</label>
            <input type="password" id="login-pass" placeholder="••••••••" required />
            <button type="submit" class="btn-primary">Entrar no Painel →</button>
          </form>
        </div>
      </div>

      <!-- 2. PAINEL PESSOAL MASTER (EXCLUSIVO SAMUEL22) COM ABAS DE NAVEGADOR -->
      <div id="master-view" style="display:none;flex:1;flex-direction:column;">
        <div class="top-banner">
          <div>
            <strong style="font-size:1.05rem;">👑 Painel Pessoal Master — Samuel22</strong>
            <span style="color:var(--muted);font-size:0.85rem;margin-left:8px;">Controle exclusivo de criação e status das barbearias</span>
          </div>
          <button class="btn-outline" onclick="logout()">Sair (Logout)</button>
        </div>

        <section class="kpi-grid">
          <div class="kpi"><span>Total de Barbearias</span><strong id="m-kpi-total">0</strong></div>
          <div class="kpi"><span>Barbearias Ativas</span><strong id="m-kpi-active">0</strong></div>
          <div class="kpi"><span>Barbearias Inativas</span><strong id="m-kpi-inactive">0</strong></div>
          <div class="kpi"><span>Agendamentos na Rede</span><strong id="m-kpi-appts">0</strong></div>
        </section>

        <div class="browser-window">
          <div class="browser-tabs-bar">
            <button type="button" class="browser-tab active" onclick="switchMasterTab('m-tab-shops', this)">
              📋 Barbearias Ativas & Rede
            </button>
            <button type="button" class="browser-tab" onclick="switchMasterTab('m-tab-create', this)">
              ✨ Cadastrar Nova Barbearia
            </button>
          </div>

          <div id="m-tab-shops" class="browser-tab-content active">
            <h3 style="margin-bottom:14px;">Barbearias Cadastradas na Plataforma</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Barbearia</th>
                    <th>Link Público (Vercel)</th>
                    <th>Login Vendedor</th>
                    <th>Cortes / Agenda</th>
                    <th>Status</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody id="tb-master-shops"></tbody>
              </table>
            </div>
          </div>

          <div id="m-tab-create" class="browser-tab-content">
            <div class="form-box">
              <h3 style="margin-bottom:12px;">✨ Criar Nova Barbearia (Exclusivo Samuel22)</h3>
              <form id="form-master-create">
                <label>Nome da Barbearia</label>
                <input type="text" id="reg-name" placeholder="Ex: Sharp Cut Barbershop" required />
                <div class="form-row-2">
                  <div>
                    <label>Slug do Link Público (ex: sharp-cut)</label>
                    <input type="text" id="reg-slug" placeholder="sharp-cut" required />
                  </div>
                  <div>
                    <label>Login do Vendedor (Dono)</label>
                    <input type="text" id="reg-login" placeholder="dono@sharpcut.com" required />
                  </div>
                </div>
                <label>Senha do Vendedor (mín. 6 caracteres)</label>
                <input type="password" id="reg-pass" placeholder="******" required />
                <button type="submit" class="btn-primary">Criar Barbearia & Ativar Link →</button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. PAINEL DO VENDEDOR / DONO EM ABAS ESTILO NAVEGADOR -->
      <div id="owner-view" style="display:none;flex:1;flex-direction:column;">
        <div class="top-banner">
          <div>
            <strong id="dash-shop-title" style="font-size:1.05rem;"></strong>
            <span style="color:var(--muted);font-size:0.85rem;margin-left:10px;">Página pública da sua barbearia:</span>
            <a id="dash-public-link" href="#" target="_blank" style="color:var(--gold-dark);font-weight:800;"></a>
          </div>
          <button class="btn-outline" onclick="logout()">Sair (Logout)</button>
        </div>

        <section class="kpi-grid">
          <div class="kpi"><span>Receita Bruta</span><strong id="kpi-gross">R$ 0,00</strong></div>
          <div class="kpi"><span>Comissões Equipe</span><strong id="kpi-comm">R$ 0,00</strong></div>
          <div class="kpi"><span>Despesas</span><strong id="kpi-exp">R$ 0,00</strong></div>
          <div class="kpi"><span>Lucro Líquido</span><strong id="kpi-net">R$ 0,00</strong></div>
        </section>

        <!-- JANELA COM ABAS DE NAVEGADOR DO VENDEDOR -->
        <div class="browser-window">
          <div class="browser-tabs-bar">
            <button type="button" class="browser-tab active" data-tab="tab-appts" onclick="switchOwnerTab('tab-appts', this)">
              📅 Agendamentos <span class="tab-badge" id="badge-appts">0</span>
            </button>
            <button type="button" class="browser-tab" data-tab="tab-published" onclick="switchOwnerTab('tab-published', this)">
              📸 Estilos de Corte Publicados <span class="tab-badge" id="badge-services">0</span>
            </button>
            <button type="button" class="browser-tab" data-tab="tab-add-cut" onclick="switchOwnerTab('tab-add-cut', this)">
              ✂️ Adicionar Corte
            </button>
            <button type="button" class="browser-tab" data-tab="tab-add-barber" onclick="switchOwnerTab('tab-add-barber', this)">
              🧔 Adicionar Barbeiro <span class="tab-badge" id="badge-barbers">0</span>
            </button>
          </div>

          <!-- ABA 1: AGENDAMENTOS -->
          <div id="tab-appts" class="browser-tab-content active">
            <!-- BANNER DE NOTIFICAÇÃO AUTOMÁTICA DE WHATSAPP (30 MIN ANTES) -->
            <div id="wa-reminder-banner" style="display:none;background:#fbf1df;border:2px solid var(--gold);border-radius:10px;padding:14px 18px;margin-bottom:16px;"></div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
              <h3>📅 Agendamentos Recebidos</h3>
              <span style="font-size:0.82rem;color:var(--muted);">🔔 O painel notifica automaticamente 30 min antes de cada horário para envio do WhatsApp</span>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Horário</th>
                    <th>Cliente (WhatsApp)</th>
                    <th>Barbeiro</th>
                    <th>Corte Escolhido</th>
                    <th>Valor</th>
                    <th>Lembrete WhatsApp (30 min)</th>
                    <th>Status</th>
                    <th>Ação do Vendedor</th>
                  </tr>
                </thead>
                <tbody id="tb-appts"></tbody>
              </table>
            </div>
          </div>

          <!-- ABA 2: ESTILOS DE CORTE PUBLICADOS -->
          <div id="tab-published" class="browser-tab-content">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
              <h3>📸 Estilos de Corte Publicados em "Serviços e Preços"</h3>
              <button type="button" class="btn-sm" style="background:var(--gold);color:var(--navy);" onclick="openOwnerTabByName('tab-add-cut')">
                + Adicionar Novo Corte
              </button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Imagem</th>
                    <th>Estilo de Corte</th>
                    <th>Duração</th>
                    <th>Preço</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody id="tb-services"></tbody>
              </table>
            </div>
          </div>

          <!-- ABA 3: ADICIONAR CORTE + FOTO -->
          <div id="tab-add-cut" class="browser-tab-content">
            <div class="form-box">
              <h3 style="margin-bottom:12px;">✂️ Adicionar Novo Estilo de Corte + Foto</h3>
              <form id="form-service">
                <label>Nome do Estilo de Corte</label>
                <input type="text" id="srv-name" placeholder="Ex: Degradê Navalhado" required />
                <div class="form-row-2">
                  <div>
                    <label>Preço em R$ (ex: 45)</label>
                    <input type="number" id="srv-price" value="45" min="1" required />
                  </div>
                  <div>
                    <label>Duração (minutos)</label>
                    <input type="number" id="srv-dur" value="40" min="5" required />
                  </div>
                </div>
                <label>Anexar Foto do Corte (Upload do Computador/Celular)</label>
                <input type="file" id="srv-file" accept="image/*" />
                <label>Ou URL de Imagem (opcional)</label>
                <input type="text" id="srv-img-url" placeholder="https://..." />
                <div class="preview-box" id="img-preview-box" style="display:none;">
                  <img id="img-preview" class="cut-thumb" src="" alt="Preview" />
                  <span style="font-size:0.82rem;color:var(--green);font-weight:700;">✔ Imagem pronta para publicação</span>
                </div>
                <button type="submit" class="btn-primary">Publicar Estilo de Corte →</button>
              </form>
            </div>
          </div>

          <!-- ABA 4: ADICIONAR BARBEIRO & EQUIPE -->
          <div id="tab-add-barber" class="browser-tab-content">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;">
              <div class="form-box">
                <h3 style="margin-bottom:12px;">🧔 Cadastrar Novo Barbeiro</h3>
                <form id="form-barber">
                  <label>Nome e Especialidade (ex: Alex — Barbeiro Mestre)</label>
                  <input type="text" id="bar-name" placeholder="Alex — Barbeiro Mestre" required />
                  <label>Comissão do Barbeiro (%)</label>
                  <input type="number" id="bar-comm" value="40" min="0" max="100" required />
                  <button type="submit" class="btn-primary">Cadastrar Barbeiro →</button>
                </form>
              </div>
              <div>
                <h3 style="margin-bottom:12px;">Equipe Atual ("Nossos Barbeiros")</h3>
                <div class="table-wrap">
                  <table style="min-width:280px;">
                    <thead>
                      <tr><th>Profissional</th><th>Comissão</th><th>Status</th><th>Ação</th></tr>
                    </thead>
                    <tbody id="tb-barbers"></tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const _origFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (typeof input === 'string' && input.startsWith('/api/')) {
        const headers = { ...(init.headers || {}), 'x-barber-route': input };
        return _origFetch('/api?__route=' + encodeURIComponent(input), { ...init, headers });
      }
      return _origFetch(input, init);
    };
    const fmtBRL = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtTime = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    let token = localStorage.getItem('barber_token') || '';
    let role = localStorage.getItem('barber_role') || '';
    let uploadedImageDataUrl = '';

    // Alternância de Abas estilo Navegador (Vendedor)
    window.switchOwnerTab = (tabId, btnEl) => {
      document.querySelectorAll('#owner-view .browser-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#owner-view .browser-tab-content').forEach(c => c.classList.remove('active'));
      btnEl.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    };

    window.openOwnerTabByName = (tabId) => {
      const btn = document.querySelector(\`#owner-view .browser-tab[data-tab="\${tabId}"]\`);
      if (btn) window.switchOwnerTab(tabId, btn);
    };

    // Alternância de Abas estilo Navegador (Master Samuel22)
    window.switchMasterTab = (tabId, btnEl) => {
      document.querySelectorAll('#master-view .browser-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#master-view .browser-tab-content').forEach(c => c.classList.remove('active'));
      btnEl.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    };

    function showAlert(msg, isErr) {
      const el = document.getElementById('alert');
      el.style.display = 'block';
      el.className = isErr ? 'err' : 'ok';
      el.textContent = msg;
      setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    window.fillLogin = (u, p) => {
      document.getElementById('login-user').value = u;
      document.getElementById('login-pass').value = p;
    };

    window.logout = () => {
      token = '';
      role = '';
      localStorage.removeItem('barber_token');
      localStorage.removeItem('barber_role');
      renderView();
    };

    document.getElementById('srv-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 320;
          let w = img.width, h = img.height;
          if (w > h && w > MAX) { h = Math.round((h * MAX) / w); w = MAX; }
          else if (h >= w && h > MAX) { w = Math.round((w * MAX) / h); h = MAX; }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          uploadedImageDataUrl = canvas.toDataURL('image/jpeg', 0.84);
          document.getElementById('img-preview').src = uploadedImageDataUrl;
          document.getElementById('img-preview-box').style.display = 'flex';
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    async function loadDirectory() {
      const res = await fetch('/api/public/shops');
      const data = await res.json();
      const el = document.getElementById('public-shops-list');
      if (data.shops.length === 0) {
        el.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">Nenhuma barbearia ativa no momento.</span>';
        return;
      }
      el.innerHTML = data.shops.map(s => \`
        <a href="/b/\${s.slug}" style="background:var(--navy);color:var(--gold);padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.86rem;">
          💈 Abrir Site: /b/\${s.slug} (\${s.name}) →
        </a>
      \`).join('');
    }

    async function loadMasterDashboard() {
      const res = await fetch('/api/admin/shops', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) { logout(); return; }
      const data = await res.json();

      const total = data.shops.length;
      const activeCount = data.shops.filter(s => s.active).length;
      const totalAppts = data.shops.reduce((acc, s) => acc + s.appointmentsCount, 0);

      document.getElementById('m-kpi-total').textContent = total;
      document.getElementById('m-kpi-active').textContent = activeCount;
      document.getElementById('m-kpi-inactive').textContent = total - activeCount;
      document.getElementById('m-kpi-appts').textContent = totalAppts;

      document.getElementById('tb-master-shops').innerHTML = data.shops.map(s => \`
        <tr>
          <td><strong>\${s.name}</strong></td>
          <td><a href="/b/\${s.slug}" target="_blank" style="color:var(--gold-dark);font-weight:800;text-decoration:none;">/b/\${s.slug} ↗</a></td>
          <td><code>\${s.ownerLogin}</code></td>
          <td>\${s.servicesCount} cortes • \${s.appointmentsCount} agendamentos</td>
          <td><span class="status \${s.active ? 'status-ACTIVE' : 'status-INACTIVE'}">\${s.active ? 'ATIVA' : 'INATIVA'}</span></td>
          <td>
            <button class="btn-sm" style="background:\${s.active ? 'var(--red)' : 'var(--green)'}" onclick="toggleShop('\${s.id}')">
              \${s.active ? 'Desativar' : 'Ativar'}
            </button>
          </td>
        </tr>
      \`).join('');
    }

    window.toggleShop = async (shopId) => {
      const res = await fetch('/api/admin/shops/' + shopId + '/toggle', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const out = await res.json();
      if (!res.ok) showAlert(out.error, true);
      else {
        showAlert('Status da barbearia atualizado!', false);
        loadMasterDashboard();
      }
    };

    async function loadOwnerDashboard() {
      const res = await fetch('/api/owner/state', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) { logout(); return; }
      const data = await res.json();

      document.getElementById('dash-shop-title').textContent = '💈 ' + data.shop.name + ' (' + data.shop.ownerLogin + ')';
      const pubUrl = '/b/' + data.shop.slug;
      const linkEl = document.getElementById('dash-public-link');
      linkEl.href = pubUrl;
      linkEl.textContent = window.location.origin + pubUrl + ' ↗';

      document.getElementById('kpi-gross').textContent = fmtBRL(data.summary.grossRevenueCents);
      document.getElementById('kpi-comm').textContent = fmtBRL(data.summary.commissionsCents);
      document.getElementById('kpi-exp').textContent = fmtBRL(data.summary.expensesCents);
      document.getElementById('kpi-net').textContent = fmtBRL(data.summary.netProfitCents);

      // Contadores nas abas estilo navegador
      document.getElementById('badge-appts').textContent = data.appointments.length;
      document.getElementById('badge-services').textContent = data.services.length;
      document.getElementById('badge-barbers').textContent = data.barbers.length;

      document.getElementById('tb-services').innerHTML = data.services.map(s => \`
        <tr>
          <td><img class="cut-thumb" src="\${s.imageUrl}" alt="\${s.name}" /></td>
          <td><strong>\${s.name}</strong></td>
          <td>\${s.durationMin} min</td>
          <td style="font-weight:800;color:var(--gold-dark);">\${fmtBRL(s.priceCents)}</td>
          <td><button class="btn-sm btn-cancel" onclick="deleteService('\${s.id}')">Remover</button></td>
        </tr>
      \`).join('');

      document.getElementById('tb-barbers').innerHTML = data.barbers.map(b => \`
        <tr>
          <td><strong>\${b.name}</strong></td>
          <td>\${(b.commissionRateBps / 100).toFixed(0)}%</td>
          <td><span class="status status-ACTIVE">\${b.active ? 'ATIVO' : 'INATIVO'}</span></td>
          <td><button class="btn-sm btn-cancel" onclick="deleteBarber('\${b.id}')">Remover</button></td>
        </tr>
      \`).join('');

      const clientMap = Object.fromEntries(data.clients.map(c => [c.id, c]));
      const barberMap = Object.fromEntries(data.barbers.map(b => [b.id, b]));
      const serviceMap = Object.fromEntries(data.services.map(s => [s.id, s]));

      const statusPt = { SCHEDULED: 'AGENDADO', COMPLETED: 'CONCLUÍDO', CANCELED: 'CANCELADO' };
      const sortedAppts = [...data.appointments].sort((a, b) => a.startAt - b.startAt);
      const sentMap = JSON.parse(localStorage.getItem('wa_sent_map') || '{}');
      const nowMs = Date.now();
      const dueReminders = [];

      document.getElementById('tb-appts').innerHTML = sortedAppts.map(a => {
        const cl = clientMap[a.clientId] || { name: a.clientId, phone: '' };
        const srv = serviceMap[a.serviceId] || { name: a.serviceId, priceCents: 0 };
        const barberName = (barberMap[a.barberId]?.name || a.barberId).split('—')[0].trim();
        const reminderAt = a.startAt - 30 * 60_000;
        const minsLeft = Math.round((a.startAt - nowMs) / 60_000);
        const isDue30Min = a.status === 'SCHEDULED' && minsLeft <= 35 && minsLeft >= -15;
        const wasSent = Boolean(sentMap[a.id]);

        const rawDigits = String(cl.phone || '').replace(/\\D/g, '');
        const waPhone = rawDigits.startsWith('55') ? rawDigits : '55' + rawDigits;
        const waText = \`Olá \${cl.name}! Passando da \${data.shop.name} para confirmar seu agendamento hoje às \${fmtTime(a.startAt)} (\${srv.name} com \${barberName}). Podemos confirmar sua presença?\`;
        const waUrl = \`https://wa.me/\${waPhone}?text=\${encodeURIComponent(waText)}\`;

        if (isDue30Min && !wasSent) {
          dueReminders.push({ id: a.id, clientName: cl.name, phone: cl.phone, startAt: a.startAt, srvName: srv.name, waUrl, minsLeft });
        }

        let waCol = '<span style="color:var(--muted);font-size:0.78rem;">—</span>';
        if (a.status === 'SCHEDULED') {
          const statusLabel = wasSent
            ? '<span style="color:var(--green);font-weight:800;font-size:0.76rem;display:block;margin-bottom:4px;">✔ Msg 30min Enviada</span>'
            : isDue30Min
              ? '<span style="color:var(--red);font-weight:800;font-size:0.76rem;display:block;margin-bottom:4px;">🔔 ENVIAR AGORA (≤ 30 min!)</span>'
              : \`<span style="color:var(--muted);font-size:0.75rem;display:block;margin-bottom:4px;">⏰ Disparo às <strong>\${fmtTime(reminderAt)}</strong></span>\`;

          waCol = \`
            \${statusLabel}
            <button type="button" class="btn-sm" style="background:#25D366;color:#141824;" onclick="sendWhatsAppReminder('\${a.id}', '\${waUrl}')">
              📲 \${wasSent ? 'Reenviar WhatsApp' : 'Mandar Msg (30 min)'}
            </button>
          \`;
        }

        const act = a.status === 'SCHEDULED'
          ? \`<button class="btn-sm" onclick="ownerAction('\${a.id}','complete')">✔ Concluir</button>
             <button class="btn-sm btn-cancel" onclick="ownerAction('\${a.id}','cancel')">✖</button>\`
          : '<span style="color:var(--muted);font-size:0.78rem;">Finalizado</span>';
        return \`<tr style="\${isDue30Min && !wasSent ? 'background:#fff8eb;' : ''}">
          <td><strong>\${fmtTime(a.startAt)}</strong> - \${fmtTime(a.endAt)}</td>
          <td>\${cl.name} <span style="color:var(--muted);font-size:0.76rem;">(\${cl.phone})</span></td>
          <td>\${barberMap[a.barberId]?.name || a.barberId}</td>
          <td>\${srv.name}</td>
          <td>\${fmtBRL(srv.priceCents)}</td>
          <td>\${waCol}</td>
          <td><span class="status status-\${a.status}">\${statusPt[a.status] || a.status}</span></td>
          <td>\${act}</td>
        </tr>\`;
      }).join('');

      const bannerEl = document.getElementById('wa-reminder-banner');
      if (dueReminders.length > 0) {
        bannerEl.style.display = 'block';
        bannerEl.innerHTML = \`
          <div style="font-weight:800;color:var(--navy);margin-bottom:8px;font-size:0.95rem;">
            🔔 ATENÇÃO DONO: Faltam 30 minutos (ou menos) para \${dueReminders.length} atendimento(s)! Envie a confirmação no WhatsApp:
          </div>
          \${dueReminders.map(r => \`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid var(--border-sand);flex-wrap:wrap;gap:8px;">
              <span>👤 <strong>\${r.clientName}</strong> (\${r.phone}) — Corte: <strong>\${r.srvName}</strong> às <strong>\${fmtTime(r.startAt)}</strong></span>
              <button type="button" class="btn-sm" style="background:#25D366;color:#141824;font-weight:800;" onclick="sendWhatsAppReminder('\${r.id}', '\${r.waUrl}')">
                📲 Confirmar via WhatsApp Agora →
              </button>
            </div>
          \`).join('')}
        \`;
      } else {
        bannerEl.style.display = 'none';
      }
    }

    window.sendWhatsAppReminder = (apptId, waUrl) => {
      const sentMap = JSON.parse(localStorage.getItem('wa_sent_map') || '{}');
      sentMap[apptId] = Date.now();
      localStorage.setItem('wa_sent_map', JSON.stringify(sentMap));
      window.open(waUrl, '_blank', 'noopener');
      loadOwnerDashboard();
    };

    // Verifica automaticamente a cada 25 segundos se algum agendamento entrou na janela de 30 minutos antes
    setInterval(() => {
      if (token && role === 'SHOP_OWNER') loadOwnerDashboard();
    }, 25000);

    function renderView() {
      const badge = document.getElementById('role-badge');
      if (token && role === 'SUPER_ADMIN') {
        badge.textContent = 'SUPER ADMIN: SAMUEL22';
        document.getElementById('auth-view').style.display = 'none';
        document.getElementById('owner-view').style.display = 'none';
        document.getElementById('master-view').style.display = 'flex';
        loadMasterDashboard();
      } else if (token && role === 'SHOP_OWNER') {
        badge.textContent = 'PAINEL DO VENDEDOR';
        document.getElementById('auth-view').style.display = 'none';
        document.getElementById('master-view').style.display = 'none';
        document.getElementById('owner-view').style.display = 'flex';
        loadOwnerDashboard();
      } else {
        badge.textContent = 'ACESSO RESTRITO';
        document.getElementById('auth-view').style.display = 'block';
        document.getElementById('master-view').style.display = 'none';
        document.getElementById('owner-view').style.display = 'none';
      }
    }

    document.getElementById('form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: document.getElementById('login-user').value,
          password: document.getElementById('login-pass').value
        })
      });
      const out = await res.json();
      if (!res.ok) showAlert(out.error, true);
      else {
        token = out.token;
        role = out.role;
        localStorage.setItem('barber_token', token);
        localStorage.setItem('barber_role', role);
        showAlert(role === 'SUPER_ADMIN' ? 'Bem-vindo ao Painel Master, Samuel22!' : 'Autenticado em ' + out.shop.name, false);
        renderView();
      }
    });

    document.getElementById('form-master-create').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/admin/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          name: document.getElementById('reg-name').value,
          slug: document.getElementById('reg-slug').value,
          login: document.getElementById('reg-login').value,
          password: document.getElementById('reg-pass').value
        })
      });
      const out = await res.json();
      if (!res.ok) showAlert(out.error, true);
      else {
        document.getElementById('reg-name').value = '';
        document.getElementById('reg-slug').value = '';
        document.getElementById('reg-login').value = '';
        document.getElementById('reg-pass').value = '';
        showAlert('Nova barbearia criada com sucesso!', false);
        loadMasterDashboard();
        const firstTab = document.querySelector('#master-view .browser-tab');
        if (firstTab) window.switchMasterTab('m-tab-shops', firstTab);
      }
    });

    document.getElementById('form-service').addEventListener('submit', async (e) => {
      e.preventDefault();
      const finalImage = uploadedImageDataUrl || document.getElementById('srv-img-url').value.trim();
      const res = await fetch('/api/owner/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          name: document.getElementById('srv-name').value,
          priceCents: Math.round(Number(document.getElementById('srv-price').value) * 100),
          durationMin: Number(document.getElementById('srv-dur').value),
          imageUrl: finalImage
        })
      });
      const out = await res.json();
      if (!res.ok) showAlert(out.error, true);
      else {
        document.getElementById('srv-name').value = '';
        document.getElementById('srv-file').value = '';
        document.getElementById('srv-img-url').value = '';
        uploadedImageDataUrl = '';
        document.getElementById('img-preview-box').style.display = 'none';
        showAlert('Estilo de corte publicado! Redirecionando para Estilos Publicados...', false);
        await loadOwnerDashboard();
        window.openOwnerTabByName('tab-published');
      }
    });

    window.deleteService = async (id) => {
      const res = await fetch('/api/owner/services/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const out = await res.json();
      if (!res.ok) showAlert(out.error, true);
      else {
        showAlert('Estilo de corte removido.', false);
        loadOwnerDashboard();
      }
    };

    window.deleteBarber = async (id) => {
      const res = await fetch('/api/owner/barbers/' + id, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const out = await res.json();
      if (!res.ok) showAlert(out.error, true);
      else {
        showAlert('Barbeiro removido da equipe.', false);
        loadOwnerDashboard();
      }
    };

    document.getElementById('form-barber').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/owner/barbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          name: document.getElementById('bar-name').value,
          commissionRateBps: Math.round(Number(document.getElementById('bar-comm').value) * 100)
        })
      });
      const out = await res.json();
      if (!res.ok) showAlert(out.error, true);
      else {
        document.getElementById('bar-name').value = '';
        showAlert('Barbeiro adicionado à equipe!', false);
        loadOwnerDashboard();
      }
    });

    window.ownerAction = async (id, action) => {
      const res = await fetch(\`/api/owner/appointments/\${id}/\${action}\`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const out = await res.json();
      if (!res.ok) showAlert(out.error, true);
      else {
        showAlert(action === 'complete' ? 'Atendimento concluído e faturado!' : 'Agendamento cancelado.', false);
        loadOwnerDashboard();
      }
    };

    renderView();
  </script>
</body>
</html>`;

const resolvePathname = (req: http.IncomingMessage): string => {
  const headerRoute = req.headers['x-barber-route'];
  if (typeof headerRoute === 'string' && headerRoute.startsWith('/')) {
    return headerRoute;
  }
  const rawUrl = new URL(req.url ?? '/', 'http://localhost');
  const shopParam = rawUrl.searchParams.get('shop');
  if (shopParam) return `/b/${shopParam}`;
  let p =
    rawUrl.searchParams.get('__route') ||
    rawUrl.searchParams.get('__path') ||
    rawUrl.pathname ||
    '/';
  if (!p.startsWith('/')) p = '/' + p;
  if (
    p.startsWith('/public/') ||
    p.startsWith('/auth/') ||
    p.startsWith('/admin/') ||
    p.startsWith('/owner/') ||
    p === '/health'
  ) {
    p = '/api' + p;
  }
  if (req.method === 'GET' && (p === '/api' || p === '/api/')) {
    p = '/';
  }
  return p;
};

const serverHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  try {
    await ensureSupabaseSynced();
    const pathname = resolvePathname(req);
    const url = { pathname };

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, supabaseConnected: supabaseSynced, supabaseConfigured: isSupabaseConfigured() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PORTAL_HTML);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/b/')) {
      const slug = url.pathname.slice(3).replace(/\/$/, '');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPublicShopHtml(slug));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/public/shops') {
      const shops = Array.from(store.shops.values())
        .filter(s => s.active)
        .map(s => ({ id: s.id, slug: s.slug, name: s.name }));
      sendJson(res, 200, { shops });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/public/') && !url.pathname.endsWith('/book')) {
      const slug = url.pathname.split('/')[3] ?? '';
      const shop = findShopBySlug(store, slug);
      if (!shop || !shop.active) throw new DomainError('SHOP_UNAVAILABLE', 'Esta barbearia está inativa ou não existe.');

      const barbers = Array.from(store.barbers.values())
        .filter(b => b.shopId === shop.id && b.active)
        .map(b => ({ id: b.id, name: b.name }));

      const services = Array.from(store.services.values())
        .filter(s => s.shopId === shop.id);

      const busySlots = Array.from(store.appointments.values())
        .filter(a => a.shopId === shop.id && a.status === 'SCHEDULED')
        .map(a => ({ barberId: a.barberId, startAt: a.startAt, endAt: a.endAt }));

      sendJson(res, 200, {
        shop: { id: shop.id, slug: shop.slug, name: shop.name },
        barbers,
        services,
        busySlots,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/public/') && url.pathname.endsWith('/book')) {
      const slug = url.pathname.split('/')[3] ?? '';
      const shop = findShopBySlug(store, slug);
      if (!shop || !shop.active) throw new DomainError('SHOP_UNAVAILABLE', 'Barbearia inativa ou não encontrada.');

      const body = await readJson(req);
      const startAt = Number(body['startAt']);
      assertIntPositive(startAt, 'startAt');

      const clientId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const client = validateClient({
        id: clientId,
        shopId: shop.id,
        name: String(body['clientName'] ?? ''),
        phone: String(body['clientPhone'] ?? '').replace(/\D/g, ''),
      });
      store.clients.set(client.id, client);

      const appt = scheduleAppointment(store, {
        id: `a_${Date.now().toString(36)}`,
        shopId: shop.id,
        clientId: client.id,
        barberId: String(body['barberId'] ?? ''),
        serviceId: String(body['serviceId'] ?? ''),
        startAt,
      });

      await Promise.all([dbUpsertClient(client), dbUpsertAppointment(appt)]);
      sendJson(res, 201, { appointmentId: appt.id, startAt: appt.startAt, endAt: appt.endAt });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJson(req);
      const login = String(body['login'] ?? '').trim();
      const password = String(body['password'] ?? '');

      if (verifyMasterCredentials(login, password)) {
        const token = signToken({ role: 'SUPER_ADMIN', shopId: 'MASTER', slug: 'master', login: 'Samuel22' });
        sendJson(res, 200, { role: 'SUPER_ADMIN', token });
        return;
      }

      const shop = findShopByLogin(store, login);
      if (!shop || !verifyPassword(password, shop.passwordHash)) {
        throw new DomainError('INVALID_CREDENTIALS', 'Login ou senha incorretos.');
      }
      if (!shop.active) {
        throw new DomainError('SHOP_INACTIVE', 'Esta barbearia foi desativada pelo administrador (Samuel22).');
      }

      const token = signToken({ role: 'SHOP_OWNER', shopId: shop.id, slug: shop.slug, login: shop.ownerLogin });
      sendJson(res, 200, {
        role: 'SHOP_OWNER',
        token,
        shop: { id: shop.id, slug: shop.slug, name: shop.name, ownerLogin: shop.ownerLogin },
      });
      return;
    }

    if (url.pathname.startsWith('/api/admin/')) {
      const session = requireAuth(req);
      assertSuperAdmin(session);

      if (req.method === 'GET' && url.pathname === '/api/admin/shops') {
        const allServices = Array.from(store.services.values());
        const allAppts = Array.from(store.appointments.values());
        const shops = Array.from(store.shops.values()).map(s => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          ownerLogin: s.ownerLogin,
          active: s.active,
          servicesCount: allServices.filter(srv => srv.shopId === s.id).length,
          appointmentsCount: allAppts.filter(a => a.shopId === s.id).length,
        }));
        sendJson(res, 200, { shops });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/admin/shops') {
        const body = await readJson(req);
        const slug = String(body['slug'] ?? '').trim().toLowerCase();
        const login = String(body['login'] ?? '').trim();

        if (findShopBySlug(store, slug)) throw new DomainError('SLUG_TAKEN', 'Este slug já está em uso por outra barbearia.');
        if (findShopByLogin(store, login) || login.toLowerCase() === 'samuel22') {
          throw new DomainError('LOGIN_TAKEN', 'Este login já está em uso.');
        }

        const shop = validateShop({
          id: `shop_${Date.now().toString(36)}`,
          slug,
          name: String(body['name'] ?? ''),
          ownerLogin: login,
          passwordHash: hashPassword(String(body['password'] ?? '')),
          active: true,
        });
        store.shops.set(shop.id, shop);

        const bDefault = validateBarber({ id: `b_${Date.now().toString(36)}`, shopId: shop.id, name: 'Alex — Barbeiro Mestre', commissionRateBps: 5000, active: true });
        const sDefault = validateService({
          id: `s_${Date.now().toString(36)}`,
          shopId: shop.id,
          name: 'Corte Clássico e Degradê',
          priceCents: 4500,
          durationMin: 35,
          imageUrl: makeServiceIconSvg('scissors', 'Corte'),
        });
        store.barbers.set(bDefault.id, bDefault);
        store.services.set(sDefault.id, sDefault);

        await dbUpsertShop(shop);
        await Promise.all([dbUpsertBarber(bDefault), dbUpsertService(sDefault)]);

        sendJson(res, 201, { shop: { id: shop.id, slug: shop.slug, name: shop.name, ownerLogin: shop.ownerLogin, active: shop.active } });
        return;
      }

      if (req.method === 'POST' && url.pathname.endsWith('/toggle')) {
        const shopId = url.pathname.split('/')[4] ?? '';
        const shop = store.shops.get(shopId);
        if (!shop) throw new DomainError('SHOP_NOT_FOUND', 'Barbearia não encontrada.');
        const updated = { ...shop, active: !shop.active };
        store.shops.set(shopId, updated);
        await dbUpsertShop(updated);
        sendJson(res, 200, { id: updated.id, active: updated.active });
        return;
      }
    }

    if (url.pathname.startsWith('/api/owner/')) {
      const session = requireAuth(req);
      const shop = store.shops.get(session.shopId);
      if (!shop || !shop.active) throw new DomainError('UNAUTHORIZED', 'Barbearia inativa ou inválida.');

      if (req.method === 'GET' && url.pathname === '/api/owner/state') {
        sendJson(res, 200, {
          shop: { id: shop.id, slug: shop.slug, name: shop.name, ownerLogin: shop.ownerLogin },
          clients: Array.from(store.clients.values()).filter(c => c.shopId === shop.id),
          barbers: Array.from(store.barbers.values()).filter(b => b.shopId === shop.id),
          services: Array.from(store.services.values()).filter(s => s.shopId === shop.id),
          appointments: Array.from(store.appointments.values()).filter(a => a.shopId === shop.id),
          ledger: store.ledger.filter(l => l.shopId === shop.id),
          summary: getFinancialSummary(store, shop.id),
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/owner/services') {
        const body = await readJson(req);
        const name = String(body['name'] ?? '').trim();
        const rawImage = String(body['imageUrl'] ?? '').trim();
        const srv = validateService({
          id: `s_${Date.now().toString(36)}`,
          shopId: shop.id,
          name,
          priceCents: Number(body['priceCents']),
          durationMin: Number(body['durationMin']),
          imageUrl: rawImage || makeServiceIconSvg('custom', name),
        });
        store.services.set(srv.id, srv);
        await dbUpsertService(srv);
        sendJson(res, 201, srv);
        return;
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/owner/services/')) {
        const srvId = url.pathname.split('/')[4] ?? '';
        const srv = store.services.get(srvId);
        if (!srv || srv.shopId !== shop.id) {
          throw new DomainError('TENANT_MISMATCH', 'Estilo de corte não encontrado nesta barbearia.');
        }
        store.services.delete(srvId);
        await dbDeleteService(srvId);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/owner/barbers') {
        const body = await readJson(req);
        const barber = validateBarber({
          id: `b_${Date.now().toString(36)}`,
          shopId: shop.id,
          name: String(body['name'] ?? ''),
          commissionRateBps: Number(body['commissionRateBps']),
          active: true,
        });
        store.barbers.set(barber.id, barber);
        await dbUpsertBarber(barber);
        sendJson(res, 201, barber);
        return;
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/owner/barbers/')) {
        const barberId = url.pathname.split('/')[4] ?? '';
        const barber = store.barbers.get(barberId);
        if (!barber || barber.shopId !== shop.id) {
          throw new DomainError('TENANT_MISMATCH', 'Barbeiro não encontrado nesta barbearia.');
        }
        store.barbers.delete(barberId);
        await dbDeleteBarber(barberId);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && url.pathname.endsWith('/complete')) {
        const apptId = url.pathname.split('/')[4] ?? '';
        const prevLedgerLen = store.ledger.length;
        completeAppointment(store, shop.id, apptId);
        const updatedAppt = store.appointments.get(apptId);
        const newEntries = store.ledger.slice(prevLedgerLen);
        if (updatedAppt) await dbUpsertAppointment(updatedAppt);
        for (const entry of newEntries) await dbInsertLedger(entry);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && url.pathname.endsWith('/cancel')) {
        const apptId = url.pathname.split('/')[4] ?? '';
        cancelAppointment(store, shop.id, apptId);
        const updatedAppt = store.appointments.get(apptId);
        if (updatedAppt) await dbUpsertAppointment(updatedAppt);
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    sendJson(res, 404, { error: `Rota não encontrada (${req.method ?? 'GET'} ${url.pathname})` });
  } catch (err) {
    if (err instanceof DomainError) {
      const status =
        err.code === 'UNAUTHORIZED' || err.code === 'SESSION_EXPIRED' || err.code === 'INVALID_CREDENTIALS'
          ? 401
          : err.code === 'FORBIDDEN_SUPER_ADMIN_ONLY'
            ? 403
            : 400;
      sendJson(res, status, { code: err.code, error: err.message });
      return;
    }
    sendJson(res, 500, { error: 'Erro interno do servidor' });
  }
};

let supabaseSynced = false;
const ensureSupabaseSynced = async () => {
  if (!isSupabaseConfigured()) return;
  supabaseSynced = await hydrateFromSupabase(store);
};

export default serverHandler;

if (!process.env['VERCEL']) {
  const PORT = Number(process.env['PORT'] ?? 3000);
  const server = http.createServer(serverHandler);
  server.listen(PORT, () => {
    console.log(`[BARBER-CORE SAAS] Servidor Full-Screen & Tabs ativo em http://localhost:${PORT}`);
  });
}
