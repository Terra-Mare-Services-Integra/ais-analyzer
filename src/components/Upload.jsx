import { useState, useRef } from "react";
import { parseAISExcel, detectTrips } from "../lib/ais_engine";

export default function Upload({ onLoad }) {
  const [drag,    setDrag]    = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState(null);
  const [progress,setProgress]= useState("");
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true); setError(null); setProgress("Leyendo archivo...");
    try {
      const buf = await file.arrayBuffer();
      setProgress("Clasificando puntos AIS...");
      const points = parseAISExcel(new Uint8Array(buf));
      if (!points.length) throw new Error("No se encontraron puntos AIS válidos.");
      setProgress(`${points.length.toLocaleString()} puntos encontrados. Detectando viajes...`);
      const trips = detectTrips(points);
      setProgress("");
      onLoad({ filename: file.name, points, trips, loadedAt: new Date() });
    } catch (e) {
      setError(e.message);
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 720 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 3, color: "var(--muted)", textTransform: "uppercase", marginBottom: 6 }}>
        AIS Analyzer · Upload
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--navy)", marginBottom: 6 }}>Subir archivo AIS</h1>
      <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7, marginBottom: 24, maxWidth: 560 }}>
        Exportá el historial de posiciones desde VesselFinder en formato .xlsx y subilo acá.
        El sistema detecta viajes automáticamente y clasifica cada punto por zona y velocidad.
      </p>

      <div
        style={{
          border: `2px dashed ${drag ? "var(--blue)" : "var(--border)"}`,
          borderRadius: 12, padding: "40px 32px", textAlign: "center",
          background: drag ? "#EFF6FF" : "#fff", cursor: "pointer",
          transition: "all .2s", marginBottom: 20,
        }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
          onChange={e => handleFile(e.target.files[0])} />

        {busy ? (
          <>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⏳</div>
            <div style={{ fontSize: 13, color: "var(--blue)", fontWeight: 600 }}>{progress}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40, marginBottom: 10, opacity: .4 }}>📡</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
              Arrastrá el Excel AIS acá o hacé click para seleccionar
            </div>
            <div style={{ fontSize: 11, color: "#A5B5CC", fontFamily: "var(--mono)" }}>
              VesselFinder Export · .xlsx · DATE TIME · LAT · LON · SPEED
            </div>
          </>
        )}
      </div>

      {error && (
        <div style={{ background: "#FFF5F5", border: "1px solid #FECACA", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "#C0392B", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ background: "#EFF6FF", border: "1px solid #93C5FD", borderRadius: 9, padding: "12px 16px", fontSize: 12, color: "#1E40AF", lineHeight: 1.6 }}>
        <strong>Formato esperado:</strong> Export de VesselFinder con columnas DATE TIME (UTC), LATITUDE, LONGITUDE, SPEED.
        Las coordenadas como enteros ×100.000 se convierten automáticamente.
      </div>
    </div>
  );
}
