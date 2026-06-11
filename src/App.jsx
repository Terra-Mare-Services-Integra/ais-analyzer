import { useState, useEffect, useCallback } from "react";
import { supabase } from "./lib/supabase";
import Upload    from "./components/Upload";
import TripViewer from "./components/TripViewer";
import Dashboard  from "./components/Dashboard";

const PORTAL_HOME_URL = "https://evaluacion-proyectos.vercel.app";
const TABS = ["Dashboard", "Viajes", "Upload"];

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
.loading{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--navy)}
.loading-txt{font-family:var(--mono);font-size:11px;color:rgba(255,255,255,.4);letter-spacing:2px;text-transform:uppercase}
.no-file{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;text-align:center;padding:40px}
.no-file-icon{font-size:48px;margin-bottom:14px;opacity:.35}
.no-file-title{font-size:18px;font-weight:700;color:var(--navy);margin-bottom:8px}
.no-file-desc{font-size:12px;color:var(--muted);max-width:380px;line-height:1.7}
.go-btn{margin-top:16px;padding:9px 20px;border-radius:8px;background:var(--blue);color:#fff;border:none;font-family:var(--sans);font-size:12px;font-weight:600;cursor:pointer}
.go-btn:hover{background:var(--navy)}
.trips-row{display:grid;grid-template-columns:36px 130px 1fr 55px 65px 65px 90px;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #EEF2F7;cursor:pointer;transition:background .12s;font-size:12px}
.trips-row:last-child{border-bottom:none}
.trips-row.validated{background:#F0FFF4}
.trips-row.incomplete-trip{background:#FFFBEB}
.trips-row:hover{background:#F8FAFC}
.trips-row.validated:hover{background:#E8FFF2}
.trips-row.incomplete-trip:hover{background:#FEF3C7}
.badge-ok{font-family:var(--mono);font-size:8px;padding:2px 7px;border-radius:3px;background:#D1FAE5;color:#065F46;text-align:center}
.badge-pending{font-family:var(--mono);font-size:8px;padding:2px 7px;border-radius:3px;background:#F3F4F6;color:#6B7280;text-align:center}
.badge-incomplete{font-family:var(--mono);font-size:8px;padding:2px 7px;border-radius:3px;background:#FEF3C7;color:#92400E;text-align:center}
.badge-svc-pending{font-family:var(--mono);font-size:8px;padding:2px 5px;border-radius:3px;background:#FFF7ED;color:#C2410C;text-align:center}
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

// ─── TIMEZONE ────────────────────────────────────────────────────────────────
const TZ_OFFSET_HS = -3;
const TZ_LABEL     = "ART";
function toLocal(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return new Date(dt.getTime() + TZ_OFFSET_HS * 3600000);
}
function fmtDate(dt) {
  const loc = toLocal(dt);
  if (!loc) return "—";
  return `${String(loc.getUTCDate()).padStart(2,"0")}/${String(loc.getUTCMonth()+1).padStart(2,"0")}/${String(loc.getUTCFullYear()).slice(-2)}`;
}
function fmtTime(dt) {
  const loc = toLocal(dt);
  if (!loc) return "—";
  return `${String(loc.getUTCHours()).padStart(2,"0")}:${String(loc.getUTCMinutes()).padStart(2,"0")}`;
}
function fmtDuration(hs) {
  if (hs==null||isNaN(hs)) return "—";
  const days=Math.floor(hs/24), hrs=Math.round(hs%24);
  return days>0?`${days}d ${hrs}h`:`${hrs}h`;
}

// ─── BUG-02: HASH NAVIGATION ─────────────────────────────────────────────────
// Formato:
//   #/dashboard          → tab Dashboard
//   #/viajes             → tab Viajes, lista
//   #/viajes/27          → tab Viajes, viaje #27 abierto
//   #/upload             → tab Upload
//
// readHash() lee window.location.hash y devuelve { tab, tripId }.
// writeHash() escribe el hash a partir del estado actual.
// No depende de ningún router externo — funciona con Vite + Vercel tal cual.

function readHash() {
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hash.startsWith("viajes/")) {
    const id = parseInt(hash.split("/")[1], 10);
    return { tab: "Viajes", tripId: isNaN(id) ? null : id };
  }
  if (hash === "viajes")    return { tab: "Viajes",    tripId: null };
  if (hash === "upload")    return { tab: "Upload",    tripId: null };
  // dashboard o vacío → Dashboard
  return { tab: "Dashboard", tripId: null };
}

function writeHash(tab, tripId) {
  let hash;
  if (tab === "Viajes" && tripId !== null) hash = `#/viajes/${tripId}`;
  else if (tab === "Viajes")               hash = `#/viajes`;
  else if (tab === "Upload")               hash = `#/upload`;
  else                                     hash = `#/dashboard`;
  // Usar replaceState cuando solo cambia el viaje dentro de Viajes,
  // pushState en los demás casos para que el botón Atrás funcione entre tabs.
  if (window.location.hash === hash) return;
  window.history.pushState(null, "", hash);
}

async function loadUploadFromSupabase(uploadRecord) {
  const { data: tripRows, error: trErr } = await supabase
    .from("ais_trips").select("*").eq("upload_id", uploadRecord.id).order("trip_num");
  if (trErr) throw new Error("Error cargando viajes: " + trErr.message);
  if (!tripRows?.length) return { uploadId:uploadRecord.id, filename:uploadRecord.filename, trips:[], loadedAt:new Date() };

  const tripIds = tripRows.map(t => t.id);

  // FIX REGRESIÓN: Supabase tiene un límite de 1000 filas por request.
  // Con el campo servicio_num agregado hoy, viajes largos (#31-33, 15h+)
  // superan ese límite y la query retorna datos truncados SIN error,
  // causando points:[] en esos viajes aunque existan en la DB.
  // Solución: paginación con range() hasta obtener todos los puntos.
  const PAGE_SIZE = 1000;
  let allPoints = [];
  let from = 0;
  while (true) {
    const { data: page, error: ptErr } = await supabase
      .from("ais_points")
      .select("*")
      .in("trip_id", tripIds)
      .order("datetime")
      .range(from, from + PAGE_SIZE - 1);
    if (ptErr) throw new Error("Error cargando puntos: " + ptErr.message);
    if (!page?.length) break;
    allPoints = allPoints.concat(page);
    if (page.length < PAGE_SIZE) break; // última página
    from += PAGE_SIZE;
  }

  const pointsByTrip = {};
  for (const p of (allPoints||[])) {
    if (!pointsByTrip[p.trip_id]) pointsByTrip[p.trip_id] = [];
    pointsByTrip[p.trip_id].push({
      datetime:new Date(p.datetime), lat:p.lat, lon:p.lon, sog:p.sog,
      zone:p.zone, state:p.state, tipo_servicio:p.tipo_servicio, zona_servicio:p.zona_servicio,
      servicio_num:p.servicio_num,
    });
  }

  const trips = tripRows.map(tr => ({
    id:tr.trip_num, supabaseId:tr.id,
    dateStart:new Date(tr.date_start), dateDeparture:new Date(tr.date_departure||tr.date_start), dateEnd:new Date(tr.date_end),
    durationHs:tr.duration_hs, navHs:tr.nav_hs??tr.duration_hs, distNm:tr.dist_nm,
    nServices:tr.n_services, zones:tr.zones||[], validated:tr.validated,
    incomplete:tr.incomplete||false, points:pointsByTrip[tr.id]||[],
  }));

  return { uploadId:uploadRecord.id, filename:uploadRecord.filename, trips, loadedAt:new Date() };
}

async function fetchUploads() {
  const { data, error } = await supabase.from("ais_uploads").select("*").order("created_at",{ascending:false});
  if (error) { console.error("[App] Error uploads:", error.message); return null; }
  return data||[];
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [pwd,   setPwd]   = useState("");
  const [err,   setErr]   = useState("");
  const [busy,  setBusy]  = useState(false);
  const submit = async e => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const {error} = await supabase.auth.signInWithPassword({email, password:pwd});
      if (error) setErr("Email o contraseña incorrectos.");
    } catch { setErr("Error de conexión. Intentá de nuevo."); }
    finally { setBusy(false); }
  };
  return (
    <div className="lw"><div className="lc">
      <button className="lbk" onClick={()=>window.location.href=PORTAL_HOME_URL}>← Evaluación de Proyectos</button>
      <div className="li">📡</div>
      <div className="lt">AIS Analyzer</div>
      <div className="ls">Grupo Marítimo · Análisis AIS</div>
      {err&&<div className="le" role="alert">{err}</div>}
      <form onSubmit={submit}>
        <div className="lfg"><label htmlFor="e">Email</label><input id="e" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@email.com" required autoFocus autoComplete="email"/></div>
        <div className="lfg"><label htmlFor="p">Contraseña</label><input id="p" type="password" value={pwd} onChange={e=>setPwd(e.target.value)} placeholder="••••••••" required autoComplete="current-password"/></div>
        <button type="submit" className="lb" disabled={busy}>{busy?"Ingresando…":"Ingresar"}</button>
      </form>
      <div className="lf">© {new Date().getFullYear()} Grupo Marítimo · Acceso restringido</div>
    </div></div>
  );
}

export default function App() {
  const [session,         setSession]         = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [tab,             setTab]             = useState("Dashboard");
  const [aisData,         setAisData]         = useState(null);
  const [trips,           setTrips]           = useState([]);
  const [viewingTripId,   setViewingTripId]   = useState(null);
  const [existingUploads, setExistingUploads] = useState([]);
  const [uploadsError,    setUploadsError]    = useState(null);
  const [loadingUpload,   setLoadingUpload]   = useState(false);
  const [logoutBusy,      setLogoutBusy]      = useState(false);

  // ─── AUTH ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({data:{session:s}}) => { if (mounted){setSession(s);setLoading(false);} });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_e,s) => { if (mounted) setSession(s); });
    return () => { mounted=false; subscription.unsubscribe(); };
  }, []);

  // ─── BUG-02: LEER HASH AL MONTAR Y ESCUCHAR CAMBIOS ─────────────────────────
  // Al montar: restaura tab y viaje desde el hash actual (recarga o link directo).
  // hashchange: sincroniza el estado cuando el usuario usa los botones
  //             Atrás/Adelante del browser.
  // Nota: el hash puede apuntar a un viaje (ej. #/viajes/27) pero los datos AIS
  // aún no están cargados. En ese caso se restaura el tab "Viajes" y el tripId;
  // cuando los datos carguen, viewingIdx se resolverá automáticamente.
  useEffect(() => {
    const applyHash = () => {
      const { tab: t, tripId } = readHash();
      setTab(t);
      setViewingTripId(tripId);
    };
    applyHash(); // lectura inicial
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  // ─── BUG-02: ESCRIBIR HASH CUANDO CAMBIA EL ESTADO ──────────────────────────
  // Cada vez que tab o viewingTripId cambian desde el código (clicks en la UI),
  // sincronizamos el hash. hashchange no se dispara al hacer pushState,
  // así que no hay loop.
  useEffect(() => {
    writeHash(tab, viewingTripId);
  }, [tab, viewingTripId]);

  const refreshUploads = useCallback(async () => {
    const data = await fetchUploads();
    if (data===null) setUploadsError("No se pudo cargar la lista de archivos anteriores.");
    else { setExistingUploads(data); setUploadsError(null); }
  }, []);

  useEffect(() => { if (session) refreshUploads(); }, [session, refreshUploads]);

  const handleLoad = useCallback(data => {
    setAisData(data); setTrips(data.trips); setTab("Dashboard"); setViewingTripId(null);
    refreshUploads();
  }, [refreshUploads]);

  const handleSelectUpload = useCallback(async uploadRecord => {
    setLoadingUpload(true);
    try {
      const data = await loadUploadFromSupabase(uploadRecord);
      setAisData(data); setTrips(data.trips); setTab("Dashboard"); setViewingTripId(null);
    } catch(e) { alert("Error cargando datos: " + e.message); }
    finally { setLoadingUpload(false); }
  }, []);

  const handleTripsUpdate = useCallback(newTrips => {
    setTrips(newTrips);
    setAisData(d => d ? {...d, trips:newTrips} : d);
  }, []);

  const goTab = useCallback(t => { setTab(t); if (t!=="Viajes") setViewingTripId(null); }, []);

  const handleLogout = useCallback(async () => {
    setLogoutBusy(true);
    try { await supabase.auth.signOut(); }
    catch(ex) { console.error("[App] Logout error:", ex); }
    finally { setLogoutBusy(false); }
  }, []);

  const viewingTrip = viewingTripId!==null ? trips.find(t=>t.id===viewingTripId)??null : null;
  const viewingIdx  = viewingTrip ? trips.findIndex(t=>t.id===viewingTripId) : null;

  // UX-01: tabLabel siempre derivado del estado actual — fuente única de verdad
  let tabLabel = tab;
  if (tab==="Viajes"&&viewingTrip) {
    tabLabel = `Viaje #${viewingTrip.id}`;
    if (viewingTrip.incomplete) tabLabel += " ⚠";
  }

  const incompleteCount = trips.filter(t=>t.incomplete).length;

  // UX-13: primer viaje pendiente para CTA del Dashboard
  const firstPending = trips.find(t=>!t.validated);

  if (loading) return <><style>{CSS}</style><div className="loading"><div className="loading-txt">Cargando…</div></div></>;
  if (!session) return <><style>{CSS}</style><LoginPage /></>;
  if (loadingUpload) return <><style>{CSS}</style><div className="loading"><div className="loading-txt">Cargando datos AIS…</div></div></>;

  return (
    <><style>{CSS}</style>
    <div className="shell">
      <aside className="sb">
        <div className="sb-brand">
          <div className="sb-icon">📡</div>
          <div className="sb-name">AIS Analyzer</div>
          <div className="sb-sub">BG Tiger · Análisis AIS</div>
        </div>
        <nav className="sb-nav" aria-label="Navegación principal">
          <div className="sb-sec">Módulo</div>
          {TABS.map(t=>(
            <button key={t} className={`sb-item ${tab===t?"active":""}`} onClick={()=>goTab(t)} aria-current={tab===t?"page":undefined}>
              <span className="sb-item-dot" aria-hidden="true">{t==="Dashboard"?"📊":t==="Viajes"?"🗺️":"📤"}</span>
              <span className="sb-item-lbl">{t}</span>
            </button>
          ))}
        </nav>
        <div className="sb-footer">
          <div className="sb-email" title={session.user.email}>{session.user.email}</div>
          <button className="sb-back" onClick={()=>window.open(PORTAL_HOME_URL,"_self")}>← Portal</button>
          <button className="sb-logout" onClick={handleLogout} disabled={logoutBusy}>{logoutBusy?"Saliendo…":"Cerrar sesión"}</button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <span className="topbar-title">AIS Analyzer</span>
          <span className="topbar-sep">·</span>
          {/* UX-01: breadcrumb sincronizado */}
          <span className="topbar-sub">{tabLabel}</span>
          {aisData&&<>
            <span className="topbar-file">📡 {aisData.filename} · {trips.length} viajes</span>
            {incompleteCount>0&&<span className="topbar-incomplete" title="Viajes sin arribo registrado">⚠ {incompleteCount} incompleto{incompleteCount>1?"s":""}</span>}
          </>}
        </div>

        <div className="page-body">
          {tab==="Upload"&&<Upload onLoad={handleLoad} existingUploads={existingUploads} uploadsError={uploadsError} onSelectUpload={handleSelectUpload}/>}

          {tab==="Dashboard"&&(
            <Dashboard data={aisData?{...aisData,trips}:null}
              onGoTrips={()=>goTab("Viajes")}
              onGoUpload={()=>goTab("Upload")}
              // UX-13: CTA al primer pendiente
              firstPendingTrip={firstPending}
              onGoFirstPending={firstPending?()=>{setTab("Viajes");setViewingTripId(firstPending.id);}:null}
            />
          )}

          {tab==="Viajes"&&viewingTripId===null&&(
            aisData
              ? <TripsList trips={trips} onSelectTrip={id=>setViewingTripId(id)}/>
              : <div className="no-file">
                  <div className="no-file-icon" aria-hidden="true">🗺️</div>
                  <div className="no-file-title">Primero subí el archivo AIS</div>
                  <div className="no-file-desc">Andá a Upload y cargá el Excel de VesselFinder.</div>
                  <button className="go-btn" onClick={()=>goTab("Upload")}>→ Ir a Upload</button>
                </div>
          )}

          {tab==="Viajes"&&viewingTripId!==null&&viewingIdx!==null&&(
            <TripViewer trips={trips} setTrips={handleTripsUpdate} initialIdx={viewingIdx} onBack={()=>setViewingTripId(null)}/>
          )}
        </div>
      </main>
    </div></>
  );
}

// ─── TRIPS LIST ───────────────────────────────────────────────────────────────
// UX-14: filtro Todos / Pendientes / Validados
// MEJORA-02: checkbox Solo ZC
function TripsList({ trips, onSelectTrip }) {
  const [listFilter, setListFilter] = useState("PENDING"); // UX-14: default pendientes
  const [onlyZC,     setOnlyZC]     = useState(false);     // MEJORA-02

  const validated  = trips.filter(t=>t.validated).length;
  const pending    = trips.filter(t=>!t.validated).length;
  const incomplete = trips.filter(t=>t.incomplete).length;
  // MEJORA-02: contar cuántos viajes tienen al menos 1 punto en ZONA_COMUN
  const withZC     = trips.filter(t=>t.zones?.includes("ZONA_COMUN")).length;

  const filtered = trips.filter(t => {
    if (listFilter==="PENDING")   { if (t.validated) return false; }
    if (listFilter==="VALIDATED") { if (!t.validated) return false; }
    if (onlyZC && !t.zones?.includes("ZONA_COMUN")) return false; // MEJORA-02
    return true;
  });

  // Mensaje de lista vacía contextualizado
  const emptyMsg = onlyZC
    ? (listFilter==="PENDING"   ? "No hay viajes pendientes con Zona Común."
      :listFilter==="VALIDATED" ? "No hay viajes validados con Zona Común."
      :                           "No hay viajes con Zona Común.")
    : (listFilter==="PENDING"   ? "No hay viajes pendientes."
      :                           "No hay viajes validados.");

  return (
    <div style={{padding:"28px 32px",maxWidth:1040}}>
      <div style={{fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",textTransform:"uppercase",marginBottom:6}}>AIS Analyzer · Viajes</div>
      <h1 style={{fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:6}}>Viajes detectados — {trips.length}</h1>
      <p style={{fontSize:12,color:"var(--muted)",lineHeight:1.7,marginBottom:12,maxWidth:560}}>
        Click en un viaje para abrirlo en el mapa. Clasificá cada punto de parada y marcá como validado.
      </p>

      <div style={{marginBottom:12,display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{fontSize:11,color:"var(--muted)",display:"flex",gap:14}}>
          <span>✅ {validated} validados</span>
          <span>⏳ {pending} pendientes</span>
          {incomplete>0&&<span style={{color:"#92400E"}}>⚠ {incomplete} incompleto{incomplete>1?"s":""}</span>}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          {/* UX-14: toggle estado */}
          <div style={{display:"flex",gap:3}}>
            {[["ALL","Todos"],["PENDING","Pendientes"],["VALIDATED","Validados"]].map(([f,l])=>(
              <button key={f}
                style={{fontSize:10,padding:"4px 10px",borderRadius:6,cursor:"pointer",fontFamily:"var(--mono)",
                  border:`1px solid ${listFilter===f?"#235C96":"#D6E0ED"}`,
                  background:listFilter===f?"#EFF6FF":"#fff",color:listFilter===f?"#235C96":"#6381A7",fontWeight:listFilter===f?600:400}}
                onClick={()=>setListFilter(f)}>{l}</button>
            ))}
          </div>
          {/* MEJORA-02: toggle Solo ZC */}
          <button
            style={{
              fontSize:10,padding:"4px 10px",borderRadius:6,cursor:"pointer",fontFamily:"var(--mono)",
              border:`1px solid ${onlyZC?"#1E40AF":"#D6E0ED"}`,
              background:onlyZC?"#DBEAFE":"#fff",
              color:onlyZC?"#1E40AF":"#6381A7",
              fontWeight:onlyZC?600:400,
            }}
            onClick={()=>setOnlyZC(v=>!v)}
            title={`${withZC} viajes tienen puntos en Zona Común`}
          >
            {onlyZC?"✓ ":""}ZC ({withZC})
          </button>
        </div>
      </div>

      <div style={{marginBottom:14,fontSize:10,color:"var(--muted)",fontFamily:"var(--mono)",background:"#EEF2F7",display:"inline-block",padding:"4px 10px",borderRadius:5}}>
        ⏱ Horarios en ART (UTC-3) · Formato 24h
      </div>

      {filtered.length===0&&(
        <div style={{padding:"32px",textAlign:"center",fontSize:12,color:"var(--muted)"}}>
          {emptyMsg}
        </div>
      )}

      {filtered.length>0&&(
        <div style={{background:"#fff",border:"1px solid #D6E0ED",borderRadius:10,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"36px 145px 1fr 55px 70px 65px 90px",gap:8,padding:"7px 14px",background:"#213363"}}>
            {["#","Fechas (ART)","Zonas","Svc","Duración","Dist.","Estado"].map(h=>(
              <span key={h} style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,.55)",textTransform:"uppercase",letterSpacing:.5}}>{h}</span>
            ))}
          </div>
          {filtered.map(t=><TripRow key={t.id} trip={t} onClick={()=>onSelectTrip(t.id)}/>)}
        </div>
      )}
    </div>
  );
}

function TripRow({ trip, onClick }) {
  const t = trip;
  let rowClass="trips-row";
  if (t.incomplete) rowClass+=" incomplete-trip";
  else if (t.validated) rowClass+=" validated";

  // UX-17: badge naranja si hay puntos en ZC sin clasificar
  const zcTotal    = t.points?.filter(p=>p.zone==="ZONA_COMUN"&&p.state==="WORKING_STOP").length||0;
  const zcClasif   = t.points?.filter(p=>p.zone==="ZONA_COMUN"&&p.servicio_num!=null).length||0;
  const zcPending  = zcTotal - zcClasif;

  let badge;
  if (t.incomplete) badge=<span className="badge-incomplete">⚠ Incompleto</span>;
  else if (t.validated) badge=<span className="badge-ok">✓ OK</span>;
  else if (zcPending>0) badge=<span className="badge-svc-pending">{zcPending} ZC ⚠</span>;
  else badge=<span className="badge-pending">Pendiente</span>;

  return (
    <div className={rowClass} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")onClick();}}
      aria-label={`Viaje ${t.id}, ${fmtDate(t.dateStart)} a ${fmtDate(t.dateEnd)}, ${t.nServices} servicios`}>
      <span style={{fontFamily:"var(--mono)",fontSize:11,fontWeight:700,color:"#235C96",textAlign:"center"}}>{t.id}</span>
      <span style={{fontFamily:"var(--mono)",fontSize:10,color:"#6381A7",lineHeight:1.5}}>
        {fmtDate(t.dateStart)}<br/>
        <span style={{fontSize:9}}>{fmtTime(t.dateStart)} → {fmtTime(t.dateEnd)} {TZ_LABEL}</span>
      </span>
      <span style={{display:"flex",gap:3,flexWrap:"wrap"}}>
        {t.zones.slice(0,3).map(z=>(
          <span key={z} style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"#EEF2F7",color:"#6381A7",fontFamily:"var(--mono)"}}>{z.replace(/_/g," ")}</span>
        ))}
        {t.zones.length>3&&<span style={{fontSize:8,color:"#6381A7"}}>+{t.zones.length-3}</span>}
      </span>
      {/* UX-17: nServices real */}
      <span style={{fontSize:14,fontWeight:700,color:t.nServices>0?"#1E7A4A":"#A5B5CC",textAlign:"center"}}>{t.nServices}</span>
      {/* UX-15: duración legible */}
      <span style={{fontFamily:"var(--mono)",fontSize:11,color:"#6381A7",textAlign:"right"}}>{fmtDuration(t.durationHs)}</span>
      <span style={{fontFamily:"var(--mono)",fontSize:11,color:"#6381A7",textAlign:"right"}}>{t.distNm!=null?`${t.distNm} nm`:"—"}</span>
      {badge}
    </div>
  );
}
