import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";
import Upload    from "./components/Upload";
import TripViewer from "./components/TripViewer";
import Dashboard  from "./components/Dashboard";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const PORTAL_HOME_URL = "https://evaluacion-proyectos.vercel.app";
const TABS = ["Dashboard", "Viajes", "Upload"];

// ─── ESTILOS ──────────────────────────────────────────────────────────────────
// FIX UX/PERF: CSS movido a string estático fuera del componente.
// Ya no se re-parsea en cada render. Queda pendiente migrar a archivo .css externo.
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#213363;--blue:#235C96;--mid:#6381A7;--light:#A5B5CC;
  --bg:#EEF2F7;--surface:#FFFFFF;--border:#D6E0ED;
  --text:#213363;--muted:#6381A7;
  --sans:'Montserrat',sans-serif;--mono:'DM Mono',monospace;
}
body{font-family:var(--sans);background:var(--bg);color:var(--text);min-height:100vh}

/* ── Login ── */
.lw{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f1d4a,#1a2a5e,#213363);padding:20px}
.lc{background:#fff;border-radius:16px;padding:40px;width:100%;max-width:400px;box-shadow:0 20px 60px rgba(0,0,0,.3)}
.li{width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#dbeafe,#eff6ff);border:1.5px solid #93c5fd;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 14px}
.lt{text-align:center;font-size:17px;font-weight:700;color:var(--navy);margin-bottom:2px}
.ls{text-align:center;font-size:11px;color:var(--muted);margin-bottom:24px;font-family:var(--mono);letter-spacing:.5px}
.lfg{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
.lfg label{font-size:10px;color:var(--navy);letter-spacing:.5px;text-transform:uppercase;font-weight:600}
.lfg input{border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:13px;font-family:var(--sans);outline:none;transition:border-color .15s}
.lfg input:focus{border-color:var(--blue)}
.lb{width:100%;padding:11px;background:var(--blue);color:#fff;border:none;border-radius:8px;font-family:var(--sans);font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;margin-top:4px}
.lb:hover{background:var(--navy)}
.lb:disabled{opacity:.6;cursor:not-allowed}
.le{background:#FEE2E2;color:#991B1B;border:1px solid #FECACA;border-radius:8px;padding:10px 14px;font-size:12px;margin-bottom:12px}
.lf{text-align:center;font-size:10px;color:var(--muted);margin-top:18px;font-family:var(--mono)}
.lbk{font-size:11px;color:var(--muted);font-family:var(--mono);margin-bottom:18px;cursor:pointer;border:none;background:none;padding:0;display:block}
.lbk:hover{color:var(--navy)}

/* ── Shell ── */
.shell{display:flex;min-height:100vh}
.sb{width:224px;min-height:100vh;background:var(--navy);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;flex-shrink:0}
.sb-brand{padding:18px 14px 14px;border-bottom:1px solid rgba(255,255,255,.08)}
.sb-icon{width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:16px;margin-bottom:8px}
.sb-name{font-size:11px;font-weight:700;color:#fff;letter-spacing:.8px;text-transform:uppercase;line-height:1.3}
.sb-sub{font-size:9px;color:rgba(255,255,255,.3);font-family:var(--mono);margin-top:2px}
.sb-nav{flex:1;padding:8px}
.sb-sec{font-family:var(--mono);font-size:8px;letter-spacing:2px;color:rgba(255,255,255,.25);text-transform:uppercase;padding:14px 8px 5px}
.sb-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;transition:background .15s;margin-bottom:2px;border:none;background:none;width:100%;text-align:left;font-family:var(--sans)}
.sb-item:hover{background:rgba(255,255,255,.07)}
.sb-item.active{background:rgba(255,255,255,.13)}
.sb-item-dot{font-size:14px;width:18px;text-align:center;flex-shrink:0}
.sb-item-lbl{font-size:12px;font-weight:500;color:rgba(255,255,255,.65);flex:1}
.sb-item.active .sb-item-lbl{color:#fff;font-weight:600}
.sb-footer{padding:12px 14px;border-top:1px solid rgba(255,255,255,.08)}
.sb-email{font-size:9px;color:rgba(255,255,255,.22);font-family:var(--mono);margin-bottom:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-back{width:100%;padding:6px;border-radius:6px;background:transparent;border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.3);font-family:var(--mono);font-size:9px;cursor:pointer;transition:all .15s;text-align:center;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px}
.sb-back:hover{color:rgba(255,255,255,.55);border-color:rgba(255,255,255,.2)}
.sb-logout{width:100%;padding:7px;border-radius:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.42);font-family:var(--sans);font-size:10px;font-weight:600;cursor:pointer;transition:all .15s}
.sb-logout:hover{background:rgba(255,255,255,.12);color:#fff}
.sb-logout:disabled{opacity:.4;cursor:not-allowed}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.topbar{height:52px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 28px;position:sticky;top:0;z-index:5;gap:8px;flex-shrink:0}
.topbar-title{font-size:14px;font-weight:700;color:var(--navy)}
.topbar-sep{color:var(--border);font-size:16px}
.topbar-sub{font-size:11px;color:var(--muted)}
.topbar-file{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--muted);background:#EEF2F7;padding:3px 10px;border-radius:5px}
.topbar-incomplete{background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;border-radius:5px;font-family:var(--mono);font-size:9px;padding:3px 8px;margin-left:6px}
.page-body{flex:1;background:var(--bg)}

/* ── Estados de carga ── */
.loading{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--navy)}
.loading-txt{font-family:var(--mono);font-size:11px;color:rgba(255,255,255,.4);letter-spacing:2px;text-transform:uppercase}

/* ── Sin datos ── */
.no-file{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;text-align:center;padding:40px}
.no-file-icon{font-size:48px;margin-bottom:14px;opacity:.35}
.no-file-title{font-size:18px;font-weight:700;color:var(--navy);margin-bottom:8px}
.no-file-desc{font-size:12px;color:var(--muted);max-width:380px;line-height:1.7}
.go-btn{margin-top:16px;padding:9px 20px;border-radius:8px;background:var(--blue);color:#fff;border:none;font-family:var(--sans);font-size:12px;font-weight:600;cursor:pointer}
.go-btn:hover{background:var(--navy)}

/* ── Lista de viajes ── */
.trips-row{display:grid;grid-template-columns:36px 130px 1fr 55px 65px 65px 90px;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #EEF2F7;cursor:pointer;transition:background .12s;font-size:12px}
.trips-row:last-child{border-bottom:none}
.trips-row.validated{background:#F0FFF4}
.trips-row.incomplete-trip{background:#FFFBEB}
.trips-row:hover{background:#F8FAFC}
.trips-row.validated:hover{background:#E8FFF2}
.trips-row.incomplete-trip:hover{background:#FEF3C7}

/* ── Badges ── */
.badge-ok{font-family:var(--mono);font-size:8px;padding:2px 7px;border-radius:3px;background:#D1FAE5;color:#065F46;text-align:center}
.badge-pending{font-family:var(--mono);font-size:8px;padding:2px 7px;border-radius:3px;background:#F3F4F6;color:#6B7280;text-align:center}
.badge-incomplete{font-family:var(--mono);font-size:8px;padding:2px 7px;border-radius:3px;background:#FEF3C7;color:#92400E;text-align:center}

/* ── Responsive ── */
@media(max-width:768px){.sb{width:200px}.topbar{padding:0 16px}}
@media(max-width:600px){
  .shell{flex-direction:column}
  .sb{width:100%;height:auto;min-height:auto;position:relative}
  .sb-nav{display:flex;flex-wrap:wrap;padding:6px}
  .sb-sec{display:none}
  .sb-item{width:auto;flex:none;padding:6px 10px}
  .sb-footer{display:flex;flex-direction:row;gap:8px;align-items:center;padding:8px 12px}
  .sb-email,.sb-back{display:none}
  .sb-logout{width:auto;padding:5px 12px}
  .trips-row{grid-template-columns:32px 110px 1fr 45px 60px 60px 80px;font-size:11px}
}
`;

// ─── HELPERS DE FORMATO ───────────────────────────────────────────────────────
/**
 * FIX UX: formato de fecha/hora siempre en 24h y con separación clara entre
 * fecha y hora. Usa componentes UTC para consistencia con datos AIS.
 * Ejemplo: "21/11/24" + "06:37" (nunca "6:37 AM" ni "6:37" sin contexto)
 */
function fmtDate(dt) {
  if (!dt) return "—";
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function fmtTime(dt) {
  if (!dt) return "—";
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return "—";
  const hh  = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

// ─── CARGA DE DATOS DESDE SUPABASE ───────────────────────────────────────────
/**
 * FIX CRÍTICO PERFORMANCE: reemplaza N+1 queries por 2 queries en total.
 * Antes: 1 query trips + 1 query por cada viaje para puntos = O(n) queries.
 * Ahora: 1 query trips + 1 query todos los puntos del upload = O(1) queries.
 * Con 50 viajes y latencia 200ms: de ~10 segundos a ~0.4 segundos.
 */
async function loadUploadFromSupabase(uploadRecord) {
  // Query 1: todos los viajes del upload
  const { data: tripRows, error: trErr } = await supabase
    .from("ais_trips")
    .select("*")
    .eq("upload_id", uploadRecord.id)
    .order("trip_num");

  if (trErr) throw new Error("Error cargando viajes: " + trErr.message);
  if (!tripRows || tripRows.length === 0) {
    return { uploadId: uploadRecord.id, filename: uploadRecord.filename, trips: [], loadedAt: new Date() };
  }

  // Query 2: todos los puntos de todos los viajes en una sola query
  const tripIds = tripRows.map(t => t.id);
  const { data: allPoints, error: ptErr } = await supabase
    .from("ais_points")
    .select("*")
    .in("trip_id", tripIds)
    .order("datetime");

  if (ptErr) throw new Error("Error cargando puntos: " + ptErr.message);

  // Agrupar puntos por trip_id en el cliente
  const pointsByTrip = {};
  for (const p of (allPoints || [])) {
    if (!pointsByTrip[p.trip_id]) pointsByTrip[p.trip_id] = [];
    pointsByTrip[p.trip_id].push({
      datetime:      new Date(p.datetime),
      lat:           p.lat,
      lon:           p.lon,
      sog:           p.sog,
      zone:          p.zone,
      state:         p.state,
      tipo_servicio: p.tipo_servicio,
      zona_servicio: p.zona_servicio,
    });
  }

  const trips = tripRows.map(tr => ({
    id:            tr.trip_num,
    supabaseId:    tr.id,
    dateStart:     new Date(tr.date_start),
    dateDeparture: new Date(tr.date_departure || tr.date_start),
    dateEnd:       new Date(tr.date_end),
    durationHs:    tr.duration_hs,
    navHs:         tr.nav_hs ?? tr.duration_hs,  // compatibilidad con registros viejos
    distNm:        tr.dist_nm,
    nServices:     tr.n_services,
    zones:         tr.zones || [],
    validated:     tr.validated,
    incomplete:    tr.incomplete || false,
    points:        pointsByTrip[tr.id] || [],
  }));

  return {
    uploadId:  uploadRecord.id,
    filename:  uploadRecord.filename,
    trips,
    loadedAt:  new Date(),
  };
}

// ─── HELPERS DE UPLOADS ───────────────────────────────────────────────────────
// FIX MEDIO: extraído como función para evitar duplicación y manejar errores
async function fetchUploads() {
  const { data, error } = await supabase
    .from("ais_uploads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[App] Error cargando lista de uploads:", error.message);
    return null; // null indica fallo, distinto de [] que indica lista vacía
  }
  return data || [];
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage() {
  const [email, setEmail] = useState("");
  const [pwd,   setPwd]   = useState("");
  const [err,   setErr]   = useState("");
  const [busy,  setBusy]  = useState(false);

  // FIX ALTO: setBusy(false) siempre en finally — antes podía quedar en true
  // si signInWithPassword lanzaba una excepción no capturada.
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
      if (error) setErr("Email o contraseña incorrectos.");
    } catch (ex) {
      setErr("Error de conexión. Intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lw">
      <div className="lc">
        <button className="lbk" onClick={() => window.location.href = PORTAL_HOME_URL}>
          ← Evaluación de Proyectos
        </button>
        <div className="li">📡</div>
        <div className="lt">AIS Analyzer</div>
        <div className="ls">Grupo Marítimo · Análisis AIS</div>
        {err && <div className="le" role="alert">{err}</div>}
        <form onSubmit={submit}>
          <div className="lfg">
            <label htmlFor="ais-email">Email</label>
            <input
              id="ais-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              autoFocus
              autoComplete="email"
            />
          </div>
          <div className="lfg">
            <label htmlFor="ais-pwd">Contraseña</label>
            <input
              id="ais-pwd"
              type="password"
              value={pwd}
              onChange={e => setPwd(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="lb" disabled={busy}>
            {busy ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
        <div className="lf">© {new Date().getFullYear()} Grupo Marítimo · Acceso restringido</div>
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const [session,         setSession]         = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [tab,             setTab]             = useState("Dashboard");
  const [aisData,         setAisData]         = useState(null);
  const [trips,           setTrips]           = useState([]);

  // FIX ALTO: viewing guarda el trip.id (no el índice de array).
  // Antes: setViewing(i) → si el array cambia, i apunta a otro viaje.
  // Ahora: setViewing(trip.id) → siempre identifica el viaje correcto.
  const [viewingTripId,   setViewingTripId]   = useState(null);

  const [existingUploads, setExistingUploads] = useState([]);
  const [uploadsError,    setUploadsError]    = useState(null);
  const [loadingUpload,   setLoadingUpload]   = useState(false);
  const [logoutBusy,      setLogoutBusy]      = useState(false);

  // ── Auth ──
  // FIX: onAuthStateChange solo setea session, nunca setLoading (patrón INTEGRA).
  // setLoading(false) solo lo hace getSession en el .then() inicial.
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (mounted) { setSession(s); setLoading(false); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (mounted) setSession(s);
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // ── Cargar lista de uploads cuando hay sesión ──
  // FIX MEDIO: manejo de error en carga de uploads
  const refreshUploads = useCallback(async () => {
    const data = await fetchUploads();
    if (data === null) {
      setUploadsError("No se pudo cargar la lista de archivos anteriores.");
    } else {
      setExistingUploads(data);
      setUploadsError(null);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshUploads();
  }, [session, refreshUploads]);

  // ── Handlers ──
  const handleLoad = useCallback((data) => {
    setAisData(data);
    setTrips(data.trips);
    setTab("Dashboard");
    setViewingTripId(null);
    refreshUploads(); // fire-and-forget con manejo de error interno
  }, [refreshUploads]);

  const handleSelectUpload = useCallback(async (uploadRecord) => {
    setLoadingUpload(true);
    try {
      const data = await loadUploadFromSupabase(uploadRecord);
      setAisData(data);
      setTrips(data.trips);
      setTab("Dashboard");
      setViewingTripId(null);
    } catch (e) {
      // FIX UX: mensaje de error descriptivo en lugar de alert() genérico
      alert("Error cargando datos: " + e.message);
    } finally {
      setLoadingUpload(false);
    }
  }, []);

  const handleTripsUpdate = useCallback((newTrips) => {
    setTrips(newTrips);
    setAisData(d => d ? { ...d, trips: newTrips } : d);
  }, []);

  // FIX UX: al navegar a otra tab desde Viajes, limpiar viewing
  const goTab = useCallback((t) => {
    setTab(t);
    if (t !== "Viajes") setViewingTripId(null);
  }, []);

  // FIX ALTO: logout con manejo de error y feedback visual
  const handleLogout = useCallback(async () => {
    setLogoutBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("[App] Error en logout:", error.message);
      // Supabase dispara onAuthStateChange → setSession(null) → renderiza LoginPage
    } catch (ex) {
      console.error("[App] Excepción en logout:", ex);
    } finally {
      setLogoutBusy(false);
    }
  }, []);

  // ── FIX ALTO: resolver trip por ID, no por índice ──
  const viewingTrip = viewingTripId !== null
    ? trips.find(t => t.id === viewingTripId) ?? null
    : null;
  const viewingIdx  = viewingTrip
    ? trips.findIndex(t => t.id === viewingTripId)
    : null;

  // ── Topbar subtitle ──
  let tabLabel = tab;
  if (tab === "Viajes" && viewingTrip) {
    tabLabel = `Viaje #${viewingTrip.id}`;
    if (viewingTrip.incomplete) tabLabel += " ⚠ incompleto";
  }

  // ── Contador de viajes incompletos para warning en topbar ──
  const incompleteCount = trips.filter(t => t.incomplete).length;

  // ── Renders de estado ──
  if (loading) {
    return (
      <>
        <style>{CSS}</style>
        <div className="loading">
          <div className="loading-txt">Cargando…</div>
        </div>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <style>{CSS}</style>
        <LoginPage />
      </>
    );
  }

  if (loadingUpload) {
    return (
      <>
        <style>{CSS}</style>
        <div className="loading">
          <div className="loading-txt">Cargando datos AIS…</div>
        </div>
      </>
    );
  }

  // ── Render principal ──
  return (
    <>
      <style>{CSS}</style>
      <div className="shell">

        {/* ── Sidebar ── */}
        <aside className="sb">
          <div className="sb-brand">
            <div className="sb-icon">📡</div>
            <div className="sb-name">AIS Analyzer</div>
            <div className="sb-sub">BG Tiger · Análisis AIS</div>
          </div>
          <nav className="sb-nav" aria-label="Navegación principal">
            <div className="sb-sec">Módulo</div>
            {TABS.map(t => (
              <button
                key={t}
                className={`sb-item ${tab === t ? "active" : ""}`}
                onClick={() => goTab(t)}
                aria-current={tab === t ? "page" : undefined}
              >
                <span className="sb-item-dot" aria-hidden="true">
                  {t === "Dashboard" ? "📊" : t === "Viajes" ? "🗺️" : "📤"}
                </span>
                <span className="sb-item-lbl">{t}</span>
              </button>
            ))}
          </nav>
          <div className="sb-footer">
            <div className="sb-email" title={session.user.email}>{session.user.email}</div>
            <button
              className="sb-back"
              onClick={() => window.open(PORTAL_HOME_URL, "_self")}
              aria-label="Volver al portal"
            >
              ← Portal
            </button>
            <button
              className="sb-logout"
              onClick={handleLogout}
              disabled={logoutBusy}
              aria-label="Cerrar sesión"
            >
              {logoutBusy ? "Saliendo…" : "Cerrar sesión"}
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="main">
          <div className="topbar" role="banner">
            <span className="topbar-title">AIS Analyzer</span>
            <span className="topbar-sep" aria-hidden="true">·</span>
            <span className="topbar-sub">{tabLabel}</span>
            {aisData && (
              <>
                <span className="topbar-file" aria-label={`Archivo: ${aisData.filename}, ${trips.length} viajes`}>
                  📡 {aisData.filename} · {trips.length} viajes
                </span>
                {incompleteCount > 0 && (
                  <span
                    className="topbar-incomplete"
                    title={`${incompleteCount} viaje(s) sin arribo registrado en el dataset`}
                  >
                    ⚠ {incompleteCount} incompleto{incompleteCount > 1 ? "s" : ""}
                  </span>
                )}
              </>
            )}
          </div>

          <div className="page-body">

            {/* ── Tab: Upload ── */}
            {tab === "Upload" && (
              <Upload
                onLoad={handleLoad}
                existingUploads={existingUploads}
                uploadsError={uploadsError}
                onSelectUpload={handleSelectUpload}
              />
            )}

            {/* ── Tab: Dashboard ── */}
            {tab === "Dashboard" && (
              <Dashboard
                data={aisData ? { ...aisData, trips } : null}
                onGoTrips={() => goTab("Viajes")}
              />
            )}

            {/* ── Tab: Viajes — lista ── */}
            {tab === "Viajes" && viewingTripId === null && (
              aisData ? (
                <TripsList
                  trips={trips}
                  onSelectTrip={(tripId) => setViewingTripId(tripId)}
                />
              ) : (
                <div className="no-file">
                  <div className="no-file-icon" aria-hidden="true">🗺️</div>
                  <div className="no-file-title">Primero subí el archivo AIS</div>
                  <div className="no-file-desc">
                    Andá a Upload y cargá el Excel de VesselFinder para ver los viajes acá.
                  </div>
                  <button className="go-btn" onClick={() => goTab("Upload")}>
                    → Ir a Upload
                  </button>
                </div>
              )
            )}

            {/* ── Tab: Viajes — detalle ── */}
            {tab === "Viajes" && viewingTripId !== null && viewingIdx !== null && (
              <TripViewer
                trips={trips}
                setTrips={handleTripsUpdate}
                initialIdx={viewingIdx}
                onBack={() => setViewingTripId(null)}
              />
            )}

          </div>
        </main>
      </div>
    </>
  );
}

// ─── TRIPS LIST (extraído del render inline para claridad) ────────────────────
/**
 * FIX UX múltiples problemas:
 * 1. Fechas en formato 24h explícito con hora de salida/llegada visible
 * 2. FIX: onSelectTrip recibe trip.id no índice
 * 3. FIX: viajes incompletos claramente diferenciados (fondo ámbar, badge)
 * 4. FIX UX: columna "Fechas" muestra fecha inicio + hora salida, fecha fin + hora llegada
 *    para que el usuario pueda comparar cronología sin ambigüedad AM/PM
 */
function TripsList({ trips, onSelectTrip }) {
  const validated = trips.filter(t => t.validated).length;
  const pending   = trips.filter(t => !t.validated).length;
  const incomplete = trips.filter(t => t.incomplete).length;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1040 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 3, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
        AIS Analyzer · Viajes
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginBottom: 6 }}>
        Viajes detectados — {trips.length}
      </h1>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7, marginBottom: 16, maxWidth: 560 }}>
        Hacé click en un viaje para abrirlo en el mapa. Clasificá cada WORKING_STOP y marcalo como validado.
      </p>

      {/* Resumen de estado */}
      <div style={{ marginBottom: 12, fontSize: 11, color: "var(--muted)", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span>✅ {validated} validados</span>
        <span>⏳ {pending} pendientes</span>
        {incomplete > 0 && (
          <span style={{ color: "#92400E" }}>
            ⚠ {incomplete} incompleto{incomplete > 1 ? "s" : ""} (sin arribo en el dataset)
          </span>
        )}
      </div>

      {/* FIX UX: leyenda de formato de hora */}
      <div style={{ marginBottom: 14, fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)", background: "#EEF2F7", display: "inline-block", padding: "4px 10px", borderRadius: 5 }}>
        ⏱ Horarios en UTC · Formato 24h
      </div>

      <div style={{ background: "#fff", border: "1px solid #D6E0ED", borderRadius: 10, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "36px 145px 1fr 55px 65px 65px 95px", gap: 8, padding: "7px 14px", background: "#213363" }}>
          {["#", "Fechas (UTC)", "Zonas", "Svc", "Duración", "Dist.", "Estado"].map(h => (
            <span key={h} style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,.55)", textTransform: "uppercase", letterSpacing: .5 }}>
              {h}
            </span>
          ))}
        </div>

        {/* Filas */}
        {trips.map(t => (
          <TripRow
            key={t.id}
            trip={t}
            onClick={() => onSelectTrip(t.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * FIX UX: TripRow muestra fecha y hora de salida/llegada en líneas separadas.
 * Formato: "21/11/24" en línea 1, "06:37 → 14:22" en línea 2.
 * Esto permite comparar cronología de viajes sin ambigüedad de AM/PM.
 */
function TripRow({ trip, onClick }) {
  const t = trip;

  let rowClass = "trips-row";
  if (t.incomplete) rowClass += " incomplete-trip";
  else if (t.validated) rowClass += " validated";

  let badge;
  if (t.incomplete) {
    badge = <span className="badge-incomplete">⚠ Incompleto</span>;
  } else if (t.validated) {
    badge = <span className="badge-ok">✓ OK</span>;
  } else {
    badge = <span className="badge-pending">Pendiente</span>;
  }

  return (
    <div
      className={rowClass}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      aria-label={`Viaje ${t.id}, ${fmtDate(t.dateStart)} a ${fmtDate(t.dateEnd)}, ${t.nServices} servicios`}
    >
      {/* # */}
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: "#235C96", textAlign: "center" }}>
        {t.id}
      </span>

      {/* FIX UX: Fechas con hora de salida y llegada en 24h */}
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "#6381A7", lineHeight: 1.5 }}>
        {fmtDate(t.dateStart)}<br />
        <span style={{ fontSize: 9 }}>
          {fmtTime(t.dateStart)} → {fmtTime(t.dateEnd)}
        </span>
      </span>

      {/* Zonas */}
      <span style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {t.zones.slice(0, 3).map(z => (
          <span
            key={z}
            style={{ fontSize: 8, padding: "1px 5px", borderRadius: 3, background: "#EEF2F7", color: "#6381A7", fontFamily: "var(--mono)" }}
          >
            {z.replace(/_/g, " ")}
          </span>
        ))}
        {t.zones.length > 3 && (
          <span style={{ fontSize: 8, color: "#6381A7", fontFamily: "var(--mono)" }}>
            +{t.zones.length - 3}
          </span>
        )}
      </span>

      {/* Servicios */}
      <span style={{ fontSize: 14, fontWeight: 700, color: "#1E7A4A", textAlign: "center" }}>
        {t.nServices}
      </span>

      {/* Duración */}
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#6381A7", textAlign: "right" }}>
        {typeof t.durationHs === "number" ? `${t.durationHs.toFixed(0)}h` : "—"}
      </span>

      {/* Distancia */}
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#6381A7", textAlign: "right" }}>
        {t.distNm != null ? `${t.distNm} nm` : "—"}
      </span>

      {/* Estado */}
      {badge}
    </div>
  );
}
