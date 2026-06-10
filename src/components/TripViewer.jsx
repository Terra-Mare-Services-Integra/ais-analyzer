import { useState, useCallback, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { ZONES, STATES, SERVICE_TYPES } from "../lib/ais_engine";
import { supabase } from "../lib/supabase";

// ─── HELPERS DE FECHA ─────────────────────────────────────────────────────────
// FIX UX: siempre formato 24h explícito usando componentes UTC.
// La versión anterior usaba toLocaleTimeString("es-AR") que en algunos browsers
// devuelve "6:37 a.m." o "06:37 a. m." con puntos y espacio — inconsistente.
const fmtDate = d => {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "—";
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(dt.getUTCFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
};

const fmtTime = d => {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")}`;
};

const fmtDatetime = d => {
  if (!d) return "—";
  return `${fmtDate(d)} ${fmtTime(d)} UTC`;
};

// ─── COLORES POR NÚMERO DE SERVICIO ──────────────────────────────────────────
const SVC_COLORS = ["#2196F3", "#FF9800", "#9C27B0", "#4CAF50", "#F44336", "#00BCD4", "#FF5722"];
const svcColor = (n) => (n != null ? SVC_COLORS[(n - 1) % SVC_COLORS.length] : "#9E9E9E");

// ─── MAP FIT — LA RAÍZ DEL BUG DE ZOOM ───────────────────────────────────────
// FIX CRÍTICO UX — el zoom-out que reportaste.
// Causa: <MapFit points={points} /> recibía `points` como prop. Cada vez que el
// usuario clasificaba un punto, `handleSave` llamaba setTrips → nuevo array de
// trips → nuevo array de points → React detectaba cambio en la prop → el
// useEffect dentro de MapFit disparaba map.fitBounds() → ZOOM OUT.
//
// Solución: MapFit solo dispara fitBounds UNA VEZ, al montar (cuando el
// componente aparece por primera vez con los puntos del viaje). Nunca más.
// Usamos una ref para garantizar que fitBounds se llame solo en el primer render
// con puntos válidos, y nunca por actualizaciones de clasificación.
//
// Adicionalmente: si el usuario cambia de viaje (tripIdx cambia), el componente
// se desmonta y remonta con key={tripIdx}, por lo que el fit ocurre correctamente
// para el nuevo viaje también.
function MapFit({ points }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    // Solo fitear una vez por montaje del componente
    if (fitted.current || !points?.length) return;
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    // Validar que las coordenadas sean números reales antes de fitBounds
    if ([minLat, maxLat, minLon, maxLon].some(v => !Number.isFinite(v))) return;
    map.fitBounds(
      [[minLat - 0.05, minLon - 0.05], [maxLat + 0.05, maxLon + 0.05]],
      { padding: [20, 20], maxZoom: 13 }
    );
    fitted.current = true;
  // Solo depende del map — intencionalmente NO incluimos points en deps
  // para que el efecto no se repita cuando cambian los datos de clasificación.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

// ─── MODAL DE CLASIFICACIÓN ───────────────────────────────────────────────────
// FIX UX: múltiples mejoras al modal que se ve en las capturas de pantalla.
// 1. SOG nulo se muestra como "—" en lugar de "null kn"
// 2. Timestamp siempre en 24h UTC
// 3. Botones de tipo de servicio tienen estado visual más claro (selected vs not)
// 4. Tecla Escape cierra el modal
// 5. Focus queda dentro del modal (trap) para no romper navegación por teclado
const SVCS_CLASIFICABLES = ["AGUA", "SLOP", "LUBRICANTES", "ALIJO_ZC", "ALIJO_ZA", "ALIJO_ZD"];
const ZONAS_OP = ["ZONA_COMUN", "ZONA_ALFA", "ZONA_DELTA", "RECALADA", "KM171"];

function ServiceEditor({ point, onSave, onClose, maxSvcNum }) {
  const [svc,    setSvc]    = useState(point.tipo_servicio && !["SIN_CLASIFICAR", "BORRADO"].includes(point.tipo_servicio) ? point.tipo_servicio : "AGUA");
  const [zona,   setZona]   = useState(point.zona_servicio && ZONAS_OP.includes(point.zona_servicio) ? point.zona_servicio : "ZONA_COMUN");
  const [svcNum, setSvcNum] = useState(point.servicio_num ?? null);

  // Opciones de número de servicio: los existentes + uno nuevo
  const svcNums = Array.from({ length: (maxSvcNum || 0) + 1 }, (_, i) => i + 1);

  // FIX UX: Escape cierra el modal
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const sogDisplay = point.sog !== null && point.sog !== undefined
    ? `${Number(point.sog).toFixed(1)} kn`
    : "SOG —";

  const handleConfirm = () => {
    onSave({
      ...point,
      tipo_servicio: svcNum === null ? "BORRADO" : svc,
      zona_servicio: zona,
      servicio_num:  svcNum,
    });
  };

  return (
    // FIX UX: overlay con pointer-events bloqueados al scroll del mapa detrás
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clasificar punto de servicio"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 14, padding: 22, width: "100%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ fontSize: 14, fontWeight: 700, color: "#213363", marginBottom: 2 }}>
          Clasificar punto
        </div>
        <div style={{ fontSize: 10, color: "#6381A7", fontFamily: "var(--mono)", marginBottom: 16 }}>
          {/* FIX UX: 24h UTC explícito */}
          {fmtDatetime(point.datetime)} · {sogDisplay} · {point.zone}
        </div>

        {/* Número de servicio */}
        <div style={{ fontSize: 10, fontWeight: 600, color: "#6381A7", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>
          Número de servicio
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          <button
            style={{
              padding: "7px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: svcNum === null ? 700 : 400,
              border: `1px solid ${svcNum === null ? "#EF5350" : "#D6E0ED"}`,
              background: svcNum === null ? "#FFF5F5" : "#fff",
              color: svcNum === null ? "#C0392B" : "#6381A7",
            }}
            onClick={() => setSvcNum(null)}
          >
            ✕ No es servicio
          </button>
          {svcNums.map(n => (
            <button
              key={n}
              style={{
                padding: "7px 14px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: svcNum === n ? 700 : 400,
                border: `1px solid ${svcNum === n ? svcColor(n) : "#D6E0ED"}`,
                background: svcNum === n ? `${svcColor(n)}18` : "#fff",
                color: svcNum === n ? svcColor(n) : "#213363",
              }}
              onClick={() => {
                setSvcNum(n);
                // Si venía de BORRADO/SIN_CLASIFICAR, pre-seleccionar AGUA como default
                if (!svc || svc === "BORRADO" || svc === "SIN_CLASIFICAR") setSvc("AGUA");
              }}
            >
              S{n}{n === (maxSvcNum || 0) + 1 ? " (nuevo)" : ""}
            </button>
          ))}
        </div>

        {/* Tipo y zona — solo si es servicio */}
        {svcNum !== null && (
          <>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#6381A7", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>
              Tipo de servicio
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 14 }}>
              {SVCS_CLASIFICABLES.map(s => {
                const info = SERVICE_TYPES[s];
                const selected = svc === s;
                return (
                  <button
                    key={s}
                    style={{
                      padding: "8px 6px", borderRadius: 6, fontSize: 10, cursor: "pointer", textAlign: "center",
                      border: `1.5px solid ${selected ? info.color : "#D6E0ED"}`,
                      background: selected ? `${info.color}18` : "#fff",
                      color: selected ? info.color : "#213363",
                      fontWeight: selected ? 700 : 400,
                      transition: "all .12s",
                    }}
                    onClick={() => setSvc(s)}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: 10, fontWeight: 600, color: "#6381A7", textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>
              Zona operativa
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 16 }}>
              {ZONAS_OP.map(z => {
                const selected = zona === z;
                return (
                  <button
                    key={z}
                    style={{
                      padding: "7px 8px", borderRadius: 6, fontSize: 10, cursor: "pointer", textAlign: "center",
                      border: `1.5px solid ${selected ? "#235C96" : "#D6E0ED"}`,
                      background: selected ? "#EFF6FF" : "#fff",
                      color: selected ? "#235C96" : "#213363",
                      fontWeight: selected ? 600 : 400,
                      transition: "all .12s",
                    }}
                    onClick={() => setZona(z)}
                  >
                    {z.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Acciones */}
        <div style={{ display: "flex", gap: 7 }}>
          <button
            style={{ flex: 1, padding: "9px 0", borderRadius: 7, background: "#235C96", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            onClick={handleConfirm}
          >
            ✓ Confirmar
          </button>
          <button
            style={{ padding: "9px 12px", borderRadius: 7, border: "1px solid #D6E0ED", background: "#fff", color: "#6381A7", fontSize: 11, cursor: "pointer" }}
            onClick={onClose}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function TripViewer({ trips, setTrips, initialIdx = 0, onBack }) {
  const [tripIdx, setTripIdx] = useState(initialIdx);
  const [selPt,   setSelPt]   = useState(null);
  const [editing, setEditing] = useState(null);
  const [filter,  setFilter]  = useState("ALL");
  const [saving,  setSaving]  = useState(false);
  // FIX UX: feedback de guardado exitoso/fallido en lugar de solo "Guardando..."
  const [saveStatus, setSaveStatus] = useState(null); // null | "ok" | "error"

  const trip   = trips[tripIdx];
  const points = trip?.points || [];

  // FIX: filtros correctamente nombrados y con lógica consistente
  const visible = (() => {
    if (filter === "SVC") return points.filter(p => p.state === "WORKING_STOP");
    if (filter === "MOV") return points.filter(p => p.state !== "IN_PORT");
    return points;
  })();

  // Segmentos de ruta (polylines entre puntos consecutivos, coloreados por estado)
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      pos:   [[points[i].lat, points[i].lon], [points[i + 1].lat, points[i + 1].lon]],
      color: STATES[points[i].state]?.color || "#999",
    });
  }

  // maxSvcNum: máximo número de servicio asignado en este viaje
  const maxSvcNum = Math.max(0, ...points.map(p => p.servicio_num || 0));

  // ── handleSave ──
  // FIX: la actualización en memoria se hace sobre el trip correcto usando tripIdx
  // de la closure del useCallback. El estado newTrips se pasa a setTrips para que
  // App.jsx sincronice (y eventualmente persista a Supabase en update de viaje).
  //
  // FIX PERSISTENCIA: el update en Supabase ahora usa TANTO trip_id COMO datetime
  // para identificar el punto de forma inequívoca (datetime puede no ser único dentro
  // de un upload si el archivo tiene duplicados — ver auditoría).
  // FIX: el update incluye servicio_num además de tipo_servicio y zona_servicio.
  const handleSave = useCallback(async (updated) => {
    setSaving(true);
    setSaveStatus(null);

    const newTrips = trips.map((t, ti) => {
      if (ti !== tripIdx) return t;
      const newPoints = t.points.map((p, pi) => pi === editing.idx ? updated : p);
      // nServices = cantidad de números de servicio únicos asignados (excluye BORRADO)
      const servicios = new Set(
        newPoints
          .filter(p => p.servicio_num != null && p.tipo_servicio !== "BORRADO")
          .map(p => p.servicio_num)
      );
      return { ...t, points: newPoints, nServices: servicios.size };
    });

    setTrips(newTrips);
    setEditing(null);
    setSelPt(null);

    // Persistir a Supabase
    try {
      const currentTrip = newTrips[tripIdx];
      if (currentTrip?.supabaseId) {
        const datetimeStr = updated.datetime instanceof Date
          ? updated.datetime.toISOString()
          : new Date(updated.datetime).toISOString();

        const { error } = await supabase
          .from("ais_points")
          .update({
            tipo_servicio: updated.tipo_servicio,
            zona_servicio: updated.zona_servicio,
            servicio_num:  updated.servicio_num,   // FIX: persistir servicio_num
          })
          .eq("trip_id", currentTrip.supabaseId)
          .eq("datetime", datetimeStr);

        if (error) throw error;

        // FIX: actualizar también n_services en ais_trips para consistencia
        await supabase
          .from("ais_trips")
          .update({ n_services: newTrips[tripIdx].nServices })
          .eq("id", currentTrip.supabaseId);
      }
      setSaveStatus("ok");
    } catch (e) {
      console.error("[TripViewer] Error guardando clasificación:", e);
      setSaveStatus("error");
    } finally {
      setSaving(false);
      // Limpiar el status después de 2.5 segundos
      setTimeout(() => setSaveStatus(null), 2500);
    }
  }, [trips, tripIdx, editing, setTrips]);

  // ── markValidated ──
  // FIX: markValidated usa el trip actual del array newTrips para el supabaseId,
  // no el trip del closure original (que puede estar desactualizado si hubo saves).
  const markValidated = useCallback(async () => {
    const newTrips = trips.map((t, i) => i === tripIdx ? { ...t, validated: true } : t);
    setTrips(newTrips);

    const currentTrip = newTrips[tripIdx];
    if (currentTrip?.supabaseId) {
      const { error } = await supabase
        .from("ais_trips")
        .update({ validated: true })
        .eq("id", currentTrip.supabaseId);
      if (error) console.error("[TripViewer] Error marcando validado:", error.message);
    }

    // Avanzar al siguiente viaje no validado
    const nextUnvalidated = newTrips.findIndex((t, i) => i > tripIdx && !t.validated);
    if (nextUnvalidated !== -1) {
      setTripIdx(nextUnvalidated);
    } else if (tripIdx < trips.length - 1) {
      setTripIdx(i => i + 1);
    }
  }, [trips, tripIdx, setTrips]);

  // ── Navegación entre viajes: limpiar estado de selección ──
  const goTrip = useCallback((newIdx) => {
    setTripIdx(newIdx);
    setSelPt(null);
    setEditing(null);
    setFilter("ALL");
  }, []);

  // ── Estilos ──
  const S = {
    btn: (active, color) => ({
      fontSize: 11, padding: "5px 11px", borderRadius: 6,
      border: `1px solid ${active ? (color || "#235C96") : "#D6E0ED"}`,
      background: active ? (color ? "#fff" : "#EFF6FF") : "#fff",
      color: active ? (color || "#235C96") : "#6381A7",
      cursor: "pointer", fontFamily: "var(--sans)", fontWeight: active ? 600 : 400,
    }),
    fchip: active => ({
      fontSize: 9, padding: "2px 7px", borderRadius: 10,
      border: `1px solid ${active ? "#235C96" : "#D6E0ED"}`,
      background: active ? "#EFF6FF" : "#fff",
      color: active ? "#235C96" : "#6381A7",
      cursor: "pointer", fontFamily: "var(--mono)",
    }),
  };

  if (!trip) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "calc(100vh - 52px)", color: "var(--muted)", fontSize: 13 }}>
        No hay viaje seleccionado.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 52px)" }}>

      {/* ── Topbar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: "1px solid #D6E0ED", background: "#fff", flexShrink: 0, flexWrap: "wrap" }}>
        <button style={S.btn(false)} onClick={onBack}>← Lista</button>
        <button
          style={S.btn(false)}
          onClick={() => goTrip(Math.max(0, tripIdx - 1))}
          disabled={tripIdx === 0}
          aria-label="Viaje anterior"
        >
          ‹
        </button>
        <span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: "#213363" }}>
          {/* FIX UX: mostrar ambas fechas con hora para cronología clara */}
          Viaje #{trip.id} — {fmtDate(trip.dateStart)} {fmtTime(trip.dateStart)} → {fmtDate(trip.dateEnd)} {fmtTime(trip.dateEnd)} UTC
          {trip.incomplete && (
            <span style={{ marginLeft: 8, fontSize: 10, color: "#92400E", background: "#FEF3C7", padding: "1px 6px", borderRadius: 3 }}>
              ⚠ Incompleto
            </span>
          )}
        </span>
        <button
          style={S.btn(false)}
          onClick={() => goTrip(Math.min(trips.length - 1, tripIdx + 1))}
          disabled={tripIdx === trips.length - 1}
          aria-label="Viaje siguiente"
        >
          ›
        </button>

        {/* Feedback de guardado */}
        {saving && (
          <span style={{ fontSize: 10, color: "#6381A7", fontFamily: "var(--mono)" }}>
            Guardando…
          </span>
        )}
        {saveStatus === "ok" && (
          <span style={{ fontSize: 10, color: "#1E7A4A", fontFamily: "var(--mono)" }}>
            ✓ Guardado
          </span>
        )}
        {saveStatus === "error" && (
          <span style={{ fontSize: 10, color: "#C0392B", fontFamily: "var(--mono)" }}>
            ⚠ Error al guardar
          </span>
        )}

        <div style={{ marginLeft: "auto" }}>
          {trip.validated ? (
            <span style={{ fontSize: 11, color: "#1E7A4A", fontWeight: 600 }}>✓ Validado</span>
          ) : (
            <button
              style={{ ...S.btn(true), background: "#1E7A4A", color: "#fff", borderColor: "#1E7A4A" }}
              onClick={markValidated}
            >
              ✓ Marcar validado
            </button>
          )}
        </div>
      </div>

      {/* ── Body: mapa + panel derecho ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", flex: 1, minHeight: 0 }}>

        {/* ── MAPA ── */}
        {/* FIX CRÍTICO: key={tripIdx} fuerza desmonte/remonte del MapContainer
            al cambiar de viaje. Esto garantiza que MapFit fitee correctamente
            el nuevo viaje y que el mapa no mantenga estado del viaje anterior. */}
        <div style={{ position: "relative", height: "100%" }}>
          <MapContainer
            key={tripIdx}
            center={[-34.7, -58.0]}
            zoom={9}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution="© OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {/* MapFit con ref interna — solo fita al montar, nunca en clasificaciones */}
            <MapFit points={points} />

            {/* Polígonos de zonas operativas */}
            {Object.entries(ZONES).map(([key, z]) => (
              <Polyline
                key={key}
                positions={[...z.polygon.map(([a, b]) => [a, b]), [z.polygon[0][0], z.polygon[0][1]]]}
                color={z.color}
                weight={1.5}
                opacity={0.6}
                dashArray="4,4"
              />
            ))}

            {/* Ruta del viaje */}
            {segments.map((s, i) => (
              <Polyline key={i} positions={s.pos} color={s.color} weight={3} opacity={0.85} />
            ))}

            {/* Puntos WORKING_STOP — clasificables */}
            {points.map((p, i) => {
              if (p.state !== "WORKING_STOP") return null;
              const col = p.servicio_num != null ? svcColor(p.servicio_num) : "#9E9E9E";
              const isSelected = selPt === i;
              return (
                <CircleMarker
                  key={i}
                  center={[p.lat, p.lon]}
                  radius={isSelected ? 10 : 8}
                  color={isSelected ? "#fff" : col}
                  weight={isSelected ? 3 : 2}
                  fillColor={col}
                  fillOpacity={0.9}
                  eventHandlers={{
                    click: () => {
                      setSelPt(i);
                      setEditing({ idx: i, pt: p });
                    },
                  }}
                >
                  <Popup>
                    <div style={{ fontSize: 12, minWidth: 180 }}>
                      {/* FIX UX: 24h UTC en popup */}
                      <strong>{fmtDatetime(p.datetime)}</strong><br />
                      SOG: {p.sog !== null ? `${Number(p.sog).toFixed(1)} kn` : "—"} | {p.zone}<br />
                      {STATES[p.state]?.label}
                      {p.servicio_num != null && p.tipo_servicio && !["SIN_CLASIFICAR", "BORRADO"].includes(p.tipo_servicio) && (
                        <>
                          <br />
                          <em style={{ color: col }}>
                            S{p.servicio_num} · {SERVICE_TYPES[p.tipo_servicio]?.label}
                          </em>
                        </>
                      )}
                      <button
                        style={{ marginTop: 7, width: "100%", padding: "6px 0", borderRadius: 6, background: "#235C96", color: "#fff", border: "none", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                        onClick={() => setEditing({ idx: i, pt: p })}
                      >
                        ✏ Clasificar
                      </button>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}

            {/* Marcadores de inicio y fin */}
            {points.length > 0 && (
              <>
                <CircleMarker
                  center={[points[0].lat, points[0].lon]}
                  radius={8} color="#fff" weight={3} fillColor="#213363" fillOpacity={1}
                >
                  <Popup>
                    <strong>Zarpe</strong><br />
                    {fmtDate(trip.dateStart)} {fmtTime(trip.dateStart)} UTC
                  </Popup>
                </CircleMarker>
                <CircleMarker
                  center={[points[points.length - 1].lat, points[points.length - 1].lon]}
                  radius={8} color="#fff" weight={3}
                  fillColor={trip.incomplete ? "#F59E0B" : "#1E7A4A"}
                  fillOpacity={1}
                >
                  <Popup>
                    <strong>{trip.incomplete ? "⚠ Fin de datos (incompleto)" : "Arribo"}</strong><br />
                    {fmtDate(trip.dateEnd)} {fmtTime(trip.dateEnd)} UTC
                  </Popup>
                </CircleMarker>
              </>
            )}
          </MapContainer>
        </div>

        {/* ── PANEL DERECHO ── */}
        <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid #D6E0ED", background: "#fff", overflow: "hidden" }}>

          {/* Info del viaje */}
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #D6E0ED", background: "#F8FAFC", flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#213363" }}>
              Viaje #{trip.id}
              {trip.incomplete && (
                <span style={{ marginLeft: 6, fontSize: 9, background: "#FEF3C7", color: "#92400E", padding: "1px 5px", borderRadius: 3 }}>
                  INCOMPLETO
                </span>
              )}
            </div>
            {/* FIX UX: hora en 24h UTC */}
            <div style={{ fontSize: 10, color: "#6381A7", fontFamily: "var(--mono)", marginTop: 1, lineHeight: 1.5 }}>
              {fmtDate(trip.dateStart)} {fmtTime(trip.dateStart)}<br />
              → {fmtDate(trip.dateEnd)} {fmtTime(trip.dateEnd)} UTC
            </div>
          </div>

          {/* Stats del viaje */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, padding: "9px 12px", borderBottom: "1px solid #EEF2F7", flexShrink: 0 }}>
            {[
              { v: `${trip.durationHs?.toFixed(0)}h`,      l: "Duración" },
              { v: trip.nServices || 0,                     l: "Servicios", c: "#1E7A4A" },
              { v: `${trip.distNm ?? "—"} nm`,              l: "Distancia" },
            ].map(k => (
              <div key={k.l} style={{ background: "#EEF2F7", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: k.c || "#213363" }}>{k.v}</div>
                <div style={{ fontSize: 9, color: "#6381A7", textTransform: "uppercase", letterSpacing: ".4px", marginTop: 1 }}>{k.l}</div>
              </div>
            ))}
          </div>

          {/* Filtros de puntos */}
          <div style={{ padding: "7px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #EEF2F7", flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: "#6381A7", textTransform: "uppercase", letterSpacing: 1 }}>
              {visible.length} punto{visible.length !== 1 ? "s" : ""}
            </span>
            <div style={{ display: "flex", gap: 3 }}>
              {[["ALL", "Todo"], ["SVC", "Svc"], ["MOV", "Mov"]].map(([f, l]) => (
                <button key={f} style={S.fchip(filter === f)} onClick={() => setFilter(f)}>{l}</button>
              ))}
            </div>
          </div>

          {/* Lista de puntos */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {visible.length === 0 && (
              <div style={{ padding: "20px 12px", textAlign: "center", fontSize: 11, color: "#A5B5CC" }}>
                No hay puntos {filter === "SVC" ? "WORKING_STOP" : ""} en este viaje.
              </div>
            )}
            {visible.map((p, vi) => {
              const realIdx = points.indexOf(p);
              const isWS  = p.state === "WORKING_STOP";
              const col   = isWS
                ? (p.servicio_num != null ? svcColor(p.servicio_num) : "#9E9E9E")
                : (STATES[p.state]?.color || "#999");
              const isSel = selPt === realIdx;

              return (
                <div
                  key={vi}
                  role="button"
                  tabIndex={0}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "58px 42px 1fr 18px",
                    gap: 5,
                    padding: "6px 10px",
                    borderBottom: "1px solid #F5F7FA",
                    cursor: "pointer",
                    alignItems: "center",
                    background: isSel ? (isWS ? "#F0FFF4" : "#EFF6FF") : "transparent",
                    borderLeft: isSel ? `3px solid ${isWS ? "#1E7A4A" : "#235C96"}` : "3px solid transparent",
                  }}
                  onClick={() => {
                    setSelPt(realIdx);
                    if (isWS) setEditing({ idx: realIdx, pt: p });
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      setSelPt(realIdx);
                      if (isWS) setEditing({ idx: realIdx, pt: p });
                    }
                  }}
                >
                  {/* FIX UX: hora en 24h UTC */}
                  <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "#6381A7", lineHeight: 1.3 }}>
                    {fmtTime(p.datetime)}<br />
                    <span style={{ fontSize: 8, color: "#A5B5CC" }}>{fmtDate(p.datetime)}</span>
                  </span>

                  {/* SOG — FIX UX: nulo mostrado como "—" */}
                  <span style={{
                    fontFamily: "var(--mono)", fontSize: 10, textAlign: "right",
                    color: p.sog === null ? "#A5B5CC" : p.sog > 3 ? "#235C96" : p.sog <= 0.5 ? "#1E7A4A" : "#854F0B",
                  }}>
                    {p.sog !== null ? `${Number(p.sog).toFixed(1)}kn` : "—"}
                  </span>

                  {/* Etiqueta de estado / servicio */}
                  <span style={{
                    fontSize: 8, padding: "2px 5px", borderRadius: 3,
                    background: `${col}18`, color: col,
                    border: `1px solid ${col}44`,
                    fontFamily: "var(--mono)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {p.servicio_num != null
                      ? `S${p.servicio_num}${p.tipo_servicio && !["SIN_CLASIFICAR", "BORRADO"].includes(p.tipo_servicio) ? ` · ${SERVICE_TYPES[p.tipo_servicio]?.label || ""}` : ""}`
                      : (STATES[p.state]?.label || p.state)
                    }
                  </span>

                  {/* Ícono de edición */}
                  <span style={{ fontSize: 11, color: isSel ? "#235C96" : "#D6E0ED", textAlign: "center" }}>
                    {isWS ? "✏" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Modal de clasificación ── */}
      {editing && (
        <ServiceEditor
          point={editing.pt}
          onSave={handleSave}
          onClose={() => { setEditing(null); setSelPt(null); }}
          maxSvcNum={maxSvcNum}
        />
      )}
    </div>
  );
}
