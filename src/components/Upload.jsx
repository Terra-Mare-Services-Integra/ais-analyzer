import { useState, useRef, useCallback } from "react";
import { parseAISExcel, detectTrips } from "../lib/ais_engine";
import { supabase } from "../lib/supabase";

// ─── PERSISTENCIA EN SUPABASE ─────────────────────────────────────────────────
// FIX CRÍTICO: saveToSupabase tenía N+1 inserts para puntos — un insert por cada
// batch de 200, pero dentro de un loop de viajes. Con 50 viajes × 500 puntos c/u
// = 125 inserts secuenciales.
// FIX: los batches de puntos de TODOS los viajes se preparan primero y se insertan
// en paralelo con Promise.all, respetando el límite de 200 filas por insert de Supabase.
//
// FIX CRÍTICO: si saveToSupabase falla a mitad de camino (p.ej. al insertar el
// viaje #3 de 12), el upload quedaba registrado pero incompleto en Supabase, sin
// posibilidad de reintento limpio. Ahora se registra el error con contexto y se
// lanza para que el caller pueda mostrar un mensaje útil.
//
// FIX ALTO: Math.min/max sobre array grande con spread (...dates) lanza
// "Maximum call stack size exceeded" con > ~100.000 puntos.
// Reemplazado por reduce().

async function saveToSupabase({ filename, points, trips }) {
  // FIX: reduce en lugar de spread para evitar stack overflow con datasets grandes
  const minDate = points.reduce((min, p) => p.datetime < min ? p.datetime : min, points[0].datetime);
  const maxDate = points.reduce((max, p) => p.datetime > max ? p.datetime : max, points[0].datetime);
  const fechaInicio = minDate.toISOString().split("T")[0];
  const fechaFin    = maxDate.toISOString().split("T")[0];

  // 1. Registro de upload
  const { data: upload, error: upErr } = await supabase
    .from("ais_uploads")
    .insert({
      buque:            "BG Tiger",
      filename,
      fecha_inicio:     fechaInicio,
      fecha_fin:        fechaFin,
      total_registros:  points.length,
      total_viajes:     trips.length,
    })
    .select()
    .maybeSingle();

  if (upErr) throw new Error("Error registrando upload: " + upErr.message);
  if (!upload) throw new Error("No se obtuvo confirmación del upload desde Supabase.");

  // 2. Insertar viajes y puntos
  // FIX PERFORMANCE: preparar todos los batches de puntos y ejecutarlos en paralelo
  // después de insertar los viajes (que sí deben ser secuenciales por dependencia de FK)
  const allPointBatches = []; // { tripIdx, batch }

  for (const trip of trips) {
    const { data: tripRow, error: tripErr } = await supabase
      .from("ais_trips")
      .insert({
        upload_id:       upload.id,
        trip_num:        trip.id,
        date_start:      trip.dateStart.toISOString(),
        date_departure:  trip.dateDeparture.toISOString(),
        date_end:        trip.dateEnd.toISOString(),
        duration_hs:     trip.durationHs,
        nav_hs:          trip.navHs,          // FIX: persistir navHs real
        dist_nm:         trip.distNm,
        n_services:      trip.nServices,
        zones:           trip.zones,
        validated:       false,
        incomplete:      trip.incomplete || false,
      })
      .select()
      .maybeSingle();

    if (tripErr) throw new Error(`Error guardando viaje #${trip.id}: ${tripErr.message}`);
    if (!tripRow) throw new Error(`No se obtuvo ID para viaje #${trip.id}`);

    // Asignar supabaseId al objeto en memoria para uso posterior
    trip.supabaseId = tripRow.id;

    // Preparar batches de puntos para este viaje
    const rows = trip.points.map(p => ({
      upload_id:     upload.id,
      trip_id:       tripRow.id,
      datetime:      p.datetime.toISOString(),
      lat:           p.lat,
      lon:           p.lon,
      sog:           p.sog,
      zone:          p.zone,
      state:         p.state,
      tipo_servicio: p.tipo_servicio,
      zona_servicio: p.zona_servicio,
    }));

    for (let i = 0; i < rows.length; i += 200) {
      allPointBatches.push(rows.slice(i, i + 200));
    }
  }

  // Insertar todos los batches de puntos en paralelo (máx 8 simultáneos para no saturar)
  const CONCURRENCY = 8;
  for (let i = 0; i < allPointBatches.length; i += CONCURRENCY) {
    const chunk = allPointBatches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(batch => supabase.from("ais_points").insert(batch))
    );
    const failed = results.find(r => r.error);
    if (failed) throw new Error("Error guardando puntos: " + failed.error.message);
  }

  return upload.id;
}

// ─── VALIDACIÓN DE ARCHIVO ────────────────────────────────────────────────────
// FIX UX: validar antes de procesar. Evita que el usuario espere 5 segundos
// para descubrir que subió un PDF o un xlsx vacío.
function validateFile(file) {
  if (!file) return "No se seleccionó ningún archivo.";

  const ext = file.name.split(".").pop().toLowerCase();
  if (!["xlsx", "xls"].includes(ext)) {
    return `Formato no soportado: .${ext}. El archivo debe ser .xlsx o .xls (exportado desde VesselFinder).`;
  }

  const MAX_MB = 50;
  if (file.size > MAX_MB * 1024 * 1024) {
    return `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es ${MAX_MB} MB.`;
  }

  if (file.size < 1024) {
    return "El archivo parece estar vacío (menos de 1 KB). Verificá la exportación de VesselFinder.";
  }

  return null; // null = válido
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────
export default function Upload({ onLoad, existingUploads = [], uploadsError = null, onSelectUpload }) {
  const [drag,       setDrag]       = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState(null);
  const [progress,   setProgress]   = useState("");
  const [progressPct,setProgressPct]= useState(0);
  // FIX UX: confirmar antes de reemplazar datos en memoria
  const [pendingFile,setPendingFile] = useState(null);
  const inputRef = useRef();

  // FIX UX: limpiar el input file después de cada uso para que el mismo archivo
  // se pueda volver a subir si el usuario quiere reintentar.
  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = useCallback(async (file) => {
    if (!file || busy) return;

    // FIX UX: validación temprana antes de procesar
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      resetInput();
      return;
    }

    setBusy(true);
    setError(null);
    setProgressPct(0);

    try {
      setProgress("Leyendo archivo…");
      setProgressPct(10);
      const buf = await file.arrayBuffer();

      setProgress("Clasificando puntos AIS…");
      setProgressPct(30);
      const points = parseAISExcel(new Uint8Array(buf));

      if (!points.length) throw new Error("No se encontraron puntos AIS válidos en el archivo.");

      setProgress(`${points.length.toLocaleString()} puntos encontrados. Detectando viajes…`);
      setProgressPct(50);
      const trips = detectTrips(points);

      if (!trips.length) {
        throw new Error(
          "No se detectaron viajes. Verificá que el archivo contenga posiciones fuera de Dársena E " +
          "y que el buque haya navegado con SOG > 3 kn."
        );
      }

      setProgress(`${trips.length} viajes detectados. Guardando en Supabase…`);
      setProgressPct(70);
      const uploadId = await saveToSupabase({ filename: file.name, points, trips });

      setProgressPct(100);
      setProgress("");
      resetInput();
      onLoad({ uploadId, filename: file.name, points, trips, loadedAt: new Date() });

    } catch (e) {
      setError(e.message || "Error desconocido al procesar el archivo.");
      setProgress("");
      setProgressPct(0);
      resetInput();
    } finally {
      setBusy(false);
    }
  }, [busy, onLoad]);

  // FIX UX: drag handlers previenen defaults correctamente
  const onDragOver  = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDrag(true);  }, []);
  const onDragLeave = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); }, []);
  const onDrop      = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag(false);
    if (!busy) handleFile(e.dataTransfer.files[0]);
  }, [busy, handleFile]);

  // FIX UX: formatear fechas de uploads existentes en formato legible
  // Las fechas vienen como "2024-11-21" desde Supabase — mostrar como "21/11/2024"
  const fmtSupabaseDate = (str) => {
    if (!str) return "—";
    const [y, m, d] = str.split("-");
    return `${d}/${m}/${y}`;
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 720 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 3, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
        AIS Analyzer · Upload
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginBottom: 6 }}>
        Subir archivo AIS
      </h1>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7, marginBottom: 24, maxWidth: 560 }}>
        Exportá el historial de posiciones desde VesselFinder en .xlsx. El sistema clasifica, detecta viajes y guarda todo automáticamente.
      </p>

      {/* ── Uploads existentes ── */}
      {uploadsError && (
        <div style={{ background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#C0392B", marginBottom: 16 }}>
          ⚠ {uploadsError}
        </div>
      )}

      {existingUploads.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 2, color: "var(--muted)", textTransform: "uppercase", marginBottom: 10 }}>
            Archivos guardados
          </div>
          <div style={{ background: "#fff", border: "1px solid #D6E0ED", borderRadius: 10, overflow: "hidden" }}>
            {existingUploads.map((u, idx) => (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                aria-label={`Cargar ${u.filename}, ${u.total_viajes} viajes`}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 16px",
                  borderBottom: idx < existingUploads.length - 1 ? "1px solid #EEF2F7" : "none",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.5 : 1,
                  transition: "background .12s",
                }}
                onMouseEnter={e => { if (!busy) e.currentTarget.style.background = "#F8FAFC"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
                onClick={() => { if (!busy) onSelectUpload(u); }}
                onKeyDown={e => { if (!busy && (e.key === "Enter" || e.key === " ")) onSelectUpload(u); }}
              >
                <span style={{ fontSize: 18 }} aria-hidden="true">📡</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* FIX UX: nombre de archivo truncado con ellipsis, no cortado */}
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {u.filename}
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
                    {/* FIX UX: fechas en formato local dd/mm/yyyy, no ISO */}
                    {fmtSupabaseDate(u.fecha_inicio)} → {fmtSupabaseDate(u.fecha_fin)}
                    {" · "}{u.total_viajes} viaje{u.total_viajes !== 1 ? "s" : ""}
                    {" · "}{u.total_registros?.toLocaleString("es-AR")} pts
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#235C96", flexShrink: 0 }}>
                  Cargar →
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {existingUploads.length === 0 && !uploadsError && (
        <div style={{ marginBottom: 20, fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
          No hay archivos guardados todavía.
        </div>
      )}

      {/* ── Drop zone ── */}
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label="Zona de carga de archivo. Arrastrá o hacé click para seleccionar."
        aria-busy={busy}
        style={{
          border: `2px dashed ${drag ? "#235C96" : "#D6E0ED"}`,
          borderRadius: 12,
          padding: "40px 32px",
          textAlign: "center",
          background: drag ? "#EFF6FF" : "#fff",
          cursor: busy ? "default" : "pointer",
          transition: "border-color .2s, background .2s",
          marginBottom: 20,
          outline: "none",
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => { if (!busy) inputRef.current?.click(); }}
        onKeyDown={e => { if (!busy && (e.key === "Enter" || e.key === " ")) inputRef.current?.click(); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={e => handleFile(e.target.files[0])}
        />

        {busy ? (
          <BusyState progress={progress} progressPct={progressPct} />
        ) : (
          <IdleState />
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div
          role="alert"
          style={{ background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "#C0392B", marginBottom: 16, lineHeight: 1.6 }}
        >
          <strong>⚠ Error al procesar el archivo</strong><br />
          {error}
          {/* FIX UX: botón para reintentar sin tener que recargar la página */}
          <button
            onClick={() => { setError(null); inputRef.current?.click(); }}
            style={{ marginTop: 8, display: "block", fontSize: 11, color: "#235C96", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
          >
            → Intentar con otro archivo
          </button>
        </div>
      )}

      {/* ── Info box ── */}
      <div style={{ background: "#EFF6FF", border: "1px solid #93C5FD", borderRadius: 9, padding: "12px 16px", fontSize: 12, color: "#1E40AF", lineHeight: 1.6 }}>
        <strong>Los datos se guardan en Supabase</strong> — podés cerrar y volver sin perder las clasificaciones.
        <br />
        <span style={{ fontSize: 11, opacity: 0.8 }}>
          Formato esperado: VesselFinder Export · .xlsx · columnas DATE/TIME, LAT, LON, SPEED/SOG
        </span>
      </div>
    </div>
  );
}

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

function IdleState() {
  return (
    <>
      <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.4 }} aria-hidden="true">📡</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
        Arrastrá el Excel AIS acá o hacé click para seleccionar
      </div>
      <div style={{ fontSize: 11, color: "#A5B5CC", fontFamily: "var(--mono)" }}>
        VesselFinder Export · .xlsx · DATE TIME · LAT · LON · SPEED
      </div>
    </>
  );
}

function BusyState({ progress, progressPct }) {
  return (
    <>
      <div style={{ fontSize: 36, marginBottom: 10 }} aria-hidden="true">⏳</div>
      <div style={{ fontSize: 13, color: "#235C96", fontWeight: 600, marginBottom: 12 }}>
        {progress}
      </div>
      {/* FIX UX: barra de progreso con porcentaje visible */}
      <div
        role="progressbar"
        aria-valuenow={progressPct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ background: "#EEF2F7", borderRadius: 6, height: 6, overflow: "hidden", maxWidth: 320, margin: "0 auto" }}
      >
        <div style={{
          width: `${progressPct}%`,
          height: "100%",
          background: "#235C96",
          borderRadius: 6,
          transition: "width .4s ease",
        }} />
      </div>
      <div style={{ fontSize: 10, color: "#A5B5CC", fontFamily: "var(--mono)", marginTop: 8 }}>
        {progressPct}% completado
      </div>
    </>
  );
}
