import { aggregateKPIs, SERVICE_TYPES } from "../lib/ais_engine";

const SVC_ROWS = [
  { key: "agua_zc",  label: "Agua — Zona Común",    color: "#2196F3" },
  { key: "slop_zc",  label: "Slop — Zona Común",    color: "#FF9800" },
  { key: "lub_zc",   label: "Lubricantes — ZC",     color: "#4CAF50" },
  { key: "alijo_zc", label: "Alijo — Zona Común",   color: "#9C27B0" },
  { key: "alijo_za", label: "Alijo — Zona Alfa",    color: "#673AB7" },
  { key: "alijo_zd", label: "Alijo — Zona Delta",   color: "#3F51B5" },
];

export default function Dashboard({ data, onGoTrips }) {
  if (!data) return (
    <div style={{ padding:"28px 32px",maxWidth:800 }}>
      <div style={{ fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",textTransform:"uppercase",marginBottom:6 }}>AIS Analyzer · Dashboard</div>
      <h1 style={{ fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:20 }}>Dashboard operativo</h1>
      <div style={{ display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:340,textAlign:"center",padding:40 }}>
        <div style={{ fontSize:48,marginBottom:14,opacity:.35 }}>📊</div>
        <div style={{ fontSize:18,fontWeight:700,color:"var(--navy)",marginBottom:8 }}>Subí el archivo AIS para empezar</div>
        <div style={{ fontSize:12,color:"var(--muted)",maxWidth:380,lineHeight:1.7 }}>
          Andá a la pestaña Upload, cargá el Excel de VesselFinder, y acá aparecerán los KPIs del BG Tiger.
        </div>
      </div>
    </div>
  );

  const kpis  = aggregateKPIs(data.trips);
  const pct   = data.trips.length ? Math.round(kpis.validatedTrips / data.trips.length * 100) : 0;
  const maxOp = Math.max(...SVC_ROWS.map(s => kpis.ops[s.key]), 1);

  const revenueExtra = (kpis.ops.agua_zc * 250 * 65) + (kpis.ops.slop_zc * 100 * 100);

  return (
    <div style={{ padding:"28px 32px",maxWidth:900 }}>
      <div style={{ fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",textTransform:"uppercase",marginBottom:6 }}>
        AIS Analyzer · {data.filename}
      </div>
      <h1 style={{ fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:6 }}>Dashboard operativo</h1>
      <p style={{ fontSize:12,color:"var(--muted)",lineHeight:1.7,marginBottom:20,maxWidth:600 }}>
        Operaciones validadas por tipo de servicio. Los valores de agua y slop alimentan directamente el P&L del modelo FSV.
      </p>

      {/* Progress */}
      <div style={{ background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:9,padding:"12px 16px",marginBottom:20,fontSize:12,color:"#854F0B",lineHeight:1.6 }}>
        <strong>Validación: {kpis.validatedTrips}/{data.trips.length} viajes ({pct}%)</strong>
        <div style={{ background:"#EEF2F7",borderRadius:4,height:5,overflow:"hidden",margin:"7px 0" }}>
          <div style={{ width:`${pct}%`,height:"100%",background:"#FFA726",borderRadius:4,transition:"width .3s" }} />
        </div>
        {kpis.pendingTrips > 0 && <>{kpis.pendingTrips} viajes pendientes. </>}
        <span style={{ cursor:"pointer",textDecoration:"underline" }} onClick={onGoTrips}>Ir a Trip Viewer →</span>
      </div>

      {/* KPIs */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:10,marginBottom:20 }}>
        {[
          { val: kpis.totalTrips,    lbl:"Viajes",      sub:"total",          col:"#235C96" },
          { val: kpis.validatedTrips,lbl:"Validados",   sub:`${pct}%`,        col:"#1E7A4A" },
          { val: kpis.totalServices, lbl:"Servicios",   sub:"detectados",     col:"#1E7A4A" },
          { val: kpis.ops.agua_zc,   lbl:"Agua / ZC",   sub:"→ P&L B108",     col:"#2196F3" },
          { val: kpis.ops.slop_zc,   lbl:"Slop / ZC",   sub:"→ P&L B109",     col:"#FF9800" },
          { val: kpis.pendingTrips,  lbl:"Pendientes",  sub:"por revisar",    col:"#6381A7" },
        ].map(k => (
          <div key={k.lbl} style={{ background:"#fff",border:"1px solid #D6E0ED",borderRadius:9,padding:"12px 14px",borderLeft:`3px solid ${k.col}` }}>
            <div style={{ fontSize:20,fontWeight:700,color:k.col,lineHeight:1,marginBottom:3 }}>{k.val}</div>
            <div style={{ fontSize:10,color:"#6381A7",textTransform:"uppercase",letterSpacing:".7px" }}>{k.lbl}</div>
            <div style={{ fontSize:9,color:"#A5B5CC",marginTop:2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Ops breakdown */}
      <div style={{ background:"#fff",border:"1px solid #D6E0ED",borderRadius:10,overflow:"hidden",marginBottom:20 }}>
        <div style={{ padding:"10px 16px",borderBottom:"1px solid #EEF2F7",fontFamily:"var(--mono)",fontSize:9,fontWeight:600,color:"#6381A7",textTransform:"uppercase",letterSpacing:1 }}>
          Operaciones validadas por tipo
        </div>
        {SVC_ROWS.map(s => (
          <div key={s.key} style={{ display:"flex",alignItems:"center",gap:12,padding:"9px 16px",borderBottom:"1px solid #F5F7FA" }}>
            <div style={{ width:160,fontSize:11,color:"#6381A7",flexShrink:0 }}>{s.label}</div>
            <div style={{ flex:1,height:7,background:"#EEF2F7",borderRadius:4,overflow:"hidden" }}>
              <div style={{ width:`${kpis.ops[s.key]/maxOp*100}%`,height:"100%",background:s.color,borderRadius:4,transition:"width .3s" }} />
            </div>
            <div style={{ width:28,fontFamily:"var(--mono)",fontSize:13,fontWeight:700,color:s.color,textAlign:"right" }}>{kpis.ops[s.key]}</div>
          </div>
        ))}
      </div>

      {/* Impact box */}
      {revenueExtra > 0 && (
        <div style={{ background:"#F0FFF4",border:"1px solid #86EFAC",borderRadius:9,padding:"12px 16px",fontSize:12,color:"#065F46",lineHeight:1.6 }}>
          💡 <strong>Impacto en el modelo:</strong> {kpis.ops.agua_zc} ops de agua + {kpis.ops.slop_zc} ops de slop =
          revenue extra estimado de <strong>${revenueExtra.toLocaleString("es-AR")} USD/año</strong>.
          Actualizá las celdas del P&L con estos valores.
        </div>
      )}
    </div>
  );
}
