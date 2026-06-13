import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { ZONES, SERVICE_TYPES, haversine } from "../lib/ais_engine";
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
  LLEGADA:      { label: "Llegada",      color: "#DC2626", icon: "🏁" },
  ENTRADA_ZONA: { label: "Entrada Zona", color: "#1E40AF", icon: "→" },
  SALIDA_ZONA:  { label: "Salida Zona",  color: "#1E40AF", icon: "←" },
  TRANSITO:     { label: "Tránsito",     color: "#64B5F6", icon: "▶" },
  // NOTA: los puntos de cluster NO tienen state — se identifican por servicio_num.
  // pointColor() prioriza servicio_num sobre state, así que nunca llega acá.
};

// Etiquetas asignables manualmente
const MANUAL_LABELS = ["ZARPE","LLEGADA","ENTRADA_ZONA","SALIDA_ZONA","TRANSITO"];

// Color para etiqueta de un punto (incluye C1/C2/C3...)
// Paleta de clusters — alternancia cálido/frío + oscuro/claro para máximo
// contraste visual entre clusters CONSECUTIVOS en tabla y mapa.
// Regla: nunca dos colores adyacentes del mismo matiz ni luminosidad similar.
// Colores del sistema excluidos: #213363 navy, #64B5F6 tránsito, #DC2626 llegada, #E91E63 zona
const SVC_COLORS = [
  "#D32F2F", // C1  rojo oscuro       (cálido, oscuro)
  "#00BCD4", // C2  cyan brillante    (frío,   claro)
  "#F57F17", // C3  naranja oscuro    (cálido, oscuro)
  "#43A047", // C4  verde medio       (frío,   medio)
  "#FDD835", // C5  amarillo vivo     (cálido, muy claro)
  "#1565C0", // C6  azul oscuro       (frío,   oscuro)
  "#AD1457", // C7  bordo/fucsia      (cálido, oscuro)
  "#00897B", // C8  teal medio        (frío,   medio)
  "#E64A19", // C9  naranja rojo      (cálido, medio)
  "#5E35B1", // C10 violeta medio     (frío,   oscuro)
];
const svcColor = n => n != null ? SVC_COLORS[(n - 1) % SVC_COLORS.length] : "#9E9E9E";

function pointColor(p) {
  // servicio_num SIEMPRE tiene prioridad — define el color del cluster
  if (p?.servicio_num != null) return svcColor(p.servicio_num);
  // state solo para puntos de navegación (ZARPE, TRANSITO, etc.)
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

// ─── SEQUENCE TABLE ──────────────────────────────────────────────────────────
// Agrupa puntos consecutivos con la misma etiqueta en "segmentos".
// Una fila por segmento. Horas y SOGs de todos los puntos del segmento
// se muestran en la misma celda, separados por " / ", wrapeando si no entran.
// Los clusters tienen dropdown de tipo de servicio inline.

function buildSegments(points, clusters) {
  // Usar datetime como clave estable (no referencia de objeto — se rompe tras spread inmutable)
  const clusterNumByDatetime = {};
  clusters.forEach(c => {
    c.points.forEach(cp => {
      const dtKey = cp.datetime instanceof Date ? cp.datetime.toISOString() : String(cp.datetime);
      clusterNumByDatetime[dtKey] = c.num;
    });
  });

  // Construir lookup por índice usando el array points actual
  const clusterNumByIdx = {};
  points.forEach((p, idx) => {
    const dtKey = p.datetime instanceof Date ? p.datetime.toISOString() : String(p.datetime);
    if (clusterNumByDatetime[dtKey] != null) {
      clusterNumByIdx[idx] = clusterNumByDatetime[dtKey];
    }
  });

  const segments = [];
  let i = 0;
  while (i < points.length) {
    const p = points[i];
    const cNum = clusterNumByIdx[i];

    if (cNum != null) {
      // Reunir todos los puntos consecutivos de este mismo cluster
      const pts = [];
      while (i < points.length && clusterNumByIdx[i] === cNum) {
        pts.push({ point: points[i], idx: i });
        i++;
      }
      segments.push({ type: "cluster", clusterNum: cNum, items: pts });
    } else {
      // Punto normal: agrupar consecutivos con el mismo state
      const label = p.state ?? "__none__";
      const pts   = [];
      while (i < points.length && clusterNumByIdx[i] == null && (points[i].state ?? "__none__") === label) {
        pts.push({ point: points[i], idx: i });
        i++;
      }
      segments.push({ type: "point", label, items: pts });
    }
  }
  return segments;
}

const LABEL_META_SEQ = {
  ZARPE:        { icon: "⚓", text: "Zarpe",       color: "#213363" },
  LLEGADA:      { icon: "🏁", text: "Llegada",     color: "#DC2626" },
  ENTRADA_ZONA: { icon: "→",  text: "Entrada ZC",  color: "#1E40AF" },
  SALIDA_ZONA:  { icon: "←",  text: "Salida ZC",   color: "#1E40AF" },
  TRANSITO:     { icon: "▶",  text: "Tránsito",    color: "#64B5F6" },
};

function SequenceTable({ points, clusters, onClusterClick, highlightNum, onTipoChange, onLabelClick }) {
  if (!points.length) {
    return (
      <div style={{padding:"24px 16px",textAlign:"center"}}>
        <div style={{fontSize:28,opacity:.3,marginBottom:8}}>⊘</div>
        <div style={{fontSize:11,color:"#6381A7"}}>
          Sin datos AIS. Usá "Auto-detectar" o asigná etiquetas manualmente.
        </div>
      </div>
    );
  }

  const segments  = buildSegments(points, clusters);
  const clusterMap = {};
  clusters.forEach(c => { clusterMap[c.num] = c; });

  // Column widths (px) — fixed layout
  const COL = { hora: "30%", etiqueta: "18%", sog: "22%", tipo: "30%" };

  const cellBase = {
    padding: "6px 8px",
    verticalAlign: "top",
    textAlign: "center",
    borderRight: "1px solid #EEF2F7",
    lineHeight: 1.6,
  };

  const dividerRow = (key) => (
    <tr key={key}>
      <td colSpan={4} style={{padding:0,borderTop:"1px solid #E2E8F0"}}/>
    </tr>
  );

  const rows = [];
  segments.forEach((seg, si) => {
    if (si > 0) rows.push(dividerRow(`div-${si}`));

    if (seg.type === "cluster") {
      const c     = clusterMap[seg.clusterNum];
      if (!c) return;
      const isHL  = highlightNum === c.num;
      const noSvc = !c.tipoServicio;
      const col   = svcColor(c.num);

      const horas   = seg.items.map(({point:p}) => fmtTime(p.datetime));
      const sogs    = seg.items.map(({point:p}) =>
        p.sog == null ? "—" : p.sog === 0 ? "⚓" : `${Number(p.sog).toFixed(1)}kn`
      );

      rows.push(
        <tr key={`seg-${si}`}
          onClick={() => onClusterClick(c)}
          style={{
            background: isHL ? `${col}18` : noSvc ? "#FFFBEB" : `${col}0C`,
            cursor: "pointer",
            borderLeft: `3px solid ${col}`,
          }}>
          {/* HORA */}
          <td style={{...cellBase, width: COL.hora, fontFamily:"var(--mono)", fontSize:10, color:"#213363", borderLeft:"none"}}>
            {horas.join(" / ")}
          </td>
          {/* ETIQUETA */}
          <td style={{...cellBase, width: COL.etiqueta, fontFamily:"var(--mono)", fontWeight:800, fontSize:12, color:col}}>
            ● C{c.num}
          </td>
          {/* SOG */}
          <td style={{...cellBase, width: COL.sog, fontFamily:"var(--mono)", fontSize:10, color:"#1E7A4A"}}>
            {sogs.join(" / ")}
          </td>
          {/* TIPO */}
          <td style={{...cellBase, width: COL.tipo, borderRight:"none", padding:"4px 6px"}}
            onClick={e => e.stopPropagation()}>
            <select
              value={c.tipoServicio ?? ""}
              onChange={e => onTipoChange(c.num, e.target.value || null)}
              style={{
                fontSize:10, padding:"3px 4px", borderRadius:5, width:"100%",
                border:`1px solid ${noSvc ? "#FCD34D" : col+"55"}`,
                background: noSvc ? "#FFFBEB" : `${col}10`,
                color: noSvc ? "#92400E" : "#213363",
                fontFamily:"var(--sans)", cursor:"pointer", outline:"none",
              }}>
              <option value="">— Tipo —</option>
              {TIPOS_SERVICIO.map(t=>(
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </td>
        </tr>
      );
      return;
    }

    // ── POINT segment ────────────────────────────────────────────────
    const meta    = LABEL_META_SEQ[seg.label];
    const col     = meta ? meta.color : "#9E9E9E";
    const hasLbl  = !!meta;

    const horas   = seg.items.map(({point:p}) => fmtTime(p.datetime));
    const sogs    = seg.items.map(({point:p}) =>
      p.sog == null ? "—" : p.sog === 0 ? "⚓" : `${Number(p.sog).toFixed(1)}kn`
    );

    // Edit button — only show for single-point segments with a label
    const canEdit = seg.items.length === 1;

    rows.push(
      <tr key={`seg-${si}`}
        style={{
          background: hasLbl ? `${col}07` : "#fff",
          borderLeft: `3px solid ${hasLbl ? col : "#EEF2F7"}`,
        }}>
        {/* HORA */}
        <td style={{...cellBase, width: COL.hora, fontFamily:"var(--mono)", fontSize:10, color:"#213363", borderLeft:"none"}}>
          {horas.join(" / ")}
        </td>
        {/* ETIQUETA */}
        <td style={{...cellBase, width: COL.etiqueta, fontWeight:700, fontSize:10, color:col}}>
          {meta ? `${meta.icon} ${meta.text}` : <span style={{color:"#C4CADC",fontStyle:"italic",fontSize:9}}>sin etiqueta</span>}
        </td>
        {/* SOG */}
        <td style={{...cellBase, width: COL.sog, fontFamily:"var(--mono)", fontSize:10,
                    color: seg.items[0]?.point?.sog > 3 ? "#235C96" : "#1E7A4A"}}>
          {sogs.join(" / ")}
        </td>
        {/* TIPO — vacío para no-cluster, con ✏ si es editable */}
        <td style={{...cellBase, width: COL.tipo, borderRight:"none", color:"#D6E0ED", fontSize:10}}>
          {canEdit && (
            <span title="Editar etiqueta" style={{cursor:"pointer", transition:"color .1s"}}
              onClick={() => onLabelClick(seg.items[0].idx, seg.items[0].point)}
              onMouseEnter={e=>e.currentTarget.style.color="#235C96"}
              onMouseLeave={e=>e.currentTarget.style.color="#D6E0ED"}>✏</span>
          )}
        </td>
      </tr>
    );
  });

  return (
    <table style={{width:"100%", borderCollapse:"collapse", fontSize:11, tableLayout:"fixed"}}>
      <thead>
        <tr style={{background:"#F8FAFC", borderBottom:"2px solid #D6E0ED", position:"sticky", top:0, zIndex:1}}>
          <th style={{...TH, width:COL.hora,     textAlign:"center", borderRight:"1px solid #EEF2F7"}}>Hora</th>
          <th style={{...TH, width:COL.etiqueta, textAlign:"center", borderRight:"1px solid #EEF2F7"}}>Etiqueta</th>
          <th style={{...TH, width:COL.sog,      textAlign:"center", borderRight:"1px solid #EEF2F7"}}>SOG</th>
          <th style={{...TH, width:COL.tipo,     textAlign:"center"}}>Tipo</th>
        </tr>
      </thead>
      <tbody>
        {rows}
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MULTI-MODEL DETECTION ENGINE ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Cada modelo recibe el array de puntos del viaje y devuelve:
//   Array<{ origIdx: number, servicio_num: number | null }>
// Solo devuelve asignaciones para puntos de ZONA_COMUN.
// Los puntos fuera de zona (ZARPE, TRANSITO, LLEGADA) los maneja el caller.
//
// Convención interna: servicio_num es 1-based dentro de cada modelo.
// El consenso renumera desde 1 al final.

const centroidOf = items => {
  const valid = items.filter(({ p }) => p.lat != null && p.lon != null);
  if (!valid.length) return null;
  return {
    lat: valid.reduce((s, { p }) => s + p.lat, 0) / valid.length,
    lon: valid.reduce((s, { p }) => s + p.lon, 0) / valid.length,
  };
};

// ─── MODELO A — "Conservador v2" ─────────────────────────────────────────────
// Regla 1: clusters de punto único → Tránsito (no son evidencia de estadía real)
// Regla 2: dos clusters consecutivos se fusionan SOLO si se cumplen AMBAS:
//   - distancia entre último punto del C1 y primer punto del C2 < MERGE_DIST_M metros
//   - gap temporal entre esos mismos puntos < MERGE_GAP_HS horas
// Parámetros configurables — valores por defecto consensuados con el equipo:
const MODEL_A_MERGE_DIST_M  = 500;   // metros
const MODEL_A_MERGE_GAP_HS  = 2;     // horas

function runModelA(points) {
  const zcPts = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.zone === "ZONA_COMUN");

  if (!zcPts.length) return [];

  // ── Paso 1: detección base (SOG < 4 kn en ZC) ────────────────────────────
  // Igual que Modelo B: cada grupo contiguo de puntos lentos es un cluster
  // candidato. El gap > 90 min o dist > 0.5nm rompe el grupo.
  const candidatos = zcPts.filter(({ p }) => p.sog != null && p.sog < 4);

  const rawGroups = []; // Array<Array<{p,i}>>
  let cur = null;
  for (const item of candidatos) {
    if (!cur) { cur = [item]; continue; }
    const last   = cur[cur.length - 1];
    const gapMin = (new Date(item.p.datetime) - new Date(last.p.datetime)) / 60000;
    const ctr    = centroidOf(cur);
    const distNm = (ctr && item.p.lat != null && item.p.lon != null)
      ? haversine(ctr.lat, ctr.lon, item.p.lat, item.p.lon) : 0;
    if (gapMin > 90 || distNm > 0.5) { rawGroups.push(cur); cur = [item]; }
    else { cur.push(item); }
  }
  if (cur) rawGroups.push(cur);

  // ── Paso 2 — Regla 1: descartar clusters de punto único ──────────────────
  // Un único punto no es evidencia suficiente de estadía operativa.
  let groups = rawGroups.filter(grp => grp.length > 1);

  if (!groups.length) return [];

  // ── Paso 3 — Regla 2: fusión por proximidad + gap (ambas condiciones) ────
  // Recorremos pares consecutivos. Si el último punto del grupo A y el primer
  // punto del grupo B están a < MERGE_DIST_M metros Y < MERGE_GAP_HS horas,
  // se fusionan. Iteramos hasta que no haya más fusiones posibles.
  const MERGE_DIST_NM = MODEL_A_MERGE_DIST_M / 1852;
  const MERGE_GAP_MS  = MODEL_A_MERGE_GAP_HS * 3600 * 1000;

  let merged = true;
  while (merged) {
    merged = false;
    const next = [];
    let i = 0;
    while (i < groups.length) {
      if (i === groups.length - 1) { next.push(groups[i]); i++; continue; }

      const g1 = groups[i];
      const g2 = groups[i + 1];
      const lastPt  = g1[g1.length - 1]; // último punto de g1
      const firstPt = g2[0];             // primer punto de g2

      const gapMs = new Date(firstPt.p.datetime) - new Date(lastPt.p.datetime);
      const distNm = (lastPt.p.lat != null && lastPt.p.lon != null &&
                      firstPt.p.lat != null && firstPt.p.lon != null)
        ? haversine(lastPt.p.lat, lastPt.p.lon, firstPt.p.lat, firstPt.p.lon)
        : Infinity;

      const gapOk  = gapMs  < MERGE_GAP_MS;
      const distOk = distNm < MERGE_DIST_NM;

      if (gapOk && distOk) {
        // Fusionar: combinar los dos grupos en uno
        next.push([...g1, ...g2]);
        merged = true;
        i += 2; // saltar ambos grupos
      } else {
        next.push(g1);
        i++;
      }
    }
    groups = next;
  }

  // ── Paso 4: expandir grupos — incluir todos los puntos ZC en el rango ────
  // (igual que los otros modelos: puntos intermedios entre candidatos)
  const result = [];
  groups.forEach((grp, gi) => {
    const minIdx = Math.min(...grp.map(({ i }) => i));
    const maxIdx = Math.max(...grp.map(({ i }) => i));
    zcPts
      .filter(({ i }) => i >= minIdx && i <= maxIdx)
      .forEach(({ i }) => result.push({ origIdx: i, servicio_num: gi + 1 }));
  });
  return result;
}


// ─── MODELO B — "Literal" (igual al algoritmo actual) ────────────────────────
// SOG < 4 kn en ZC → candidato. Gap > 90 min O distancia al centroide > 0.5nm
// rompe el cluster. Es el comportamiento actual del sistema.
function runModelB(points) {
  const zcPts = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.zone === "ZONA_COMUN");

  if (!zcPts.length) return [];

  const MAX_GAP_MIN  = 90;
  const MAX_DIST_NM  = 0.5;
  const candidatos   = zcPts.filter(({ p }) => p.sog != null && p.sog < 4);

  const groups = [];
  let cur = null;
  for (const item of candidatos) {
    if (!cur) { cur = [item]; continue; }
    const last   = cur[cur.length - 1];
    const gapMin = (new Date(item.p.datetime) - new Date(last.p.datetime)) / 60000;
    const ctr    = centroidOf(cur);
    const distNm = (ctr && item.p.lat != null && item.p.lon != null)
      ? haversine(ctr.lat, ctr.lon, item.p.lat, item.p.lon) : 0;
    if (gapMin > MAX_GAP_MIN || distNm > MAX_DIST_NM) {
      groups.push(cur);
      cur = [item];
    } else {
      cur.push(item);
    }
  }
  if (cur) groups.push(cur);

  const result = [];
  groups.forEach((grp, gi) => {
    const minIdx = Math.min(...grp.map(({ i }) => i));
    const maxIdx = Math.max(...grp.map(({ i }) => i));
    zcPts
      .filter(({ i }) => i >= minIdx && i <= maxIdx)
      .forEach(({ i }) => result.push({ origIdx: i, servicio_num: gi + 1 }));
  });
  return result;
}

// ─── MODELO C — "Geoespacial" ─────────────────────────────────────────────────
// Ignora el tiempo. Agrupa por proximidad geográfica: si un punto está a menos
// de 500 metros de CUALQUIER punto ya en el cluster, se une a él.
// Implementación: single-linkage clustering por distancia, procesando en orden
// temporal para mantener numeración consistente.
function runModelC(points) {
  const MAX_DIST_M = 500; // metros
  const MAX_DIST_NM = MAX_DIST_M / 1852;

  const zcPts = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.zone === "ZONA_COMUN" && p.lat != null && p.lon != null);

  if (!zcPts.length) return [];

  // Asignar cada punto al primer grupo donde algún miembro esté a < 500m.
  // Si no encuentra ninguno, abre un grupo nuevo.
  const groups = []; // Array<Array<{p, i}>>

  for (const item of zcPts) {
    let assigned = false;
    for (const grp of groups) {
      const close = grp.some(({ p }) =>
        haversine(p.lat, p.lon, item.p.lat, item.p.lon) <= MAX_DIST_NM
      );
      if (close) {
        grp.push(item);
        assigned = true;
        break;
      }
    }
    if (!assigned) groups.push([item]);
  }

  // Convertir a result: ordenar grupos por índice mínimo (orden temporal)
  groups.sort((a, b) => Math.min(...a.map(x=>x.i)) - Math.min(...b.map(x=>x.i)));
  const result = [];
  groups.forEach((grp, gi) => {
    grp.forEach(({ i }) => result.push({ origIdx: i, servicio_num: gi + 1 }));
  });
  return result;
}

// ─── CONSENSUS ENGINE ────────────────────────────────────────────────────────
// Input: resultados de los 3 modelos (arrays de {origIdx, servicio_num})
// Output: {
//   rows: Array<ConsensusRow>,      ← una fila por "evento de servicio"
//   consensusMap: Map<origIdx, {servicio_num, ambiguous}>
// }
//
// ConsensusRow: {
//   eventId: number,
//   pointIndices: number[],         ← índices originales
//   modelA: string,                 ← "C1 (3pts)" o "—"
//   modelB: string,
//   modelC: string,
//   consensus: string,
//   ambiguous: boolean,
// }
//
// Lógica de consenso: para cada par de puntos en el mismo grupo de UN modelo,
// contamos cuántos modelos los agrupan juntos. Si ≥ 2 de 3 los agrupan juntos
// → van al mismo cluster en el consenso.
// Implementación simplificada: para cada punto, vemos si ≥ 2 modelos le asignan
// el mismo "grupo canónico" (resolvemos por unión transitiva al final).
function buildConsensus(points, resA, resB, resC) {
  // Construir mapa origIdx → servicio_num por modelo
  const mapA = new Map(resA.map(r => [r.origIdx, r.servicio_num]));
  const mapB = new Map(resB.map(r => [r.origIdx, r.servicio_num]));
  const mapC = new Map(resC.map(r => [r.origIdx, r.servicio_num]));

  // Todos los índices ZC involucrados
  const allZcIdx = [...new Set([
    ...resA.map(r => r.origIdx),
    ...resB.map(r => r.origIdx),
    ...resC.map(r => r.origIdx),
  ])].sort((a, b) => a - b);

  if (!allZcIdx.length) return { rows: [], consensusMap: new Map() };

  // ── Union-Find para consenso ─────────────────────────────────────────────
  const parent = {};
  allZcIdx.forEach(i => { parent[i] = i; });

  const find = x => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a, b) => { parent[find(a)] = find(b); };

  // Para cada par de puntos dentro del mismo modelo, contar cuántos modelos
  // los unen. Si ≥ 2 → hacer union en el consenso.
  // Eficiencia: iteramos por grupos de cada modelo.
  const groupsByModel = [mapA, mapB, mapC].map(m => {
    const byGroup = {};
    m.forEach((snum, idx) => {
      if (!byGroup[snum]) byGroup[snum] = [];
      byGroup[snum].push(idx);
    });
    return byGroup;
  });

  // Para cada par (i,j), contar en cuántos modelos están juntos
  // Optimización: solo evaluar pares que están juntos en AL MENOS un modelo
  const pairCount = new Map(); // "i-j" → count (i < j)
  groupsByModel.forEach(byGroup => {
    Object.values(byGroup).forEach(idxList => {
      for (let a = 0; a < idxList.length; a++) {
        for (let b = a + 1; b < idxList.length; b++) {
          const key = `${Math.min(idxList[a],idxList[b])}-${Math.max(idxList[a],idxList[b])}`;
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        }
      }
    });
  });

  // Union si ≥ 2 modelos coinciden
  pairCount.forEach((count, key) => {
    if (count >= 2) {
      const [a, b] = key.split("-").map(Number);
      union(a, b);
    }
  });

  // ── Construir grupos del consenso ────────────────────────────────────────
  const consensusGroups = {};
  allZcIdx.forEach(i => {
    const root = find(i);
    if (!consensusGroups[root]) consensusGroups[root] = [];
    consensusGroups[root].push(i);
  });

  // Numerar grupos por orden temporal (índice mínimo)
  const sortedRoots = Object.keys(consensusGroups)
    .map(Number)
    .sort((a, b) => Math.min(...consensusGroups[a]) - Math.min(...consensusGroups[b]));

  const consensusMap = new Map();
  sortedRoots.forEach((root, gi) => {
    const snum = gi + 1;
    // Ambiguo si los 3 modelos difieren para algún punto del grupo:
    // verificamos si TODOS los puntos del grupo tienen el mismo snum en ≥ 2 modelos.
    const indices = consensusGroups[root];
    const groupPairs = [];
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const key = `${Math.min(indices[a],indices[b])}-${Math.max(indices[a],indices[b])}`;
        groupPairs.push(pairCount.get(key) ?? 0);
      }
    }
    // Si algún par dentro del grupo tiene count=1 (solo 1 modelo los juntó),
    // pero igual llegaron al mismo grupo por unión transitiva, marcar como ambiguo.
    const ambiguous = groupPairs.length > 0 && groupPairs.some(c => c < 2);
    indices.forEach(i => consensusMap.set(i, { servicio_num: snum, ambiguous }));
  });

  // ── Construir filas para la tabla comparativa ────────────────────────────
  const modelLabel = (map, groupIndices) => {
    const nums = [...new Set(groupIndices.map(i => map.get(i)).filter(n => n != null))];
    if (!nums.length) return "—";
    nums.sort((a, b) => a - b);
    const label = nums.map(n => `C${n}`).join("+");
    return `${label} (${groupIndices.filter(i => map.get(i) != null).length}pts)`;
  };

  const rows = sortedRoots.map((root, gi) => {
    const indices   = consensusGroups[root].sort((a, b) => a - b);
    const entry     = consensusMap.get(indices[0]);
    const ambiguous = entry?.ambiguous ?? false;
    return {
      eventId:      gi + 1,
      pointIndices: indices,
      modelA:       modelLabel(mapA, indices),
      modelB:       modelLabel(mapB, indices),
      modelC:       modelLabel(mapC, indices),
      consensus:    `C${gi + 1} (${indices.length}pts)${ambiguous ? " ⚠" : " ✓"}`,
      ambiguous,
    };
  });

  return { rows, consensusMap };
}

// ─── COMPARISON MODE — 4 Mapas sincronizados ─────────────────────────────────
//
// Arquitectura de sincronización:
//   • mapRefs: array de 4 refs a instancias de Leaflet (L.Map)
//   • MapSyncController: componente interno de react-leaflet que, al montar,
//     registra un listener 'moveend' en su mapa y propaga center+zoom a los
//     otros 3. useRef(true) previene bucles de retroalimentación.
//   • Cada SyncedMapView recibe su ref a través de una callback ref que
//     ComparisonMode pasa como prop.

// ─── MapSyncController ────────────────────────────────────────────────────────
// Componente sin render que vive DENTRO de un MapContainer.
// Lee useMap() para obtener la instancia y registra la sincronización.
function MapSyncController({ mapRefs, ownIdx }) {
  const map = useMap();
  const syncing = useRef(false);

  useEffect(() => {
    if (!map) return;
    // Guardar la instancia en el array compartido
    mapRefs.current[ownIdx] = map;

    const onMove = () => {
      if (syncing.current) return;
      syncing.current = true;
      const center = map.getCenter();
      const zoom   = map.getZoom();
      mapRefs.current.forEach((m, i) => {
        if (i !== ownIdx && m) {
          m.setView(center, zoom, { animate: false });
        }
      });
      syncing.current = false;
    };

    map.on("moveend", onMove);
    return () => { map.off("moveend", onMove); mapRefs.current[ownIdx] = null; };
  }, [map, mapRefs, ownIdx]);

  return null;
}

// ─── MapFitOnce ───────────────────────────────────────────────────────────────
// Igual que MapFit pero acepta un flag externo para poder forzar re-fit.
function MapFitOnce({ points }) {
  const map    = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !points?.length) return;
    const lats = points.map(p => p.lat).filter(Number.isFinite);
    const lons = points.map(p => p.lon).filter(Number.isFinite);
    if (!lats.length) return;
    map.fitBounds([
      [Math.min(...lats) - .05, Math.min(...lons) - .05],
      [Math.max(...lats) + .05, Math.max(...lons) + .05],
    ], { padding: [20, 20], maxZoom: 13 });
    fitted.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

// ─── buildPointsFromModelResult ──────────────────────────────────────────────
// Convierte el resultado de un modelo (Array<{origIdx, servicio_num}>) +
// (optionally) un consensusMap en un array de puntos "hydrated" con
// servicio_num y state asignados, listos para mostrarse en el mapa.
// Los puntos que no aparecen en el resultado quedan con state = "TRANSITO".
function buildPointsFromModelResult(rawPoints, modelResult, consensusMap) {
  // idx → servicio_num
  const byIdx = new Map(modelResult.map(r => [r.origIdx, r.servicio_num]));

  const zcPts = rawPoints
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.zone === "ZONA_COMUN");

  const updates = {};

  // Clusters del modelo
  byIdx.forEach((snum, idx) => {
    updates[idx] = { state: null, servicio_num: snum, ambiguous: false };
  });

  // Puntos ZC no asignados → TRANSITO si SOG alto
  zcPts.forEach(({ p, i }) => {
    if (updates[i]) return;
    updates[i] = { state: "TRANSITO", servicio_num: null, ambiguous: false };
  });

  // Si se pasa un consensusMap (modo consenso), marcar ambiguos
  if (consensusMap) {
    consensusMap.forEach(({ servicio_num, ambiguous }, origIdx) => {
      updates[origIdx] = { state: null, servicio_num, ambiguous: ambiguous ?? false };
    });
  }

  // ZARPE / LLEGADA
  rawPoints.forEach((p, i) => {
    if (i === 0)                       updates[i] = { state: "ZARPE",   servicio_num: null, ambiguous: false };
    else if (i === rawPoints.length-1) updates[i] = { state: "LLEGADA", servicio_num: null, ambiguous: false };
    else if (!updates[i])              updates[i] = { state: "TRANSITO",servicio_num: null, ambiguous: false };
  });

  return rawPoints.map((p, i) => {
    const u = updates[i];
    if (!u) return { ...p };
    return { ...p, state: u.state, servicio_num: u.servicio_num, _ambiguous: u.ambiguous };
  });
}

// ─── ModelTable ──────────────────────────────────────────────────────────────
// Tabla de secuencia para el Modo Comparación.
// Muestra clusters agrupados por servicio_num, sin dropdowns de edición
// (la edición ocurre después de "Usar este" / "Editar este").
function ModelTable({ points, accentColor, label, sublabel, clusterCount,
                      ambiguousCount, onUse, onEdit }) {
  // Agrupar puntos por servicio_num para mostrar filas de cluster
  const clusterRows = useMemo(() => {
    const byNum = {};
    points.forEach(p => {
      if (p.servicio_num == null) return;
      if (!byNum[p.servicio_num]) byNum[p.servicio_num] = [];
      byNum[p.servicio_num].push(p);
    });
    return Object.entries(byNum)
      .map(([numStr, pts]) => ({
        num: parseInt(numStr, 10),
        pts,
        ambiguous: pts.some(p => p._ambiguous),
        horas: pts.map(p => fmtTime(p.datetime)),
        sogs: pts.map(p => p.sog == null ? "—" : p.sog === 0 ? "⚓" : `${Number(p.sog).toFixed(1)}kn`),
      }))
      .sort((a, b) => a.num - b.num);
  }, [points]);

  const col = accentColor;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: "#fff", height: "100%",
      border: `1px solid ${col}44`, borderRadius: 8,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 10px", background: col, flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 2,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", fontFamily: "var(--sans)" }}>
            {label}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, color: "#fff",
            background: "rgba(255,255,255,.25)", padding: "1px 6px", borderRadius: 8,
            fontFamily: "var(--mono)",
          }}>
            {clusterCount} C
          </span>
        </div>
        <span style={{ fontSize: 8, color: "rgba(255,255,255,.65)", fontFamily: "var(--mono)" }}>
          {sublabel}
          {ambiguousCount > 0 && (
            <span style={{ marginLeft: 6, color: "#FEF3C7" }}>⚠ {ambiguousCount}</span>
          )}
        </span>
      </div>

      {/* Tabla scrolleable */}
      <div style={{ flex: 1, overflowY: "auto", fontSize: 10 }}>
        {clusterRows.length === 0 ? (
          <div style={{ padding: "16px 10px", textAlign: "center", color: "#A5B5CC", fontSize: 10 }}>
            Sin clusters
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: `2px solid ${col}33` }}>
                <th style={{ padding: "4px 6px", fontSize: 8, color: "#6381A7", fontWeight: 600,
                             fontFamily: "var(--mono)", textAlign: "center", letterSpacing: ".5px" }}>
                  CL
                </th>
                <th style={{ padding: "4px 4px", fontSize: 8, color: "#6381A7", fontWeight: 600,
                             fontFamily: "var(--mono)", textAlign: "center" }}>
                  HORA
                </th>
                <th style={{ padding: "4px 4px", fontSize: 8, color: "#6381A7", fontWeight: 600,
                             fontFamily: "var(--mono)", textAlign: "center" }}>
                  SOG
                </th>
              </tr>
            </thead>
            <tbody>
              {clusterRows.map((row, ri) => {
                const cCol = row.ambiguous ? "#F59E0B" : svcColor(row.num);
                const bg   = row.ambiguous ? "#FFFBEB" : ri % 2 === 0 ? "#fff" : "#FAFBFC";
                return (
                  <tr key={row.num} style={{
                    borderBottom: "1px solid #F5F7FA",
                    background: bg,
                    borderLeft: `3px solid ${cCol}`,
                  }}>
                    <td style={{
                      padding: "5px 6px", textAlign: "center",
                      fontFamily: "var(--mono)", fontSize: 11, fontWeight: 800, color: cCol,
                    }}>
                      {row.ambiguous ? "⚠" : `C${row.num}`}
                    </td>
                    <td style={{
                      padding: "5px 4px", fontFamily: "var(--mono)", fontSize: 9,
                      color: "#213363", lineHeight: 1.5,
                    }}>
                      {row.horas.map((h, i) => (
                        <span key={i} style={{ display: "block" }}>{h}</span>
                      ))}
                    </td>
                    <td style={{
                      padding: "5px 4px", fontFamily: "var(--mono)", fontSize: 9,
                      color: "#1E7A4A", textAlign: "center", lineHeight: 1.5,
                    }}>
                      {row.sogs.map((s, i) => (
                        <span key={i} style={{ display: "block" }}>{s}</span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Botones */}
      <div style={{
        padding: "7px 8px", borderTop: `1px solid ${col}33`,
        display: "flex", gap: 5, flexShrink: 0, background: "#F8FAFC",
      }}>
        <button onClick={onEdit} style={{
          flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 10,
          border: `1.5px solid ${col}`, background: "#fff",
          color: col, fontWeight: 700, cursor: "pointer", fontFamily: "var(--sans)",
        }}>
          ✏ Editar
        </button>
        <button onClick={onUse} style={{
          flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 10,
          border: "none", background: col,
          color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "var(--sans)",
        }}>
          ✓ Usar
        </button>
      </div>
    </div>
  );
}

// ─── SyncedMapView ────────────────────────────────────────────────────────────
// Solo el mapa, sin botones — los botones están en ModelTable adyacente.
function SyncedMapView({ accentColor, points, mapRefs, ownIdx }) {
  const segments = useMemo(() => {
    const segs = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i];
      segs.push({
        pos:   [[p.lat, p.lon], [points[i+1].lat, points[i+1].lon]],
        color: p._ambiguous ? "#F59E0B" : pointColor(p),
      });
    }
    return segs;
  }, [points]);

  return (
    <div style={{ height: "100%", borderRadius: 6, overflow: "hidden",
                  border: `2px solid ${accentColor}66` }}>
      <MapContainer center={[-34.7, -58.0]} zoom={9}
        style={{ height: "100%", width: "100%" }} zoomControl={ownIdx === 0}>
        <TileLayer attribution="© OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapFitOnce points={points} />
        <MapSyncController mapRefs={mapRefs} ownIdx={ownIdx} />

        {Object.entries(ZONES).map(([key, z]) => (
          <Polygon key={key} positions={z.polygon.map(([a,b]) => [a,b])}
            pathOptions={{ color: z.color, weight: 1, opacity: 0.5,
                           fillColor: z.color, fillOpacity: 0.06, dashArray: "4,4" }} />
        ))}

        {segments.map((s, i) => (
          <Polyline key={`${i}-${s.color}`} positions={s.pos}
            color={s.color} weight={2.5} opacity={0.85} />
        ))}

        {points.map((p, i) => {
          if (p.lat == null || p.lon == null) return null;
          const isCluster   = p.servicio_num != null;
          const isAmbiguous = p._ambiguous;
          const col = isAmbiguous ? "#F59E0B" : pointColor(p);

          if (!isCluster && p.state !== "ZARPE" && p.state !== "LLEGADA") {
            return <CircleMarker key={i} center={[p.lat, p.lon]} radius={2}
              color="#ccc" weight={1} fillColor="#ccc" fillOpacity={0.3} />;
          }
          const radius = (p.state === "ZARPE" || p.state === "LLEGADA") ? 7
            : isAmbiguous ? 8 : 6;
          return (
            <CircleMarker key={`${i}-${p.servicio_num ?? p.state}`}
              center={[p.lat, p.lon]} radius={radius}
              color={isCluster ? "#fff" : col} weight={isCluster ? 1.5 : 2}
              fillColor={col} fillOpacity={0.95}>
              <Popup>
                <div style={{ fontSize: 11 }}>
                  <strong style={{ color: col }}>
                    {isAmbiguous ? "⚠ Ambiguo" : isCluster ? `C${p.servicio_num}` : p.state}
                  </strong><br />
                  {fmtTime(p.datetime)} {TZ_LABEL} · SOG: {p.sog != null ? `${Number(p.sog).toFixed(1)} kn` : "—"}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

// ─── ComparisonMode ───────────────────────────────────────────────────────────
// Layout: tabla-izquierda | mapa-A | mapa-B | tabla-derecha  (fila superior)
//         tabla-izquierda | mapa-C | consenso | tabla-derecha (fila inferior)
//
// grid: 18% | 32% | 32% | 18%   (columnas)
//       1fr | 1fr              (filas)
function ComparisonMode({ rawPoints, onApply, onClose }) {
  const mapRefs = useRef([null, null, null, null]);

  const resA = useMemo(() => runModelA(rawPoints), [rawPoints]);
  const resB = useMemo(() => runModelB(rawPoints), [rawPoints]);
  const resC = useMemo(() => runModelC(rawPoints), [rawPoints]);
  const { consensusMap } = useMemo(
    () => buildConsensus(rawPoints, resA, resB, resC),
    [rawPoints, resA, resB, resC]
  );

  const ptsA    = useMemo(() => buildPointsFromModelResult(rawPoints, resA, null),       [rawPoints, resA]);
  const ptsB    = useMemo(() => buildPointsFromModelResult(rawPoints, resB, null),       [rawPoints, resB]);
  const ptsC    = useMemo(() => buildPointsFromModelResult(rawPoints, resC, null),       [rawPoints, resC]);
  const ptsCons = useMemo(() => buildPointsFromModelResult(rawPoints, [], consensusMap), [rawPoints, consensusMap]);

  const countA    = new Set(resA.map(r => r.servicio_num)).size;
  const countB    = new Set(resB.map(r => r.servicio_num)).size;
  const countC    = new Set(resC.map(r => r.servicio_num)).size;
  const countCons = new Set([...consensusMap.values()].map(v => v.servicio_num)).size;
  const ambCount  = [...consensusMap.values()].filter(v => v.ambiguous).length;

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Helpers para disparar apply
  const apply = (result, isCons, editMode) =>
    onApply(isCons ? null : result, consensusMap, isCons, editMode);

  // Definición de los 4 modelos en orden de grilla:
  // posición 0 = arriba-izq, 1 = arriba-der, 2 = abajo-izq, 3 = abajo-der
  const MODELS = [
    { label: "Modelo A", sublabel: "Conservador",  color: "#1565C0", pts: ptsA,    count: countA,    ambs: 0,        res: resA,  isCons: false },
    { label: "Modelo B", sublabel: "Literal",       color: "#2E7D32", pts: ptsB,    count: countB,    ambs: 0,        res: resB,  isCons: false },
    { label: "Modelo C", sublabel: "Geoespacial",   color: "#6A1B9A", pts: ptsC,    count: countC,    ambs: 0,        res: resC,  isCons: false },
    { label: "Consenso", sublabel: "2 de 3 modelos",color: "#065F46", pts: ptsCons, count: countCons, ambs: ambCount, res: null,  isCons: true  },
  ];

  const tableProps = (m) => ({
    accentColor:    m.color,
    label:          m.label,
    sublabel:       m.sublabel,
    clusterCount:   m.count,
    ambiguousCount: m.ambs,
    points:         m.pts,
    onUse:  () => apply(m.res, m.isCons, false),
    onEdit: () => apply(m.res, m.isCons, true),
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#1a2744",
      display: "flex", flexDirection: "column",
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: "8px 14px", background: "#213363",
        display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,.1)",
      }}>
        <button onClick={onClose} style={{
          padding: "4px 11px", borderRadius: 5, fontSize: 11,
          border: "1px solid rgba(255,255,255,.3)", background: "transparent",
          color: "#fff", cursor: "pointer", fontFamily: "var(--sans)",
        }}>← Volver</button>

        <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", fontFamily: "var(--sans)" }}>
          ⚡ Modo comparación
        </span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.5)", fontFamily: "var(--mono)" }}>
          3 modelos · mapas sincronizados · elegí cuál usar
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {MODELS.map(m => (
            <span key={m.label} style={{
              fontSize: 9, fontFamily: "var(--mono)", color: "#fff",
              background: m.color, padding: "2px 7px", borderRadius: 8, fontWeight: 700,
            }}>
              {m.label.replace("Modelo ", "")}: {m.count}
            </span>
          ))}
          {ambCount > 0 && (
            <span style={{
              fontSize: 9, color: "#92400E", background: "#FEF3C7",
              padding: "2px 7px", borderRadius: 8, fontWeight: 700, fontFamily: "var(--mono)",
            }}>⚠ {ambCount}</span>
          )}
        </div>
      </div>

      {/* ── Body: tabla-A | mapa-A | mapa-B | tabla-B  (row 1)
                  tabla-C | mapa-C | consenso | tabla-consenso (row 2) ── */}
      <div style={{
        flex: 1, minHeight: 0,
        display: "grid",
        gridTemplateColumns: "18% 32% 32% 18%",
        gridTemplateRows:    "1fr 1fr",
        gap: 6, padding: 6,
      }}>
        {/* ROW 1 — left to right */}
        <div style={{ gridColumn: 1, gridRow: 1 }}><ModelTable {...tableProps(MODELS[0])} /></div>
        <div style={{ gridColumn: 2, gridRow: 1, minHeight: 0 }}>
          <SyncedMapView accentColor={MODELS[0].color} points={MODELS[0].pts} mapRefs={mapRefs} ownIdx={0} />
        </div>
        <div style={{ gridColumn: 3, gridRow: 1 }}>
          <SyncedMapView accentColor={MODELS[1].color} points={MODELS[1].pts} mapRefs={mapRefs} ownIdx={1} />
        </div>
        <div style={{ gridColumn: 4, gridRow: 1 }}><ModelTable {...tableProps(MODELS[1])} /></div>

        {/* ROW 2 — left to right */}
        <div style={{ gridColumn: 1, gridRow: 2 }}><ModelTable {...tableProps(MODELS[2])} /></div>
        <div style={{ gridColumn: 2, gridRow: 2 }}>
          <SyncedMapView accentColor={MODELS[2].color} points={MODELS[2].pts} mapRefs={mapRefs} ownIdx={2} />
        </div>
        <div style={{ gridColumn: 3, gridRow: 2 }}>
          <SyncedMapView accentColor={MODELS[3].color} points={MODELS[3].pts} mapRefs={mapRefs} ownIdx={3} />
        </div>
        <div style={{ gridColumn: 4, gridRow: 2 }}><ModelTable {...tableProps(MODELS[3])} /></div>
      </div>
    </div>
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
  const [highlightNum,  setHighlightNum]  = useState(null); // cluster num seleccionado
  const [zoomTarget,    setZoomTarget]    = useState(null); // array de puntos para zoom
  const [comparisonMode, setComparisonMode] = useState(false); // grilla 4 mapas

  const trip   = trips?.[tripIdx] ?? null;
  const points = trip?.points ?? [];

  // ─── NAVEGACIÓN ──────────────────────────────────────────────────────────────
  const goTrip = useCallback(newIdx => {
    setTripIdx(newIdx);
    setSelPt(null);
    setLabelEditing(null);
    setHighlightNum(null);
    setZoomTarget(null);
    setComparisonMode(false);
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
  const allClustersHaveTipo = clusters.every(c => c.tipoServicio); // true when clusters=[]
  const canValidate = clusters.length === 0 || allClustersHaveTipo;

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

  // ─── AUTO-DETECTAR → abre Modo Comparación ──────────────────────────────
  const handleAutoDetect = useCallback(() => {
    const ct = trips[tripIdx];
    if (!ct || !ct.points?.length) return;
    setComparisonMode(true);
  }, [trips, tripIdx]);

  // ─── APLICAR MODELO (desde ComparisonMode) ──────────────────────────────
  // modelResult: Array<{origIdx, servicio_num}> | null (null = consenso)
  // consensusMap: Map<origIdx, {servicio_num, ambiguous}>
  // isConsensus: bool — si true, usa consensusMap en vez de modelResult
  // editMode: bool — si false, escribe en Supabase; si true, solo carga en editor
  const handleApplyModel = useCallback(async (modelResult, consensusMap, isConsensus, editMode) => {
    const ct = trips[tripIdx];
    if (!ct) return;

    setComparisonMode(false);
    setAutoRunning(true);

    try {
      const zcPts = ct.points.map((p, i) => ({ p, i })).filter(({ p }) => p.zone === "ZONA_COMUN");

      // Construir mapa origIdx → {state, servicio_num, ambiguous}
      const updates = {};

      if (isConsensus) {
        consensusMap.forEach(({ servicio_num, ambiguous }, origIdx) => {
          updates[origIdx] = { state: null, servicio_num, ambiguous: ambiguous ?? false };
        });
      } else {
        // modelResult: Array<{origIdx, servicio_num}>
        modelResult.forEach(({ origIdx, servicio_num }) => {
          updates[origIdx] = { state: null, servicio_num, ambiguous: false };
        });
      }

      // ZC no asignados → TRANSITO
      zcPts.forEach(({ p, i }) => {
        if (updates[i]) return;
        updates[i] = { state: "TRANSITO", servicio_num: null, ambiguous: false };
      });

      // ENTRADA / SALIDA de zona
      if (zcPts.length > 0 && !updates[zcPts[0].i])
        updates[zcPts[0].i] = { state: "ENTRADA_ZONA", servicio_num: null, ambiguous: false };
      if (zcPts.length > 1 && !updates[zcPts[zcPts.length-1].i])
        updates[zcPts[zcPts.length-1].i] = { state: "SALIDA_ZONA", servicio_num: null, ambiguous: false };

      // ZARPE / LLEGADA / TRANSITO para el resto
      ct.points.forEach((p, i) => {
        if (i === 0)                      updates[i] = { state: "ZARPE",    servicio_num: null, ambiguous: false };
        else if (i === ct.points.length-1) updates[i] = { state: "LLEGADA",  servicio_num: null, ambiguous: false };
        else if (!updates[i])             updates[i] = { state: "TRANSITO", servicio_num: null, ambiguous: false };
      });

      const newPoints = ct.points.map((p, i) => {
        const u = updates[i];
        if (!u) return p;
        return {
          ...p,
          state:        u.state,
          servicio_num: u.servicio_num,
          // Ambiguos (consenso): limpiar tipo_servicio para forzar revisión manual
          tipo_servicio: (u.ambiguous && u.servicio_num != null) ? null : p.tipo_servicio,
        };
      });

      const nSvc = new Set(newPoints.filter(p => p.servicio_num != null).map(p => p.servicio_num)).size;
      const newTrips = trips.map((t, ti) =>
        ti === tripIdx ? { ...t, points: newPoints, nServices: nSvc } : t
      );
      setTrips(newTrips);

      // Si es editMode, solo cargar — no escribir en Supabase todavía
      if (editMode) {
        const ambCount = [...(isConsensus ? consensusMap.values() : [])].filter(v => v.ambiguous).length;
        showToast(
          ambCount > 0
            ? `${nSvc} cluster${nSvc!==1?"s":""} cargados · ${ambCount} ⚠ para revisar`
            : `${nSvc} cluster${nSvc!==1?"s":""} listos para editar`,
          "info"
        );
        return;
      }

      // Usar → escribir en Supabase
      if (ct.supabaseId) {
        const byKey = {};
        Object.entries(updates).forEach(([idxStr, upd]) => {
          const p   = ct.points[parseInt(idxStr, 10)];
          const key = `${upd.state ?? "NULL"}__${upd.servicio_num ?? "NULL"}`;
          if (!byKey[key]) byKey[key] = { state: upd.state, servicio_num: upd.servicio_num, dts: [] };
          byKey[key].dts.push(
            p.datetime instanceof Date ? p.datetime.toISOString() : new Date(p.datetime).toISOString()
          );
        });
        for (const { state, servicio_num, dts } of Object.values(byKey)) {
          const { error } = await supabase
            .from("ais_points").update({ state, servicio_num })
            .eq("trip_id", ct.supabaseId).in("datetime", dts);
          if (error) throw error;
        }
        const { error: errTrip } = await supabase
          .from("ais_trips").update({ n_services: nSvc }).eq("id", ct.supabaseId);
        if (errTrip) throw errTrip;
      }

      const ambCount = isConsensus ? [...consensusMap.values()].filter(v => v.ambiguous).length : 0;
      showToast(
        ambCount > 0
          ? `${nSvc} cluster${nSvc!==1?"s":""} aplicados · ${ambCount} ⚠ ambiguo${ambCount!==1?"s":""} para revisión`
          : `${nSvc} cluster${nSvc!==1?"s":""} detectados ✓`,
        ambCount > 0 ? "info" : "ok"
      );
    } catch (e) {
      console.error("[TripViewer] Error aplicando modelo:", e?.message ?? e);
      showToast("Error al aplicar modelo", "error");
    } finally {
      setAutoRunning(false);
    }
  }, [trips, tripIdx, setTrips]);

  // ─── RESET

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
    if (!canValidate) return;
    const resumen = clusters.length === 0
      ? "Este viaje no tiene servicios."
      : clusters.map(c => {
          const tipo = TIPOS_SERVICIO.find(t => t.key === c.tipoServicio)?.label ?? c.tipoServicio;
          return `C${c.num} = ${tipo}`;
        }).join(", ");
    const ok = window.confirm(
      clusters.length === 0
        ? "Validar viaje sin servicios:\nEste viaje no tuvo actividad en Zona Común. ¿Confirmar?"
        : `Validar ${clusters.length} servicio${clusters.length!==1?"s":""}:\n${resumen}`
    );
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
  }, [trips, tripIdx, clusters, canValidate, setTrips, goTrip]);

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
            disabled={autoRunning || comparisonMode}
            style={{
              fontSize:11,padding:"5px 12px",borderRadius:6,border:"1px solid #B8942A",
              background:autoRunning?"#FEF3C7":"#FFFBEB",color:"#92400E",
              cursor:autoRunning?"not-allowed":"pointer",fontWeight:600,fontFamily:"var(--sans)",
            }}>
            {autoRunning ? "⏳ Aplicando…" : comparisonMode ? "⚡ Comparando…" : "⚡ Auto-detectar"}
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
                disabled={!canValidate}
                title={!canValidate ? "Asigná tipo de servicio a todos los clusters primero" : ""}
                style={{
                  fontSize:11,padding:"5px 12px",borderRadius:6,fontWeight:600,
                  border:`1px solid ${canValidate ? "#16A34A" : "#D6E0ED"}`,
                  background:canValidate ? "#16A34A" : "#F3F4F6",
                  color:canValidate ? "#fff" : "#9CA3AF",
                  cursor:canValidate ? "pointer" : "not-allowed",
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
              color: clusters.length===0 ? "#6381A7" : allClustersHaveTipo ? "#1E7A4A" : "#92400E",
            }}>
              {clusters.length === 0
                ? "Sin clusters — validable"
                : allClustersHaveTipo
                  ? `${clusters.length} cluster${clusters.length!==1?"s":""} ✓`
                  : `${clusters.filter(c=>!c.tipoServicio).length} sin tipo`}
            </span>
          </div>

          {/* Tabla scrolleable */}
          <div style={{flex:1,overflowY:"auto",overflowX:"auto"}}>
            <SequenceTable
              points={points}
              clusters={clusters}
              highlightNum={highlightNum}
              onClusterClick={c => {
                setHighlightNum(c.num);
                setZoomTarget([...c.points]);
              }}
              onTipoChange={handleTipoChange}
              onLabelClick={(idx, pt) => setLabelEditing({idx, pt})}
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
                <Polyline key={`${i}-${s.color}`} positions={s.pos} color={s.color} weight={3} opacity={0.85}/>
              ))}

              {/* Marcadores de todos los puntos */}
              {points.map((p, i) => {
                if (p.lat == null || p.lon == null) return null;
                const col    = pointColor(p);
                const lbl    = pointLabel(p);
                const isSel  = selPt === i;
                const isHL   = highlightNum != null && p.servicio_num === highlightNum;
                const isCluster = p.servicio_num != null;

                // Tamaños:
                // - highlight (seleccionado desde tabla): 11px, halo exterior
                // - seleccionado por click: 9px, borde blanco
                // - cluster normal: 8px, color del cluster
                // - con etiqueta (tránsito etc): 5px
                // - sin etiqueta: 3px gris
                const radius = isSel ? 9 : isCluster ? 8 : 5;

                const hasLabel = p.state != null || p.servicio_num != null;
                if (!hasLabel && !isSel) {
                  return (
                    <CircleMarker key={`${i}-none`} center={[p.lat,p.lon]} radius={3}
                      color="#ccc" weight={1} fillColor="#ccc" fillOpacity={0.4}
                      eventHandlers={{click:()=>{setSelPt(i);setLabelEditing({idx:i,pt:p});}}}>
                    </CircleMarker>
                  );
                }

                const popup = (
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
                );

                return (
                  <CircleMarker key={`${i}-${p.servicio_num ?? "x"}-${p.state ?? "x"}`} center={[p.lat,p.lon]} radius={radius}
                    color={isSel ? "#fff" : isCluster ? "#fff" : col}
                    weight={isSel ? 3 : isCluster ? 2 : 1.5}
                    fillColor={col}
                    fillOpacity={isSel ? 1 : isCluster ? 0.95 : 0.8}
                    eventHandlers={{click:()=>{setSelPt(i);setLabelEditing({idx:i,pt:p});}}}>
                    {popup}
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

      {/* Modo comparación — 4 mapas sincronizados */}
      {comparisonMode && (
        <ComparisonMode
          rawPoints={points}
          onApply={handleApplyModel}
          onClose={() => setComparisonMode(false)}
        />
      )}

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
