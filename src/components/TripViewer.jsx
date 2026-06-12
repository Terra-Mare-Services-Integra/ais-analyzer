import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { ZONES, SERVICE_TYPES } from "../lib/ais_engine";
import { supabase } from "../lib/supabase";

// ─── TIMEZONE ────────────────────────────────────────────────────────────────
const TZ_OFFSET_HS = -3;
const TZ_LABEL     = "ART";

function toLocal(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return new Date(dt.getTime() + TZ_OFFSET_HS * 3600000);
}

const fmtDate = d => {
  const loc = toLocal(d);
  if (!loc) return "—";
  return `${String(loc.getUTCDate()).padStart(2,"0")}/${String(loc.getUTCMonth()+1).padStart(2,"0")}/${String(loc.getUTCFullYear()).slice(-2)}`;
};

const fmtTime = d => {
  const loc = toLocal(d);
  if (!loc) return "—";
  return `${String(loc.getUTCHours()).padStart(2,"0")}:${String(loc.getUTCMinutes()).padStart(2,"0")}`;
};

const fmtTimeUTC = d => {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return `${String(dt.getUTCHours()).padStart(2,"0")}:${String(dt.getUTCMinutes()).padStart(2,"0")}`;
};

const fmtRange = (start, end) => {
  if (!start || !end) return "—";
  return `${fmtDate(start)} ${fmtTime(start)} ${TZ_LABEL} → ${fmtDate(end)} ${fmtTime(end)} ${TZ_LABEL}`;
};

function fmtDuration(hs) {
  if (hs == null || isNaN(hs)) return "—";
  const days = Math.floor(hs / 24);
  const hrs  = Math.round(hs % 24);
  if (days > 0) return `${days}d ${hrs}h`;
  return `${hrs}h`;
}

// ─── NUEVAS ETIQUETAS DE ESTADO ──────────────────────────────────────────────
// El campo "state" en ais_points ahora usa este vocabulario.
// C1/C2/C3... se derivan de servicio_num (no se almacenan como strings).
const LABEL_META = {
  ZARPE:        { label: "Zarpe",        color: "#213363", icon: "⚓" },
  LLEGADA:      { label: "Llegada",      color: "#1a3a6c", icon: "🏁" },
  ENTRADA_ZONA: { label: "Entrada Zona", color: "#1E40AF", icon: "→" },
  SALIDA_ZONA:  { label: "Salida Zona",  color: "#1E40AF", icon: "←" },
  TRANSITO:     { label: "Tránsito",     color: "#64B5F6", icon: "▶" },
  CLUSTER:      { label: "Cluster",      color: "#22C55E", icon: "●" }, // fallback
};

// Etiquetas asignables manualmente
const MANUAL_LABELS = ["ZARPE","LLEGADA","ENTRADA_ZONA","SALIDA_ZONA","TRANSITO"];

// Color para etiqueta de un punto (incluye C1/C2/C3...)
const SVC_COLORS = ["#2196F3","#FF9800","#9C27B0","#4CAF50","#F44336","#00BCD4","#FF5722","#E91E63"];
const svcColor   = n => n != null ? SVC_COLORS[(n - 1) % SVC_COLORS.length] : "#9E9E9E";

function pointColor(p) {
  if (p?.servicio_num != null) return svcColor(p.servicio_num);
  if (p?.state && LABEL_META[p.state]) return LABEL_META[p.state].color;
  return "#9E9E9E";
}

function pointLabel(p) {
  if (p?.servicio_num != null) return `C${p.servicio_num}`;
  if (p?.state && LABEL_META[p.state]) return LABEL_META[p.state].label;
  return p?.state ?? "—";
}

// Tipos de servicio disponibles en el dropdown de la tabla
const TIPOS_SERVICIO = [
  { key: "AGUA",        label: "Transporte de Agua" },
  { key: "ALIJO_ZC",   label: "Alijo" },
  { key: "SLOP",       label: "SLOP" },
  { key: "LUBRICANTES",label: "Lubricantes" },
  { key: "OTRO",       label: "Otro" },
];

// ─── MAP FIT ─────────────────────────────────────────────────────────────────
function MapFit({ points }) {
  const map    = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !points?.length) return;
    const lats = points.map(p => p.lat).filter(Number.isFinite);
    const lons = points.map(p => p.lon).filter(Number.isFinite);
    if (!lats.length || !lons.length) return;
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    map.fitBounds([[minLat-.05,minLon-.05],[maxLat+.05,maxLon+.05]],{padding:[20,20],maxZoom:13});
    fitted.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

// ─── MAP ZOOM TO CLUSTER ─────────────────────────────────────────────────────
function MapZoomToCluster({ target }) {
  const map = useMap();
  useEffect(() => {
    if (!target?.length) return;
    const lats = target.map(p => p.lat).filter(Number.isFinite);
    const lons = target.map(p => p.lon).filter(Number.isFinite);
    if (!lats.length) return;
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    map.flyToBounds([[minLat-.01,minLon-.01],[maxLat+.01,maxLon+.01]],{padding:[30,30],maxZoom:14,duration:.8});
  }, [map, target]);
  return null;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ msg, type = "ok" }) {
  const bg = type === "ok" ? "#065F46" : type === "error" ? "#991B1B" : "#1e3a5f";
  return (
    <div style={{
      position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",
      background:bg,color:"#fff",padding:"10px 20px",borderRadius:8,
      fontSize:12,fontWeight:600,zIndex:9998,fontFamily:"var(--sans)",
      boxShadow:"0 4px 16px rgba(0,0,0,.25)",pointerEvents:"none",
      animation:"fadein .2s ease",
    }}>
      {msg}
    </div>
  );
}

// ─── LABEL SELECTOR (popup inline sobre el mapa o lista) ─────────────────────
function LabelSelector({ point, onSave, onClose, maxSvcNum }) {
  const [sel, setSel] = useState(
    point.servicio_num != null ? `C${point.servicio_num}` : (point.state ?? null)
  );

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const clusterNums = Array.from({ length: (maxSvcNum || 0) + 1 }, (_, i) => i + 1);

  const handleConfirm = () => {
    if (!sel) return;
    if (sel.startsWith("C")) {
      const n = parseInt(sel.slice(1), 10);
      onSave({ ...point, state: null, servicio_num: n });
    } else {
      onSave({ ...point, state: sel, servicio_num: null });
    }
  };

  return (
    <div role="dialog" aria-modal="true"
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:9999,
              display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={onClose}>
      <div style={{background:"#fff",borderRadius:14,padding:22,width:"100%",maxWidth:340,
                   boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:13,fontWeight:700,color:"#213363",marginBottom:4}}>
          Asignar etiqueta
        </div>
        <div style={{fontSize:10,color:"#6381A7",fontFamily:"var(--mono)",marginBottom:14}}>
          {fmtDate(point.datetime)} {fmtTime(point.datetime)} {TZ_LABEL}
          {" · "}SOG {point.sog != null ? `${Number(point.sog).toFixed(1)} kn` : "—"}
          {" · "}{point.zone ?? "—"}
        </div>

        {/* Etiquetas manuales */}
        <div style={{fontSize:9,fontWeight:600,color:"#6381A7",textTransform:"uppercase",
                     letterSpacing:".8px",marginBottom:6}}>
          Etiqueta de navegación
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
          {MANUAL_LABELS.map(lbl => {
            const meta = LABEL_META[lbl];
            const active = sel === lbl;
            return (
              <button key={lbl}
                style={{padding:"6px 11px",borderRadius:6,fontSize:10,cursor:"pointer",
                        border:`1.5px solid ${active ? meta.color : "#D6E0ED"}`,
                        background: active ? `${meta.color}18` : "#fff",
                        color: active ? meta.color : "#213363",fontWeight:active?700:400}}
                onClick={()=>setSel(lbl)}>
                {meta.icon} {meta.label}
              </button>
            );
          })}
        </div>

        {/* Cluster buttons */}
        <div style={{fontSize:9,fontWeight:600,color:"#6381A7",textTransform:"uppercase",
                     letterSpacing:".8px",marginBottom:6}}>
          Asignar a cluster
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
          <button
            style={{padding:"6px 10px",borderRadius:6,fontSize:10,cursor:"pointer",
                    border:`1.5px solid ${sel===null?"#EF5350":"#D6E0ED"}`,
                    background:sel===null?"#FFF5F5":"#fff",
                    color:sel===null?"#C0392B":"#6381A7",fontWeight:sel===null?700:400}}
            onClick={()=>setSel(null)}>
            ✕ Sin etiqueta
          </button>
          {clusterNums.map(n => {
            const key = `C${n}`;
            const active = sel === key;
            const col = svcColor(n);
            return (
              <button key={n}
                style={{padding:"6px 12px",borderRadius:6,fontSize:10,cursor:"pointer",
                        border:`1.5px solid ${active ? col : "#D6E0ED"}`,
                        background: active ? `${col}18` : "#fff",
                        color: active ? col : "#213363",fontWeight:active?700:400}}
                onClick={()=>setSel(key)}>
                C{n}{n === (maxSvcNum||0)+1 ? " (nuevo)" : ""}
              </button>
            );
          })}
        </div>

        <div style={{fontSize:9,color:"#A5B5CC",fontFamily:"var(--mono)",marginBottom:12,
                     padding:"4px 8px",background:"#F8FAFC",borderRadius:5}}>
          El tipo de servicio se asigna desde la tabla de clusters, no desde aquí.
        </div>

        <div style={{display:"flex",gap:7}}>
          <button
            style={{flex:1,padding:"9px 0",borderRadius:7,background:"#235C96",color:"#fff",
                    border:"none",fontSize:12,fontWeight:600,cursor:"pointer",
                    opacity:sel===undefined?"0.5":1}}
            onClick={handleConfirm}>
            ✓ Confirmar
          </button>
          <button
            style={{padding:"9px 12px",borderRadius:7,border:"1px solid #D6E0ED",
                    background:"#fff",color:"#6381A7",fontSize:11,cursor:"pointer"}}
            onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─── TABLA DE CLUSTERS ───────────────────────────────────────────────────────
function ClusterTable({ clusters, onRowClick, highlightNum, onTipoChange }) {
  if (!clusters.length) {
    return (
      <div style={{padding:"24px 16px",textAlign:"center"}}>
        <div style={{fontSize:28,opacity:.3,marginBottom:8}}>⊘</div>
        <div style={{fontSize:11,color:"#6381A7"}}>
          No hay clusters detectados.<br/>
          <span style={{fontSize:10,color:"#A5B5CC"}}>
            Usá "Auto-detectar" para generar clusters automáticamente.
          </span>
        </div>
      </div>
    );
  }

  return (
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
      <thead>
        <tr style={{background:"#F8FAFC",borderBottom:"2px solid #D6E0ED"}}>
          <th style={TH}>#</th>
          <th style={TH}>Inicio</th>
          <th style={TH}>Fin</th>
          <th style={TH}>Pts</th>
          <th style={TH}>SOG Ø</th>
          <th style={{...TH,minWidth:140}}>Tipo de servicio</th>
        </tr>
      </thead>
      <tbody>
        {clusters.map(c => {
          const isHL  = highlightNum === c.num;
          const noSvc = !c.tipoServicio;
          const col   = svcColor(c.num);
          const sogAvg = c.points.length
            ? (c.points.reduce((s,p)=>s+(p.sog??0),0)/c.points.length).toFixed(1)
            : "—";
          return (
            <tr key={c.num}
              onClick={()=>onRowClick(c)}
              style={{
                background: isHL ? `${col}18` : noSvc ? "#FFFBEB" : "#fff",
                borderBottom: "1px solid #EEF2F7",
                borderLeft: `3px solid ${isHL ? col : noSvc ? "#FCD34D" : "transparent"}`,
                cursor:"pointer",
                transition:"background .12s",
              }}>
              <td style={TD}>
                <span style={{fontFamily:"var(--mono)",fontWeight:700,
                              color:col,fontSize:12}}>
                  C{c.num}
                </span>
              </td>
              <td style={{...TD,fontFamily:"var(--mono)",fontSize:10}}>
                {fmtTime(c.points[0]?.datetime)}
              </td>
              <td style={{...TD,fontFamily:"var(--mono)",fontSize:10}}>
                {fmtTime(c.points[c.points.length-1]?.datetime)}
              </td>
              <td style={{...TD,fontFamily:"var(--mono)",textAlign:"center"}}>
                {c.points.length}
              </td>
              <td style={{...TD,fontFamily:"var(--mono)",textAlign:"center",
                          color:parseFloat(sogAvg)>3?"#235C96":"#1E7A4A"}}>
                {sogAvg}kn
              </td>
              <td style={TD} onClick={e=>e.stopPropagation()}>
                <select
                  value={c.tipoServicio ?? ""}
                  onChange={e=>onTipoChange(c.num, e.target.value || null)}
                  style={{
                    fontSize:10,padding:"4px 6px",borderRadius:5,width:"100%",
                    border:`1px solid ${noSvc?"#FCD34D":"#D6E0ED"}`,
                    background: noSvc ? "#FFFBEB" : "#fff",
                    color: noSvc ? "#92400E" : "#213363",
                    fontFamily:"var(--sans)",cursor:"pointer",outline:"none",
                  }}>
                  <option value="">— Elegir tipo —</option>
                  {TIPOS_SERVICIO.map(t=>(
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
const TH = {padding:"7px 10px",textAlign:"left",fontSize:9,color:"#6381A7",
            fontWeight:600,textTransform:"uppercase",letterSpacing:".6px",
            fontFamily:"var(--mono)",whiteSpace:"nowrap"};
const TD = {padding:"7px 10px",verticalAlign:"middle"};

// ─── LISTA DE PUNTOS ──────────────────────────────────────────────────────────
function PointsList({ points, selPt, setSelPt, onLabelClick, highlightNum }) {
  let lastDate = null;

  if (!points.length) {
    return (
      <div style={{padding:"24px 16px",textAlign:"center"}}>
        <div style={{fontSize:28,opacity:.3,marginBottom:8}}>⊘</div>
        <div style={{fontSize:11,color:"#6381A7"}}>Sin datos AIS para este viaje.</div>
      </div>
    );
  }

  return (
    <>
      {points.map((p, i) => {
        const thisDate = fmtDate(p.datetime);
        const showDate = thisDate !== lastDate;
        lastDate = thisDate;

        const col    = pointColor(p);
        const lbl    = pointLabel(p);
        const isSel  = selPt === i;
        const isHL   = p.servicio_num != null && p.servicio_num === highlightNum;

        return (
          <div key={i}>
            {showDate && (
              <div style={{padding:"3px 10px",background:"#F8FAFC",fontSize:8,
                           color:"#6381A7",fontFamily:"var(--mono)",
                           borderBottom:"1px solid #EEF2F7",borderTop: i>0?"1px solid #EEF2F7":"none"}}>
                {thisDate} {TZ_LABEL}
              </div>
            )}
            <div role="button" tabIndex={0}
              style={{
                display:"grid",gridTemplateColumns:"22px 50px 36px 1fr 20px",
                gap:4,padding:"5px 10px",
                borderBottom:"1px solid #F5F7FA",cursor:"pointer",alignItems:"center",
                background: isSel ? "#EFF6FF" : isHL ? `${svcColor(p.servicio_num)}10` : "transparent",
                borderLeft: isSel ? "3px solid #235C96" : isHL ? `3px solid ${svcColor(p.servicio_num)}` : "3px solid transparent",
              }}
              onClick={()=>setSelPt(i)}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")setSelPt(i);}}
            >
              <span style={{fontFamily:"var(--mono)",fontSize:8,color:"#C4CADC",textAlign:"center"}}>
                {i+1}
              </span>
              <span style={{fontFamily:"var(--mono)",lineHeight:1.2}}>
                <span style={{fontSize:10,color:"#213363",display:"block"}}>{fmtTime(p.datetime)}</span>
                <span style={{fontSize:8,color:"#A5B5CC",display:"block"}}>{fmtTimeUTC(p.datetime)} UTC</span>
              </span>
              <span style={{fontFamily:"var(--mono)",fontSize:10,textAlign:"right",
                            color:p.sog==null?"#A5B5CC":p.sog>3?"#235C96":p.sog<=0.5?"#1E7A4A":"#854F0B"}}>
                {p.sog==null?"—":p.sog===0
                  ?<span title="SOG 0">⚓</span>
                  :`${Number(p.sog).toFixed(1)}`}
                {p.sog!=null&&p.sog!==0&&<span style={{fontSize:7}}>kn</span>}
              </span>
              <span style={{display:"flex",alignItems:"center",gap:3,overflow:"hidden"}}>
                <span style={{
                  fontSize:8,padding:"2px 5px",borderRadius:3,
                  background:`${col}18`,color:col,
                  border:`1px solid ${col}44`,
                  fontFamily:"var(--mono)",overflow:"hidden",
                  textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,
                }}>
                  {lbl}
                </span>
                {p.zone==="ZONA_COMUN"&&(
                  <span style={{fontSize:7,padding:"1px 3px",borderRadius:2,
                                background:"#DBEAFE",color:"#1E40AF",
                                fontFamily:"var(--mono)",flexShrink:0}}>ZC</span>
                )}
              </span>
              <span
                title="Cambiar etiqueta"
                style={{fontSize:11,color:"#D6E0ED",textAlign:"center",cursor:"pointer",
                        transition:"color .1s"}}
                onClick={e=>{e.stopPropagation();onLabelClick(i,p);}}
                onMouseEnter={e=>e.currentTarget.style.color="#235C96"}
                onMouseLeave={e=>e.currentTarget.style.color="#D6E0ED"}>
                ✏
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function TripViewer({ trips, setTrips, initialIdx = 0, onBack }) {
  const [tripIdx,      setTripIdx]      = useState(initialIdx);
  const [selPt,        setSelPt]        = useState(null);
  const [labelEditing, setLabelEditing] = useState(null); // {idx, pt}
  const [saving,       setSaving]       = useState(false);
  const [saveStatus,   setSaveStatus]   = useState(null); // "ok"|"error"|null
  const [toast,        setToast]        = useState(null); // {msg, type}
  const [autoRunning,  setAutoRunning]  = useState(false);
  const [resetRunning, setResetRunning] = useState(false);
  const [highlightNum, setHighlightNum] = useState(null); // cluster num seleccionado
  const [zoomTarget,   setZoomTarget]   = useState(null); // array de puntos para zoom

  const trip   = trips?.[tripIdx] ?? null;
  const points = trip?.points ?? [];

  // ─── NAVEGACIÓN ──────────────────────────────────────────────────────────────
  const goTrip = useCallback(newIdx => {
    setTripIdx(newIdx);
    setSelPt(null);
    setLabelEditing(null);
    setHighlightNum(null);
    setZoomTarget(null);
  }, []);

  const goNextPending = useCallback(() => {
    const idx = trips.findIndex((t, i) => i > tripIdx && !t.validated);
    if (idx !== -1) goTrip(idx);
  }, [trips, tripIdx, goTrip]);

  const goPrevPending = useCallback(() => {
    let idx = -1;
    for (let i = tripIdx - 1; i >= 0; i--) { if (!trips[i].validated) { idx = i; break; } }
    if (idx !== -1) goTrip(idx);
  }, [trips, tripIdx, goTrip]);

  const hasPrevPending = trips.slice(0, tripIdx).some(t => !t.validated);
  const hasNextPending = trips.slice(tripIdx + 1).some(t => !t.validated);

  // ─── CLUSTERS (derivado de puntos con servicio_num asignado) ─────────────────
  // Agrupa puntos consecutivos con el mismo servicio_num
  const clusters = useMemo(() => {
    const map = {};
    points.forEach(p => {
      if (p.servicio_num == null) return;
      const n = p.servicio_num;
      if (!map[n]) map[n] = [];
      map[n].push(p);
    });

    // Obtener tipo de servicio del cluster (primer punto que lo tenga)
    return Object.entries(map)
      .map(([numStr, pts]) => {
        const num = parseInt(numStr, 10);
        const tipo = pts.find(p =>
          p.tipo_servicio && !["SIN_CLASIFICAR","BORRADO"].includes(p.tipo_servicio)
        )?.tipo_servicio ?? null;
        return { num, points: pts, tipoServicio: tipo };
      })
      .sort((a, b) => a.num - b.num);
  }, [points]);

  const maxSvcNum = clusters.length ? Math.max(...clusters.map(c => c.num)) : 0;
  const allClustersHaveTipo = clusters.length > 0 && clusters.every(c => c.tipoServicio);

  // ─── POLYLINE segments (color por etiqueta) ───────────────────────────────
  const segments = useMemo(() => {
    const segs = [];
    for (let i = 0; i < points.length - 1; i++) {
      const col = pointColor(points[i]);
      segs.push({ pos: [[points[i].lat,points[i].lon],[points[i+1].lat,points[i+1].lon]], color: col });
    }
    return segs;
  }, [points]);

  // ─── TOAST HELPER ────────────────────────────────────────────────────────────
  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ─── GUARDAR ETIQUETA (punto individual) ─────────────────────────────────────
  const handleSaveLabel = useCallback(async updated => {
    const newTrips = trips.map((t, ti) => {
      if (ti !== tripIdx) return t;
      const newPoints = t.points.map((p, pi) => pi === labelEditing.idx ? updated : p);
      const nSvc = new Set(newPoints.filter(p => p.servicio_num != null).map(p => p.servicio_num)).size;
      return { ...t, points: newPoints, nServices: nSvc };
    });
    setTrips(newTrips);
    setLabelEditing(null);

    const ct = newTrips[tripIdx];
    if (!ct?.supabaseId) return;

    setSaving(true);
    setSaveStatus(null);
    try {
      const dtStr = updated.datetime instanceof Date
        ? updated.datetime.toISOString()
        : new Date(updated.datetime).toISOString();

      const { error: errPt } = await supabase
        .from("ais_points")
        .update({
          state:        updated.state,
          servicio_num: updated.servicio_num,
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
    } catch (e) {
      console.error("[TripViewer] Error guardando etiqueta:", e?.message ?? e);
      setSaveStatus("error");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 2500);
    }
  }, [trips, tripIdx, labelEditing, setTrips]);

  // ─── GUARDAR TIPO DE SERVICIO (desde tabla) ───────────────────────────────
  const handleTipoChange = useCallback(async (clusterNum, newTipo) => {
    const newTrips = trips.map((t, ti) => {
      if (ti !== tripIdx) return t;
      const newPoints = t.points.map(p =>
        p.servicio_num === clusterNum
          ? { ...p, tipo_servicio: newTipo ?? "SIN_CLASIFICAR" }
          : p
      );
      return { ...t, points: newPoints };
    });
    setTrips(newTrips);

    const ct = newTrips[tripIdx];
    if (!ct?.supabaseId) return;

    setSaving(true);
    setSaveStatus(null);
    try {
      const affectedDts = trips[tripIdx].points
        .filter(p => p.servicio_num === clusterNum)
        .map(p => p.datetime instanceof Date ? p.datetime.toISOString() : new Date(p.datetime).toISOString());

      if (affectedDts.length > 0) {
        const { error } = await supabase
          .from("ais_points")
          .update({ tipo_servicio: newTipo ?? "SIN_CLASIFICAR" })
          .eq("trip_id", ct.supabaseId)
          .in("datetime", affectedDts);
        if (error) throw error;
      }
      setSaveStatus("ok");
    } catch (e) {
      console.error("[TripViewer] Error guardando tipo de servicio:", e?.message ?? e);
      setSaveStatus("error");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 2500);
    }
  }, [trips, tripIdx, setTrips]);

  // ─── AUTO-DETECTAR ────────────────────────────────────────────────────────────
  // Lógica:
  //   - Solo puntos en ZONA_COMUN
  //   - SOG < 4 → candidato a cluster
  //   - Gap > 90 min entre candidatos consecutivos → nuevo cluster
  //   - Primer punto de zona → ENTRADA_ZONA
  //   - Último punto de zona → SALIDA_ZONA
  //   - SOG >= 4 dentro de zona → TRANSITO
  //   - Fuera de zona pero sin etiqueta especial → null (estado original)
  const handleAutoDetect = useCallback(async () => {
    const ct = trips[tripIdx];
    if (!ct) return;
    setAutoRunning(true);

    try {
      const zcPts = ct.points
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.zone === "ZONA_COMUN");

      if (!zcPts.length) {
        showToast("No hay puntos en ZONA_COMUN", "info");
        return;
      }

      // Paso 1: agrupar candidatos en clusters (SOG < 4, gap max 90 min)
      const candidatos = zcPts.filter(({ p }) => p.sog != null && p.sog < 4);

      const clusterGroups = [];
      let curGroup = null;
      for (const item of candidatos) {
        if (!curGroup) {
          curGroup = [item];
        } else {
          const last = curGroup[curGroup.length - 1];
          const gapMin = (new Date(item.p.datetime) - new Date(last.p.datetime)) / 60000;
          if (gapMin > 90) {
            clusterGroups.push(curGroup);
            curGroup = [item];
          } else {
            curGroup.push(item);
          }
        }
      }
      if (curGroup) clusterGroups.push(curGroup);

      // Paso 2: construir mapa de índice → nueva asignación
      const updates = {}; // origIdx → {state, servicio_num}

      // Marcar clusters
      clusterGroups.forEach((grp, gi) => {
        grp.forEach(({ i }) => {
          updates[i] = { state: null, servicio_num: gi + 1 };
        });
      });

      // Marcar tránsito (ZONA_COMUN, SOG >= 4, no en ningún cluster)
      zcPts.forEach(({ p, i }) => {
        if (updates[i]) return;
        if (p.sog != null && p.sog >= 4) {
          updates[i] = { state: "TRANSITO", servicio_num: null };
        }
      });

      // Marcar ENTRADA_ZONA (primer punto de ZC)
      if (zcPts.length > 0) {
        const firstIdx = zcPts[0].i;
        if (!updates[firstIdx]) {
          updates[firstIdx] = { state: "ENTRADA_ZONA", servicio_num: null };
        }
      }

      // Marcar SALIDA_ZONA (último punto de ZC)
      if (zcPts.length > 1) {
        const lastIdx = zcPts[zcPts.length - 1].i;
        if (!updates[lastIdx]) {
          updates[lastIdx] = { state: "SALIDA_ZONA", servicio_num: null };
        }
      }

      // Paso 3: aplicar localmente
      const newPoints = ct.points.map((p, i) => {
        if (!updates[i]) return p;
        return { ...p, state: updates[i].state, servicio_num: updates[i].servicio_num };
      });

      const nSvc = new Set(newPoints.filter(p => p.servicio_num != null).map(p => p.servicio_num)).size;
      const newTrips = trips.map((t, ti) =>
        ti === tripIdx ? { ...t, points: newPoints, nServices: nSvc } : t
      );
      setTrips(newTrips);

      // Paso 4: escribir en Supabase
      if (ct.supabaseId) {
        // Batch: agrupar por state+servicio_num para minimizar queries
        const byKey = {};
        Object.entries(updates).forEach(([origIdx, upd]) => {
          const p = ct.points[parseInt(origIdx, 10)];
          const key = `${upd.state ?? "NULL"}__${upd.servicio_num ?? "NULL"}`;
          if (!byKey[key]) byKey[key] = { state: upd.state, servicio_num: upd.servicio_num, dts: [] };
          byKey[key].dts.push(
            p.datetime instanceof Date ? p.datetime.toISOString() : new Date(p.datetime).toISOString()
          );
        });

        for (const { state, servicio_num, dts } of Object.values(byKey)) {
          const { error } = await supabase
            .from("ais_points")
            .update({ state, servicio_num })
            .eq("trip_id", ct.supabaseId)
            .in("datetime", dts);
          if (error) throw error;
        }

        const { error: errTrip } = await supabase
          .from("ais_trips")
          .update({ n_services: nSvc })
          .eq("id", ct.supabaseId);
        if (errTrip) throw errTrip;
      }

      showToast(`${clusterGroups.length} cluster${clusterGroups.length !== 1 ? "s" : ""} detectado${clusterGroups.length !== 1 ? "s" : ""}`, "ok");
    } catch (e) {
      console.error("[TripViewer] Error en auto-detectar:", e?.message ?? e);
      showToast("Error en auto-detección", "error");
    } finally {
      setAutoRunning(false);
    }
  }, [trips, tripIdx, setTrips]);

  // ─── RESET ───────────────────────────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    const ok = window.confirm(
      "¿Seguro? Esto borra todo el análisis de este viaje:\n" +
      "state, servicio_num, tipo_servicio y zona_servicio de todos los puntos."
    );
    if (!ok) return;

    const ct = trips[tripIdx];
    if (!ct) return;
    setResetRunning(true);

    try {
      const newPoints = ct.points.map(p => ({
        ...p,
        state: null,
        servicio_num: null,
        tipo_servicio: null,
        zona_servicio: null,
      }));
      const newTrips = trips.map((t, ti) =>
        ti === tripIdx ? { ...t, points: newPoints, nServices: 0, validated: false } : t
      );
      setTrips(newTrips);

      if (ct.supabaseId) {
        const { error: errPts } = await supabase
          .from("ais_points")
          .update({ state: null, servicio_num: null, tipo_servicio: null, zona_servicio: null })
          .eq("trip_id", ct.supabaseId);
        if (errPts) throw errPts;

        const { error: errTrip } = await supabase
          .from("ais_trips")
          .update({ validated: false, n_services: 0 })
          .eq("id", ct.supabaseId);
        if (errTrip) throw errTrip;
      }

      setHighlightNum(null);
      setZoomTarget(null);
      showToast("Análisis borrado", "ok");
    } catch (e) {
      console.error("[TripViewer] Error en reset:", e?.message ?? e);
      showToast("Error al resetear", "error");
    } finally {
      setResetRunning(false);
    }
  }, [trips, tripIdx, setTrips]);

  // ─── VALIDAR ─────────────────────────────────────────────────────────────────
  const handleValidate = useCallback(async () => {
    if (!allClustersHaveTipo) return;
    const resumen = clusters.map(c => {
      const tipo = TIPOS_SERVICIO.find(t => t.key === c.tipoServicio)?.label ?? c.tipoServicio;
      return `C${c.num} = ${tipo}`;
    }).join(", ");
    const ok = window.confirm(`Validar ${clusters.length} servicio${clusters.length!==1?"s":""}:\n${resumen}`);
    if (!ok) return;

    const ct = trips[tripIdx];
    if (!ct) return;

    setSaving(true);
    try {
      const newTrips = trips.map((t, ti) =>
        ti === tripIdx ? { ...t, validated: true, nServices: clusters.length } : t
      );
      setTrips(newTrips);

      if (ct.supabaseId) {
        const { error } = await supabase
          .from("ais_trips")
          .update({ validated: true, n_services: clusters.length })
          .eq("id", ct.supabaseId);
        if (error) throw error;
      }

      showToast(`✓ Viaje validado — ${clusters.length} servicio${clusters.length!==1?"s":""}`, "ok");
      const next = trips.findIndex((t, i) => i > tripIdx && !t.validated);
      if (next !== -1) goTrip(next);
    } catch (e) {
      console.error("[TripViewer] Error validando:", e?.message ?? e);
      showToast("Error al validar", "error");
    } finally {
      setSaving(false);
    }
  }, [trips, tripIdx, clusters, allClustersHaveTipo, setTrips, goTrip]);

  // ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
  useEffect(() => {
    const h = e => {
      if (labelEditing) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === "n" || e.key === "N") goNextPending();
      if (e.key === "p" || e.key === "P") goPrevPending();
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelEditing, tripIdx, trips]);

  // ─── STYLES ──────────────────────────────────────────────────────────────────
  const S = {
    btn: (active, color) => ({
      fontSize:11,padding:"5px 11px",borderRadius:6,cursor:"pointer",fontFamily:"var(--sans)",fontWeight:active?600:400,
      border:`1px solid ${active?(color||"#235C96"):"#D6E0ED"}`,
      background:active?(color?"transparent":"#EFF6FF"):"#fff",
      color:active?(color||"#235C96"):"#6381A7",
    }),
  };

  if (!trip) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",
                   height:"calc(100vh - 52px)",color:"var(--muted)",fontSize:13}}>
        No hay viaje seleccionado.
      </div>
    );
  }

  const durLabel = fmtDuration(trip.durationHs);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 52px)",overflow:"hidden"}}>

      {/* ── TOPBAR ── */}
      <div style={{
        display:"flex",alignItems:"center",gap:8,padding:"8px 16px",
        borderBottom:"1px solid #D6E0ED",background:"#fff",flexShrink:0,flexWrap:"wrap",
      }}>
        <button style={S.btn(false)} onClick={onBack}>← Lista</button>
        <button style={S.btn(false)} onClick={()=>goTrip(Math.max(0,tripIdx-1))}
          disabled={tripIdx===0}>‹</button>

        <span style={{fontFamily:"var(--mono)",fontSize:11,fontWeight:700,color:"#213363"}}>
          Viaje #{trip.id}
          {" — "}
          {fmtRange(trip.dateStart, trip.dateEnd)}
          <span style={{marginLeft:6,fontSize:10,color:"#6381A7",fontWeight:400}}>({durLabel})</span>
          {trip.incomplete && (
            <span style={{marginLeft:8,fontSize:9,color:"#92400E",background:"#FEF3C7",
                          padding:"1px 6px",borderRadius:3}}>⚠ Incompleto</span>
          )}
        </span>

        <button style={S.btn(false)} onClick={()=>goTrip(Math.min(trips.length-1,tripIdx+1))}
          disabled={tripIdx===trips.length-1}>›</button>

        {hasPrevPending && (
          <button style={{...S.btn(false),fontSize:10}} onClick={goPrevPending} title="P">‹ Pendiente</button>
        )}
        {hasNextPending && (
          <button style={{...S.btn(true),fontSize:10,background:"#FFF7ED",color:"#92400E",borderColor:"#FCD34D"}}
            onClick={goNextPending} title="N">Pendiente ›</button>
        )}

        {saving && <span style={{fontSize:10,color:"#6381A7",fontFamily:"var(--mono)"}}>Guardando…</span>}
        {saveStatus==="ok" && <span style={{fontSize:10,color:"#1E7A4A",fontFamily:"var(--mono)"}}>✓ Guardado</span>}
        {saveStatus==="error" && <span style={{fontSize:10,color:"#C0392B",fontFamily:"var(--mono)"}}>⚠ Error</span>}

        {/* Botones principales */}
        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          <button
            onClick={handleAutoDetect}
            disabled={autoRunning}
            style={{
              fontSize:11,padding:"5px 12px",borderRadius:6,border:"1px solid #B8942A",
              background:autoRunning?"#FEF3C7":"#FFFBEB",color:"#92400E",
              cursor:autoRunning?"not-allowed":"pointer",fontWeight:600,fontFamily:"var(--sans)",
            }}>
            {autoRunning ? "⏳ Detectando…" : "⚡ Auto-detectar"}
          </button>

          <button
            onClick={handleReset}
            disabled={resetRunning}
            style={{
              fontSize:11,padding:"5px 12px",borderRadius:6,border:"1px solid #FECACA",
              background:"#FFF5F5",color:"#991B1B",
              cursor:resetRunning?"not-allowed":"pointer",fontWeight:600,fontFamily:"var(--sans)",
            }}>
            {resetRunning ? "⏳ Borrando…" : "✕ Reset"}
          </button>

          {trip.validated
            ? <span style={{fontSize:11,color:"#1E7A4A",fontWeight:600}}>✓ Validado</span>
            : (
              <button
                onClick={handleValidate}
                disabled={!allClustersHaveTipo || clusters.length === 0}
                title={!allClustersHaveTipo ? "Asigná tipo de servicio a todos los clusters primero" : ""}
                style={{
                  fontSize:11,padding:"5px 12px",borderRadius:6,fontWeight:600,
                  border:`1px solid ${allClustersHaveTipo && clusters.length>0 ? "#16A34A" : "#D6E0ED"}`,
                  background:allClustersHaveTipo && clusters.length>0 ? "#16A34A" : "#F3F4F6",
                  color:allClustersHaveTipo && clusters.length>0 ? "#fff" : "#9CA3AF",
                  cursor:allClustersHaveTipo && clusters.length>0 ? "pointer" : "not-allowed",
                  fontFamily:"var(--sans)",
                }}>
                ✓ Validar
              </button>
            )
          }
        </div>
      </div>

      {/* ── BODY: 2 columnas ── */}
      <div style={{
        display:"grid",
        gridTemplateColumns:"40% 60%",
        flex:1,minHeight:0,
        // mobile: apilado
      }}>

        {/* ── COL IZQUIERDA: tabla de clusters ── */}
        <div style={{
          display:"flex",flexDirection:"column",
          borderRight:"1px solid #D6E0ED",background:"#fff",overflow:"hidden",
        }}>
          {/* Header de la columna */}
          <div style={{
            padding:"9px 14px",borderBottom:"1px solid #D6E0ED",
            background:"#F8FAFC",flexShrink:0,
            display:"flex",alignItems:"center",justifyContent:"space-between",
          }}>
            <span style={{fontSize:11,fontWeight:700,color:"#213363"}}>
              Clusters de servicio
            </span>
            <span style={{
              fontSize:9,fontFamily:"var(--mono)",
              color: clusters.length===0 ? "#A5B5CC" : allClustersHaveTipo ? "#1E7A4A" : "#92400E",
            }}>
              {clusters.length === 0
                ? "Sin clusters"
                : allClustersHaveTipo
                  ? `${clusters.length} cluster${clusters.length!==1?"s":""} ✓`
                  : `${clusters.filter(c=>!c.tipoServicio).length} sin tipo`}
            </span>
          </div>

          {/* Tabla scrolleable */}
          <div style={{flex:1,overflowY:"auto",overflowX:"auto"}}>
            <ClusterTable
              clusters={clusters}
              highlightNum={highlightNum}
              onRowClick={c => {
                setHighlightNum(c.num);
                setZoomTarget([...c.points]);
              }}
              onTipoChange={handleTipoChange}
            />
          </div>

          {/* Info del viaje debajo de la tabla */}
          <div style={{
            padding:"10px 14px",borderTop:"1px solid #EEF2F7",
            background:"#F8FAFC",flexShrink:0,
          }}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5}}>
              {[
                {v: durLabel,           l: "Duración"},
                {v: clusters.length,    l: "Clusters",  c: clusters.length>0?"#1E7A4A":undefined},
                {v: `${trip.distNm??0}nm`, l: "Distancia"},
              ].map(k=>(
                <div key={k.l} style={{background:"#EEF2F7",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                  <div style={{fontSize:13,fontWeight:700,color:k.c||"#213363"}}>{k.v}</div>
                  <div style={{fontSize:8,color:"#6381A7",textTransform:"uppercase",letterSpacing:".4px",marginTop:1}}>{k.l}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:8,fontSize:9,color:"#A5B5CC",fontFamily:"var(--mono)"}}>
              N=sig.pendiente · Esc=salir
            </div>
          </div>
        </div>

        {/* ── COL DERECHA: mapa arriba + lista abajo ── */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>

          {/* Mapa: ~55% de la columna derecha */}
          <div style={{flex:"0 0 55%",position:"relative",minHeight:0}}>
            <MapContainer
              key={tripIdx}
              center={[-34.7,-58.0]}
              zoom={9}
              style={{height:"100%",width:"100%"}}
            >
              <TileLayer
                attribution="© OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapFit points={points} />
              {zoomTarget && <MapZoomToCluster target={zoomTarget} />}

              {/* Zonas geográficas */}
              {Object.entries(ZONES).map(([key, z]) => (
                <Polygon key={key}
                  positions={z.polygon.map(([a,b])=>[a,b])}
                  pathOptions={{color:z.color,weight:1.5,opacity:0.7,
                                fillColor:z.color,fillOpacity:0.08,dashArray:"4,4"}}>
                  <Popup><strong>{z.label}</strong></Popup>
                </Polygon>
              ))}

              {/* Polylines con color por etiqueta */}
              {segments.map((s,i)=>(
                <Polyline key={i} positions={s.pos} color={s.color} weight={3} opacity={0.85}/>
              ))}

              {/* Marcadores de todos los puntos (no solo WORKING_STOP) */}
              {points.map((p, i) => {
                if (p.lat == null || p.lon == null) return null;
                const col    = pointColor(p);
                const lbl    = pointLabel(p);
                const isSel  = selPt === i;
                const isHL   = highlightNum != null && p.servicio_num === highlightNum;
                const radius = isSel || isHL ? 9 : p.servicio_num != null ? 7 : 4;

                // Solo renderizar puntos con etiqueta o cluster, o si es el seleccionado
                const hasLabel = p.state != null || p.servicio_num != null;
                if (!hasLabel && !isSel) {
                  // Punto sin clasificar: pequeño marcador gris
                  return (
                    <CircleMarker key={i} center={[p.lat,p.lon]} radius={3}
                      color="#ccc" weight={1} fillColor="#ccc" fillOpacity={0.5}
                      eventHandlers={{click:()=>{setSelPt(i);setLabelEditing({idx:i,pt:p});}}}>
                    </CircleMarker>
                  );
                }

                return (
                  <CircleMarker key={i} center={[p.lat,p.lon]} radius={radius}
                    color={isSel?"#fff":col}
                    weight={isSel?3:isHL?3:2}
                    fillColor={col}
                    fillOpacity={0.9}
                    eventHandlers={{click:()=>{setSelPt(i);setLabelEditing({idx:i,pt:p});}}}>
                    <Popup>
                      <div style={{fontSize:12,minWidth:180}}>
                        <strong>{fmtDate(p.datetime)} {fmtTime(p.datetime)} {TZ_LABEL}</strong><br/>
                        <span style={{fontSize:10,color:"#999"}}>{fmtTimeUTC(p.datetime)} UTC</span><br/>
                        SOG: {p.sog!=null?`${Number(p.sog).toFixed(1)} kn`:"—"} | {p.zone}<br/>
                        <span style={{color:col}}>{lbl}</span>
                        {p.tipo_servicio && !["SIN_CLASIFICAR","BORRADO"].includes(p.tipo_servicio) && (
                          <><br/><em style={{color:col,fontSize:10}}>
                            {TIPOS_SERVICIO.find(t=>t.key===p.tipo_servicio)?.label ?? p.tipo_servicio}
                          </em></>
                        )}
                        <button
                          style={{marginTop:8,width:"100%",padding:"6px 0",borderRadius:6,
                                  background:"#235C96",color:"#fff",border:"none",
                                  fontSize:11,cursor:"pointer",fontWeight:600}}
                          onClick={()=>setLabelEditing({idx:i,pt:p})}>
                          ✏ Cambiar etiqueta
                        </button>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              {/* Zarpe y Llegada */}
              {points.length > 0 && <>
                <CircleMarker center={[points[0].lat,points[0].lon]} radius={9}
                  color="#fff" weight={3} fillColor="#213363" fillOpacity={1}>
                  <Popup>
                    <strong>⚓ Zarpe</strong><br/>
                    {fmtDate(trip.dateStart)} {fmtTime(trip.dateStart)} {TZ_LABEL}<br/>
                    <span style={{fontSize:10,color:"#999"}}>{fmtTimeUTC(trip.dateStart)} UTC</span>
                  </Popup>
                </CircleMarker>
                <CircleMarker
                  center={[points[points.length-1].lat,points[points.length-1].lon]}
                  radius={9} color="#fff" weight={3}
                  fillColor={trip.incomplete?"#F59E0B":"#DC2626"} fillOpacity={1}>
                  <Popup>
                    <strong>{trip.incomplete?"⚠ Fin de datos":"🏁 Llegada"}</strong><br/>
                    {fmtDate(trip.dateEnd)} {fmtTime(trip.dateEnd)} {TZ_LABEL}<br/>
                    <span style={{fontSize:10,color:"#999"}}>{fmtTimeUTC(trip.dateEnd)} UTC</span>
                  </Popup>
                </CircleMarker>
              </>}
            </MapContainer>
          </div>

          {/* Lista de puntos: ~45% restante */}
          <div style={{
            flex:"0 0 45%",
            borderTop:"1px solid #D6E0ED",
            display:"flex",flexDirection:"column",
            minHeight:0,background:"#fff",
          }}>
            {/* Header lista */}
            <div style={{
              padding:"6px 12px",borderBottom:"1px solid #EEF2F7",
              display:"flex",alignItems:"center",justifyContent:"space-between",
              flexShrink:0,background:"#F8FAFC",
            }}>
              <span style={{fontSize:9,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:1}}>
                {points.length} punto{points.length!==1?"s":""}
              </span>
              {highlightNum != null && (
                <button
                  style={{fontSize:9,padding:"2px 8px",borderRadius:4,border:"1px solid #D6E0ED",
                          background:"#fff",color:"#6381A7",cursor:"pointer",fontFamily:"var(--mono)"}}
                  onClick={()=>{setHighlightNum(null);setZoomTarget(null);}}>
                  ✕ Ver todos
                </button>
              )}
            </div>

            {/* Lista scrolleable */}
            <div style={{flex:1,overflowY:"auto"}}>
              <PointsList
                points={points}
                selPt={selPt}
                setSelPt={setSelPt}
                onLabelClick={(idx, pt) => setLabelEditing({idx, pt})}
                highlightNum={highlightNum}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Selector de etiqueta */}
      {labelEditing && (
        <LabelSelector
          point={labelEditing.pt}
          maxSvcNum={maxSvcNum}
          onSave={handleSaveLabel}
          onClose={()=>setLabelEditing(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* CSS inline para mobile */}
      <style>{`
        @keyframes fadein { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @media(max-width:768px){
          .tv-body { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
