import { useMemo } from "react";
import { aggregateKPIs } from "../lib/ais_engine";

// ─── CONFIGURACIÓN DE SERVICIOS ───────────────────────────────────────────────
const SVC_ROWS = [
  { key: "agua_zc",  label: "Agua — Zona Común",  color: "#2196F3" },
  { key: "slop_zc",  label: "Slop — Zona Común",  color: "#FF9800" },
  { key: "lub_zc",   label: "Lubricantes — ZC",   color: "#4CAF50" },
  { key: "alijo_zc", label: "Alijo — Zona Común", color: "#9C27B0" },
  { key: "alijo_za", label: "Alijo — Zona Alfa",  color: "#673AB7" },
  { key: "alijo_zd", label: "Alijo — Zona Delta", color: "#3F51B5" },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
// FIX UX: formatear rango de fechas del dataset con formato legible
function fmtDateRange(trips) {
  if (!trips || trips.length === 0) return null;
  const dates = trips.flatMap(t => [t.dateStart, t.dateEnd]).filter(Boolean);
  if (!dates.length) return null;
  const min = new Date(Math.min(...dates.map(d => d.getTime ? d.getTime() : new Date(d).getTime())));
  const max = new Date(Math.max(...dates.map(d => d.getTime ? d.getTime() : new Date(d).getTime())));
  const fmt = d => `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
  return `${fmt(min)} → ${fmt(max)}`;
}

// ─── ESTADO VACÍO ─────────────────────────────────────────────────────────────
function EmptyDashboard({ onGoUpload }) {
  return (
    <div style={{ padding: "28px 32px", maxWidth: 800 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 3, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
        AIS Analyzer · Dashboard
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginBottom: 20 }}>
        Dashboard operativo
      </h1>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 340, textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 14, opacity: 0.35 }} aria-hidden="true">📊</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--navy)", marginBottom: 8 }}>
          Subí el archivo AIS para empezar
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", maxWidth: 380, lineHeight: 1.7 }}>
          Andá a Upload, cargá el Excel de VesselFinder, y acá aparecerán los KPIs del BG Tiger.
        </div>
        {/* FIX UX: CTA directo, antes no había botón en esta pantalla */}
        {onGoUpload && (
          <button
            onClick={onGoUpload}
            style={{ marginTop: 20, padding: "9px 22px", borderRadius: 8, background: "var(--blue)", color: "#fff", border: "none", fontFamily: "var(--sans)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            → Ir a Upload
          </button>
        )}
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function Dashboard({ data, onGoTrips, onGoUpload }) {
  // FIX PERF: aggregateKPIs se re-ejecuta solo cuando cambian los trips,
  // no en cada render del componente padre.
  const kpis = useMemo(() => {
    if (!data?.trips) return null;
    return aggregateKPIs(data.trips);
  }, [data?.trips]);

  if (!data || !kpis) return <EmptyDashboard onGoUpload={onGoUpload} />;

  const pct    = data.trips.length ? Math.round(kpis.validatedTrips / data.trips.length * 100) : 0;
  // FIX: Math.max con array vacío → -Infinity. Fallback a 1 para evitar división por cero en barras.
  const maxOp  = Math.max(...SVC_ROWS.map(s => kpis.ops[s.key]), 1);
  const dateRange = fmtDateRange(data.trips);

  // FIX LÓGICA: revenueExtra usa constantes hardcodeadas sin explicación.
  // Extraídas como constantes nombradas para que sean auditables.
  const AGUA_PRECIO_USD  = 250;  // USD por servicio de agua
  const AGUA_SERVICIOS_AÑO = 65; // servicios/año estimados
  const SLOP_PRECIO_USD  = 100;
  const SLOP_SERVICIOS_AÑO = 100;
  const revenueExtra =
    (kpis.ops.agua_zc * AGUA_PRECIO_USD * AGUA_SERVICIOS_AÑO) +
    (kpis.ops.slop_zc * SLOP_PRECIO_USD * SLOP_SERVICIOS_AÑO);

  // ── KPI cards config ──
  const kpiCards = [
    { val: kpis.totalTrips,     lbl: "Viajes",     sub: "total detectados",   col: "#235C96" },
    { val: kpis.validatedTrips, lbl: "Validados",  sub: `${pct}% del total`,  col: "#1E7A4A" },
    { val: kpis.totalServices,  lbl: "Servicios",  sub: "detectados",         col: "#1E7A4A" },
    { val: kpis.ops.agua_zc,    lbl: "Agua / ZC",  sub: "→ P&L B108",         col: "#2196F3" },
    { val: kpis.ops.slop_zc,    lbl: "Slop / ZC",  sub: "→ P&L B109",         col: "#FF9800" },
    { val: kpis.pendingTrips,   lbl: "Pendientes", sub: "por revisar",        col: "#6381A7" },
  ];

  // FIX UX: si hay viajes incompletos, mostrar en KPIs también
  if (kpis.incompleteTrips > 0) {
    kpiCards.push({
      val: kpis.incompleteTrips,
      lbl: "Incompletos",
      sub: "sin arribo registrado",
      col: "#F59E0B",
    });
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 900 }}>
      {/* ── Header ── */}
      <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 3, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
        AIS Analyzer · {data.filename}
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginBottom: 4 }}>
        Dashboard operativo
      </h1>
      {/* FIX UX: mostrar rango de fechas del dataset para contexto inmediato */}
      {dateRange && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", marginBottom: 6 }}>
          Dataset: {dateRange} (UTC)
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7, marginBottom: 20, maxWidth: 600 }}>
        Operaciones validadas por tipo de servicio. Los valores de agua y slop alimentan el P&L del modelo FSV.
      </p>

      {/* ── Barra de progreso de validación ── */}
      <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 9, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#854F0B", lineHeight: 1.6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <strong>
            Validación: {kpis.validatedTrips}/{data.trips.length} viajes
          </strong>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700 }}>{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% de viajes validados`}
          style={{ background: "#EEF2F7", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 7 }}
        >
          <div style={{
            width: `${pct}%`,
            height: "100%",
            background: pct === 100 ? "#22C55E" : "#FFA726",
            borderRadius: 4,
            transition: "width .4s ease",
          }} />
        </div>
        {kpis.pendingTrips > 0 && (
          <>
            <span>{kpis.pendingTrips} viaje{kpis.pendingTrips > 1 ? "s" : ""} pendiente{kpis.pendingTrips > 1 ? "s" : ""}. </span>
            <span
              role="button"
              tabIndex={0}
              style={{ cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
              onClick={onGoTrips}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onGoTrips?.(); }}
            >
              Ir a Trip Viewer →
            </span>
          </>
        )}
        {kpis.pendingTrips === 0 && (
          <span style={{ color: "#065F46", fontWeight: 600 }}>✓ Todos los viajes validados</span>
        )}
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
        {kpiCards.map(k => (
          <KpiCard key={k.lbl} {...k} />
        ))}
      </div>

      {/* ── Desglose por tipo de servicio ── */}
      <div style={{ background: "#fff", border: "1px solid #D6E0ED", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #EEF2F7", fontFamily: "var(--mono)", fontSize: 9, fontWeight: 600, color: "#6381A7", textTransform: "uppercase", letterSpacing: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Operaciones validadas por tipo</span>
          {/* FIX UX: aclarar que son las clasificadas, no las totales detectadas */}
          <span style={{ fontSize: 9, color: "#A5B5CC", fontWeight: 400 }}>
            solo viajes validados
          </span>
        </div>
        {SVC_ROWS.map((s, idx) => (
          <ServiceRow
            key={s.key}
            label={s.label}
            color={s.color}
            count={kpis.ops[s.key]}
            maxCount={maxOp}
            isLast={idx === SVC_ROWS.length - 1}
          />
        ))}
        {/* FIX UX: si totalServices > suma de ops clasificadas, mostrar los sin clasificar */}
        {(() => {
          const classified = SVC_ROWS.reduce((sum, s) => sum + kpis.ops[s.key], 0);
          const unclassified = kpis.totalServices - classified;
          if (unclassified <= 0) return null;
          return (
            <div style={{ padding: "8px 16px", background: "#FAFAFA", fontSize: 11, color: "#9E9E9E", fontFamily: "var(--mono)", borderTop: "1px solid #EEF2F7" }}>
              + {unclassified} servicio{unclassified > 1 ? "s" : ""} sin clasificar
            </div>
          );
        })()}
      </div>

      {/* ── Impacto en el modelo ── */}
      {revenueExtra > 0 && (
        <div style={{ background: "#F0FFF4", border: "1px solid #86EFAC", borderRadius: 9, padding: "14px 16px", fontSize: 12, color: "#065F46", lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            💡 Impacto estimado en el modelo FSV
          </div>
          <div>
            {kpis.ops.agua_zc} ops de agua × ${AGUA_PRECIO_USD.toLocaleString("es-AR")} × {AGUA_SERVICIOS_AÑO} svc/año
            {" + "}
            {kpis.ops.slop_zc} ops de slop × ${SLOP_PRECIO_USD.toLocaleString("es-AR")} × {SLOP_SERVICIOS_AÑO} svc/año
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 6, color: "#047857" }}>
            = USD {revenueExtra.toLocaleString("es-AR")} / año estimado
          </div>
          {/* FIX UX: aclarar que es una estimación con supuestos */}
          <div style={{ fontSize: 10, color: "#6EE7B7", marginTop: 4, fontFamily: "var(--mono)" }}>
            * Estimación basada en supuestos del modelo. Actualizá las celdas del P&L con los valores reales.
          </div>
        </div>
      )}

      {/* FIX UX: si hay 0 servicios y hay viajes, guiar al usuario */}
      {kpis.totalServices === 0 && data.trips.length > 0 && (
        <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 9, padding: "12px 16px", fontSize: 12, color: "#92400E", lineHeight: 1.6, marginTop: 16 }}>
          <strong>No se detectaron servicios aún.</strong>
          <br />
          Abrí cada viaje en Trip Viewer, identificá los puntos WORKING_STOP y clasificalos para que aparezcan acá.
          {onGoTrips && (
            <span
              role="button"
              tabIndex={0}
              style={{ marginLeft: 6, cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
              onClick={onGoTrips}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onGoTrips?.(); }}
            >
              Ir a Viajes →
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

function KpiCard({ val, lbl, sub, col }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #D6E0ED", borderRadius: 9, padding: "12px 14px", borderLeft: `3px solid ${col}` }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: col, lineHeight: 1, marginBottom: 3 }}>
        {typeof val === "number" ? val.toLocaleString("es-AR") : val}
      </div>
      <div style={{ fontSize: 10, color: "#6381A7", textTransform: "uppercase", letterSpacing: ".7px" }}>
        {lbl}
      </div>
      <div style={{ fontSize: 9, color: "#A5B5CC", marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

function ServiceRow({ label, color, count, maxCount, isLast }) {
  const barPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: isLast ? "none" : "1px solid #F5F7FA" }}>
      <div style={{ width: 160, fontSize: 11, color: "#6381A7", flexShrink: 0 }}>
        {label}
      </div>
      <div
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={maxCount}
        aria-label={`${label}: ${count}`}
        style={{ flex: 1, height: 7, background: "#EEF2F7", borderRadius: 4, overflow: "hidden" }}
      >
        <div style={{
          width: `${barPct}%`,
          height: "100%",
          background: color,
          borderRadius: 4,
          transition: "width .4s ease",
          // FIX UX: barra mínima visible si count > 0 aunque sea pequeño vs maxOp
          minWidth: count > 0 ? 4 : 0,
        }} />
      </div>
      <div style={{ width: 28, fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: count > 0 ? color : "#D6E0ED", textAlign: "right" }}>
        {count}
      </div>
    </div>
  );
}
