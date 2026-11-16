import { useEffect, useRef, useState } from 'react';
import type { FormEvent, CSSProperties } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import Einlagerungsschein from './Einlagerungsschein';
import LagerUebersicht from './LagerUebersicht';
import ExcelImportExport from './ExcelImportExport';
import Historie from './Historie';
import Inventur from './Inventur';
import { Search, Warehouse, FileText, History, FileSpreadsheet, LayoutDashboard, LogOut, RefreshCw, Plus, ClipboardCheck, CarFront, CalendarDays, ExternalLink } from 'lucide-react';

const ADMIN_UID = '103ca84c-cb46-440f-a1df-b95c8b1b8e52';

// Parkplatz uses its own Supabase project. Only its public (publishable) key is used here.
const PARKING_URL = 'https://cydestwofhdfsmekwxho.supabase.co';
const PARKING_AUTH_CHECK_URL = `${PARKING_URL}/functions/v1/besico-parking-api`;
const PARKING_PUBLIC_KEY = 'sb_publishable_LNyn0n-rbQfu5AIMeAt9XQ_zqSpQ3Dh';
type ParkingCar = { id: number; branch_id: number | null; yard_status: string | null };
type ParkingBranch = { id: number; name: string };
async function parkingGet<T>(path: string): Promise<T> {
  const response = await fetch(`${PARKING_URL}/rest/v1/${path}`, {
    headers: { apikey: PARKING_PUBLIC_KEY, Authorization: `Bearer ${PARKING_PUBLIC_KEY}` },
  });
  if (!response.ok) throw new Error(`Parkplatz-Daten nicht verfügbar (HTTP ${response.status})`);
  return response.json() as Promise<T>;
}

// Read-only statistics from the existing Vorführwagenplaner (Cloudflare D1).
const VFW_DASHBOARD_URL = 'https://vfw-planer.jolly-fairy-7194.chatgpt.site/api/dashboard';
const VFW_AVAILABILITY_URL = 'https://vfw-planer.jolly-fairy-7194.chatgpt.site/api/availability';
const berlinToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type AvailableVehicle = { id: string | number; kennzeichen: string };
type VfwAvailability = { from: string; to: string; periodDays: number; availableCount: number; availableVehicles: AvailableVehicle[] };
async function getVfwAvailability(from?: string, to?: string): Promise<VfwAvailability> {
  const url = from && to ? `${VFW_AVAILABILITY_URL}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : VFW_AVAILABILITY_URL;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('Ungültige API-Antwort');
  const data = value as Partial<VfwAvailability>;
  if (typeof data.from !== 'string' || typeof data.to !== 'string' ||
      typeof data.availableCount !== 'number' || !Array.isArray(data.availableVehicles)) throw new Error('Ungültige Verfügbarkeitsdaten');
  return { from: data.from, to: data.to, periodDays: data.periodDays || 1, availableCount: data.availableCount,
    availableVehicles: data.availableVehicles.filter((vehicle): vehicle is AvailableVehicle =>
      !!vehicle && (typeof vehicle.id === 'string' || typeof vehicle.id === 'number') && typeof vehicle.kennzeichen === 'string') };
}
type VfwBooking = { kennzeichen: string; date: string; text: string };
type VfwDashboard = {
  date: string;
  totalVehicles: number;
  occupiedToday: number;
  availableToday: number;
  upcomingBookings: VfwBooking[];
};
async function getVfwDashboard(): Promise<VfwDashboard> {
  const response = await fetch(VFW_DASHBOARD_URL, { method: 'GET', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('Ungültige API-Antwort');
  const data = value as Partial<VfwDashboard>;
  if (typeof data.date !== 'string' ||
      typeof data.totalVehicles !== 'number' || !Number.isFinite(data.totalVehicles) ||
      typeof data.occupiedToday !== 'number' || !Number.isFinite(data.occupiedToday) ||
      typeof data.availableToday !== 'number' || !Number.isFinite(data.availableToday) ||
      !Array.isArray(data.upcomingBookings)) throw new Error('Ungültige Statistikdaten');
  return {
    date: data.date,
    totalVehicles: data.totalVehicles!,
    occupiedToday: data.occupiedToday!,
    availableToday: data.availableToday!,
    upcomingBookings: data.upcomingBookings.filter((booking): booking is VfwBooking =>
      !!booking && typeof booking.kennzeichen === 'string' && typeof booking.date === 'string' && typeof booking.text === 'string'),
  };
}

type RecordData = Record<string, unknown>;
type Radsatz = { id: string; kennzeichen: string | null; belegnummer: string | null; lager: string | null; lagerplatz: string | null; daten: RecordData | null; erstellt_am: string | null };
const menu = [
  { title: 'Dashboard', icon: LayoutDashboard },
  { title: 'Lagerplan', icon: Warehouse },
  { title: 'Parkplatz', icon: CarFront },
  { title: 'Vorführwagenplan', icon: CalendarDays },
  { title: 'Inventur', icon: ClipboardCheck },
  { title: 'Einlagerungsscheine', icon: FileText },
  { title: 'Historie', icon: History },
  { title: 'Excel Import / Export', icon: FileSpreadsheet },
];
const pageFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('qr')) return 'Einlagerungsscheine';
  const requested = params.get('page');
  return menu.some(item => item.title === requested) ? requested! : 'Dashboard';
};
const pageHref = (title: string) => `${import.meta.env.BASE_URL}?page=${encodeURIComponent(title)}`;

const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
// Ignore spaces, punctuation and letter case when searching plates and tyre sizes.
const normalizeSearch = (value: unknown): string => text(value).toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const card: CSSProperties = { background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16 };
const button: CSSProperties = { border: 0, background: '#12365a', color: '#fff', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontWeight: 700 };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [page, setPage] = useState(pageFromUrl);
  const [search, setSearch] = useState('');
  const [radsatzList, setRadsatzList] = useState<Radsatz[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');
  const [parkingCars, setParkingCars] = useState<ParkingCar[]>([]);
  const [parkingBranches, setParkingBranches] = useState<ParkingBranch[]>([]);
  const [parkingLoading, setParkingLoading] = useState(false);
  const [parkingError, setParkingError] = useState('');
  const [parkingAuthLoading, setParkingAuthLoading] = useState(false);
  const [parkingAuthResult, setParkingAuthResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [vfwData, setVfwData] = useState<VfwDashboard | null>(null);
  const [vfwLoading, setVfwLoading] = useState(false);
  const [vfwError, setVfwError] = useState('');
  const [vfwAvailability, setVfwAvailability] = useState<VfwAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityFrom, setAvailabilityFrom] = useState(berlinToday);
  const [availabilityTo, setAvailabilityTo] = useState(berlinToday);
  const parkingFrameRef = useRef<HTMLIFrameElement>(null);
  const [expandedFrame, setExpandedFrame] = useState<'Parkplatz' | 'Vorführwagenplan' | null>(null);
  const isAdmin = session?.user.id === ADMIN_UID;

  useEffect(() => {
    if (!expandedFrame) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpandedFrame(null); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [expandedFrame]);

  const frameSectionStyle = (name: 'Parkplatz' | 'Vorführwagenplan'): CSSProperties => expandedFrame === name
    ? { position: 'fixed', inset: 0, zIndex: 9999, background: '#f8fafc', padding: 16, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
    : { width: '100%' };
  const frameStyle = (name: 'Parkplatz' | 'Vorführwagenplan'): CSSProperties => expandedFrame === name
    ? { display: 'block', width: '100%', flex: 1, minHeight: 0, border: '1px solid #cbd5e1', borderRadius: 12, background: '#fff' }
    : { display: 'block', width: '100%', height: 'min(82vh, 1100px)', minHeight: 560, resize: 'both', overflow: 'auto', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 12, background: '#fff' };

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => { setSession(newSession); setLoading(false); });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const onPopState = () => { setPage(pageFromUrl()); setSearch(''); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!isAdmin) { setRadsatzList([]); setParkingCars([]); setParkingBranches([]); setVfwData(null); setVfwAvailability(null); return; }
    void loadRadsaetze();
    void loadParking();
    void loadVfw();
    void loadAvailability();
  }, [isAdmin]);

  async function loadRadsaetze() {
    setDataLoading(true); setDataError('');
    try {
      const all: Radsatz[] = [];
      // Supabase may limit a single response; fetch all pages for correct dashboard totals.
      for (let start = 0; ; start += 1000) {
        const { data, error } = await supabase.from('reifenlager_scheine')
          .select('id,kennzeichen,belegnummer,lager,lagerplatz,daten,erstellt_am')
          .order('erstellt_am', { ascending: false }).range(start, start + 999);
        if (error) throw error;
        const batch = (data || []) as Radsatz[];
        all.push(...batch);
        if (batch.length < 1000) break;
      }
      setRadsatzList(all);
    } catch (error) { setDataError('Fehler beim Laden: ' + (error instanceof Error ? error.message : String(error))); }
    finally { setDataLoading(false); }
  }

  async function loadParking() {
    setParkingLoading(true);
    setParkingError('');
    try {
      const branches = await parkingGet<ParkingBranch[]>('branches?select=id,name&order=id.asc');
      const allCars: ParkingCar[] = [];
      for (let start = 0; ; start += 1000) {
        const batch = await parkingGet<ParkingCar[]>(`cars?select=id,branch_id,yard_status&order=id.asc&offset=${start}&limit=1000`);
        allCars.push(...batch);
        if (batch.length < 1000) break;
      }
      setParkingBranches(branches);
      setParkingCars(allCars);
    } catch (error) {
      setParkingCars([]);
      setParkingBranches([]);
      setParkingError(error instanceof Error ? error.message : 'Parkplatz-Daten konnten nicht geladen werden.');
    } finally {
      setParkingLoading(false);
    }
  }

  // Same-origin iframe handshake: token stays in memory, never in URL or storage.
  useEffect(() => {
    const sendSession = () => {
      const frame = parkingFrameRef.current?.contentWindow;
      if (!frame) return;
      frame.postMessage({ type: 'BESICO_MANAGER_SESSION', token: session?.access_token ?? null }, window.location.origin);
    };
    const receiveReady = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== parkingFrameRef.current?.contentWindow) return;
      if (event.data?.type === 'BESICO_PARKING_READY') sendSession();
    };
    window.addEventListener('message', receiveReady);
    sendSession();
    return () => window.removeEventListener('message', receiveReady);
  }, [session?.access_token, page]);

  async function checkParkingAdminAccess() {
    setParkingAuthLoading(true);
    setParkingAuthResult(null);
    try {
      // The Manager session may belong to a different Supabase Auth project.
      // Never store, display or log the access token.
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) {
        setParkingAuthResult({ ok: false, message: 'Keine gültige BESICO-Manager-Sitzung gefunden.' });
        return;
      }
      const response = await fetch(PARKING_AUTH_CHECK_URL, {
        method: 'POST',
        headers: {
          apikey: PARKING_PUBLIC_KEY,
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const result: unknown = await response.json().catch(() => null);
      const payload = result && typeof result === 'object' ? result as Record<string, unknown> : {};
      const authorized = response.ok && payload.authorized === true;
      const reason = typeof payload.error === 'string' ? payload.error : '';
      setParkingAuthResult(authorized
        ? { ok: true, message: 'Administratorzugang bestätigt. Die API akzeptiert diese Sitzung.' }
        : { ok: false, message: `Zugriff nicht bestätigt (HTTP ${response.status})${reason ? `: ${reason}` : ''}. Manager und Parkplatz können unterschiedliche Anmeldesysteme verwenden.` });
    } catch {
      setParkingAuthResult({ ok: false, message: 'Verbindung zur Parkplatz-API fehlgeschlagen. Bitte CORS-Einstellungen und Erreichbarkeit der Edge Function prüfen.' });
    } finally {
      setParkingAuthLoading(false);
    }
  }

  async function loadVfw() {
    setVfwLoading(true);
    setVfwError('');
    try {
      setVfwData(await getVfwDashboard());
    } catch (error) {
      setVfwData(null);
      setVfwError(error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setVfwLoading(false);
    }
  }

  async function loadAvailability(from?: string, to?: string) {
    setAvailabilityLoading(true);
    setAvailabilityError('');
    try {
      setVfwAvailability(await getVfwAvailability(from, to));
    } catch (error) {
      setVfwAvailability(null);
      setAvailabilityError(error instanceof Error ? error.message : 'Unbekannter Fehler');
    } finally {
      setAvailabilityLoading(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSigningIn(true); setLoginError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setLoginError('Anmeldung fehlgeschlagen. E-Mail und Passwort prüfen.');
    setSigningIn(false);
  }
  async function handleLogout() {
    await supabase.auth.signOut(); setSession(null); setPassword(''); setPage('Dashboard');
  }
  function navigate(target: string) {
    window.history.pushState({}, '', pageHref(target));
    setPage(target); setSearch('');
    if (target === 'Dashboard') { void loadRadsaetze(); void loadParking(); void loadVfw(); void loadAvailability(); }
  }
  function openSchein(id: string) {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}?qr=${encodeURIComponent(id)}`;
    window.location.assign(url);
  }

  const query = normalizeSearch(search);
  const filtered = query ? radsatzList.filter(r => {
    const d = r.daten || {};
    const values = [r.kennzeichen, r.belegnummer, r.lager, r.lagerplatz,
      d.fahrzeug, d.vin, d.fin, d.fahrgestellnummer, d.kundenname,
      d.reifengroesse, d.reifenmarke, d.reifenbezeichnung, d.saison,
      d.bemerkung, d.fahrzeugstandort, d.auto, d.marke, d.modell,
      ...Object.values(d).filter(v => typeof v === 'string' || typeof v === 'number')];
    // Match inside each value so '235 55' matches '235/55 R19', and
    // 'GC-S 120' matches 'GC-S120', without merging unrelated fields.
    return values.some(value => normalizeSearch(value).includes(query));
  }) : [];
  const assigned = radsatzList.filter(r => (r.lager === 'Zelt' || r.lager === 'Lager') && !!text(r.lagerplatz));
  const zelt = assigned.filter(r => r.lager === 'Zelt').length;
  const lager = assigned.filter(r => r.lager === 'Lager').length;
  const activeParkingCars = parkingCars.filter(car => (car.yard_status || 'on_site') === 'on_site');
  const parkingByBranch = parkingBranches.map(branch => ({
    ...branch,
    count: activeParkingCars.filter(car => Number(car.branch_id ?? 1) === Number(branch.id)).length,
  })).filter(branch => branch.count > 0);
  const parkingUnknown = activeParkingCars.filter(car =>
    !parkingBranches.some(branch => Number(branch.id) === Number(car.branch_id ?? 1))).length;
  const stats = [
    ['Radsätze gesamt', radsatzList.length],
    ['Im Lager', assigned.length],
    ['Zelt', zelt],
    ['Lager', lager],
    ['Nicht zugeordnet', radsatzList.length - assigned.length],
  ] as const;

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>BESICO Reifenlager wird geladen...</div>;
  if (!isAdmin) return <div className="app">
    <header className="header"><div className="brand"><span className="brand-symbol">B</span><div><strong>BESICO</strong><small>REIFENLAGER</small></div></div><span className="header-label">Lagerverwaltung</span></header>
    <main style={{ minHeight: '75vh', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <form onSubmit={handleLogin} style={{ ...card, width: '100%', maxWidth: 400, padding: 30 }}>
        <h1>Anmeldung</h1><p>Bitte mit Ihrem Administratorkonto anmelden.</p>
        {session && <p style={{ color: '#b91c1c' }}>Dieses Konto hat keinen Administratorzugang.</p>}
        <label htmlFor="email">E-Mail</label><input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" style={{ width: '100%', boxSizing: 'border-box', padding: 12, margin: '8px 0 18px' }} />
        <label htmlFor="password">Passwort</label><input id="password" type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" style={{ width: '100%', boxSizing: 'border-box', padding: 12, margin: '8px 0 18px' }} />
        {loginError && <p role="alert" style={{ color: '#b91c1c' }}>{loginError}</p>}
        <button type="submit" disabled={signingIn || !!session} style={button}>{signingIn ? 'Bitte warten...' : 'Anmelden'}</button>
        {session && <button type="button" onClick={() => void handleLogout()} style={{ marginLeft: 12 }}>Anderes Konto</button>}
      </form>
    </main>
  </div>;

  return <div className="app">
    <header className="header"><div className="brand"><span className="brand-symbol">B</span><div><strong>BESICO</strong><small>REIFENLAGER</small></div></div><span className="header-label">Lagerverwaltung</span>
      <button onClick={() => void handleLogout()} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 8, border: '1px solid #94a3b8', background: 'transparent', color: 'inherit', cursor: 'pointer' }}><LogOut size={18} /> Abmelden</button>
    </header>
    <div className="layout">
      <aside className="sidebar">{menu.map(({ title, icon: Icon }) => <a key={title} href={pageHref(title)} className={'nav-item' + (page === title ? ' active' : '')} aria-current={page === title ? 'page' : undefined} onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(title); }} style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit', display: 'flex' }}><Icon size={20} /><span>{title}</span></a>)}</aside>
      <main className="content">
        {page === 'Dashboard' && <>
          <div className="welcome"><h1>BESICO Manager</h1><p>Reifenlager, Parkplatz und Vorführwagenplan an einem Ort</p></div>
          <div className="search-box"><Search size={24} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kennzeichen, FIN, Fahrzeug, Reifen oder Lagerplatz suchen..." /></div>
          <div className="quick-actions">
            <div className="action-card" onClick={() => navigate('Einlagerungsscheine')} style={{ cursor: 'pointer' }}><Plus size={28} /><strong>Neuer Radsatz</strong></div>
            <div className="action-card" onClick={() => { void loadRadsaetze(); void loadParking(); void loadVfw(); void loadAvailability(); }} style={{ cursor: 'pointer' }}><RefreshCw size={28} /><strong>Aktualisieren</strong></div>
          </div>
          <h2>Bereiche</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 235px), 1fr))', gap: 14, marginBottom: 26 }}>
            <button type="button" onClick={() => navigate('Lagerplan')} style={{ ...card, textAlign: 'left', cursor: 'pointer', color: '#12365a', display: 'grid', gap: 10 }}>
              <Warehouse size={26} /><strong style={{ fontSize: 17 }}>Reifenlager</strong>
              <span style={{ fontSize: 28, fontWeight: 800 }}>{dataLoading ? '…' : radsatzList.length} <span style={{ fontSize: 13, fontWeight: 400 }}>Radsätze</span></span>
              <span style={{ color: '#64748b', fontSize: 13 }}>Zelt: {zelt} · Lager: {lager}</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Lagerplan öffnen →</span>
            </button>
            <button type="button" onClick={() => navigate('Parkplatz')} style={{ ...card, textAlign: 'left', cursor: 'pointer', color: '#12365a', display: 'grid', gap: 10 }}>
              <CarFront size={26} /><strong style={{ fontSize: 17 }}>Parkplatz</strong>
              <span style={{ fontSize: 15 }}>{parkingLoading ? 'Fahrzeuge werden geladen…' : parkingError ? 'Fahrzeugkarte' : `${activeParkingCars.length} Fahrzeuge`}</span>
              <span style={{ color: '#64748b', fontSize: 13 }}>Fahrzeuge, Positionen und Status in der bestehenden Parkplatz-Anwendung</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Parkplatz öffnen →</span>
            </button>
            <button type="button" onClick={() => navigate('Vorführwagenplan')} style={{ ...card, textAlign: 'left', cursor: 'pointer', color: '#12365a', display: 'grid', gap: 10 }}>
              <CalendarDays size={26} /><strong style={{ fontSize: 17 }}>Vorführwagenplan</strong>
              <span style={{ fontSize: 15 }}>{vfwLoading ? 'Daten werden geladen…' : vfwData ? `${vfwData.totalVehicles} Fahrzeuge · ${vfwData.occupiedToday} heute belegt` : 'Fahrzeuge & Buchungen'}</span>
              <span style={{ color: '#64748b', fontSize: 13 }}>Bestehenden Planer öffnen – ohne Datenübertragung</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Plan öffnen →</span>
            </button>
            <button type="button" onClick={() => navigate('Inventur')} style={{ ...card, textAlign: 'left', cursor: 'pointer', color: '#12365a', display: 'grid', gap: 10 }}>
              <ClipboardCheck size={26} /><strong style={{ fontSize: 17 }}>Inventur</strong>
              <span style={{ fontSize: 15 }}>Prüfung der Radsätze</span>
              <span style={{ color: '#64748b', fontSize: 13 }}>Geprüfte und nicht geprüfte Radsätze im Inventur-Bereich ansehen</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Inventur öffnen →</span>
            </button>
          </div>
          <h2>Reifenlager · Übersicht</h2>
          <div className="stats">{stats.map(([name, count]) => <div className="stat-card" key={name}><span>{name}</span><strong>{dataLoading ? '...' : count}</strong></div>)}</div>
          {dataError && <p role="alert" style={{ color: '#b91c1c' }}>{dataError}</p>}
           <h2>Parkplatz · Übersicht</h2>
           {parkingLoading && <p>Parkplatz-Daten werden geladen...</p>}
           {parkingError && <p role="alert" style={{ color: '#b91c1c' }}>{parkingError}. Bitte den öffentlichen Lesezugriff (RLS) für die Parkplatz-Tabellen prüfen.</p>}
           {!parkingLoading && !parkingError && <div className="stats">
             <div className="stat-card"><span>Fahrzeuge gesamt</span><strong>{activeParkingCars.length}</strong></div>
             {parkingByBranch.map(branch => <div className="stat-card" key={branch.id}>
               <span>{Number(branch.id) === 1 ? 'Glauchau' : branch.name}</span><strong>{branch.count}</strong>
             </div>)}
             {parkingUnknown > 0 && <div className="stat-card"><span>Standort nicht zugeordnet</span><strong>{parkingUnknown}</strong></div>}
           </div>}

           <h2>Vorführwagenplan · Übersicht</h2>
           {vfwLoading && <p>Vorführwagen-Daten werden geladen...</p>}
           {vfwError && <p role="alert" style={{ color: '#b91c1c' }}>Vorführwagen-Statistik nicht verfügbar ({vfwError}). Der bestehende Planer funktioniert unabhängig davon weiter.</p>}
           {!vfwLoading && vfwData && <div className="stats">
             <div className="stat-card"><span>Vorführwagen gesamt</span><strong>{vfwData.totalVehicles}</strong></div>
             <div className="stat-card"><span>Heute belegt</span><strong>{vfwData.occupiedToday}</strong></div>
             <div className="stat-card"><span>Heute frei</span><strong>{vfwData.availableToday}</strong></div>
           </div>}
           <section style={{ ...card, marginTop: 18, marginBottom: 24 }}>
             <h3 style={{ margin: '0 0 8px', color: '#12365a' }}>Freie Vorführwagen</h3>
             <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 16px' }}>Heute freie Fahrzeuge anzeigen oder einen Zeitraum auswählen. Ein Fahrzeug ist nur frei, wenn es an allen ausgewählten Tagen verfügbar ist.</p>
             <form onSubmit={event => { event.preventDefault(); if (availabilityFrom && availabilityTo && availabilityFrom <= availabilityTo) void loadAvailability(availabilityFrom, availabilityTo); }} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12, marginBottom: 16 }}>
               <label style={{ display: 'grid', gap: 5, fontWeight: 600, fontSize: 13 }}>Von
                 <input type="date" required value={availabilityFrom} onChange={event => { setAvailabilityFrom(event.target.value); if (availabilityTo < event.target.value) setAvailabilityTo(event.target.value); }} style={{ padding: 9, borderRadius: 8, border: '1px solid #cbd5e1' }} />
               </label>
               <label style={{ display: 'grid', gap: 5, fontWeight: 600, fontSize: 13 }}>Bis
                 <input type="date" required min={availabilityFrom} value={availabilityTo} onChange={event => setAvailabilityTo(event.target.value)} style={{ padding: 9, borderRadius: 8, border: '1px solid #cbd5e1' }} />
               </label>
               <button type="submit" disabled={availabilityLoading || !availabilityFrom || !availabilityTo || availabilityFrom > availabilityTo} style={{ ...button, opacity: availabilityLoading ? 0.6 : 1 }}>{availabilityLoading ? 'Wird geprüft…' : 'Verfügbarkeit prüfen'}</button>
               <button type="button" disabled={availabilityLoading} onClick={() => { const today = berlinToday(); setAvailabilityFrom(today); setAvailabilityTo(today); void loadAvailability(); }} style={{ ...button, background: '#e2e8f0', color: '#12365a' }}>Heute</button>
             </form>
             {availabilityError && <p role="alert" style={{ color: '#b91c1c' }}>Verfügbarkeit konnte nicht geladen werden ({availabilityError}).</p>}
             {availabilityLoading && <p>Freie Fahrzeuge werden geladen…</p>}
             {!availabilityLoading && vfwAvailability && <>
               <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
                 <strong style={{ color: '#12365a', fontSize: 17 }}>Freie Fahrzeuge: {vfwAvailability.availableCount}</strong>
                 <span style={{ color: '#64748b', fontSize: 13 }}>{vfwAvailability.from === vfwAvailability.to ? `Am ${vfwAvailability.from}` : `${vfwAvailability.from} – ${vfwAvailability.to}`}</span>
               </div>
               {vfwAvailability.availableVehicles.length === 0 ? <p>Keine Fahrzeuge im ausgewählten Zeitraum frei.</p> :
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 10 }}>
                   {vfwAvailability.availableVehicles.map(vehicle => <div key={vehicle.id} style={{ border: '1px solid #dbe3ee', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                     <strong style={{ color: '#12365a' }}>{vehicle.kennzeichen}</strong>
                     <span style={{ borderRadius: 999, padding: '4px 9px', background: '#dcfce7', color: '#166534', fontSize: 12, fontWeight: 700 }}>Frei</span>
                   </div>)}
                 </div>}
             </>}
             <button type="button" onClick={() => navigate('Vorführwagenplan')} style={{ ...button, marginTop: 16, background: '#e2e8f0', color: '#12365a' }}>Vorführwagenplan öffnen →</button>
           </section>

          {!!query && <section style={{ marginTop: 24 }}><h2>Suchergebnisse Radsätze ({filtered.length})</h2>
            {dataLoading && <p>Radsätze werden geladen...</p>}
            {!dataLoading && filtered.length === 0 && <p>Keine Radsätze gefunden.</p>}
            <div style={{ display: 'grid', gap: 10 }}>{filtered.map(r => {
              const d = r.daten || {};
              const location = r.lager && r.lagerplatz ? `${r.lager} · ${r.lagerplatz}` : 'Nicht zugeordnet';
              return <div key={r.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><strong>{r.kennzeichen || 'Ohne Kennzeichen'}</strong><span style={{ color: '#9a3412' }}>{location}</span></div>
                <p style={{ margin: '8px 0', color: '#475569' }}>{[text(d.fahrzeug), text(d.saison), text(d.reifengroesse), text(d.reifenmarke)].filter(Boolean).join(' · ') || text(r.belegnummer)}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" style={button} onClick={() => openSchein(r.id)}>Schein / QR öffnen</button>
                  <button type="button" style={{ ...button, background: '#e2e8f0', color: '#12365a' }} onClick={() => navigate('Lagerplan')}>Lagerplan öffnen</button>
                </div>
              </div>;
            })}</div>
          </section>}
        </>}
        {page === 'Lagerplan' && <LagerUebersicht view="Lagerplan" />}
        {page === 'Parkplatz' && <section style={frameSectionStyle('Parkplatz')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div><h1 style={{ margin: '0 0 6px' }}>Parkplatz</h1><p style={{ margin: 0, color: '#64748b' }}>Originale Fahrzeugkarte mit unveränderten Positionen und Bildern. Die Anmeldung erfolgt automatisch über BESICO Manager.</p></div>
            <button type="button" onClick={() => setExpandedFrame(expandedFrame === 'Parkplatz' ? null : 'Parkplatz')} style={{ ...button, marginLeft: 'auto' }}>{expandedFrame === 'Parkplatz' ? 'Vollbild schließen' : 'Vollbild'}</button>
            <a href={`${import.meta.env.BASE_URL}parking/index.html`} target="_blank" rel="noopener noreferrer" style={{ ...button, textDecoration: 'none', display: 'inline-flex', gap: 8, alignItems: 'center' }}><ExternalLink size={16} /> In neuem Fenster öffnen</a>
          </div>
        
          <iframe ref={parkingFrameRef} title="BESICO Parkplatz" src={`${import.meta.env.BASE_URL}parking/index.html`} style={frameStyle('Parkplatz')} />
        </section>}

        {page === 'Vorführwagenplan' && <section style={frameSectionStyle('Vorführwagenplan')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <h1 style={{ margin: '0 0 6px' }}>Vorführwagenplan</h1>
              <p style={{ margin: 0, color: '#64748b' }}>Bestehender Vorführwagenplan mit unveränderten Fahrzeugen und Buchungen. Die Anmeldung erfolgt gegebenenfalls separat.</p>
            </div>
            <button type="button" onClick={() => setExpandedFrame(expandedFrame === 'Vorführwagenplan' ? null : 'Vorführwagenplan')} style={{ ...button, marginLeft: 'auto' }}>{expandedFrame === 'Vorführwagenplan' ? 'Vollbild schließen' : 'Vollbild'}</button>
            <a href="https://vfw-planer.jolly-fairy-7194.chatgpt.site/" target="_blank" rel="noopener noreferrer" style={{ ...button, textDecoration: 'none', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <ExternalLink size={16} /> In neuem Fenster öffnen
            </a>
          </div>
          <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 12px' }}>Falls der Planer hier nicht angezeigt wird, bitte „In neuem Fenster öffnen“ verwenden. Manche Websites erlauben keine Einbettung.</p>
          <iframe title="BESICO Vorführwagenplan" src="https://vfw-planer.jolly-fairy-7194.chatgpt.site/" referrerPolicy="strict-origin-when-cross-origin" style={frameStyle('Vorführwagenplan')} />
        </section>}

        {page === 'Inventur' && <Inventur />}
        {page === 'Einlagerungsscheine' && <Einlagerungsschein />}
        {page === 'Excel Import / Export' && <ExcelImportExport />}
        {page === 'Historie' && <Historie />}
      </main>
    </div>
  </div>;
}
