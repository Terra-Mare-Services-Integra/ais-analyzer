import { useState, useCallback } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";
import { ZONES, STATES, SERVICE_TYPES, OPERATIONAL_ZONES } from "../lib/ais_engine";

const fmtDate = d => d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
const fmtTime = d => d ? new Date(d).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—";

// ─── MAP FIT ──────────────────────────────────────────────────────────────────
function MapFit({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
    map.fitBounds(
      [[Math.min(...lats) - .05, Math.min(...lons) - .05], [Math.max(...lats) + .05, Math.max(...lons) + .05]],
      { padding: [20, 20] }
    );
  }, [points, map]);
  return null;
}

// ─── SERVICE EDITOR ───────────────────────────────────────────────────────────
function ServiceEditor({ point, onSave, onClose }) {
  const [svc,  setSvc]  = useState(point.tipo_servicio || "SIN_CLASIFICAR");
  const [zona, setZona] = useState(point.zona_servicio || "ZONA_COMUN");

  const SVCS  = ["AGUA", "SLOP", "LUBRICANTES", "ALIJO_ZC", "ALIJO_ZA", "ALIJO_ZD", "BORRADO"];
  const ZONAS = ["ZONA_COMUN", "ZONA_ALFA", "ZONA_DELTA", "RECALADA", "KM171"];

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16 }}
      onClick={onClose}>
      <div style={{ background:"#fff",borderRadius:14,padding:22,width:"100%",maxWidth:340,boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:14,fontWeight:700,color:"#213363",marginBottom:2 }}>Clasificar servicio</div>
        <div style={{ fontSize:10,color:"#6381A7",fontFamily:"var(--mono)",marginBottom:16 }}>
          {new Date(point.datetime).toLocaleString("es-AR")} · SOG {point.sog} kn · {point.zone}
        </div>

        <div style={{ fontSize:10,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:".8px",marginBottom:8 }}>Tipo de servicio</div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:14 }}>
          {SVCS.map(s => {
            const info = SERVICE_TYPES[s];
            return (
              <button key={s}
                style={{ padding:"8px 6px",borderRadius:6,border:`1px solid ${svc===s?info.color:"#D6E0ED"}`,fontSize:10,fontWeight:svc===s?700:500,cursor:"pointer",textAlign:"center",background:svc===s?info.color+"18":"#fff",color:svc===s?info.color:"#213363",transition:"all .12s" }}
                onClick={() => setSvc(s)}>{info.label}</button>
            );
          })}
        </div>

        {svc !== "BORRADO" && <>
          <div style={{ fontSize:10,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:".8px",marginBottom:8 }}>Zona operativa</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:16 }}>
            {ZONAS.map(z => (
              <button key={z}
                style={{ padding:"7px 8px",borderRadius:6,border:`1px solid ${zona===z?"#235C96":"#D6E0ED"}`,fontSize:10,cursor:"pointer",textAlign:"center",background:zona===z?"#EFF6FF":"#fff",color:zona===z?"#235C96":"#213363",fontWeight:zona===z?600:400,transition:"all .12s" }}
                onClick={() => setZona(z)}>{z.replace(/_/g," ")}</button>
            ))}
          </div>
        </>}

        <div style={{ display:"flex",gap:7 }}>
          <button
            style={{ flex:1,padding:"9px 0",borderRadius:7,background:"#235C96",color:"#fff",border:"none",fontSize:12,fontWeight:600,cursor:"pointer" }}
            onClick={() => onSave({ ...point, tipo_servicio: svc, zona_servicio: zona })}>✓ Confirmar</button>
          <button
            style={{ padding:"9px 12px",borderRadius:7,border:"1px solid #FECACA",background:"#fff",color:"#C0392B",fontSize:11,fontWeight:600,cursor:"pointer" }}
            onClick={() => onSave({ ...point, tipo_servicio: "BORRADO" })}>✕ Borrar</button>
          <button
            style={{ padding:"9px 12px",borderRadius:7,border:"1px solid #D6E0ED",background:"#fff",color:"#6381A7",fontSize:11,cursor:"pointer" }}
            onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── TRIP VIEWER ─────────────────────────────────────────────────────────────
export default function TripViewer({ trips, setTrips, initialIdx = 0, onBack }) {
  const [tripIdx, setTripIdx] = useState(initialIdx);
  const [selPt,   setSelPt]   = useState(null);
  const [editing, setEditing] = useState(null);
  const [filter,  setFilter]  = useState("ALL");

  const trip   = trips[tripIdx];
  const points = trip?.points || [];

  const visible = filter === "ALL"  ? points
    : filter === "SVC"              ? points.filter(p => p.state === "WORKING_STOP")
    :                                 points.filter(p => p.state !== "IN_PORT");

  // Track segments colored by state
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({ pos: [[points[i].lat, points[i].lon], [points[i+1].lat, points[i+1].lon]], color: STATES[points[i].state]?.color || "#999" });
  }

  const handleSave = useCallback((updated) => {
    setTrips(trips.map((t, ti) =>
      ti !== tripIdx ? t : { ...t, points: t.points.map((p, pi) => pi === editing.idx ? updated : p) }
    ));
    setEditing(null); setSelPt(null);
  }, [trips, tripIdx, editing, setTrips]);

  const markValidated = () => {
    setTrips(trips.map((t, i) => i === tripIdx ? { ...t, validated: true } : t));
    if (tripIdx < trips.length - 1) setTripIdx(i => i + 1);
  };

  const S = {
    shell:   { display:"flex",flexDirection:"column",height:"calc(100vh - 52px)" },
    topbar:  { display:"flex",alignItems:"center",gap:10,padding:"9px 16px",borderBottom:"1px solid #D6E0ED",background:"#fff",flexShrink:0,flexWrap:"wrap" },
    body:    { display:"grid",gridTemplateColumns:"1fr 300px",flex:1,minHeight:0 },
    mapWrap: { position:"relative",height:"100%" },
    rpanel:  { display:"flex",flexDirection:"column",borderLeft:"1px solid #D6E0ED",background:"#fff",overflow:"hidden" },
    rpHdr:   { padding:"12px 14px",borderBottom:"1px solid #D6E0ED",background:"#F8FAFC",flexShrink:0 },
    rpKpis:  { display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,padding:"9px 12px",borderBottom:"1px solid #EEF2F7",flexShrink:0 },
    kpi:     { background:"#EEF2F7",borderRadius:6,padding:"6px 8px",textAlign:"center" },
    ptsHdr:  { padding:"7px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #EEF2F7",flexShrink:0 },
    ptsList: { flex:1,overflowY:"auto" },
    btn:     (active) => ({ fontSize:11,padding:"5px 11px",borderRadius:6,border:`1px solid ${active?"#235C96":"#D6E0ED"}`,background:active?"#EFF6FF":"#fff",color:active?"#235C96":"#6381A7",cursor:"pointer",fontFamily:"var(--sans)",fontWeight:active?600:400 }),
    fchip:   (active) => ({ fontSize:9,padding:"2px 7px",borderRadius:10,border:`1px solid ${active?"#235C96":"#D6E0ED"}`,background:active?"#EFF6FF":"#fff",color:active?"#235C96":"#6381A7",cursor:"pointer",fontFamily:"var(--mono)" }),
  };

  return (
    <div style={S.shell}>
      {/* Topbar */}
      <div style={S.topbar}>
        <button style={S.btn(false)} onClick={onBack}>← Lista</button>
        <button style={S.btn(false)} onClick={() => setTripIdx(i => Math.max(0, i-1))} disabled={tripIdx===0}>‹</button>
        <span style={{ fontFamily:"var(--mono)",fontSize:12,fontWeight:700,color:"#213363" }}>
          Viaje #{trip?.id} — {fmtDate(trip?.dateStart)} → {fmtDate(trip?.dateEnd)}
        </span>
        <button style={S.btn(false)} onClick={() => setTripIdx(i => Math.min(trips.length-1, i+1))} disabled={tripIdx===trips.length-1}>›</button>
        <div style={{ marginLeft:"auto" }}>
          {trip?.validated
            ? <span style={{ fontSize:11,color:"#1E7A4A",fontWeight:600 }}>✓ Validado</span>
            : <button style={{ ...S.btn(true),background:"#1E7A4A",color:"#fff",borderColor:"#1E7A4A" }} onClick={markValidated}>✓ Marcar validado</button>
          }
        </div>
      </div>

      {/* Body */}
      <div style={S.body}>
        {/* MAP */}
        <div style={S.mapWrap}>
          <MapContainer center={[-34.7, -58.0]} zoom={9} style={{ height:"100%",width:"100%" }}>
            <TileLayer attribution="© OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapFit points={points} />

            {/* Zone outlines */}
            {Object.entries(ZONES).map(([key, z]) => (
              <Polyline key={key}
                positions={[...z.polygon.map(([a,b]) => [a,b]), [z.polygon[0][0], z.polygon[0][1]]]}
                color={z.color} weight={1.5} opacity={0.7} dashArray="4,4" />
            ))}

            {/* Track */}
            {segments.map((s, i) => <Polyline key={i} positions={s.pos} color={s.color} weight={3} opacity={0.85} />)}

            {/* Working stops */}
            {points.map((p, i) => {
              if (p.state !== "WORKING_STOP" && p.state !== "MICRO_TRANSIT") return null;
              const svcInfo = p.tipo_servicio ? SERVICE_TYPES[p.tipo_servicio] : null;
              const col = svcInfo ? svcInfo.color : (STATES[p.state]?.color || "#66BB6A");
              return (
                <CircleMarker key={i} center={[p.lat, p.lon]}
                  radius={p.state === "WORKING_STOP" ? 8 : 5}
                  color={col} weight={2} fillColor={col} fillOpacity={0.9}
                  eventHandlers={{ click: () => { setSelPt(i); if (p.state === "WORKING_STOP") setEditing({ idx: i, pt: p }); } }}>
                  <Popup>
                    <div style={{ fontSize:12,minWidth:160 }}>
                      <strong>{new Date(p.datetime).toLocaleString("es-AR")}</strong><br />
                      SOG: {p.sog} kn | {p.zone}<br />
                      {STATES[p.state]?.label}
                      {svcInfo && <><br /><em style={{ color: col }}>{svcInfo.label}</em></>}
                      {p.state === "WORKING_STOP" && (
                        <button style={{ marginTop:6,width:"100%",padding:"5px 0",borderRadius:6,background:"#235C96",color:"#fff",border:"none",fontSize:11,cursor:"pointer" }}
                          onClick={() => setEditing({ idx: i, pt: p })}>✏ Clasificar</button>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}

            {/* Start / End */}
            {points.length > 0 && <>
              <CircleMarker center={[points[0].lat, points[0].lon]} radius={8} color="#fff" weight={3} fillColor="#213363" fillOpacity={1}>
                <Popup><strong>Inicio</strong><br />{fmtDate(trip?.dateStart)} {fmtTime(trip?.dateStart)}</Popup>
              </CircleMarker>
              <CircleMarker center={[points[points.length-1].lat, points[points.length-1].lon]} radius={8} color="#fff" weight={3} fillColor="#1E7A4A" fillOpacity={1}>
                <Popup><strong>Cierre</strong><br />{fmtDate(trip?.dateEnd)} {fmtTime(trip?.dateEnd)}</Popup>
              </CircleMarker>
            </>}
          </MapContainer>
        </div>

        {/* RIGHT PANEL */}
        <div style={S.rpanel}>
          <div style={S.rpHdr}>
            <div style={{ fontSize:13,fontWeight:700,color:"#213363" }}>Viaje #{trip?.id}</div>
            <div style={{ fontSize:10,color:"#6381A7",fontFamily:"var(--mono)",marginTop:1 }}>
              {fmtDate(trip?.dateStart)} {fmtTime(trip?.dateStart)} → {fmtDate(trip?.dateEnd)} {fmtTime(trip?.dateEnd)}
            </div>
          </div>
          <div style={S.rpKpis}>
            <div style={S.kpi}><div style={{ fontSize:14,fontWeight:700,color:"#213363" }}>{trip?.durationHs?.toFixed(0)}h</div><div style={{ fontSize:9,color:"#6381A7",textTransform:"uppercase",letterSpacing:".4px",marginTop:1 }}>Duración</div></div>
            <div style={S.kpi}><div style={{ fontSize:14,fontWeight:700,color:"#1E7A4A" }}>{trip?.nServices || 0}</div><div style={{ fontSize:9,color:"#6381A7",textTransform:"uppercase",letterSpacing:".4px",marginTop:1 }}>Servicios</div></div>
            <div style={S.kpi}><div style={{ fontSize:14,fontWeight:700,color:"#213363" }}>{trip?.distNm}nm</div><div style={{ fontSize:9,color:"#6381A7",textTransform:"uppercase",letterSpacing:".4px",marginTop:1 }}>Distancia</div></div>
          </div>

          <div style={S.ptsHdr}>
            <span style={{ fontSize:9,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:1 }}>Puntos ({visible.length})</span>
            <div style={{ display:"flex",gap:3 }}>
              {[["ALL","Todo"],["SVC","Svc"],["MOV","Mov"]].map(([f,l]) => (
                <button key={f} style={S.fchip(filter===f)} onClick={() => setFilter(f)}>{l}</button>
              ))}
            </div>
          </div>

          <div style={S.ptsList}>
            {visible.map((p, vi) => {
              const realIdx = points.indexOf(p);
              const isWS    = p.state === "WORKING_STOP";
              const svcInfo = p.tipo_servicio ? SERVICE_TYPES[p.tipo_servicio] : null;
              const col     = svcInfo ? svcInfo.color : (STATES[p.state]?.color || "#999");
              const isSel   = selPt === realIdx;
              return (
                <div key={vi}
                  style={{ display:"grid",gridTemplateColumns:"55px 42px 1fr 20px",gap:5,padding:"6px 10px",borderBottom:"1px solid #F5F7FA",cursor:"pointer",alignItems:"center",background:isSel?(isWS?"#F0FFF4":"#EFF6FF"):"transparent",borderLeft:isSel?`3px solid ${isWS?"#1E7A4A":"#235C96"}`:"3px solid transparent" }}
                  onClick={() => { setSelPt(realIdx); if (isWS) setEditing({ idx: realIdx, pt: p }); }}>
                  <span style={{ fontFamily:"var(--mono)",fontSize:9,color:"#6381A7",lineHeight:1.3 }}>{fmtTime(p.datetime)}<br /><span style={{ fontSize:8,color:"#A5B5CC" }}>{fmtDate(p.datetime)}</span></span>
                  <span style={{ fontFamily:"var(--mono)",fontSize:10,textAlign:"right",color:p.sog>3?"#235C96":p.sog<=0.5?"#1E7A4A":"#854F0B" }}>{p.sog}kn</span>
                  <span style={{ fontSize:8,padding:"2px 5px",borderRadius:3,background:col+"18",color:col,border:`1px solid ${col}44`,fontFamily:"var(--mono)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                    {svcInfo ? svcInfo.label : STATES[p.state]?.label || p.state}
                  </span>
                  <span style={{ fontSize:11,color:isSel?"#235C96":"#D6E0ED",textAlign:"center" }}>{isWS?"✏":""}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editing && <ServiceEditor point={editing.pt} onSave={handleSave} onClose={() => setEditing(null)} />}
    </div>
  );
}
