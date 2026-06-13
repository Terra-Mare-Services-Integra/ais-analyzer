import { useMemo } from "react";
import { aggregateKPIs } from "../lib/ais_engine";

const SVC_ROWS = [
  { key:"agua_zc",  label:"Agua — Zona Común",  color:"#2196F3" },
  { key:"slop_zc",  label:"Slop — Zona Común",  color:"#FF9800" },
  { key:"lub_zc",   label:"Lubricantes — ZC",   color:"#4CAF50" },
  { key:"alijo_zc", label:"Alijo — Zona Común", color:"#9C27B0" },
  { key:"alijo_za", label:"Alijo — Zona Alfa",  color:"#673AB7" },
  { key:"alijo_zd", label:"Alijo — Zona Delta", color:"#3F51B5" },
];

const MODEL_COLS = [
  { key: "A",    label: "Mod. A", sub: "Conservador",  color: "#1565C0" },
  { key: "B",    label: "Mod. B", sub: "Literal",      color: "#2E7D32" },
  { key: "C",    label: "Mod. C", sub: "Geoespacial",  color: "#6A1B9A" },
  { key: "cons", label: "Consenso", sub: "2 de 3",     color: "#065F46" },
];

function fmtDateRange(trips) {
  if (!trips?.length) return null;
  const times = trips.flatMap(t=>[t.dateStart,t.dateEnd]).filter(Boolean).map(d=>d instanceof Date?d.getTime():new Date(d).getTime());
  if (!times.length) return null;
  const fmt = ms => { const d=new Date(ms); return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`; };
  return `${fmt(Math.min(...times))} → ${fmt(Math.max(...times))}`;
}

function EmptyDashboard({ onGoUpload }) {
  return (
    <div style={{padding:"28px 32px",maxWidth:800}}>
      <div style={{fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",textTransform:"uppercase",marginBottom:6}}>AIS Analyzer · Dashboard</div>
      <h1 style={{fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:20}}>Dashboard operativo</h1>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:340,textAlign:"center",padding:40}}>
        <div style={{fontSize:48,marginBottom:14,opacity:.35}}>📊</div>
        <div style={{fontSize:18,fontWeight:700,color:"var(--navy)",marginBottom:8}}>Subí el archivo AIS para empezar</div>
        <div style={{fontSize:12,color:"var(--muted)",maxWidth:380,lineHeight:1.7}}>Andá a Upload, cargá el Excel de VesselFinder, y acá aparecerán los KPIs del BG Tiger.</div>
        {onGoUpload&&<button onClick={onGoUpload} style={{marginTop:20,padding:"9px 22px",borderRadius:8,background:"var(--blue)",color:"#fff",border:"none",fontFamily:"var(--sans)",fontSize:12,fontWeight:600,cursor:"pointer"}}>→ Ir a Upload</button>}
      </div>
    </div>
  );
}

export default function Dashboard({ data, onGoTrips, onGoUpload, firstPendingTrip, onGoFirstPending }) {
  const kpis = useMemo(() => data?.trips ? aggregateKPIs(data.trips) : null, [data?.trips]);
  if (!data||!kpis) return <EmptyDashboard onGoUpload={onGoUpload}/>;

  // BUG-03: porcentaje sobre viajes revisables, no sobre el total (excluye sin datos)
  const reviewable = kpis.reviewableTrips ?? kpis.totalTrips;
  const pct   = reviewable ? Math.round(kpis.validatedTrips/reviewable*100) : 0;
  const maxOp = Math.max(...SVC_ROWS.map(s=>kpis.ops[s.key]),1);
  const dateRange = fmtDateRange(data.trips);

  const AGUA_PRECIO_USD=250, AGUA_SERVICIOS_AÑO=65;
  const SLOP_PRECIO_USD=100, SLOP_SERVICIOS_AÑO=100;
  const revenueExtra=(kpis.ops.agua_zc*AGUA_PRECIO_USD*AGUA_SERVICIOS_AÑO)+(kpis.ops.slop_zc*SLOP_PRECIO_USD*SLOP_SERVICIOS_AÑO);

  const kpiCards = [
    {val:kpis.reviewableTrips??kpis.totalTrips, lbl:"Viajes",     sub:kpis.noDataTrips>0?`${kpis.noDataTrips} sin datos AIS`:"total con datos", col:"#235C96"},
    {val:kpis.validatedTrips, lbl:"Validados",  sub:`${pct}% del total`, col:"#1E7A4A"},
    {val:kpis.totalServices,  lbl:"Servicios",  sub:"detectados",        col:"#1E7A4A"},
    {val:kpis.ops.agua_zc,    lbl:"Agua / ZC",  sub:"→ P&L B108",        col:"#2196F3"},
    {val:kpis.ops.slop_zc,    lbl:"Slop / ZC",  sub:"→ P&L B109",        col:"#FF9800"},
    {val:kpis.pendingTrips,   lbl:"Pendientes", sub:"por revisar",       col:"#6381A7"},
  ];
  if (kpis.incompleteTrips>0) kpiCards.push({val:kpis.incompleteTrips,lbl:"Incompletos",sub:"sin arribo",col:"#F59E0B"});

  return (
    <div style={{padding:"28px 32px",maxWidth:900}}>
      <div style={{fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",textTransform:"uppercase",marginBottom:6}}>AIS Analyzer · {data.filename}</div>
      <h1 style={{fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:4}}>Dashboard operativo</h1>
      {dateRange&&<div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--muted)",marginBottom:6}}>Dataset: {dateRange} (UTC)</div>}
      <p style={{fontSize:12,color:"var(--muted)",lineHeight:1.7,marginBottom:20,maxWidth:600}}>
        Operaciones validadas por tipo de servicio. Los valores alimentan el P&L del modelo FSV.
      </p>

      {/* UX-13: CTA directo al primer pendiente */}
      {firstPendingTrip&&onGoFirstPending&&(
        <div style={{background:"#EFF6FF",border:"1px solid #93C5FD",borderRadius:9,padding:"10px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:12,color:"#1E40AF",flex:1}}>
            <strong>{kpis.pendingTrips} viaje{kpis.pendingTrips>1?"s":""} pendiente{kpis.pendingTrips>1?"s":""}</strong> de revisión.
          </span>
          <button onClick={onGoFirstPending}
            style={{padding:"7px 14px",borderRadius:7,background:"#235C96",color:"#fff",border:"none",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0}}>
            ▶ Continuar — Viaje #{firstPendingTrip.id}
          </button>
        </div>
      )}

      {/* Validación */}
      <div style={{background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:9,padding:"12px 16px",marginBottom:20,fontSize:12,color:"#854F0B",lineHeight:1.6}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <strong>Validación: {kpis.validatedTrips}/{reviewable} viajes con datos</strong>
          <span style={{fontFamily:"var(--mono)",fontSize:13,fontWeight:700}}>{pct}%</span>
        </div>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
          style={{background:"#EEF2F7",borderRadius:4,height:6,overflow:"hidden",marginBottom:7}}>
          <div style={{width:`${pct}%`,height:"100%",background:pct===100?"#22C55E":"#FFA726",borderRadius:4,transition:"width .4s ease"}}/>
        </div>
        {kpis.pendingTrips>0&&<>
          <span>{kpis.pendingTrips} viaje{kpis.pendingTrips>1?"s":""} pendiente{kpis.pendingTrips>1?"s":""}. </span>
          <span role="button" tabIndex={0} style={{cursor:"pointer",textDecoration:"underline",fontWeight:600}} onClick={onGoTrips} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")onGoTrips?.();}}>Ir a Trip Viewer →</span>
        </>}
        {kpis.pendingTrips===0&&<span style={{color:"#065F46",fontWeight:600}}>✓ Todos los viajes validados</span>}
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:20}}>
        {kpiCards.map(k=>(
          <div key={k.lbl} style={{background:"#fff",border:"1px solid #D6E0ED",borderRadius:9,padding:"12px 14px",borderLeft:`3px solid ${k.col}`}}>
            <div style={{fontSize:22,fontWeight:700,color:k.col,lineHeight:1,marginBottom:3}}>{typeof k.val==="number"?k.val.toLocaleString("es-AR"):k.val}</div>
            <div style={{fontSize:10,color:"#6381A7",textTransform:"uppercase",letterSpacing:".7px"}}>{k.lbl}</div>
            <div style={{fontSize:9,color:"#A5B5CC",marginTop:2}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Breakdown operaciones — clasificación manual */}
      <div style={{background:"#fff",border:"1px solid #D6E0ED",borderRadius:10,overflow:"hidden",marginBottom:16}}>
        <div style={{padding:"10px 16px",borderBottom:"1px solid #EEF2F7",fontFamily:"var(--mono)",fontSize:9,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:1,display:"flex",justifyContent:"space-between"}}>
          <span>Operaciones validadas por tipo</span>
          <span style={{fontSize:9,color:"#A5B5CC",fontWeight:400}}>clasificación manual · solo viajes validados</span>
        </div>
        {SVC_ROWS.map((s,idx)=>{
          const barPct = maxOp>0?(kpis.ops[s.key]/maxOp)*100:0;
          return (
            <div key={s.key} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",borderBottom:idx<SVC_ROWS.length-1?"1px solid #F5F7FA":"none"}}>
              <div style={{width:160,fontSize:11,color:"#6381A7",flexShrink:0}}>{s.label}</div>
              <div role="progressbar" aria-valuenow={kpis.ops[s.key]} aria-valuemin={0} aria-valuemax={maxOp}
                style={{flex:1,height:7,background:"#EEF2F7",borderRadius:4,overflow:"hidden"}}>
                <div style={{width:`${barPct}%`,height:"100%",background:s.color,borderRadius:4,transition:"width .4s ease",minWidth:kpis.ops[s.key]>0?4:0}}/>
              </div>
              <div style={{width:28,fontFamily:"var(--mono)",fontSize:13,fontWeight:700,color:kpis.ops[s.key]>0?s.color:"#D6E0ED",textAlign:"right"}}>{kpis.ops[s.key]}</div>
            </div>
          );
        })}
        {(()=>{
          const classified=SVC_ROWS.reduce((s,r)=>s+kpis.ops[r.key],0);
          const unc=kpis.totalServices-classified;
          if (unc<=0) return null;
          return <div style={{padding:"8px 16px",background:"#FAFAFA",fontSize:11,color:"#9E9E9E",fontFamily:"var(--mono)",borderTop:"1px solid #EEF2F7"}}>+ {unc} servicio{unc>1?"s":""} sin clasificar</div>;
        })()}
      </div>

      {/* Breakdown por modelo de detección automática */}
      {kpis.models && (
        <div style={{background:"#fff",border:"1px solid #D6E0ED",borderRadius:10,overflow:"hidden",marginBottom:20}}>
          {/* Header */}
          <div style={{padding:"10px 16px",borderBottom:"1px solid #EEF2F7",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontFamily:"var(--mono)",fontSize:9,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:1}}>
              Detección automática — comparativa por modelo
            </span>
            <div style={{display:"flex",gap:10}}>
              {MODEL_COLS.map(m=>(
                <span key={m.key} style={{fontSize:8,fontFamily:"var(--mono)",color:m.color,fontWeight:700}}>
                  {m.label} <span style={{fontWeight:400,color:"#A5B5CC"}}>{m.sub}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Tabla: una fila por tipo de servicio + fila totales */}
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,tableLayout:"fixed"}}>
              <colgroup>
                <col style={{width:"28%"}}/>
                {MODEL_COLS.map(m=><col key={m.key} style={{width:`${72/MODEL_COLS.length}%`}}/>)}
              </colgroup>
              <thead>
                <tr style={{background:"#F8FAFC",borderBottom:"1px solid #EEF2F7"}}>
                  <th style={{padding:"6px 14px",textAlign:"left",fontSize:9,color:"#6381A7",fontWeight:600,fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:".6px"}}>
                    Tipo
                  </th>
                  {MODEL_COLS.map(m=>(
                    <th key={m.key} style={{padding:"6px 8px",textAlign:"center",fontSize:9,fontWeight:700,fontFamily:"var(--mono)",color:m.color,borderLeft:"1px solid #EEF2F7",background:`${m.color}08`}}>
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SVC_ROWS.map((s,idx)=>{
                  const maxVal = Math.max(...MODEL_COLS.map(m => kpis.models[m.key]?.ops[s.key] ?? 0), 1);
                  return (
                    <tr key={s.key} style={{borderBottom:idx<SVC_ROWS.length-1?"1px solid #F5F7FA":"none"}}>
                      <td style={{padding:"7px 14px",fontSize:11,color:"#6381A7"}}>{s.label}</td>
                      {MODEL_COLS.map(m=>{
                        const val = kpis.models[m.key]?.ops[s.key] ?? 0;
                        const pct = maxVal>0?(val/maxVal)*100:0;
                        const isCons = m.key==="cons";
                        return (
                          <td key={m.key} style={{padding:"5px 8px",borderLeft:"1px solid #EEF2F7",background:isCons?`${m.color}06`:"transparent"}}>
                            <div style={{display:"flex",alignItems:"center",gap:5}}>
                              <div style={{flex:1,height:5,background:"#EEF2F7",borderRadius:3,overflow:"hidden"}}>
                                <div style={{width:`${pct}%`,height:"100%",background:m.color,borderRadius:3,minWidth:val>0?3:0}}/>
                              </div>
                              <span style={{fontFamily:"var(--mono)",fontSize:12,fontWeight:700,color:val>0?m.color:"#D6E0ED",width:18,textAlign:"right",flexShrink:0}}>{val}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{borderTop:"2px solid #D6E0ED",background:"#F8FAFC"}}>
                  <td style={{padding:"7px 14px",fontSize:10,fontWeight:700,color:"#213363",fontFamily:"var(--mono)"}}>TOTAL</td>
                  {MODEL_COLS.map(m=>{
                    const val = kpis.models[m.key]?.total ?? 0;
                    const isCons = m.key==="cons";
                    return (
                      <td key={m.key} style={{padding:"7px 8px",textAlign:"center",borderLeft:"1px solid #D6E0ED",background:isCons?`${m.color}10`:"transparent"}}>
                        <span style={{fontFamily:"var(--mono)",fontSize:14,fontWeight:800,color:val>0?m.color:"#D6E0ED"}}>{val}</span>
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{padding:"7px 14px",background:"#F8FAFC",borderTop:"1px solid #EEF2F7",fontSize:9,color:"#A5B5CC",fontFamily:"var(--mono)"}}>
            Tipo inferido del <code>tipo_servicio</code> guardado en cada punto. Consenso = mayoría (≥2 de 3 modelos).
          </div>
        </div>
      )}

      {/* Impacto */}
      {revenueExtra>0&&(
        <div style={{background:"#F0FFF4",border:"1px solid #86EFAC",borderRadius:9,padding:"14px 16px",fontSize:12,color:"#065F46",lineHeight:1.7}}>
          <div style={{fontWeight:700,marginBottom:4}}>💡 Impacto estimado en el modelo FSV</div>
          <div>{kpis.ops.agua_zc} ops agua × ${AGUA_PRECIO_USD} × {AGUA_SERVICIOS_AÑO} svc/año + {kpis.ops.slop_zc} ops slop × ${SLOP_PRECIO_USD} × {SLOP_SERVICIOS_AÑO} svc/año</div>
          <div style={{fontSize:16,fontWeight:800,marginTop:6,color:"#047857"}}>= USD {revenueExtra.toLocaleString("es-AR")} / año estimado</div>
          <div style={{fontSize:10,color:"#6EE7B7",marginTop:4,fontFamily:"var(--mono)"}}>* Estimación con supuestos del modelo. Actualizá el P&L con valores reales.</div>
        </div>
      )}

      {kpis.totalServices===0&&data.trips.length>0&&(
        <div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:9,padding:"12px 16px",fontSize:12,color:"#92400E",lineHeight:1.6,marginTop:16}}>
          <strong>No se detectaron servicios aún.</strong><br/>
          Abrí cada viaje en Trip Viewer y clasificá los puntos de parada.
          {onGoTrips&&<span role="button" tabIndex={0} style={{marginLeft:6,cursor:"pointer",textDecoration:"underline",fontWeight:600}} onClick={onGoTrips} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")onGoTrips?.();}}>Ir a Viajes →</span>}
        </div>
      )}
    </div>
  );
}
