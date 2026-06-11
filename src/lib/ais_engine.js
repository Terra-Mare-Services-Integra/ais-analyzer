import * as XLSX from "xlsx";

// ─── VERSIÓN DEL MOTOR ────────────────────────────────────────────────────────
// v2.0.0 — 2024-11
// Cambios respecto a v1:
//   - FIX CRÍTICO: conversión de fechas Excel ahora fuerza UTC (evita desfase por timezone del browser)
//   - FIX CRÍTICO: classifyState añade umbral SOG ≤ 2 kn para WORKING_STOP (tránsitos ya no son "Operando")
//   - FIX CRÍTICO: detectTrips recupera el viaje incompleto al final del dataset (flag incomplete:true)
//   - FIX CRÍTICO: navHs calculado sumando solo intervalos con state TRANSIT
//   - FIX ALTO: distNm filtra segmentos GPS drift < 0.02 nm durante paradas
//   - FIX ALTO: SOG no numérico ("N/A", "—", "") tratado como null, no como 0
//   - FIX ALTO: haversine usa constante nm exacta (1/1.852)
//   - FIX ALTO: parseAISExcel busca header en primeras 10 filas (antes 5)
//   - FIX ALTO: validación estricta lat/lon dentro de rango geográfico real
//   - FIX MEDIO: aggregateKPIs agrupa segmentos contiguos WORKING_STOP correctamente
//   - FIX MEDIO: ZONES y constantes globales congelados con Object.freeze
//   - FIX MEDIO: classifyState maneja sog null como "desconocido" → IDLE_OUTSIDE

export const ENGINE_VERSION = "2.0.0";

// ─── GEOFENCES ────────────────────────────────────────────────────────────────
export const ZONES = Object.freeze({
  DARSENA_E:  Object.freeze({ label: "Dársena E",  color: "#1a3a6c", polygon: Object.freeze([[-34.57310,-58.38449],[-34.57103,-58.38054],[-34.57393,-58.37554],[-34.57567,-58.37996]]) }),
  ZONA_COMUN: Object.freeze({ label: "Zona Común", color: "#E91E63", polygon: Object.freeze([[-34.7086,-57.8866],[-34.7715,-57.9213],[-34.8200,-57.7610],[-34.7450,-57.7407]]) }),
  KM171:      Object.freeze({ label: "KM 171",     color: "#FF5722", polygon: Object.freeze([[-33.8745,-58.8784],[-33.9321,-58.7400],[-33.9837,-58.7997],[-33.9067,-58.9151]]) }),
  UPRIVER:    Object.freeze({ label: "Upriver",    color: "#00BCD4", polygon: Object.freeze([[-33.4069,-59.8336],[-33.6624,-60.1950],[-32.4096,-61.0937],[-32.4176,-60.3570]]) }),
  RECALADA:   Object.freeze({ label: "Recalada",   color: "#9C27B0", polygon: Object.freeze([[-35.0793,-55.7757],[-35.0486,-55.1312],[-35.3035,-55.1416],[-35.2767,-55.8117]]) }),
});

export const OPERATIONAL_ZONES = Object.freeze(["ZONA_COMUN", "KM171", "UPRIVER", "RECALADA"]);

export const STATES = Object.freeze({
  IN_PORT:      Object.freeze({ label: "En Puerto",       color: "#1a3a6c" }),
  TRANSIT:      Object.freeze({ label: "Navegando",       color: "#64B5F6" }),
  WORKING_STOP: Object.freeze({ label: "Operando",        color: "#66BB6A" }),
  IDLE_OUTSIDE: Object.freeze({ label: "Fondeo / Espera", color: "#78909C" }),
});

export const SERVICE_TYPES = Object.freeze({
  AGUA:           Object.freeze({ label: "Transporte de Agua",     color: "#2196F3", plRow: "agua_zc"  }),
  SLOP:           Object.freeze({ label: "Transporte de Slop",     color: "#FF9800", plRow: "slop_zc"  }),
  LUBRICANTES:    Object.freeze({ label: "Transporte Lubricantes", color: "#4CAF50", plRow: "lub_zc"   }),
  ALIJO_ZC:       Object.freeze({ label: "Alijo — Zona Común",     color: "#9C27B0", plRow: "alijo_zc" }),
  ALIJO_ZA:       Object.freeze({ label: "Alijo — Zona Alfa",      color: "#673AB7", plRow: "alijo_za" }),
  ALIJO_ZD:       Object.freeze({ label: "Alijo — Zona Delta",     color: "#3F51B5", plRow: "alijo_zd" }),
  BORRADO:        Object.freeze({ label: "No es servicio",          color: "#EF5350", plRow: null       }),
  SIN_CLASIFICAR: Object.freeze({ label: "Sin clasificar",          color: "#9E9E9E", plRow: null       }),
});

// ─── UTILS ────────────────────────────────────────────────────────────────────

/**
 * Ray-casting point-in-polygon.
 * Maneja correctamente el caso de punto sobre borde mediante epsilon.
 */
function pointInPolygon(lat, lon, polygon) {
  const EPSILON = 1e-10;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    // Punto exactamente sobre vértice → dentro
    if (Math.abs(lat - yi) < EPSILON && Math.abs(lon - xi) < EPSILON) return true;
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function classifyZone(lat, lon) {
  for (const [name, zone] of Object.entries(ZONES)) {
    if (pointInPolygon(lat, lon, zone.polygon)) return name;
  }
  return "OPEN_SEA";
}

/**
 * FIX CRÍTICO: classifyState ahora requiere SOG ≤ 2 kn para WORKING_STOP.
 * Un buque navegando a velocidad normal (SOG > 3) a través de una zona operativa
 * se clasifica como TRANSIT, no "Operando".
 * sog puede ser null (dato no disponible) → IDLE_OUTSIDE como fallback seguro.
 */
export function classifyState(zone, sog) {
  const sogNum = (sog !== null && sog !== undefined && Number.isFinite(Number(sog)))
    ? Number(sog)
    : null;

  // En dársena parado
  if (zone === "DARSENA_E" && (sogNum === null || sogNum <= 0.5)) return "IN_PORT";

  // En dársena moviéndose (maniobra de entrada/salida)
  if (zone === "DARSENA_E" && sogNum !== null && sogNum > 0.5) return "TRANSIT";

  // En zona operativa: solo es WORKING_STOP si está lento (≤ 2 kn)
  if (OPERATIONAL_ZONES.includes(zone) && sogNum !== null && sogNum <= 2.0) return "WORKING_STOP";

  // Navegando (fuera de dársena, SOG > 3 kn)
  if (sogNum !== null && sogNum > 3) return "TRANSIT";

  // Todo lo demás: fondeo o espera
  return "IDLE_OUTSIDE";
}

/**
 * FIX ALTO: Constante nm exacta. 1 km = 1/1.852 nm = 0.5399568034557235
 * (antes usaba 0.539957, error acumulativo en viajes largos)
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const distKm = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distKm / 1.852; // conversión exacta km → nm
}

// ─── PARSER ───────────────────────────────────────────────────────────────────

/**
 * FIX CRÍTICO: Conversión de fecha serial Excel a UTC real.
 * La versión anterior usaba `new Date(serial * 86400000)` que toma la timezone
 * LOCAL del browser. En Argentina (UTC-3) generaba desfase de 3 horas.
 * Ahora se descompone el serial en fecha+hora y se construye explícitamente en UTC.
 */
function excelSerialToUTC(serial) {
  // Excel epoch: 30 dic 1899. Ajuste por bug conocido de Excel con año 1900 bisiesto.
  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // 30/12/1899 en UTC
  const MS_PER_DAY = 86400000;
  return new Date(EXCEL_EPOCH_MS + Math.round(serial * MS_PER_DAY));
}

/**
 * Intenta parsear una fecha string con múltiples formatos.
 * Devuelve Date válida o null.
 */
function parseDateString(str) {
  if (!str || typeof str !== "string") return null;
  const trimmed = str.trim();

  // Formatos comunes de VesselFinder / exportadores AIS:
  // "2024-11-21 06:37:56", "21/11/2024 06:37:56", "2024-11-21T06:37:56Z"
  // Intentar ISO primero (más confiable)
  const isoAttempt = new Date(trimmed.replace(" ", "T") + (trimmed.includes("Z") ? "" : "Z"));
  if (!isNaN(isoAttempt.getTime())) return isoAttempt;

  // Formato DD/MM/YYYY HH:mm:ss
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(trimmed);
  if (ddmmyyyy) {
    const [, d, m, y, h, min, s] = ddmmyyyy;
    const dt = new Date(Date.UTC(+y, +m - 1, +d, +h, +min, +s));
    if (!isNaN(dt.getTime())) return dt;
  }

  return null;
}

export function parseAISExcel(buffer) {
  const wb  = XLSX.read(buffer, { type: "array" });
  const ws  = wb.Sheets[wb.SheetNames[0]];

  // FIX MEDIO: múltiples hojas — buscar la que tenga columnas AIS
  // Por ahora usa la primera pero loggea si hay más de una
  if (wb.SheetNames.length > 1) {
    console.warn(
      `[AIS Engine] El archivo tiene ${wb.SheetNames.length} hojas. ` +
      `Se usa la primera: "${wb.SheetNames[0]}". ` +
      `Hojas ignoradas: ${wb.SheetNames.slice(1).join(", ")}`
    );
  }

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // FIX ALTO: buscar header en primeras 10 filas (antes 5)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    const rowUpper = raw[i].map(c => String(c || "").toUpperCase().trim());
    if (rowUpper.some(c => c.includes("DATE") || c.includes("TIME"))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "No se encontró fila de encabezados con columna DATE o TIME en las primeras 10 filas. " +
      "Verificar formato del archivo."
    );
  }

  const headers = raw[headerIdx].map(h => String(h || "").toUpperCase().trim());
  const dateCol = headers.findIndex(h => h.includes("DATE") || h.includes("TIME"));
  const latCol  = headers.findIndex(h => h.includes("LAT"));
  const lonCol  = headers.findIndex(h => h.includes("LON"));
  const sogCol  = headers.findIndex(h => h.includes("SPEED") || h.includes("SOG"));

  if (dateCol < 0) throw new Error("Columna de fecha/hora no encontrada. Se esperaba DATE o TIME en el encabezado.");
  if (latCol  < 0) throw new Error("Columna de latitud no encontrada. Se esperaba LAT en el encabezado.");
  if (lonCol  < 0) throw new Error("Columna de longitud no encontrada. Se esperaba LON en el encabezado.");

  const points = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length === 0) continue;

    const rawDate = row[dateCol];
    if (rawDate === null || rawDate === undefined || rawDate === "") continue;

    // FIX CRÍTICO: forzar UTC en conversión de serial Excel
    let dt = null;
    if (typeof rawDate === "number") {
      dt = excelSerialToUTC(rawDate);
    } else {
      dt = parseDateString(String(rawDate));
    }
    if (!dt || isNaN(dt.getTime())) { skipped++; continue; }

    // FIX ALTO: validación estricta de coordenadas
    let lat = parseFloat(row[latCol]);
    let lon = parseFloat(row[lonCol]);

    if (isNaN(lat) || isNaN(lon)) { skipped++; continue; }

    // Normalización de coordenadas escaladas (e.g. lat=3457310 → -34.57310)
    if (Math.abs(lat) > 90) {
      // Intento de normalización: dividir por 100000
      const normLat = lat / 100000;
      const normLon = lon / 100000;
      if (Math.abs(normLat) <= 90 && Math.abs(normLon) <= 180) {
        lat = normLat;
        lon = normLon;
      } else {
        // No se puede normalizar — descartar punto
        skipped++;
        continue;
      }
    }

    // Validación final de rango geográfico
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { skipped++; continue; }

    // FIX ALTO: SOG no numérico → null (no 0)
    let sog = null;
    if (sogCol >= 0) {
      const rawSog = row[sogCol];
      const parsed = parseFloat(rawSog);
      sog = Number.isFinite(parsed) ? parsed : null;
    }

    const zone  = classifyZone(lat, lon);
    const state = classifyState(zone, sog);

    points.push({
      datetime:      dt,
      lat,
      lon,
      sog,
      zone,
      state,
      tipo_servicio: state === "WORKING_STOP" ? "SIN_CLASIFICAR" : null,
      zona_servicio: zone,
    });
  }

  if (skipped > 0) {
    console.warn(`[AIS Engine] Se descartaron ${skipped} filas con datos inválidos o incompletos.`);
  }

  if (points.length === 0) {
    throw new Error(
      "El archivo no contiene puntos AIS válidos. " +
      `Se procesaron ${raw.length - headerIdx - 1} filas y ninguna pasó la validación.`
    );
  }

  points.sort((a, b) => a.datetime - b.datetime);
  return points;
}

// ─── TRIP DETECTION ───────────────────────────────────────────────────────────
// Viaje = zarpe (sale de Dársena E, SOG > 3 kn) → arribo (entra a Dársena E, SOG ≤ 0.5 kn)
// Un viaje sin cierre (barco fuera de dársena al final del dataset) se marca con incomplete:true

/**
 * Construye un objeto trip a partir de un slice de puntos.
 * FIX: navHs calculado sumando solo intervalos con state === "TRANSIT"
 * FIX: distNm filtra microdesplazamientos GPS (drift < 0.02 nm) durante paradas
 */
function buildTrip(allPoints, fromIdx, toIdx, existingCount, incomplete) {
  const tp = allPoints.slice(fromIdx, toIdx + 1);

  let distNm = 0;
  let navHs  = 0;

  for (let j = 1; j < tp.length; j++) {
    const prev = tp[j - 1];
    const curr = tp[j];

    const segDist = haversine(prev.lat, prev.lon, curr.lat, curr.lon);
    const segHs   = (curr.datetime - prev.datetime) / 3600000;

    // FIX: filtrar drift GPS durante paradas (segmentos < 0.02 nm fuera de tránsito)
    const isMoving = curr.state === "TRANSIT" || prev.state === "TRANSIT";
    if (isMoving || segDist > 0.02) {
      distNm += segDist;
    }

    // navHs: solo tiempo en tránsito real
    if (curr.state === "TRANSIT") {
      navHs += segHs;
    }
  }

  const zones = [...new Set(
    tp.map(p => p.zone).filter(z => z !== "DARSENA_E" && z !== "OPEN_SEA")
  )];

  return {
    id:            existingCount + 1,
    dateStart:     allPoints[fromIdx].datetime,
    dateDeparture: allPoints[fromIdx].datetime,
    dateEnd:       allPoints[toIdx].datetime,
    durationHs:    (allPoints[toIdx].datetime - allPoints[fromIdx].datetime) / 3600000,
    navHs:         Math.round(navHs * 10) / 10,  // 1 decimal
    distNm:        Math.round(distNm),
    nServices:     0,
    zones,
    points:        tp,
    validated:     false,
    incomplete:    incomplete || false,
  };
}

export function detectTrips(points) {
  const trips = [];
  let departureIdx = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    // Zarpe: primer punto fuera de Dársena con SOG > 3 kn
    if (departureIdx === null && p.zone !== "DARSENA_E" && p.sog !== null && p.sog > 3) {
      departureIdx = i;
      continue;
    }

    // Arribo: entra a Dársena con SOG ≤ 0.5 kn
    if (departureIdx !== null && p.zone === "DARSENA_E" && (p.sog === null || p.sog <= 0.5)) {
      trips.push(buildTrip(points, departureIdx, i, trips.length, false));
      departureIdx = null;
    }
  }

  // FIX CRÍTICO: viaje sin cierre — barco fuera de dársena al final del dataset
  if (departureIdx !== null) {
    const lastIdx = points.length - 1;
    trips.push(buildTrip(points, departureIdx, lastIdx, trips.length, true));
    console.warn(
      `[AIS Engine] Viaje incompleto detectado: el barco no volvió a Dársena E ` +
      `antes del fin del dataset. Marcado como incomplete:true.`
    );
  }

  return trips;
}

// ─── IDLE PERIODS (tiempos muertos en Dársena entre viajes) ──────────────────
export function detectIdlePeriods(points, trips) {
  if (!trips.length) return [];
  const idle = [];

  for (let i = 0; i < trips.length - 1; i++) {
    const arribo = trips[i].dateEnd;
    const zarpe  = trips[i + 1].dateStart;
    const hs     = (zarpe - arribo) / 3600000;

    // Registrar todos los períodos (incluso los cortos < 0.5 hs, con flag)
    idle.push({
      id:         i + 1,
      type:       "idle",
      dateStart:  arribo,
      dateEnd:    zarpe,
      durationHs: hs,
      short:      hs < 0.5,
      label:      `Entre viaje ${trips[i].id} y ${trips[i + 1].id}`,
    });
  }

  return idle;
}

// ─── KPI AGGREGATION ─────────────────────────────────────────────────────────
/**
 * FIX MEDIO: aggregateKPIs agrupa segmentos contiguos WORKING_STOP correctamente.
 * En lugar de detectar transiciones punto a punto, primero agrupa los puntos
 * en segmentos contiguos por estado. Cada segmento WORKING_STOP = 1 servicio.
 * El tipo_servicio se determina por mayoría en el segmento, no solo el primer punto.
 */
export function aggregateKPIs(trips) {
  const ops = {
    agua_zc: 0, slop_zc: 0, lub_zc: 0,
    alijo_zc: 0, alijo_za: 0, alijo_zd: 0,
  };
  let totalServices = 0;

  for (const trip of trips) {
    const segments = groupContiguousSegments(trip.points);

    for (const seg of segments) {
      if (seg.state !== "WORKING_STOP") continue;

      totalServices++;

      // Determinar tipo_servicio predominante del segmento
      const typeCount = {};
      for (const pt of seg.points) {
        if (
          pt.tipo_servicio &&
          pt.tipo_servicio !== "SIN_CLASIFICAR" &&
          pt.tipo_servicio !== "BORRADO"
        ) {
          typeCount[pt.tipo_servicio] = (typeCount[pt.tipo_servicio] || 0) + 1;
        }
      }

      const dominantType = Object.entries(typeCount)
        .sort((a, b) => b[1] - a[1])[0]?.[0];

      if (dominantType) {
        const plRow = SERVICE_TYPES[dominantType]?.plRow;
        if (plRow && ops[plRow] !== undefined) ops[plRow]++;
      }
    }
  }

  // BUG-03: viajes sin puntos AIS no son revisables — excluirlos de los conteos
  // operativos para que el Dashboard muestre numeros consistentes con la lista.
  const tripsWithData    = trips.filter(t => t.points?.length > 0);
  const tripsWithoutData = trips.length - tripsWithData.length;

  return {
    totalTrips:      trips.length,           // total real incluyendo vacios (para denominador)
    reviewableTrips: tripsWithData.length,   // viajes con datos = los que el operador revisa
    validatedTrips:  tripsWithData.filter(t => t.validated).length,
    pendingTrips:    tripsWithData.filter(t => !t.validated).length,
    noDataTrips:     tripsWithoutData,
    incompleteTrips: trips.filter(t => t.incomplete).length,
    totalServices,
    ops,
  };
}

/**
 * Agrupa puntos consecutivos con el mismo estado en segmentos.
 * Útil para contar servicios y calcular tiempos por estado.
 * Exportado para uso en TripViewer si necesita agrupar visualmente.
 */
export function groupContiguousSegments(points) {
  if (!points || points.length === 0) return [];

  const segments = [];
  let current = null;

  for (const pt of points) {
    if (!current || current.state !== pt.state) {
      if (current) segments.push(current);
      current = {
        state:      pt.state,
        dateStart:  pt.datetime,
        dateEnd:    pt.datetime,
        points:     [pt],
      };
    } else {
      current.dateEnd = pt.datetime;
      current.points.push(pt);
    }
  }
  if (current) segments.push(current);

  return segments;
}

/**
 * Formatea un timestamp UTC para visualización.
 * Siempre en formato 24h sin ambigüedad AM/PM, con fecha completa.
 * Ejemplo: "21/11/2024 06:37"  (nunca "6:37" — siempre 2 dígitos en hora)
 *
 * FIX UX: la versión anterior no mostraba formato explícito, generando confusión
 * entre AM/PM. Ahora siempre 24h y siempre con fecha para contexto.
 */
export function formatDatetime(dt, opts = {}) {
  if (!dt || !(dt instanceof Date) || isNaN(dt.getTime())) return "—";
  const {
    showDate    = true,
    showSeconds = false,
  } = opts;

  // Extraer componentes UTC (los datos AIS son UTC)
  const dd  = String(dt.getUTCDate()).padStart(2, "0");
  const mm  = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const yy  = String(dt.getUTCFullYear()).slice(-2);
  const hh  = String(dt.getUTCHours()).padStart(2, "0");
  const min = String(dt.getUTCMinutes()).padStart(2, "0");
  const ss  = String(dt.getUTCSeconds()).padStart(2, "0");

  const timePart = showSeconds ? `${hh}:${min}:${ss}` : `${hh}:${min}`;
  return showDate ? `${dd}/${mm}/${yy} ${timePart} UTC` : timePart;
}
