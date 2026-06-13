import { useState, useMemo } from "react";
import { aggregateKPIs, aggregateProjected } from "../lib/ais_engine";

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const SVC_ROWS = [
  { key:"agua_zc",  label:"Agua — Zona Común",  color:"#2196F3" },
  { key:"slop_zc",  label:"Slop — Zona Común",  color:"#FF9800" },
  { key:"lub_zc",   label:"Lubricantes — ZC",   color:"#4CAF50" },
  { key:"alijo_zc", label:"Alijo — Zona Común", color:"#9C27B0" },
  { key:"alijo_za", label:"Alijo — Zona Alfa",  color:"#673AB7" },
  { key:"alijo_zd", label:"Alijo — Zona Delta", color:"#3F51B5" },
];

// Tabs de proyección — orden = secuencia de tabs
const PROJ_TABS = [
  { key:"validated", label:"Validado",         sub:"solo manual",     color:"#1E7A4A", badge:"✓" },
  { key:"A",         label:"+ Modelo A",        sub:"conservador",     color:"#1565C0", badge:"A" },
  { key:"B",         label:"+ Modelo B",        sub:"literal",         color:"#2E7D32", badge:"B" },
  { key:"C",         label:"+ Modelo C",        sub:"geoespacial",     color:"#6A1B9A", badge:"C" },
  { key:"cons",      label:"+ Consenso",        sub:"2 de 3 modelos",  color:"#065F46", badge:"≡" },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtDateRange(trips) {
  if (!trips?.length) return null;
  const times = trips
    .flatMap(t => [t.dateStart, t.dateEnd])
    .filter(Boolean)
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

// ─── PROJECTION TABS ─────────────────────────────────────────────────────────
function ProjectionTabs({ active, onChange, pendingTrips }) {
  return (
    <div style={{display:"flex",gap:0,marginBottom:16,
                 border:"1px solid #D6E0ED",borderRadius:9,overflow:"hidden",
                 background:"#F8FAFC"}}>
      {PROJ_TABS.map((t, i) => {
        const isActive = active === t.key;
        const isFirst  = i === 0;
        const showProj = !isFirst && pendingTrips > 0;
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            style={{
              flex: 1, padding:"9px 6px", border:"none",
              borderRight: i < PROJ_TABS.length-1 ? "1px solid #D6E0ED" : "none",
              background: isActive ? t.color : "transparent",
              cursor:"pointer", transition:"background .15s",
              display:"flex",flexDirection:"column",alignItems:"center",gap:2,
            }}>
            <span style={{
              fontSize:10,fontWeight:800,fontFamily:"var(--sans)",
              color: isActive ? "#fff" : t.color,
            }}>
              {t.badge} {t.label}
            </span>
            <span style={{fontSize:8,fontFamily:"var(--mono)",
                          color: isActive ? "rgba(255,255,255,.7)" : "#A5B5CC"}}>
              {isFirst ? t.sub : (showProj ? `${pendingTrips} pendientes` : "sin pendientes")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── BREAKDOWN DE OPERACIONES ─────────────────────────────────────────────────
// Muestra barras por tipo de servicio con split validado/proyectado.
function OpsBreakdown({ proj, isValidatedOnly, accentColor }) {
  const maxVal = Math.max(...SVC_ROWS.map(s => proj.ops[s.key]), 1);

  return (
    <div style={{background:"#fff",border:"1px solid #D6E0ED",borderRadius:10,
                 overflow:"hidden",marginBottom:16}}>
      {/* Header */}
      <div style={{padding:"10px 16px",borderBottom:"1px solid #EEF2F7",
                   display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontFamily:"var(--mono)",fontSize:9,fontWeight:600,color:"#6381A7",
                      textTransform:"uppercase",letterSpacing:1}}>
          Operaciones por tipo de servicio
        </span>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {!isValidatedOnly && (
            <>
              <span style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:"#1E7A4A"}}>
                <span style={{width:8,height:8,borderRadius:2,background:"#1E7A4A",
                              display:"inline-block"}}/>
                {proj.validatedServices} validados
              </span>
              <span style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:accentColor}}>
                <span style={{width:8,height:8,borderRadius:2,background:accentColor,
                              opacity:.5,display:"inline-block"}}/>
                {proj.projectedServices} estimados
              </span>
            </>
          )}
          {isValidatedOnly && (
            <span style={{fontSize:9,color:"#A5B5CC",fontFamily:"var(--mono)"}}>
              solo clasificación manual
            </span>
          )}
        </div>
      </div>

      {/* Filas por tipo */}
      {SVC_ROWS.map((s, idx) => {
        const total   = proj.ops[s.key];
        const valPart = proj.opsValidated?.[s.key] ?? 0;
        const prjPart = proj.opsProjected?.[s.key] ?? 0;
        const barPct  = maxVal > 0 ? (total / maxVal) * 100 : 0;
        const valPct  = total > 0 ? (valPart / total) * 100 : 0;

        return (
          <div key={s.key}
            style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",
                    borderBottom:idx<SVC_ROWS.length-1?"1px solid #F5F7FA":"none"}}>
            <div style={{width:160,fontSize:11,color:"#6381A7",flexShrink:0}}>{s.label}</div>
            {/* Barra con split validado/estimado */}
            <div style={{flex:1,height:7,background:"#EEF2F7",borderRadius:4,overflow:"hidden"}}>
              <div style={{width:`${barPct}%`,height:"100%",borderRadius:4,
                           display:"flex",overflow:"hidden",
                           transition:"width .4s ease",minWidth:total>0?4:0}}>
                {/* Parte validada (color sólido) */}
                <div style={{width:`${valPct}%`,height:"100%",background:s.color,flexShrink:0}}/>
                {/* Parte estimada (color semi-transparente) */}
                <div style={{flex:1,height:"100%",background:s.color,opacity:.35}}/>
              </div>
            </div>
            {/* Números: total (val+prj) */}
            <div style={{width:36,textAlign:"right",flexShrink:0}}>
              <span style={{fontFamily:"var(--mono)",fontSize:13,fontWeight:700,
                            color:total>0?s.color:"#D6E0ED"}}>
                {total}
              </span>
              {!isValidatedOnly && prjPart > 0 && (
                <span style={{fontFamily:"var(--mono)",fontSize:9,color:"#A5B5CC",display:"block"}}>
                  +{prjPart}~
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Pie: sin clasificar */}
      {(()=>{
        const classified = SVC_ROWS.reduce((s,r) => s + proj.ops[r.key], 0);
        const unc = proj.totalServices - classified;
        if (unc <= 0) return null;
        return (
          <div style={{padding:"8px 16px",background:"#FAFAFA",fontSize:11,
                       color:"#9E9E9E",fontFamily:"var(--mono)",borderTop:"1px solid #EEF2F7"}}>
            + {unc} servicio{unc>1?"s":""} sin clasificar
          </div>
        );
      })()}
    </div>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function Dashboard({ data, onGoTrips, onGoUpload, firstPendingTrip, onGoFirstPending }) {
  const [projTab, setProjTab] = useState("validated");

  // ── KPIs base (validados) — siempre disponible ────────────────────────────
  const kpis = useMemo(
    () => data?.trips ? aggregateKPIs(data.trips) : null,
    [data?.trips]
  );

  // ── Proyección lazy — corre los modelos sobre todos los viajes ────────────
  // Se computa solo cuando hay trips y se necesita (al montar si hay datos).
  // aggregateProjected corre los modelos solo sobre viajes pendientes.
  const projA    = useMemo(() => data?.trips ? aggregateProjected(data.trips, "A")    : null, [data?.trips]);
  const projB    = useMemo(() => data?.trips ? aggregateProjected(data.trips, "B")    : null, [data?.trips]);
  const projC    = useMemo(() => data?.trips ? aggregateProjected(data.trips, "C")    : null, [data?.trips]);
  const projCons = useMemo(() => data?.trips ? aggregateProjected(data.trips, "cons") : null, [data?.trips]);

  if (!data || !kpis) return <EmptyDashboard onGoUpload={onGoUpload}/>;

  // ── Seleccionar proyección activa ─────────────────────────────────────────
  const projMap = { A: projA, B: projB, C: projC, cons: projCons };
  const isValidatedOnly = projTab === "validated";
  const activeTab = PROJ_TABS.find(t => t.key === projTab);

  // Para el tab "validated" fabricamos un objeto proj con la misma forma
  const proj = isValidatedOnly
    ? {
        totalServices:     kpis.totalServices,
        validatedServices: kpis.totalServices,
        projectedServices: 0,
        ops:               kpis.ops,
        opsValidated:      kpis.ops,
        opsProjected:      { agua_zc:0,slop_zc:0,lub_zc:0,alijo_zc:0,alijo_za:0,alijo_zd:0 },
      }
    : (projMap[projTab] ?? null);

  // ── Métricas de cabecera ──────────────────────────────────────────────────
  const reviewable = kpis.reviewableTrips ?? kpis.totalTrips;
  const pct        = reviewable ? Math.round(kpis.validatedTrips / reviewable * 100) : 0;
  const dateRange  = fmtDateRange(data.trips);

  // Impacto FSV — usa proyección activa
  const AGUA_PRECIO=250, AGUA_SVC_AÑO=65;
  const SLOP_PRECIO=100, SLOP_SVC_AÑO=100;
  const revenueExtra = proj
    ? (proj.ops.agua_zc * AGUA_PRECIO * AGUA_SVC_AÑO) +
      (proj.ops.slop_zc * SLOP_PRECIO * SLOP_SVC_AÑO)
    : 0;

  const kpiCards = [
    { val: reviewable,            lbl:"Viajes",     sub: kpis.noDataTrips>0?`${kpis.noDataTrips} sin datos`:"con datos AIS", col:"#235C96" },
    { val: kpis.validatedTrips,   lbl:"Validados",  sub:`${pct}% completado`,  col:"#1E7A4A" },
    { val: kpis.pendingTrips,     lbl:"Pendientes", sub:"por revisar",         col:"#92400E" },
    { val: proj?.totalServices ?? 0,
                                  lbl:"Servicios",  sub: isValidatedOnly ? "validados" : `${proj?.validatedServices??0}✓ + ${proj?.projectedServices??0}~`, col: activeTab?.color ?? "#1E7A4A" },
    { val: proj?.ops?.agua_zc ?? 0, lbl:"Agua / ZC", sub:"→ P&L B108",        col:"#2196F3" },
    { val: proj?.ops?.slop_zc ?? 0, lbl:"Slop / ZC", sub:"→ P&L B109",        col:"#FF9800" },
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
            <div style={{fontSize:10,color:"#6381A7",textTransform:"uppercase",letterSpacing:".7px"}}>{k.lbl}</div>
            <div style={{fontSize:9,color:"#A5B5CC",marginTop:2}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── TABS DE PROYECCIÓN ── */}
      <div style={{marginBottom:4}}>
        <div style={{fontSize:9,color:"#6381A7",fontFamily:"var(--mono)",
                     textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>
          Vista de servicios — fuente de datos
        </div>
        <ProjectionTabs
          active={projTab}
          onChange={setProjTab}
          pendingTrips={kpis.pendingTrips}
        />
      </div>

      {/* Explicación del tab activo */}
      <div style={{fontSize:10,color:"#6381A7",marginBottom:12,fontFamily:"var(--mono)",
                   padding:"6px 12px",background:"#F8FAFC",borderRadius:6,
                   borderLeft:`3px solid ${activeTab?.color}`}}>
        {isValidatedOnly
          ? `Mostrando ${kpis.totalServices} servicios de ${kpis.validatedTrips} viajes validados manualmente.`
          : `Mostrando ${proj?.validatedServices??0} servicios validados + ${proj?.projectedServices??0} estimados por ${activeTab?.sub} en ${kpis.pendingTrips} viajes pendientes.`
        }
        {!isValidatedOnly && (
          <span style={{color:"#F59E0B",marginLeft:6}}>~ = estimado, no validado</span>
        )}
      </div>

      {/* Breakdown con split visual */}
      {proj && (
        <OpsBreakdown
          proj={proj}
          isValidatedOnly={isValidatedOnly}
          accentColor={activeTab?.color ?? "#1E7A4A"}
        />
      )}

      {/* Impacto FSV */}
      {revenueExtra > 0 && (
        <div style={{background:"#F0FFF4",border:"1px solid #86EFAC",borderRadius:9,
                     padding:"14px 16px",fontSize:12,color:"#065F46",lineHeight:1.7,marginBottom:16}}>
          <div style={{fontWeight:700,marginBottom:4}}>💡 Impacto estimado en el modelo FSV</div>
          <div>
            {proj?.ops.agua_zc} ops agua × ${AGUA_PRECIO} × {AGUA_SVC_AÑO} svc/año
            {" + "}
            {proj?.ops.slop_zc} ops slop × ${SLOP_PRECIO} × {SLOP_SVC_AÑO} svc/año
            {!isValidatedOnly && (
              <span style={{color:"#F59E0B",marginLeft:6,fontSize:10}}>
                (incluye estimados)
              </span>
            )}
          </div>
          <div style={{fontSize:16,fontWeight:800,marginTop:6,color:"#047857"}}>
            = USD {revenueExtra.toLocaleString("es-AR")} / año estimado
          </div>
          <div style={{fontSize:10,color:"#6EE7B7",marginTop:4,fontFamily:"var(--mono)"}}>
            * Estimación con supuestos del modelo. Actualizá el P&L con valores reales.
          </div>
        </div>
      )}

      {/* Aviso sin servicios */}
      {(proj?.totalServices ?? 0) === 0 && data.trips.length > 0 && (
        <div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:9,
                     padding:"12px 16px",fontSize:12,color:"#92400E",lineHeight:1.6}}>
          <strong>No se detectaron servicios aún.</strong><br/>
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
