import { useMemo } from "react";
import { aggregateKPIs, aggregateCalibration } from "../lib/ais_engine";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const SVC_ROWS = [
  { key:"agua_zc",  label:"Agua — Zona Común",  color:"#2196F3" },
  { key:"slop_zc",  label:"Slop — Zona Común",  color:"#FF9800" },
  { key:"lub_zc",   label:"Lubricantes — ZC",   color:"#4CAF50" },
  { key:"alijo_zc", label:"Alijo — Zona Común", color:"#9C27B0" },
  { key:"alijo_za", label:"Alijo — Zona Alfa",  color:"#673AB7" },
  { key:"alijo_zd", label:"Alijo — Zona Delta", color:"#3F51B5" },
];

const MODEL_COLS = [
  { key:"A",    label:"Modelo A", sub:"Conservador",  color:"#1565C0" },
  { key:"B",    label:"Modelo B", sub:"Literal",      color:"#2E7D32" },
  { key:"C",    label:"Modelo C", sub:"Geoespacial",  color:"#6A1B9A" },
  { key:"cons", label:"Consenso", sub:"2 de 3",       color:"#065F46" },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtDateRange(trips) {
  if (!trips?.length) return null;
  const times = trips
    .flatMap(t => [t.dateStart, t.dateEnd]).filter(Boolean)
    .map(d => d instanceof Date ? d.getTime() : new Date(d).getTime());
  if (!times.length) return null;
  const fmt = ms => {
    const d = new Date(ms);
    return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
  };
  return `${fmt(Math.min(...times))} → ${fmt(Math.max(...times))}`;
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
function EmptyDashboard({ onGoUpload }) {
  return (
    <div style={{padding:"28px 32px",maxWidth:800}}>
      <div style={{fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",
                   textTransform:"uppercase",marginBottom:6}}>AIS Analyzer · Dashboard</div>
      <h1 style={{fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:20}}>Dashboard operativo</h1>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",
                   justifyContent:"center",minHeight:340,textAlign:"center",padding:40}}>
        <div style={{fontSize:48,marginBottom:14,opacity:.35}}>📊</div>
        <div style={{fontSize:18,fontWeight:700,color:"var(--navy)",marginBottom:8}}>
          Subí el archivo AIS para empezar
        </div>
        <div style={{fontSize:12,color:"var(--muted)",maxWidth:380,lineHeight:1.7}}>
          Andá a Upload, cargá el Excel de VesselFinder, y acá aparecerán los KPIs del BG Tiger.
        </div>
        {onGoUpload && (
          <button onClick={onGoUpload}
            style={{marginTop:20,padding:"9px 22px",borderRadius:8,background:"var(--blue)",
                    color:"#fff",border:"none",fontFamily:"var(--sans)",fontSize:12,
                    fontWeight:600,cursor:"pointer"}}>
            → Ir a Upload
          </button>
        )}
      </div>
    </div>
  );
}

// ─── CALIBRATION TABLE ────────────────────────────────────────────────────────
// Tabla principal del dashboard.
// Filas:
//   1. "Detectado en todos"      — modelo sobre todos los viajes
//   2. "- En viajes validados"   — modelo sobre solo los validados
//   3. "= Sin catalogar"         — pendientes reales (fila 1 - fila 2)
//   separator
//   4..N. tipos de servicio      — clasificación manual (igual en todas las cols)
//   separator
//   TOTAL                        — sin catalogar + servicios reales
//   Error vs real                — fila 2 - realValidated (delta de calibración)
function CalibrationTable({ calib }) {
  const { models, realValidated, opsValidated } = calib;

  // Mejor modelo = menor |error|
  const bestKey = MODEL_COLS
    .map(m => ({ key: m.key, absErr: Math.abs(models[m.key].error) }))
    .sort((a, b) => a.absErr - b.absErr)[0]?.key;

  const th = (content, color, extra = {}) => (
    <th style={{
      padding:"7px 10px", fontSize:9, fontWeight:700,
      textTransform:"uppercase", letterSpacing:".6px",
      fontFamily:"var(--mono)", textAlign:"center",
      color: color ?? "#6381A7",
      borderLeft:"1px solid #EEF2F7",
      background: color ? `${color}0A` : "#F8FAFC",
      whiteSpace:"nowrap",
      ...extra,
    }}>{content}</th>
  );

  const tdVal = (val, color, extra = {}) => (
    <td style={{
      padding:"6px 10px", textAlign:"center",
      fontFamily:"var(--mono)", fontSize:12, fontWeight:700,
      color: val === 0 ? "#D6E0ED" : (color ?? "#213363"),
      borderLeft:"1px solid #EEF2F7",
      ...extra,
    }}>{val}</td>
  );

  const SepRow = ({ label }) => (
    <tr>
      <td colSpan={MODEL_COLS.length + 1}
        style={{padding:"0 14px",height:1,background:"#D6E0ED",fontSize:0}}>
      </td>
    </tr>
  );

  return (
    <div style={{background:"#fff",border:"1px solid #D6E0ED",borderRadius:10,
                 overflow:"hidden",marginBottom:20}}>

      {/* Header */}
      <div style={{padding:"10px 16px",borderBottom:"1px solid #EEF2F7",
                   display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <span style={{fontFamily:"var(--mono)",fontSize:9,fontWeight:600,color:"#6381A7",
                        textTransform:"uppercase",letterSpacing:1}}>
            Calibración de modelos — servicios detectados
          </span>
          <span style={{fontSize:9,color:"#A5B5CC",marginLeft:10,fontFamily:"var(--mono)"}}>
            {realValidated} servicios reales validados
          </span>
        </div>
        {bestKey && (
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:9,color:"#6381A7",fontFamily:"var(--mono)"}}>mejor ajuste:</span>
            <span style={{
              fontSize:9,fontWeight:700,fontFamily:"var(--mono)",
              color: MODEL_COLS.find(m=>m.key===bestKey)?.color,
              background: `${MODEL_COLS.find(m=>m.key===bestKey)?.color}15`,
              padding:"2px 8px",borderRadius:8,
            }}>
              {MODEL_COLS.find(m=>m.key===bestKey)?.label}
            </span>
          </div>
        )}
      </div>

      {/* Tabla */}
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <colgroup>
            <col style={{width:"32%"}}/>
            {MODEL_COLS.map(m => <col key={m.key} style={{width:`${68/MODEL_COLS.length}%`}}/>)}
          </colgroup>
          <thead>
            <tr style={{borderBottom:"2px solid #EEF2F7"}}>
              {th("", null, {borderLeft:"none",textAlign:"left"})}
              {MODEL_COLS.map(m => (
                <th key={m.key} style={{
                  padding:"8px 10px",fontSize:9,fontWeight:700,
                  textTransform:"uppercase",letterSpacing:".6px",
                  fontFamily:"var(--mono)",textAlign:"center",
                  color: m.color,
                  borderLeft:"1px solid #EEF2F7",
                  background:`${m.color}0A`,
                  whiteSpace:"nowrap",
                }}>
                  {m.label}
                  {m.key === bestKey && (
                    <span style={{marginLeft:4,fontSize:8,background:m.color,
                                  color:"#fff",padding:"1px 4px",borderRadius:4}}>
                      ★
                    </span>
                  )}
                  <br/>
                  <span style={{fontSize:8,fontWeight:400,opacity:.6}}>{m.sub}</span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* Fila 1: Detectado en todos los viajes */}
            <tr style={{background:"#F8FAFC",borderBottom:"1px solid #F0F4F9"}}>
              <td style={{padding:"7px 14px",fontSize:11,color:"#213363",fontWeight:600}}>
                Detectado en todos los viajes
              </td>
              {MODEL_COLS.map(m => tdVal(models[m.key].detectedAll, m.color))}
            </tr>

            {/* Fila 2: Detectado en viajes validados (por el modelo) */}
            <tr style={{background:"#fff",borderBottom:"1px solid #F0F4F9"}}>
              <td style={{padding:"7px 14px 7px 22px",fontSize:11,color:"#6381A7"}}>
                <span style={{color:"#A5B5CC",marginRight:4}}>−</span>
                Detectado en viajes validados
              </td>
              {MODEL_COLS.map(m => tdVal(models[m.key].detectedValidated, "#6381A7"))}
            </tr>

            {/* Fila 3: Sin catalogar */}
            <tr style={{background:"#FFFBEB",borderBottom:"2px solid #D6E0ED"}}>
              <td style={{padding:"7px 14px 7px 22px",fontSize:11,color:"#92400E",fontWeight:700,
                           borderLeft:"3px solid #F59E0B"}}>
                <span style={{marginRight:4}}>= </span>
                Sin catalogar (pendientes)
              </td>
              {MODEL_COLS.map(m => (
                <td key={m.key} style={{
                  padding:"6px 10px",textAlign:"center",
                  fontFamily:"var(--mono)",fontSize:12,fontWeight:700,
                  color: models[m.key].uncatalogued === 0 ? "#D6E0ED" : "#92400E",
                  borderLeft:"1px solid #EEF2F7",
                  background:"#FFFBEB",
                }}>
                  {models[m.key].uncatalogued}
                </td>
              ))}
            </tr>

            {/* Tipos de servicio validados (igual en todas las columnas) */}
            {SVC_ROWS.map((s, idx) => {
              const val = opsValidated[s.key] ?? 0;
              return (
                <tr key={s.key} style={{
                  borderBottom: idx < SVC_ROWS.length-1 ? "1px solid #F5F7FA" : "2px solid #D6E0ED",
                  borderLeft:`3px solid ${val > 0 ? s.color : "transparent"}`,
                }}>
                  <td style={{padding:"6px 14px",fontSize:11,color: val>0 ? "#213363" : "#C4CADC"}}>
                    {s.label}
                  </td>
                  {MODEL_COLS.map(m => (
                    <td key={m.key} style={{
                      padding:"6px 10px",textAlign:"center",
                      fontFamily:"var(--mono)",fontSize:12,fontWeight:700,
                      color: val > 0 ? s.color : "#D6E0ED",
                      borderLeft:"1px solid #EEF2F7",
                    }}>
                      {val}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            {/* TOTAL */}
            <tr style={{background:"#F8FAFC",borderTop:"2px solid #D6E0ED"}}>
              <td style={{padding:"7px 14px",fontSize:10,fontWeight:700,
                           color:"#213363",fontFamily:"var(--mono)"}}>
                TOTAL SERVICIOS
              </td>
              {MODEL_COLS.map(m => (
                <td key={m.key} style={{
                  padding:"7px 10px",textAlign:"center",
                  fontFamily:"var(--mono)",fontSize:14,fontWeight:800,
                  color: models[m.key].total > 0 ? m.color : "#D6E0ED",
                  borderLeft:"1px solid #D6E0ED",
                  background:`${m.color}06`,
                }}>
                  {models[m.key].total}
                </td>
              ))}
            </tr>

            {/* Error de calibración */}
            <tr style={{background:"#F8FAFC",borderTop:"1px solid #EEF2F7"}}>
              <td style={{padding:"6px 14px",fontSize:9,color:"#6381A7",fontFamily:"var(--mono)"}}>
                Error en validados (modelo − real)
                <span style={{marginLeft:6,color:"#A5B5CC"}}>
                  real = {realValidated}
                </span>
              </td>
              {MODEL_COLS.map(m => {
                const err = models[m.key].error;
                const col = err === 0 ? "#1E7A4A"
                  : Math.abs(err) <= 2 ? "#F59E0B"
                  : "#DC2626";
                return (
                  <td key={m.key} style={{
                    padding:"6px 10px",textAlign:"center",
                    fontFamily:"var(--mono)",fontSize:11,fontWeight:700,
                    color: col,
                    borderLeft:"1px solid #EEF2F7",
                  }}>
                    {err === 0 ? "✓ 0" : err > 0 ? `+${err}` : `${err}`}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Leyenda */}
      <div style={{padding:"7px 14px",background:"#F8FAFC",borderTop:"1px solid #EEF2F7",
                   fontSize:9,color:"#A5B5CC",fontFamily:"var(--mono)",
                   display:"flex",gap:16,flexWrap:"wrap"}}>
        <span>★ = modelo con menor error vs clasificación manual</span>
        <span>Error + = sobreestima · Error − = subestima</span>
        <span>Sin catalogar = detectados en viajes aún no validados</span>
      </div>
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function Dashboard({ data, onGoTrips, onGoUpload, firstPendingTrip, onGoFirstPending }) {

  // KPIs base — viajes validados
  const kpis = useMemo(
    () => data?.trips ? aggregateKPIs(data.trips) : null,
    [data?.trips]
  );

  // Calibración — lazy, corre todos los modelos sobre todos los viajes
  const calib = useMemo(
    () => data?.trips ? aggregateCalibration(data.trips) : null,
    [data?.trips]
  );

  if (!data || !kpis) return <EmptyDashboard onGoUpload={onGoUpload}/>;

  const reviewable = kpis.reviewableTrips ?? kpis.totalTrips;
  const pct        = reviewable ? Math.round(kpis.validatedTrips / reviewable * 100) : 0;
  const dateRange  = fmtDateRange(data.trips);

  // Impacto FSV — usa servicios reales validados
  const AGUA_PRECIO=250, AGUA_SVC_AÑO=65;
  const SLOP_PRECIO=100, SLOP_SVC_AÑO=100;
  const revenueExtra =
    (kpis.ops.agua_zc * AGUA_PRECIO * AGUA_SVC_AÑO) +
    (kpis.ops.slop_zc * SLOP_PRECIO * SLOP_SVC_AÑO);

  const kpiCards = [
    { val:reviewable,           lbl:"Viajes",     sub:kpis.noDataTrips>0?`${kpis.noDataTrips} sin datos`:"con datos AIS", col:"#235C96" },
    { val:kpis.validatedTrips,  lbl:"Validados",  sub:`${pct}% completado`,  col:"#1E7A4A" },
    { val:kpis.pendingTrips,    lbl:"Pendientes", sub:"por revisar",         col:"#92400E" },
    { val:kpis.totalServices,   lbl:"Servicios",  sub:"validados manualmente", col:"#1E7A4A" },
    { val:kpis.ops.agua_zc,     lbl:"Agua / ZC",  sub:"→ P&L B108",          col:"#2196F3" },
    { val:kpis.ops.slop_zc,     lbl:"Slop / ZC",  sub:"→ P&L B109",          col:"#FF9800" },
  ];
  if (kpis.incompleteTrips > 0)
    kpiCards.push({ val:kpis.incompleteTrips, lbl:"Incompletos", sub:"sin arribo", col:"#F59E0B" });

  return (
    <div style={{padding:"28px 32px",maxWidth:920}}>
      {/* Eyebrow */}
      <div style={{fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",
                   textTransform:"uppercase",marginBottom:6}}>
        AIS Analyzer · {data.filename}
      </div>
      <h1 style={{fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:4}}>
        Dashboard operativo
      </h1>
      {dateRange && (
        <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--muted)",marginBottom:16}}>
          Dataset: {dateRange} (UTC)
        </div>
      )}

      {/* CTA pendiente */}
      {firstPendingTrip && onGoFirstPending && (
        <div style={{background:"#EFF6FF",border:"1px solid #93C5FD",borderRadius:9,
                     padding:"10px 16px",marginBottom:16,
                     display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:12,color:"#1E40AF",flex:1}}>
            <strong>{kpis.pendingTrips} viaje{kpis.pendingTrips>1?"s":""} pendiente{kpis.pendingTrips>1?"s":""}</strong> de revisión.
          </span>
          <button onClick={onGoFirstPending}
            style={{padding:"7px 14px",borderRadius:7,background:"#235C96",
                    color:"#fff",border:"none",fontSize:11,fontWeight:700,
                    cursor:"pointer",flexShrink:0}}>
            ▶ Continuar — Viaje #{firstPendingTrip.id}
          </button>
        </div>
      )}

      {/* Barra de validación */}
      <div style={{background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:9,
                   padding:"12px 16px",marginBottom:20,fontSize:12,color:"#854F0B",lineHeight:1.6}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <strong>Validación: {kpis.validatedTrips}/{reviewable} viajes con datos</strong>
          <span style={{fontFamily:"var(--mono)",fontSize:13,fontWeight:700}}>{pct}%</span>
        </div>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
          style={{background:"#EEF2F7",borderRadius:4,height:6,overflow:"hidden",marginBottom:7}}>
          <div style={{width:`${pct}%`,height:"100%",borderRadius:4,transition:"width .4s ease",
                       background:pct===100?"#22C55E":"#FFA726"}}/>
        </div>
        {kpis.pendingTrips > 0 && (
          <>
            <span>{kpis.pendingTrips} viaje{kpis.pendingTrips>1?"s":""} pendiente{kpis.pendingTrips>1?"s":""}. </span>
            <span role="button" tabIndex={0}
              style={{cursor:"pointer",textDecoration:"underline",fontWeight:600}}
              onClick={onGoTrips}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")onGoTrips?.();}}>
              Ir a Trip Viewer →
            </span>
          </>
        )}
        {kpis.pendingTrips === 0 && (
          <span style={{color:"#065F46",fontWeight:600}}>✓ Todos los viajes validados</span>
        )}
      </div>

      {/* KPI cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",
                   gap:10,marginBottom:20}}>
        {kpiCards.map(k => (
          <div key={k.lbl}
            style={{background:"#fff",border:"1px solid #D6E0ED",borderRadius:9,
                    padding:"12px 14px",borderLeft:`3px solid ${k.col}`}}>
            <div style={{fontSize:22,fontWeight:700,color:k.col,lineHeight:1,marginBottom:3}}>
              {typeof k.val==="number" ? k.val.toLocaleString("es-AR") : k.val}
            </div>
            <div style={{fontSize:10,color:"#6381A7",textTransform:"uppercase",
                         letterSpacing:".7px"}}>{k.lbl}</div>
            <div style={{fontSize:9,color:"#A5B5CC",marginTop:2}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabla de calibración */}
      {calib && <CalibrationTable calib={calib} />}

      {/* Impacto FSV */}
      {revenueExtra > 0 && (
        <div style={{background:"#F0FFF4",border:"1px solid #86EFAC",borderRadius:9,
                     padding:"14px 16px",fontSize:12,color:"#065F46",lineHeight:1.7,marginBottom:16}}>
          <div style={{fontWeight:700,marginBottom:4}}>💡 Impacto estimado en el modelo FSV</div>
          <div>
            {kpis.ops.agua_zc} ops agua × ${AGUA_PRECIO} × {AGUA_SVC_AÑO} svc/año
            {" + "}
            {kpis.ops.slop_zc} ops slop × ${SLOP_PRECIO} × {SLOP_SVC_AÑO} svc/año
          </div>
          <div style={{fontSize:16,fontWeight:800,marginTop:6,color:"#047857"}}>
            = USD {revenueExtra.toLocaleString("es-AR")} / año estimado
          </div>
          <div style={{fontSize:10,color:"#6EE7B7",marginTop:4,fontFamily:"var(--mono)"}}>
            * Solo servicios validados. Actualizá el P&L con valores reales.
          </div>
        </div>
      )}

      {/* Aviso sin servicios */}
      {kpis.totalServices === 0 && data.trips.length > 0 && (
        <div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:9,
                     padding:"12px 16px",fontSize:12,color:"#92400E",lineHeight:1.6}}>
          <strong>No se detectaron servicios validados aún.</strong><br/>
          Abrí cada viaje en Trip Viewer y clasificá los puntos de parada.
          {onGoTrips && (
            <span role="button" tabIndex={0}
              style={{marginLeft:6,cursor:"pointer",textDecoration:"underline",fontWeight:600}}
              onClick={onGoTrips}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")onGoTrips?.();}}>
              Ir a Viajes →
            </span>
          )}
        </div>
      )}
    </div>
  );
}
