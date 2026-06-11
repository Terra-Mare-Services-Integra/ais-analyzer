import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { ZONES, STATES, SERVICE_TYPES } from "../lib/ais_engine";
import { supabase } from "../lib/supabase";

// ─── TIMEZONE ────────────────────────────────────────────────────────────────
// Offset del operador. Hardcodeado UTC-3 (Argentina / ART).
// En el futuro puede venir de configuración de usuario.
const TZ_OFFSET_HS = -3;
const TZ_LABEL     = "ART";

// Convierte un Date UTC al equivalente local del operador (sin cambiar el objeto).
// Devuelve un Date que, leído con getUTC*, da la hora local correcta.
function toLocal(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return new Date(dt.getTime() + TZ_OFFSET_HS * 3600000);
}

// ─── HELPERS DE FECHA ────────────────────────────────────────────────────────
// Todos los helpers leen con getUTC* sobre el objeto ya desplazado por toLocal().
// Así la lógica de offset está en UN solo lugar.

// Fecha local: "14/11/24"
const fmtDate = d => {
  const loc = toLocal(d);
  if (!loc) return "—";
  return `${String(loc.getUTCDate()).padStart(2,"0")}/${String(loc.getUTCMonth()+1).padStart(2,"0")}/${String(loc.getUTCFullYear()).slice(-2)}`;
};

// Hora local: "23:04"
const fmtTime = d => {
  const loc = toLocal(d);
  if (!loc) return "—";
  return `${String(loc.getUTCHours()).padStart(2,"0")}:${String(loc.getUTCMinutes()).padStart(2,"0")}`;
};

// Hora UTC pura: "02:04"
const fmtTimeUTC = d => {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return `${String(dt.getUTCHours()).padStart(2,"0")}:${String(dt.getUTCMinutes()).padStart(2,"0")}`;
};

// Datetime completo para tooltips del mapa: "14/11/24 23:04 ART · 02:04 UTC"
const fmtDatetime = d => {
  if (!d) return "—";
  return `${fmtDate(d)} ${fmtTime(d)} ${TZ_LABEL} · ${fmtTimeUTC(d)} UTC`;
};

// Rango de fechas para el header del viaje: "14/11/24 23:04 ART → 15/11/24 10:04 ART"
const fmtRange = (start, end) => {
  if (!start || !end) return "—";
  return `${fmtDate(start)} ${fmtTime(start)} ${TZ_LABEL} → ${fmtDate(end)} ${fmtTime(end)} ${TZ_LABEL}`;
};

// UX-15: duración legible "4d 15h" en vez de solo "h"
function fmtDuration(hs) {
  if (hs == null || isNaN(hs)) return "—";
  const days = Math.floor(hs / 24);
  const hrs  = Math.round(hs % 24);
  if (days > 0) return `${days}d ${hrs}h`;
  return `${hrs}h`;
}

// ─── COLORES POR NÚMERO DE SERVICIO ──────────────────────────────────────────
const SVC_COLORS = ["#2196F3","#FF9800","#9C27B0","#4CAF50","#F44336","#00BCD4","#FF5722"];
const svcColor = n => n != null ? SVC_COLORS[(n-1) % SVC_COLORS.length] : "#9E9E9E";

// ─── MAP FIT (solo al montar, nunca en clasificaciones) ───────────────────────
function MapFit({ points }) {
  const map    = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !points?.length) return;
    const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    if ([minLat,maxLat,minLon,maxLon].some(v => !Number.isFinite(v))) return;
    map.fitBounds([[minLat-.05,minLon-.05],[maxLat+.05,maxLon+.05]],{padding:[20,20],maxZoom:13});
    fitted.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const SVCS_CLASIFICABLES = ["AGUA","SLOP","LUBRICANTES","ALIJO_ZC","ALIJO_ZA","ALIJO_ZD"];
const ZONAS_OP = ["ZONA_COMUN","ZONA_ALFA","ZONA_DELTA","RECALADA","KM171"];
const GAP_UMBRAL_HS = 2; // UX-19: gap en datos AIS

// ─── SERVICE EDITOR MODAL ────────────────────────────────────────────────────
function ServiceEditor({ point, onSave, onClose, maxSvcNum }) {
  const [svc,    setSvc]    = useState(
    point.tipo_servicio && !["SIN_CLASIFICAR","BORRADO"].includes(point.tipo_servicio)
      ? point.tipo_servicio : "AGUA"
  );
  const [zona,   setZona]   = useState(
    point.zona_servicio && ZONAS_OP.includes(point.zona_servicio)
      ? point.zona_servicio : "ZONA_COMUN"
  );
  const [svcNum, setSvcNum] = useState(point.servicio_num ?? null);

  const svcNums = Array.from({ length: (maxSvcNum||0)+1 }, (_,i) => i+1);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const sogDisplay = point.sog != null ? `${Number(point.sog).toFixed(1)} kn` : "SOG —";

  return (
    <div role="dialog" aria-modal="true"
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div style={{background:"#fff",borderRadius:14,padding:22,width:"100%",maxWidth:360,boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:14,fontWeight:700,color:"#213363",marginBottom:2}}>Clasificar punto</div>
        <div style={{fontSize:10,color:"#6381A7",fontFamily:"var(--mono)",marginBottom:16}}>
          {fmtDate(point.datetime)} {fmtTime(point.datetime)} {TZ_LABEL}
          <span style={{marginLeft:6,color:"#A5B5CC"}}>({fmtTimeUTC(point.datetime)} UTC)</span>
          {" · "}{sogDisplay} · {point.zone}
        </div>

        <div style={{fontSize:10,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:".8px",marginBottom:8}}>Número de servicio</div>
        <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
          <button style={{padding:"7px 12px",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:svcNum===null?700:400,border:`1px solid ${svcNum===null?"#EF5350":"#D6E0ED"}`,background:svcNum===null?"#FFF5F5":"#fff",color:svcNum===null?"#C0392B":"#6381A7"}}
            onClick={()=>setSvcNum(null)}>✕ No es servicio</button>
          {svcNums.map(n=>(
            <button key={n} style={{padding:"7px 14px",borderRadius:6,fontSize:11,cursor:"pointer",fontWeight:svcNum===n?700:400,border:`1px solid ${svcNum===n?svcColor(n):"#D6E0ED"}`,background:svcNum===n?`${svcColor(n)}18`:"#fff",color:svcNum===n?svcColor(n):"#213363"}}
              onClick={()=>{setSvcNum(n);if(!svc||["BORRADO","SIN_CLASIFICAR"].includes(svc))setSvc("AGUA");}}>
              S{n}{n===(maxSvcNum||0)+1?" (nuevo)":""}
            </button>
          ))}
        </div>

        {svcNum!==null&&<>
          <div style={{fontSize:10,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:".8px",marginBottom:8}}>Tipo de servicio</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:14}}>
            {SVCS_CLASIFICABLES.map(s=>{
              const info=SERVICE_TYPES[s], sel=svc===s;
              return <button key={s} style={{padding:"8px 6px",borderRadius:6,fontSize:10,cursor:"pointer",textAlign:"center",border:`1.5px solid ${sel?info.color:"#D6E0ED"}`,background:sel?`${info.color}18`:"#fff",color:sel?info.color:"#213363",fontWeight:sel?700:400,transition:"all .12s"}}
                onClick={()=>setSvc(s)}>{info.label}</button>;
            })}
          </div>
          <div style={{fontSize:10,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:".8px",marginBottom:8}}>Zona operativa</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:16}}>
            {ZONAS_OP.map(z=>{const sel=zona===z;return<button key={z} style={{padding:"7px 8px",borderRadius:6,fontSize:10,cursor:"pointer",textAlign:"center",border:`1.5px solid ${sel?"#235C96":"#D6E0ED"}`,background:sel?"#EFF6FF":"#fff",color:sel?"#235C96":"#213363",fontWeight:sel?600:400,transition:"all .12s"}}
              onClick={()=>setZona(z)}>{z.replace(/_/g," ")}</button>;})}
          </div>
        </>}

        <div style={{display:"flex",gap:7}}>
          <button style={{flex:1,padding:"9px 0",borderRadius:7,background:"#235C96",color:"#fff",border:"none",fontSize:12,fontWeight:600,cursor:"pointer"}}
            onClick={()=>onSave({...point,tipo_servicio:svcNum===null?"BORRADO":svc,zona_servicio:zona,servicio_num:svcNum})}>
            ✓ Confirmar</button>
          <button style={{padding:"9px 12px",borderRadius:7,border:"1px solid #D6E0ED",background:"#fff",color:"#6381A7",fontSize:11,cursor:"pointer"}}
            onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function TripViewer({ trips, setTrips, initialIdx=0, onBack }) {
  const [tripIdx,    setTripIdx]    = useState(initialIdx);
  const [selPt,      setSelPt]      = useState(null);
  const [editing,    setEditing]    = useState(null);
  const [filter,     setFilter]     = useState("ALL");
  const [saving,     setSaving]     = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  // UX-14: filtro de lista
  const [listFilter, setListFilter] = useState("PENDING");

  const trip   = trips[tripIdx];
  const points = trip?.points || [];

  // UX-03: resetear filtro al cambiar de viaje
  const goTrip = useCallback(newIdx => {
    setTripIdx(newIdx);
    setSelPt(null);
    setEditing(null);
    setFilter("ALL"); // UX-03: siempre "Todo" al entrar a un viaje nuevo
  }, []);

  // UX-05: próximo pendiente
  const goNextPending = useCallback(() => {
    const idx = trips.findIndex((t,i) => i > tripIdx && !t.validated);
    if (idx !== -1) goTrip(idx);
  }, [trips, tripIdx, goTrip]);

  const goPrevPending = useCallback(() => {
    let idx = -1;
    for (let i = tripIdx-1; i >= 0; i--) { if (!trips[i].validated) { idx=i; break; } }
    if (idx !== -1) goTrip(idx);
  }, [trips, tripIdx, goTrip]);

  const hasPrevPending = trips.slice(0,tripIdx).some(t=>!t.validated);
  const hasNextPending = trips.slice(tripIdx+1).some(t=>!t.validated);

  // UX-05: atajos de teclado N / P / V / Escape
  useEffect(() => {
    const h = e => {
      if (editing) return; // modal abierto — no interferir
      if (e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA") return;
      if (e.key==="n"||e.key==="N") goNextPending();
      if (e.key==="p"||e.key==="P") goPrevPending();
      if ((e.key==="v"||e.key==="V") && trip && !trip.validated) markValidated();
      if (e.key==="Escape") onBack();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, tripIdx, trips]);

  // Puntos visibles según filtro
  const visible = useMemo(() => {
    if (filter==="SVC") return points.filter(p=>p.state==="WORKING_STOP");
    if (filter==="MOV") return points.filter(p=>p.state!=="IN_PORT");
    return points;
  }, [points, filter]);

  // Segmentos de ruta
  const segments = useMemo(() => {
    const segs=[];
    for (let i=0;i<points.length-1;i++) {
      segs.push({pos:[[points[i].lat,points[i].lon],[points[i+1].lat,points[i+1].lon]],color:STATES[points[i].state]?.color||"#999"});
    }
    return segs;
  }, [points]);

  // UX-11: contador de clasificación en ZC
  const zcPoints      = useMemo(()=>points.filter(p=>p.zone==="ZONA_COMUN"&&p.state==="WORKING_STOP"),[points]);
  const zcClasificados= useMemo(()=>zcPoints.filter(p=>p.servicio_num!=null),[zcPoints]);
  const zcFaltantes   = zcPoints.length - zcClasificados.length;

  // UX-08: clusters de puntos consecutivos en ZC con SOG < 1 kn
  const clusters = useMemo(() => {
    const result=[];
    let current=null;
    points.forEach((p,i)=>{
      const inCluster = p.zone==="ZONA_COMUN" && p.sog!=null && p.sog<1;
      if (inCluster) {
        if (!current) current={startIdx:i,endIdx:i,points:[p]};
        else { current.endIdx=i; current.points.push(p); }
      } else {
        if (current&&current.points.length>=3) result.push({...current});
        current=null;
      }
    });
    if (current&&current.points.length>=3) result.push(current);
    return result;
  }, [points]);

  const maxSvcNum = Math.max(0,...points.map(p=>p.servicio_num||0));

  // ─── BUG-01 FIX: handleSave ───────────────────────────────────────────────
  // Separado en dos fases:
  // Fase 1 — actualización local (siempre exitosa, síncrona).
  // Fase 2 — persistencia en Supabase (solo si hay supabaseId; errores reales
  //           de red/RLS activan el mensaje de error, no un if vacío).
  const handleSave = useCallback(async updated => {
    // Fase 1: actualización local — inmediata, nunca falla
    const newTrips = trips.map((t,ti)=>{
      if (ti!==tripIdx) return t;
      const newPoints = t.points.map((p,pi)=>pi===editing.idx?updated:p);
      const servicios = new Set(newPoints.filter(p=>p.servicio_num!=null&&p.tipo_servicio!=="BORRADO").map(p=>p.servicio_num));
      return {...t, points:newPoints, nServices:servicios.size};
    });
    setTrips(newTrips);
    setEditing(null);
    setSelPt(null);

    // Fase 2: persistencia remota — solo si el viaje tiene ID en Supabase
    const ct = newTrips[tripIdx];
    if (!ct?.supabaseId) {
      // Viaje solo en memoria (cargado desde Excel, no persistido aún).
      // El guardado local ya ocurrió — no mostrar nada.
      return;
    }

    setSaving(true);
    setSaveStatus(null);
    try {
      const dtStr = updated.datetime instanceof Date
        ? updated.datetime.toISOString()
        : new Date(updated.datetime).toISOString();

      const { error: errPt } = await supabase
        .from("ais_points")
        .update({
          tipo_servicio: updated.tipo_servicio,
          zona_servicio: updated.zona_servicio,
          servicio_num:  updated.servicio_num,
        })
        .eq("trip_id", ct.supabaseId)
        .eq("datetime", dtStr);
      if (errPt) throw errPt;

      const { error: errTrip } = await supabase
        .from("ais_trips")
        .update({ n_services: newTrips[tripIdx].nServices })
        .eq("id", ct.supabaseId);
      if (errTrip) throw errTrip;

      setSaveStatus("ok");
    } catch(e) {
      console.error("[TripViewer] Error guardando en Supabase:", e);
      setSaveStatus("error");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 2500);
    }
  }, [trips, tripIdx, editing, setTrips]);

  // markValidated con advertencia si hay ZC sin clasificar
  const markValidated = useCallback(async () => {
    if (zcFaltantes > 0) {
      const ok = window.confirm(`Hay ${zcFaltantes} punto${zcFaltantes>1?"s":""} en Zona Común sin clasificar. ¿Validar igualmente?`);
      if (!ok) return;
    }
    const newTrips = trips.map((t,i)=>i===tripIdx?{...t,validated:true}:t);
    setTrips(newTrips);
    const ct = newTrips[tripIdx];
    if (ct?.supabaseId) {
      const {error} = await supabase.from("ais_trips").update({validated:true}).eq("id",ct.supabaseId);
      if (error) console.error("[TripViewer] Error validando:",error.message);
    }
    const next = newTrips.findIndex((t,i)=>i>tripIdx&&!t.validated);
    if (next!==-1) goTrip(next);
    else if (tripIdx<trips.length-1) goTrip(tripIdx+1);
  }, [trips, tripIdx, setTrips, zcFaltantes, goTrip]);

  const S = {
    btn:(active,color)=>({fontSize:11,padding:"5px 11px",borderRadius:6,border:`1px solid ${active?(color||"#235C96"):"#D6E0ED"}`,background:active?(color?"#fff":"#EFF6FF"):"#fff",color:active?(color||"#235C96"):"#6381A7",cursor:"pointer",fontFamily:"var(--sans)",fontWeight:active?600:400}),
    fchip:active=>({fontSize:9,padding:"2px 7px",borderRadius:10,border:`1px solid ${active?"#235C96":"#D6E0ED"}`,background:active?"#EFF6FF":"#fff",color:active?"#235C96":"#6381A7",cursor:"pointer",fontFamily:"var(--mono)"}),
  };

  if (!trip) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"calc(100vh - 52px)",color:"var(--muted)",fontSize:13}}>No hay viaje seleccionado.</div>;

  // UX-15: duración legible
  const durLabel = fmtDuration(trip.durationHs);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 52px)"}}>

      {/* ── TOPBAR ── */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 16px",borderBottom:"1px solid #D6E0ED",background:"#fff",flexShrink:0,flexWrap:"wrap"}}>
        <button style={S.btn(false)} onClick={onBack}>← Lista</button>
        <button style={S.btn(false)} onClick={()=>goTrip(Math.max(0,tripIdx-1))} disabled={tripIdx===0} aria-label="Anterior">‹</button>

        {/* UX-01: título siempre sincronizado con tripIdx — fuente única de verdad */}
        <span style={{fontFamily:"var(--mono)",fontSize:11,fontWeight:700,color:"#213363"}}>
          Viaje #{trip.id}
          {" — "}
          {fmtRange(trip.dateStart, trip.dateEnd)}
          {/* UX-15: duración explícita */}
          <span style={{marginLeft:6,fontSize:10,color:"#6381A7",fontWeight:400}}>({durLabel})</span>
          {trip.incomplete&&<span style={{marginLeft:8,fontSize:9,color:"#92400E",background:"#FEF3C7",padding:"1px 6px",borderRadius:3}}>⚠ Incompleto</span>}
        </span>

        <button style={S.btn(false)} onClick={()=>goTrip(Math.min(trips.length-1,tripIdx+1))} disabled={tripIdx===trips.length-1} aria-label="Siguiente">›</button>

        {/* UX-05: botones próximo/anterior pendiente */}
        {hasPrevPending&&<button style={{...S.btn(false),fontSize:10}} onClick={goPrevPending} title="Atajo: P">‹ Pendiente</button>}
        {hasNextPending&&<button style={{...S.btn(true),fontSize:10,background:"#FFF7ED",color:"#92400E",borderColor:"#FCD34D"}} onClick={goNextPending} title="Atajo: N">Pendiente ›</button>}

        {saving&&<span style={{fontSize:10,color:"#6381A7",fontFamily:"var(--mono)"}}>Guardando…</span>}
        {saveStatus==="ok"&&<span style={{fontSize:10,color:"#1E7A4A",fontFamily:"var(--mono)"}}>✓ Guardado</span>}
        {saveStatus==="error"&&<span style={{fontSize:10,color:"#C0392B",fontFamily:"var(--mono)"}}>⚠ Error al guardar</span>}

        {/* UX-05: atajo V = validar */}
        <div style={{marginLeft:"auto"}}>
          {trip.validated
            ? <span style={{fontSize:11,color:"#1E7A4A",fontWeight:600}}>✓ Validado</span>
            : <button style={{...S.btn(true),background:"#1E7A4A",color:"#fff",borderColor:"#1E7A4A"}} onClick={markValidated} title="Atajo: V">✓ Marcar validado</button>
          }
        </div>
      </div>

      {/* UX-11: barra de progreso de clasificación en ZC */}
      {zcPoints.length>0&&(
        <div style={{padding:"5px 16px",background:zcFaltantes>0?"#FFFBEB":"#F0FFF4",borderBottom:"1px solid #EEF2F7",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <span style={{fontSize:10,color:zcFaltantes>0?"#854F0B":"#065F46",fontFamily:"var(--mono)"}}>
            ZC: {zcClasificados.length}/{zcPoints.length} clasificados
            {zcFaltantes>0&&` — ${zcFaltantes} faltante${zcFaltantes>1?"s":""}`}
          </span>
          <div style={{flex:1,height:4,background:"#EEF2F7",borderRadius:2,overflow:"hidden",maxWidth:200}}>
            <div style={{width:`${zcPoints.length?zcClasificados.length/zcPoints.length*100:0}%`,height:"100%",background:zcFaltantes>0?"#FFA726":"#22C55E",transition:"width .3s"}}/>
          </div>
          {/* UX-05: atajo teclado hint */}
          <span style={{fontSize:9,color:"#A5B5CC",fontFamily:"var(--mono)"}}>N=sig.pendiente · V=validar · Esc=salir</span>
        </div>
      )}

      {/* ── BODY ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",flex:1,minHeight:0}}>

        {/* ── MAPA ── */}
        <div style={{position:"relative",height:"100%"}}>
          <MapContainer key={tripIdx} center={[-34.7,-58.0]} zoom={9} style={{height:"100%",width:"100%"}}>
            <TileLayer attribution="© OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
            <MapFit points={points}/>

            {/* UX-16: zonas con relleno semitransparente + tooltip */}
            {Object.entries(ZONES).map(([key,z])=>(
              <Polygon key={key}
                positions={z.polygon.map(([a,b])=>[a,b])}
                pathOptions={{color:z.color,weight:1.5,opacity:0.7,fillColor:z.color,fillOpacity:0.08,dashArray:"4,4"}}>
                <Popup><strong>{z.label}</strong></Popup>
              </Polygon>
            ))}

            {/* Ruta */}
            {segments.map((s,i)=><Polyline key={i} positions={s.pos} color={s.color} weight={3} opacity={0.85}/>)}

            {/* Puntos WORKING_STOP */}
            {points.map((p,i)=>{
              if (p.state!=="WORKING_STOP") return null;
              const col = p.servicio_num!=null?svcColor(p.servicio_num):"#9E9E9E";
              const isSel = selPt===i;
              return (
                <CircleMarker key={i} center={[p.lat,p.lon]} radius={isSel?10:8}
                  color={isSel?"#fff":col} weight={isSel?3:2} fillColor={col} fillOpacity={0.9}
                  eventHandlers={{click:()=>{setSelPt(i);setEditing({idx:i,pt:p});}}}>
                  <Popup>
                    <div style={{fontSize:12,minWidth:190}}>
                      <strong>{fmtDate(p.datetime)} {fmtTime(p.datetime)} {TZ_LABEL}</strong><br/>
                      <span style={{fontSize:10,color:"#999"}}>{fmtTimeUTC(p.datetime)} UTC</span><br/>
                      SOG: {p.sog!=null?`${Number(p.sog).toFixed(1)} kn`:"—"} | {p.zone}<br/>
                      {STATES[p.state]?.label}
                      {p.servicio_num!=null&&p.tipo_servicio&&!["SIN_CLASIFICAR","BORRADO"].includes(p.tipo_servicio)&&(
                        <><br/><em style={{color:col}}>S{p.servicio_num} · {SERVICE_TYPES[p.tipo_servicio]?.label}</em></>
                      )}
                      <button style={{marginTop:7,width:"100%",padding:"6px 0",borderRadius:6,background:"#235C96",color:"#fff",border:"none",fontSize:11,cursor:"pointer",fontWeight:600}}
                        onClick={()=>setEditing({idx:i,pt:p})}>✏ Clasificar</button>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}

            {/* UX-12: marcadores inicio/fin con etiqueta S/F */}
            {points.length>0&&<>
              <CircleMarker center={[points[0].lat,points[0].lon]} radius={9} color="#fff" weight={3} fillColor="#213363" fillOpacity={1}>
                <Popup><strong>S — Zarpe</strong><br/>{fmtDate(trip.dateStart)} {fmtTime(trip.dateStart)} {TZ_LABEL}<br/><span style={{fontSize:10,color:"#999"}}>{fmtTimeUTC(trip.dateStart)} UTC</span></Popup>
              </CircleMarker>
              <CircleMarker center={[points[points.length-1].lat,points[points.length-1].lon]} radius={9} color="#fff" weight={3} fillColor={trip.incomplete?"#F59E0B":"#DC2626"} fillOpacity={1}>
                <Popup><strong>{trip.incomplete?"⚠ Fin de datos":"F — Arribo"}</strong><br/>{fmtDate(trip.dateEnd)} {fmtTime(trip.dateEnd)} {TZ_LABEL}<br/><span style={{fontSize:10,color:"#999"}}>{fmtTimeUTC(trip.dateEnd)} UTC</span></Popup>
              </CircleMarker>
            </>}
          </MapContainer>
        </div>

        {/* ── PANEL DERECHO ── */}
        <div style={{display:"flex",flexDirection:"column",borderLeft:"1px solid #D6E0ED",background:"#fff",overflow:"hidden"}}>

          {/* Info del viaje */}
          <div style={{padding:"10px 14px",borderBottom:"1px solid #D6E0ED",background:"#F8FAFC",flexShrink:0}}>
            <div style={{fontSize:13,fontWeight:700,color:"#213363"}}>
              Viaje #{trip.id}
              {trip.incomplete&&<span style={{marginLeft:6,fontSize:9,background:"#FEF3C7",color:"#92400E",padding:"1px 5px",borderRadius:3}}>INCOMPLETO</span>}
            </div>
            <div style={{fontSize:10,color:"#6381A7",fontFamily:"var(--mono)",marginTop:1,lineHeight:1.6}}>
              {fmtDate(trip.dateStart)} {fmtTime(trip.dateStart)} {TZ_LABEL}<br/>
              → {fmtDate(trip.dateEnd)} {fmtTime(trip.dateEnd)} {TZ_LABEL}
              <span style={{marginLeft:6,fontSize:8,color:"#A5B5CC"}}>({fmtTimeUTC(trip.dateStart)}–{fmtTimeUTC(trip.dateEnd)} UTC)</span>
            </div>
          </div>

          {/* Stats — UX-15: duración legible */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,padding:"9px 12px",borderBottom:"1px solid #EEF2F7",flexShrink:0}}>
            {[
              {v:durLabel,            l:"Duración"},
              {v:trip.nServices||0,   l:"Servicios", c:"#1E7A4A"},
              {v:`${trip.distNm??"—"} nm`, l:"Distancia"},
            ].map(k=>(
              <div key={k.l} style={{background:"#EEF2F7",borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                <div style={{fontSize:14,fontWeight:700,color:k.c||"#213363"}}>{k.v}</div>
                <div style={{fontSize:9,color:"#6381A7",textTransform:"uppercase",letterSpacing:".4px",marginTop:1}}>{k.l}</div>
              </div>
            ))}
          </div>

          {/* UX-18: mini timeline de estados */}
          <TripTimeline points={points} onSegmentClick={state=>{
            if (state==="WORKING_STOP") setFilter("SVC");
            else if (state==="IN_PORT") setFilter("ALL");
            else setFilter("MOV");
          }}/>

          {/* UX-08: clusters detectados */}
          {clusters.length>0&&(
            <div style={{padding:"6px 12px",borderBottom:"1px solid #EEF2F7",flexShrink:0}}>
              <div style={{fontSize:9,color:"#6381A7",textTransform:"uppercase",letterSpacing:1,marginBottom:4,fontFamily:"var(--mono)"}}>Clusters ZC detectados</div>
              {clusters.map((c,ci)=>{
                const durMs = points[c.endIdx].datetime - points[c.startIdx].datetime;
                const durH  = (durMs/3600000).toFixed(1);
                const allSameNum = c.points.every(p=>p.servicio_num===c.points[0].servicio_num&&c.points[0].servicio_num!=null);
                return (
                  <div key={ci} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0",borderBottom:ci<clusters.length-1?"1px solid #F5F7FA":"none"}}>
                    <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:allSameNum?`${svcColor(c.points[0].servicio_num)}18`:"#FEF3C7",color:allSameNum?svcColor(c.points[0].servicio_num):"#92400E",fontFamily:"var(--mono)"}}>
                      {allSameNum?`S${c.points[0].servicio_num}`:"Sin clasificar"}
                    </span>
                    <span style={{fontSize:9,color:"#6381A7",fontFamily:"var(--mono)",flex:1}}>
                      {c.points.length} pts · {durH}h
                    </span>
                    {!allSameNum&&(
                      <button style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"#EFF6FF",color:"#235C96",border:"none",cursor:"pointer"}}
                        onClick={()=>{setFilter("SVC");setSelPt(c.startIdx);setEditing({idx:c.startIdx,pt:points[c.startIdx]});}}>
                        Clasificar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Filtros */}
          <div style={{padding:"7px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #EEF2F7",flexShrink:0}}>
            <span style={{fontSize:9,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:1}}>
              {visible.length} punto{visible.length!==1?"s":""}
            </span>
            <div style={{display:"flex",gap:3}}>
              {[["ALL","Todo"],["SVC","Svc"],["MOV","Mov"]].map(([f,l])=>(
                <button key={f} style={S.fchip(filter===f)} onClick={()=>setFilter(f)}>{l}</button>
              ))}
            </div>
          </div>

          {/* UX-03: mensaje cuando filtro SVC no tiene resultados */}
          {filter==="SVC"&&visible.length===0&&(
            <div style={{padding:"16px 12px",textAlign:"center"}}>
              <div style={{fontSize:11,color:"#6381A7",marginBottom:8}}>No hay puntos WORKING_STOP en este viaje.</div>
              <button style={{fontSize:11,color:"#235C96",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}
                onClick={()=>setFilter("ALL")}>Ver todos los puntos →</button>
            </div>
          )}

          {/* Lista de puntos */}
          <div style={{flex:1,overflowY:"auto"}}>
            <PointsList
              visible={visible}
              points={points}
              selPt={selPt}
              setSelPt={setSelPt}
              setEditing={setEditing}
            />
          </div>
        </div>
      </div>

      {editing&&(
        <ServiceEditor point={editing.pt} onSave={handleSave}
          onClose={()=>{setEditing(null);setSelPt(null);}} maxSvcNum={maxSvcNum}/>
      )}
    </div>
  );
}

// ─── UX-18: MINI TIMELINE DE ESTADOS ─────────────────────────────────────────
function TripTimeline({ points, onSegmentClick }) {
  if (!points?.length) return null;
  const total = points.length;
  // Agrupar segmentos contiguos por estado
  const segs = [];
  let cur = null;
  points.forEach((p,i) => {
    if (!cur || cur.state!==p.state) {
      if (cur) segs.push(cur);
      cur = {state:p.state, count:1, color:STATES[p.state]?.color||"#ccc"};
    } else { cur.count++; }
  });
  if (cur) segs.push(cur);

  return (
    <div style={{padding:"6px 12px",borderBottom:"1px solid #EEF2F7",flexShrink:0}}>
      <div style={{fontSize:9,color:"#6381A7",textTransform:"uppercase",letterSpacing:1,marginBottom:4,fontFamily:"var(--mono)"}}>Timeline</div>
      <div style={{display:"flex",height:10,borderRadius:4,overflow:"hidden",gap:1}}>
        {segs.map((s,i)=>(
          <div key={i} title={`${STATES[s.state]?.label||s.state} (${s.count} pts)`}
            style={{flex:s.count/total,background:s.color,cursor:"pointer",minWidth:2,transition:"opacity .15s"}}
            onClick={()=>onSegmentClick(s.state)}
            onMouseEnter={e=>e.currentTarget.style.opacity=".7"}
            onMouseLeave={e=>e.currentTarget.style.opacity="1"}/>
        ))}
      </div>
      <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
        {Object.entries(STATES).map(([k,v])=>{
          const cnt = points.filter(p=>p.state===k).length;
          if (!cnt) return null;
          return <span key={k} style={{fontSize:8,color:v.color,fontFamily:"var(--mono)"}}>{v.label}: {cnt}</span>;
        })}
      </div>
    </div>
  );
}

// ─── LISTA DE PUNTOS ──────────────────────────────────────────────────────────
// UX-06: badge ZC + separadores de entrada/salida
// UX-07: fondo amarillo en SOG < 0.5
// UX-09: fecha solo cuando cambia (agrupada)
// UX-10: número de fila #
// UX-19: gap de datos AIS
// UX-20: columna de SOG coloreada
function PointsList({ visible, points, selPt, setSelPt, setEditing }) {
  let lastDate = null;

  return (
    <>
      {visible.length===0&&(
        <div style={{padding:"20px 12px",textAlign:"center",fontSize:11,color:"#A5B5CC"}}>
          No hay puntos en este viaje.
        </div>
      )}
      {visible.map((p, vi) => {
        const realIdx = points.indexOf(p);
        const isWS    = p.state==="WORKING_STOP";
        const isZC    = p.zone==="ZONA_COMUN";
        const isSlowStop = p.sog!=null&&p.sog<=0.5;
        const col     = isWS?(p.servicio_num!=null?svcColor(p.servicio_num):"#9E9E9E"):(STATES[p.state]?.color||"#999");
        const isSel   = selPt===realIdx;

        // UX-09: agrupar por fecha LOCAL (ART), no UTC
        const thisDate = fmtDate(p.datetime);
        const showDate = thisDate!==lastDate;
        lastDate = thisDate;

        // UX-06: detectar entrada/salida de ZC
        const prevVisible = vi>0?visible[vi-1]:null;
        const enteredZC = isZC && prevVisible && prevVisible.zone!=="ZONA_COMUN";
        const exitedZC  = !isZC && prevVisible && prevVisible.zone==="ZONA_COMUN";

        // UX-19: gap entre puntos consecutivos
        let gapWarning = null;
        if (realIdx>0) {
          const prev = points[realIdx-1];
          const gapHs = (p.datetime - prev.datetime) / 3600000;
          if (gapHs > GAP_UMBRAL_HS) {
            gapWarning = `Gap de ${gapHs.toFixed(1)}h en datos AIS`;
          }
        }

        return (
          <div key={vi}>
            {/* UX-09: separador de fecha */}
            {showDate&&(
              <div style={{padding:"3px 10px",background:"#F8FAFC",fontSize:8,color:"#6381A7",fontFamily:"var(--mono)",borderBottom:"1px solid #EEF2F7",borderTop:vi>0?"1px solid #EEF2F7":"none",display:"flex",justifyContent:"space-between"}}>
                <span style={{fontWeight:600}}>{thisDate} {TZ_LABEL}</span>
              </div>
            )}

            {/* UX-19: gap warning */}
            {gapWarning&&(
              <div style={{padding:"2px 10px",background:"#FFFBEB",fontSize:8,color:"#92400E",fontFamily:"var(--mono)",borderBottom:"1px solid #FCD34D"}}>
                ⚠ {gapWarning}
              </div>
            )}

            {/* UX-06: separador entrada ZC */}
            {enteredZC&&(
              <div style={{padding:"2px 10px",background:"#EFF6FF",fontSize:8,color:"#235C96",fontFamily:"var(--mono)",borderBottom:"1px solid #BFDBFE",borderTop:"1px solid #BFDBFE",fontWeight:600}}>
                ↓ Entró a Zona Común
              </div>
            )}

            <div role="button" tabIndex={0}
              style={{
                display:"grid",gridTemplateColumns:"22px 54px 38px 1fr 16px",
                gap:4,padding:"5px 10px",
                borderBottom:"1px solid #F5F7FA",cursor:"pointer",alignItems:"center",
                // UX-07: fondo amarillo en paradas
                background:isSel?(isWS?"#F0FFF4":"#EFF6FF"):isSlowStop?"#FFFDE7":"transparent",
                borderLeft:isSel?`3px solid ${isWS?"#1E7A4A":"#235C96"}`:"3px solid transparent",
              }}
              onClick={()=>{setSelPt(realIdx);if(isWS)setEditing({idx:realIdx,pt:p});}}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){setSelPt(realIdx);if(isWS)setEditing({idx:realIdx,pt:p});}}}
            >
              {/* UX-10: número de fila */}
              <span style={{fontFamily:"var(--mono)",fontSize:8,color:"#C4CADC",textAlign:"center"}}>{realIdx+1}</span>

              {/* Hora: ART principal + UTC secundario */}
              <span style={{fontFamily:"var(--mono)",lineHeight:1.2}}>
                <span style={{fontSize:10,color:"#213363",display:"block"}}>{fmtTime(p.datetime)}</span>
                <span style={{fontSize:8,color:"#A5B5CC",display:"block"}}>{fmtTimeUTC(p.datetime)} UTC</span>
              </span>

              {/* SOG coloreado — UX-07: ancla si SOG=0, tooltip en SOG bajo */}
              <span
                style={{fontFamily:"var(--mono)",fontSize:10,textAlign:"right",color:p.sog===null?"#A5B5CC":p.sog>3?"#235C96":p.sog<=0.5?"#1E7A4A":"#854F0B"}}
                title={p.sog!=null&&p.sog<=0.5?"Velocidad muy baja (SOG < 0.5 kn)":undefined}
              >
                {p.sog===null?"—":p.sog===0
                  ?<span title="Velocidad muy baja (SOG < 0.5 kn)">⚓</span>
                  :p.sog!=null?`${Number(p.sog).toFixed(1)}`:"—"}
                {p.sog!==null&&p.sog!==0&&<span style={{fontSize:7}}>kn</span>}
              </span>

              {/* Etiqueta estado/servicio + UX-06: badge ZC */}
              <span style={{display:"flex",alignItems:"center",gap:3,overflow:"hidden"}}>
                <span style={{fontSize:8,padding:"2px 4px",borderRadius:3,background:`${col}18`,color:col,border:`1px solid ${col}44`,fontFamily:"var(--mono)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                  {p.servicio_num!=null
                    ?`S${p.servicio_num}${p.tipo_servicio&&!["SIN_CLASIFICAR","BORRADO"].includes(p.tipo_servicio)?` · ${SERVICE_TYPES[p.tipo_servicio]?.label||""}`:""}`
                    :(STATES[p.state]?.label||p.state)}
                </span>
                {/* UX-06: badge ZC */}
                {isZC&&<span style={{fontSize:7,padding:"1px 3px",borderRadius:2,background:"#DBEAFE",color:"#1E40AF",fontFamily:"var(--mono)",flexShrink:0}}>ZC</span>}
              </span>

              <span style={{fontSize:11,color:isSel?"#235C96":"#D6E0ED",textAlign:"center"}}>{isWS?"✏":""}</span>
            </div>

            {/* UX-06: separador salida ZC */}
            {exitedZC&&(
              <div style={{padding:"2px 10px",background:"#F8FAFC",fontSize:8,color:"#6381A7",fontFamily:"var(--mono)",borderBottom:"1px solid #EEF2F7"}}>
                ↑ Salió de Zona Común
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
