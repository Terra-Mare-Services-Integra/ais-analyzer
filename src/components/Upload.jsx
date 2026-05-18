import { useState, useRef } from "react";
import { parseAISExcel, detectTrips } from "../lib/ais_engine";
import { supabase } from "../lib/supabase";

async function saveToSupabase({ filename, points, trips }) {
  const dates      = points.map(p => p.datetime);
  const fechaInicio = new Date(Math.min(...dates)).toISOString().split("T")[0];
  const fechaFin    = new Date(Math.max(...dates)).toISOString().split("T")[0];

  // 1. Upload record
  const { data: upload, error: upErr } = await supabase
    .from("ais_uploads")
    .insert({ buque:"BG Tiger", filename, fecha_inicio:fechaInicio, fecha_fin:fechaFin, total_registros:points.length, total_viajes:trips.length })
    .select().single();
  if (upErr) throw new Error("Error guardando upload: " + upErr.message);

  // 2. Each trip + its points
  for (const trip of trips) {
    const { data: tripRow, error: tripErr } = await supabase
      .from("ais_trips")
      .insert({
        upload_id: upload.id, trip_num: trip.id,
        date_start: trip.dateStart.toISOString(), date_departure: trip.dateDeparture.toISOString(), date_end: trip.dateEnd.toISOString(),
        duration_hs: trip.durationHs, dist_nm: trip.distNm, n_services: trip.nServices, zones: trip.zones, validated: false,
      })
      .select().single();
    if (tripErr) throw new Error("Error guardando viaje: " + tripErr.message);

    trip.supabaseId = tripRow.id;

    const batch = trip.points.map(p => ({
      upload_id: upload.id, trip_id: tripRow.id,
      datetime: p.datetime.toISOString(), lat: p.lat, lon: p.lon, sog: p.sog,
      zone: p.zone, state: p.state, tipo_servicio: p.tipo_servicio, zona_servicio: p.zona_servicio,
    }));

    for (let i = 0; i < batch.length; i += 200) {
      const { error: ptErr } = await supabase.from("ais_points").insert(batch.slice(i, i + 200));
      if (ptErr) throw new Error("Error guardando puntos: " + ptErr.message);
    }
  }

  return upload.id;
}

export default function Upload({ onLoad, existingUploads = [], onSelectUpload }) {
  const [drag,     setDrag]     = useState(false);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState(null);
  const [progress, setProgress] = useState("");
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      setProgress("Leyendo archivo...");
      const buf    = await file.arrayBuffer();
      setProgress("Clasificando puntos AIS...");
      const points = parseAISExcel(new Uint8Array(buf));
      if (!points.length) throw new Error("No se encontraron puntos AIS válidos.");
      setProgress(`${points.length.toLocaleString()} puntos. Detectando viajes...`);
      const trips  = detectTrips(points);
      setProgress(`${trips.length} viajes detectados. Guardando en Supabase...`);
      const uploadId = await saveToSupabase({ filename: file.name, points, trips });
      setProgress("");
      onLoad({ uploadId, filename: file.name, points, trips, loadedAt: new Date() });
    } catch (e) {
      setError(e.message);
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding:"28px 32px", maxWidth:720 }}>
      <div style={{ fontFamily:"var(--mono)",fontSize:9,letterSpacing:3,color:"var(--muted)",textTransform:"uppercase",marginBottom:6 }}>AIS Analyzer · Upload</div>
      <h1 style={{ fontSize:22,fontWeight:800,color:"var(--navy)",marginBottom:6 }}>Subir archivo AIS</h1>
      <p style={{ fontSize:12,color:"var(--muted)",lineHeight:1.7,marginBottom:24,maxWidth:560 }}>
        Exportá el historial de posiciones desde VesselFinder en .xlsx. El sistema parsea, detecta viajes y guarda todo en Supabase automáticamente.
      </p>

      {existingUploads.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <div style={{ fontFamily:"var(--mono)",fontSize:9,letterSpacing:2,color:"var(--muted)",textTransform:"uppercase",marginBottom:10 }}>Archivos guardados</div>
          <div style={{ background:"#fff",border:"1px solid #D6E0ED",borderRadius:10,overflow:"hidden" }}>
            {existingUploads.map(u => (
              <div key={u.id}
                style={{ display:"flex",alignItems:"center",gap:12,padding:"11px 16px",borderBottom:"1px solid #EEF2F7",cursor:"pointer" }}
                onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                onMouseLeave={e=>e.currentTarget.style.background="#fff"}
                onClick={() => onSelectUpload(u)}>
                <span style={{ fontSize:18 }}>📡</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12,fontWeight:600,color:"var(--navy)" }}>{u.filename}</div>
                  <div style={{ fontFamily:"var(--mono)",fontSize:10,color:"var(--muted)",marginTop:1 }}>
                    {u.fecha_inicio} → {u.fecha_fin} · {u.total_viajes} viajes · {u.total_registros?.toLocaleString()} pts
                  </div>
                </div>
                <span style={{ fontSize:11,fontWeight:600,color:"#235C96" }}>Cargar →</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{ border:`2px dashed ${drag?"#235C96":"#D6E0ED"}`,borderRadius:12,padding:"40px 32px",textAlign:"center",background:drag?"#EFF6FF":"#fff",cursor:busy?"default":"pointer",transition:"all .2s",marginBottom:20 }}
        onDragOver={e=>{e.preventDefault();setDrag(true)}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0])}}
        onClick={()=>!busy&&inputRef.current?.click()}>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])} />
        {busy ? (
          <><div style={{ fontSize:36,marginBottom:10 }}>⏳</div><div style={{ fontSize:13,color:"#235C96",fontWeight:600 }}>{progress}</div></>
        ) : (
          <><div style={{ fontSize:40,marginBottom:10,opacity:.4 }}>📡</div>
          <div style={{ fontSize:13,color:"var(--muted)",marginBottom:4 }}>Arrastrá el Excel AIS acá o hacé click</div>
          <div style={{ fontSize:11,color:"#A5B5CC",fontFamily:"var(--mono)" }}>VesselFinder Export · .xlsx · DATE TIME · LAT · LON · SPEED</div></>
        )}
      </div>

      {error && <div style={{ background:"#FFF5F5",border:"1px solid #FECACA",borderRadius:8,padding:"12px 16px",fontSize:12,color:"#C0392B",marginBottom:16 }}>⚠ {error}</div>}

      <div style={{ background:"#EFF6FF",border:"1px solid #93C5FD",borderRadius:9,padding:"12px 16px",fontSize:12,color:"#1E40AF",lineHeight:1.6 }}>
        <strong>Los datos se guardan en Supabase</strong> — podés cerrar y volver sin perder las clasificaciones.
      </div>
    </div>
  );
}
