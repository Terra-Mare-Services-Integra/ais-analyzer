import { useState, useEffect } from "react";
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
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.topbar{height:52px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 28px;position:sticky;top:0;z-index:5;gap:8px;flex-shrink:0}
.topbar-title{font-size:14px;font-weight:700;color:var(--navy)}
.topbar-sep{color:var(--border);font-size:16px}
.topbar-sub{font-size:11px;color:var(--muted)}
.topbar-file{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--muted);background:#EEF2F7;padding:3px 10px;border-radius:5px}
.page-body{flex:1;background:var(--bg)}
.loading{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--navy)}
.loading-txt{font-family:var(--mono);font-size:11px;color:rgba(255,255,255,.4);letter-spacing:2px;text-transform:uppercase}
.no-file{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;text-align:center;padding:40px}
.no-file-icon{font-size:48px;margin-bottom:14px;opacity:.35}
.no-file-title{font-size:18px;font-weight:700;color:var(--navy);margin-bottom:8px}
.no-file-desc{font-size:12px;color:var(--muted);max-width:380px;line-height:1.7}
.go-btn{margin-top:16px;padding:9px 20px;border-radius:8px;background:var(--blue);color:#fff;border:none;font-family:var(--sans);font-size:12px;font-weight:600;cursor:pointer}
.go-btn:hover{background:var(--navy)}
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
}
`;

// Load a saved upload from Supabase (trips + points)
async function loadUploadFromSupabase(uploadRecord) {
  // Load trips
  const { data: tripRows, error: trErr } = await supabase
    .from("ais_trips")
    .select("*")
    .eq("upload_id", uploadRecord.id)
    .order("trip_num");
  if (trErr) throw new Error("Error cargando viajes: " + trErr.message);

  const trips = [];
  for (const tr of tripRows) {
    const { data: ptRows, error: ptErr } = await supabase
      .from("ais_points")
      .select("*")
      .eq("trip_id", tr.id)
      .order("datetime");
    if (ptErr) throw new Error("Error cargando puntos: " + ptErr.message);

    trips.push({
      id:           tr.trip_num,
      supabaseId:   tr.id,
      dateStart:    new Date(tr.date_start),
      dateDeparture: new Date(tr.date_departure),
      dateEnd:      new Date(tr.date_end),
      durationHs:   tr.duration_hs,
      distNm:       tr.dist_nm,
      nServices:    tr.n_services,
      zones:        tr.zones || [],
      validated:    tr.validated,
      points:       ptRows.map(p => ({
        datetime:      new Date(p.datetime),
        lat:           p.lat,
        lon:           p.lon,
        sog:           p.sog,
        zone:          p.zone,
        state:         p.state,
        tipo_servicio: p.tipo_servicio,
        zona_servicio: p.zona_servicio,
      })),
    });
  }

  return { uploadId: uploadRecord.id, filename: uploadRecord.filename, trips, loadedAt: new Date() };
}

function LoginPage() {
  const [email, setEmail] = useState("");
  const [pwd,   setPwd]   = useState("");
  const [err,   setErr]   = useState("");
  const [busy,  setBusy]  = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
    if (error) setErr("Email o contraseña incorrectos.");
    setBusy(false);
  };

  return (
    <div className="lw">
      <div className="lc">
        <button className="lbk" onClick={() => window.location.href = PORTAL_HOME_URL}>← Evaluación de Proyectos</button>
        <div className="li">📡</div>
        <div className="lt">AIS Analyzer</div>
        <div className="ls">Grupo Marítimo · Análisis AIS</div>
        {err && <div className="le">{err}</div>}
        <form onSubmit={submit}>
          <div className="lfg"><label>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@email.com" required autoFocus /></div>
          <div className="lfg"><label>Contraseña</label><input type="password" value={pwd} onChange={e=>setPwd(e.target.value)} placeholder="••••••••" required /></div>
          <button type="submit" className="lb" disabled={busy}>{busy?"Ingresando...":"Ingresar"}</button>
        </form>
        <div className="lf">© {new Date().getFullYear()} Grupo Marítimo · Acceso restringido</div>
      </div>
    </div>
  );
}

export default function App() {
  const [session,        setSession]        = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [tab,            setTab]            = useState("Dashboard");
  const [aisData,        setAisData]        = useState(null);
  const [trips,          setTrips]          = useState([]);
  const [viewing,        setViewing]        = useState(null);
  const [existingUploads,setExistingUploads]= useState([]);
  const [loadingUpload,  setLoadingUpload]  = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); setLoading(false); });
    return () => subscription.unsubscribe();
  }, []);

  // Load existing uploads when session is ready
  useEffect(() => {
    if (!session) return;
    supabase.from("ais_uploads").select("*").order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setExistingUploads(data); });
  }, [session]);

  const handleLoad = (data) => {
    setAisData(data);
    setTrips(data.trips);
    setTab("Dashboard");
    setViewing(null);
    // Refresh uploads list
    supabase.from("ais_uploads").select("*").order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setExistingUploads(data); });
  };

  const handleSelectUpload = async (uploadRecord) => {
    setLoadingUpload(true);
    try {
      const data = await loadUploadFromSupabase(uploadRecord);
      setAisData(data);
      setTrips(data.trips);
      setTab("Dashboard");
      setViewing(null);
    } catch (e) {
      alert("Error cargando datos: " + e.message);
    } finally {
      setLoadingUpload(false);
    }
  };

  const handleTripsUpdate = (newTrips) => {
    setTrips(newTrips);
    setAisData(d => d ? { ...d, trips: newTrips } : d);
  };

  const goTab = (t) => { setTab(t); if (t !== "Viajes") setViewing(null); };

  if (loading) return <><style>{CSS}</style><div className="loading"><div className="loading-txt">Cargando...</div></div></>;
  if (!session) return <><style>{CSS}</style><LoginPage /></>;
  if (loadingUpload) return <><style>{CSS}</style><div className="loading"><div className="loading-txt">Cargando datos AIS...</div></div></>;

  const tabLabel = tab === "Viajes" && viewing !== null ? `Viaje #${trips[viewing]?.id}` : tab;

  return (
    <>
      <style>{CSS}</style>
      <div className="shell">
        <aside className="sb">
          <div className="sb-brand">
            <div className="sb-icon">📡</div>
            <div className="sb-name">AIS Analyzer</div>
            <div className="sb-sub">BG Tiger · Análisis AIS</div>
          </div>
          <nav className="sb-nav">
            <div className="sb-sec">Módulo</div>
            {TABS.map(t => (
              <button key={t} className={`sb-item ${tab===t?"active":""}`} onClick={()=>goTab(t)}>
                <span className="sb-item-dot">{t==="Dashboard"?"📊":t==="Viajes"?"🗺️":"📤"}</span>
                <span className="sb-item-lbl">{t}</span>
              </button>
            ))}
          </nav>
          <div className="sb-footer">
            <div className="sb-email">{session.user.email}</div>
            <button className="sb-back" onClick={()=>window.open(PORTAL_HOME_URL,"_self")}>← Portal</button>
            <button className="sb-logout" onClick={()=>supabase.auth.signOut()}>Cerrar sesión</button>
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <span className="topbar-title">AIS Analyzer</span>
            <span className="topbar-sep">·</span>
            <span className="topbar-sub">{tabLabel}</span>
            {aisData && <span className="topbar-file">📡 {aisData.filename} · {trips.length} viajes</span>}
          </div>

          <div className="page-body">
            {tab === "Upload" && (
              <Upload onLoad={handleLoad} existingUploads={existingUploads} onSelectUpload={handleSelectUpload} />
            )}

            {tab === "Dashboard" && (
              <Dashboard data={aisData ? {...aisData,trips} : null} onGoTrips={()=>goTab("Viajes")} />
            )}

            {tab === "Viajes" && viewing === null && (
              aisData ? (
                <div style={{ padding:"28px 32px",maxWidth:1000 }}>
                  <div style={{ fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",textTransform:"uppercase",marginBottom:6 }}>AIS Analyzer · Viajes</div>
                  <h1 style={{ fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:6 }}>Viajes detectados — {trips.length}</h1>
                  <p style={{ fontSize:12,color:"var(--muted)",lineHeight:1.7,marginBottom:16,maxWidth:560 }}>
                    Hacé click en un viaje para abrirlo en el mapa. Clasificá cada WORKING_STOP y marcalo como validado.
                  </p>
                  <div style={{ marginBottom:10,fontSize:11,color:"var(--muted)" }}>
                    {trips.filter(t=>t.validated).length} validados · {trips.filter(t=>!t.validated).length} pendientes
                  </div>
                  <div style={{ background:"#fff",border:"1px solid #D6E0ED",borderRadius:10,overflow:"hidden" }}>
                    <div style={{ display:"grid",gridTemplateColumns:"36px 110px 1fr 65px 65px 75px 90px",gap:8,padding:"7px 14px",background:"#213363" }}>
                      {["#","Fechas","Zonas","Svc","Duración","Dist.","Estado"].map(h=>(
                        <span key={h} style={{ fontSize:9,fontWeight:600,color:"rgba(255,255,255,.55)",textTransform:"uppercase",letterSpacing:.5 }}>{h}</span>
                      ))}
                    </div>
                    {trips.map((t,i) => (
                      <div key={t.id}
                        style={{ display:"grid",gridTemplateColumns:"36px 110px 1fr 65px 65px 75px 90px",alignItems:"center",gap:8,padding:"9px 14px",borderBottom:"1px solid #EEF2F7",cursor:"pointer",transition:"background .12s",background:t.validated?"#F0FFF4":"#fff",fontSize:12 }}
                        onMouseEnter={e=>e.currentTarget.style.background=t.validated?"#E8FFF2":"#F8FAFC"}
                        onMouseLeave={e=>e.currentTarget.style.background=t.validated?"#F0FFF4":"#fff"}
                        onClick={()=>setViewing(i)}>
                        <span style={{ fontFamily:"var(--mono)",fontSize:11,fontWeight:700,color:"#235C96",textAlign:"center" }}>{t.id}</span>
                        <span style={{ fontFamily:"var(--mono)",fontSize:10,color:"#6381A7",lineHeight:1.4 }}>
                          {new Date(t.dateStart).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"})}<br/>
                          {new Date(t.dateEnd).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"})}
                        </span>
                        <span style={{ display:"flex",gap:3,flexWrap:"wrap" }}>
                          {t.zones.slice(0,3).map(z=>(
                            <span key={z} style={{ fontSize:8,padding:"1px 5px",borderRadius:3,background:"#EEF2F7",color:"#6381A7",fontFamily:"var(--mono)" }}>{z.replace(/_/g," ")}</span>
                          ))}
                        </span>
                        <span style={{ fontSize:14,fontWeight:700,color:"#1E7A4A",textAlign:"center" }}>{t.nServices}</span>
                        <span style={{ fontFamily:"var(--mono)",fontSize:11,color:"#6381A7",textAlign:"right" }}>{t.durationHs?.toFixed(0)}h</span>
                        <span style={{ fontFamily:"var(--mono)",fontSize:11,color:"#6381A7",textAlign:"right" }}>{t.distNm}nm</span>
                        <span style={{ fontFamily:"var(--mono)",fontSize:8,padding:"2px 7px",borderRadius:3,background:t.validated?"#D1FAE5":"#F3F4F6",color:t.validated?"#065F46":"#6B7280",textAlign:"center" }}>
                          {t.validated?"✓ OK":"Pendiente"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="no-file">
                  <div className="no-file-icon">🗺️</div>
                  <div className="no-file-title">Primero subí el archivo AIS</div>
                  <div className="no-file-desc">Andá a Upload y cargá el Excel de VesselFinder para ver los viajes acá.</div>
                  <button className="go-btn" onClick={()=>goTab("Upload")}>→ Ir a Upload</button>
                </div>
              )
            )}

            {tab === "Viajes" && viewing !== null && (
              <TripViewer
                trips={trips}
                setTrips={handleTripsUpdate}
                initialIdx={viewing}
                onBack={()=>setViewing(null)}
              />
            )}
          </div>
        </main>
      </div>
    </>
  );
}
