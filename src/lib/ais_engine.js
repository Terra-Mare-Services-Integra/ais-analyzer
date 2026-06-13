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
 * aggregateKPIs — usa el vocabulario actual del TripViewer (clasificación manual).
 *
 * El parser automático asignaba state="WORKING_STOP" a puntos en zona operativa.
 * El sistema de clasificación manual usa en cambio:
 *   - servicio_num (1, 2, 3...) para identificar a qué servicio pertenece cada punto
 *   - tipo_servicio ("AGUA", "SLOP", etc.) para el tipo
 *   - state = null en puntos de cluster
 *
 * La versión anterior agrupaba por state === "WORKING_STOP" → nunca encontraba
 * clusters manuales → totalServices y ops siempre daban 0.
 *
 * Fix: agrupar por servicio_num dentro de cada viaje validado.
 * Cada servicio_num distinto = 1 servicio. Solo viajes con validated=true.
 * tipo_servicio se determina por mayoría entre todos los puntos del grupo.
 */
export function aggregateKPIs(trips) {
  const ops = {
    agua_zc: 0, slop_zc: 0, lub_zc: 0,
    alijo_zc: 0, alijo_za: 0, alijo_zd: 0,
  };
  let totalServices = 0;

  for (const trip of trips) {
    if (!trip.validated) continue;
    if (!trip.points?.length) continue;

    // Agrupar puntos por servicio_num — cada número único es un servicio
    const byServiceNum = {};
    for (const pt of trip.points) {
      if (pt.servicio_num == null) continue;
      if (!byServiceNum[pt.servicio_num]) byServiceNum[pt.servicio_num] = [];
      byServiceNum[pt.servicio_num].push(pt);
    }

    for (const pts of Object.values(byServiceNum)) {
      totalServices++;

      // tipo_servicio por mayoría — ignorar SIN_CLASIFICAR y BORRADO
      const typeCount = {};
      for (const pt of pts) {
        const t = pt.tipo_servicio;
        if (t && t !== "SIN_CLASIFICAR" && t !== "BORRADO") {
          typeCount[t] = (typeCount[t] || 0) + 1;
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

  // ── Conteo por modelo (solo viajes validados) ───────────────────────────────
  // Corremos los 3 modelos de detección sobre cada viaje validado para mostrar
  // en el Dashboard cuántos servicios detecta cada algoritmo vs el consenso.
  const emptyOps = () => ({ agua_zc:0, slop_zc:0, lub_zc:0, alijo_zc:0, alijo_za:0, alijo_zd:0 });
  const opsA = emptyOps(), opsB = emptyOps(), opsC = emptyOps(), opsCons = emptyOps();
  let totalA = 0, totalB = 0, totalC = 0, totalCons = 0;

  // Helper: dado un resultado de modelo (Array<{origIdx, servicio_num}>) y los
  // puntos del viaje, cuenta servicios y suma tipos al objeto ops destino.
  const accumulateModel = (modelResult, tripPoints, opsTarget, totalRef) => {
    // Agrupar origIdx por servicio_num
    const byNum = {};
    for (const { origIdx, servicio_num } of modelResult) {
      if (!byNum[servicio_num]) byNum[servicio_num] = [];
      byNum[servicio_num].push(tripPoints[origIdx]);
    }
    for (const pts of Object.values(byNum)) {
      totalRef.count++;
      const typeCount = {};
      for (const pt of pts) {
        const t = pt?.tipo_servicio;
        if (t && t !== "SIN_CLASIFICAR" && t !== "BORRADO") typeCount[t] = (typeCount[t]||0)+1;
      }
      const dominant = Object.entries(typeCount).sort((a,b)=>b[1]-a[1])[0]?.[0];
      if (dominant) { const plRow = SERVICE_TYPES[dominant]?.plRow; if (plRow && opsTarget[plRow] !== undefined) opsTarget[plRow]++; }
    }
  };

  // Helper para consenso: usa consensusMap
  const accumulateConsensus = (consensusMap, tripPoints, opsTarget, totalRef) => {
    const byNum = {};
    consensusMap.forEach(({ servicio_num }, origIdx) => {
      if (!byNum[servicio_num]) byNum[servicio_num] = [];
      byNum[servicio_num].push(tripPoints[origIdx]);
    });
    for (const pts of Object.values(byNum)) {
      totalRef.count++;
      const typeCount = {};
      for (const pt of pts) {
        const t = pt?.tipo_servicio;
        if (t && t !== "SIN_CLASIFICAR" && t !== "BORRADO") typeCount[t] = (typeCount[t]||0)+1;
      }
      const dominant = Object.entries(typeCount).sort((a,b)=>b[1]-a[1])[0]?.[0];
      if (dominant) { const plRow = SERVICE_TYPES[dominant]?.plRow; if (plRow && opsTarget[plRow] !== undefined) opsTarget[plRow]++; }
    }
  };

  const refA = {count:0}, refB = {count:0}, refC = {count:0}, refCons = {count:0};
  for (const trip of trips) {
    if (!trip.validated || !trip.points?.length) continue;
    const resA = runModelA(trip.points);
    const resB = runModelB(trip.points);
    const resC = runModelC(trip.points);
    const cMap = buildConsensus(trip.points, resA, resB, resC);
    accumulateModel(resA, trip.points, opsA, refA);
    accumulateModel(resB, trip.points, opsB, refB);
    accumulateModel(resC, trip.points, opsC, refC);
    accumulateConsensus(cMap, trip.points, opsCons, refCons);
  }
  totalA = refA.count; totalB = refB.count; totalC = refC.count; totalCons = refCons.count;

  // BUG-03: viajes sin puntos AIS no son revisables — excluirlos de los conteos
  // operativos para que el Dashboard muestre numeros consistentes con la lista.
  const tripsWithData    = trips.filter(t => t.points?.length > 0);
  const tripsWithoutData = trips.length - tripsWithData.length;

  return {
    totalTrips:      trips.length,
    reviewableTrips: tripsWithData.length,
    validatedTrips:  tripsWithData.filter(t => t.validated).length,
    pendingTrips:    tripsWithData.filter(t => !t.validated).length,
    noDataTrips:     tripsWithoutData,
    incompleteTrips: trips.filter(t => t.incomplete).length,
    totalServices,
    ops,
    // Breakdown por modelo (solo viajes validados, usando tipo_servicio existente)
    models: {
      A:    { label: "Conservador", total: totalA,    ops: opsA    },
      B:    { label: "Literal",     total: totalB,    ops: opsB    },
      C:    { label: "Geoespacial", total: totalC,    ops: opsC    },
      cons: { label: "Consenso",    total: totalCons, ops: opsCons },
    },
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MULTI-MODEL DETECTION ENGINE ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Exportado desde ais_engine para ser usado tanto en TripViewer (modal de
// consenso) como en aggregateKPIs (Dashboard con breakdown por modelo).
//
// Cada modelo recibe el array de puntos de UN viaje y devuelve:
//   Array<{ origIdx: number, servicio_num: number }>
// Solo cubre puntos de ZONA_COMUN; los puntos de navegación los maneja el caller.

const _centroidOf = items => {
  const valid = items.filter(({ p }) => p.lat != null && p.lon != null);
  if (!valid.length) return null;
  return {
    lat: valid.reduce((s, { p }) => s + p.lat, 0) / valid.length,
    lon: valid.reduce((s, { p }) => s + p.lon, 0) / valid.length,
  };
};

// ─── MODELO A — "Conservador v2" ─────────────────────────────────────────────
// Regla 1: clusters de punto único → Tránsito (no son evidencia de estadía real)
// Regla 2: dos clusters consecutivos se fusionan SOLO si se cumplen AMBAS:
//   - distancia entre último punto del C1 y primer punto del C2 < MERGE_DIST_M metros
//   - gap temporal entre esos mismos puntos < MERGE_GAP_HS horas
// Parámetros configurables — valores por defecto consensuados con el equipo:
const MODEL_A_MERGE_DIST_M  = 500;   // metros
const MODEL_A_MERGE_GAP_HS  = 2;     // horas

function runModelA(points) {
  const zcPts = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.zone === "ZONA_COMUN");

  if (!zcPts.length) return [];

  // ── Paso 1: detección base (SOG < 4 kn en ZC) ────────────────────────────
  // Igual que Modelo B: cada grupo contiguo de puntos lentos es un cluster
  // candidato. El gap > 90 min o dist > 0.5nm rompe el grupo.
  const candidatos = zcPts.filter(({ p }) => p.sog != null && p.sog < 4);

  const rawGroups = []; // Array<Array<{p,i}>>
  let cur = null;
  for (const item of candidatos) {
    if (!cur) { cur = [item]; continue; }
    const last   = cur[cur.length - 1];
    const gapMin = (new Date(item.p.datetime) - new Date(last.p.datetime)) / 60000;
    const ctr    = _centroidOf(cur);
    const distNm = (ctr && item.p.lat != null && item.p.lon != null)
      ? haversine(ctr.lat, ctr.lon, item.p.lat, item.p.lon) : 0;
    if (gapMin > 90 || distNm > 0.5) { rawGroups.push(cur); cur = [item]; }
    else { cur.push(item); }
  }
  if (cur) rawGroups.push(cur);

  // ── Paso 2 — Regla 1: descartar clusters de punto único ──────────────────
  // Un único punto no es evidencia suficiente de estadía operativa.
  let groups = rawGroups.filter(grp => grp.length > 1);

  if (!groups.length) return [];

  // ── Paso 3 — Regla 2: fusión por proximidad + gap (ambas condiciones) ────
  // Recorremos pares consecutivos. Si el último punto del grupo A y el primer
  // punto del grupo B están a < MERGE_DIST_M metros Y < MERGE_GAP_HS horas,
  // se fusionan. Iteramos hasta que no haya más fusiones posibles.
  const MERGE_DIST_NM = MODEL_A_MERGE_DIST_M / 1852;
  const MERGE_GAP_MS  = MODEL_A_MERGE_GAP_HS * 3600 * 1000;

  let merged = true;
  while (merged) {
    merged = false;
    const next = [];
    let i = 0;
    while (i < groups.length) {
      if (i === groups.length - 1) { next.push(groups[i]); i++; continue; }

      const g1 = groups[i];
      const g2 = groups[i + 1];
      const lastPt  = g1[g1.length - 1]; // último punto de g1
      const firstPt = g2[0];             // primer punto de g2

      const gapMs = new Date(firstPt.p.datetime) - new Date(lastPt.p.datetime);
      const distNm = (lastPt.p.lat != null && lastPt.p.lon != null &&
                      firstPt.p.lat != null && firstPt.p.lon != null)
        ? haversine(lastPt.p.lat, lastPt.p.lon, firstPt.p.lat, firstPt.p.lon)
        : Infinity;

      const gapOk  = gapMs  < MERGE_GAP_MS;
      const distOk = distNm < MERGE_DIST_NM;

      if (gapOk && distOk) {
        // Fusionar: combinar los dos grupos en uno
        next.push([...g1, ...g2]);
        merged = true;
        i += 2; // saltar ambos grupos
      } else {
        next.push(g1);
        i++;
      }
    }
    groups = next;
  }

  // ── Paso 4: expandir grupos — incluir todos los puntos ZC en el rango ────
  // (igual que los otros modelos: puntos intermedios entre candidatos)
  const result = [];
  groups.forEach((grp, gi) => {
    const minIdx = Math.min(...grp.map(({ i }) => i));
    const maxIdx = Math.max(...grp.map(({ i }) => i));
    zcPts
      .filter(({ i }) => i >= minIdx && i <= maxIdx)
      .forEach(({ i }) => result.push({ origIdx: i, servicio_num: gi + 1 }));
  });
  return result;
}


// ─── MODELO B — "Literal" ─────────────────────────────────────────────────────
// SOG < 4 kn en ZC → candidato. Gap > 90 min O dist centroide > 0.5nm = corte.
export function runModelB(points) {
  const zcPts = points.map((p, i) => ({ p, i })).filter(({ p }) => p.zone === "ZONA_COMUN");
  if (!zcPts.length) return [];
  const MAX_GAP_MIN = 90, MAX_DIST_NM = 0.5;
  const candidatos = zcPts.filter(({ p }) => p.sog != null && p.sog < 4);
  const groups = [];
  let cur = null;
  for (const item of candidatos) {
    if (!cur) { cur = [item]; continue; }
    const gapMin = (new Date(item.p.datetime) - new Date(cur[cur.length-1].p.datetime)) / 60000;
    const ctr = _centroidOf(cur);
    const distNm = (ctr && item.p.lat != null && item.p.lon != null)
      ? haversine(ctr.lat, ctr.lon, item.p.lat, item.p.lon) : 0;
    if (gapMin > MAX_GAP_MIN || distNm > MAX_DIST_NM) { groups.push(cur); cur = [item]; }
    else { cur.push(item); }
  }
  if (cur) groups.push(cur);
  const result = [];
  groups.forEach((grp, gi) => {
    const minIdx = Math.min(...grp.map(({ i }) => i));
    const maxIdx = Math.max(...grp.map(({ i }) => i));
    zcPts.filter(({ i }) => i >= minIdx && i <= maxIdx)
      .forEach(({ i }) => result.push({ origIdx: i, servicio_num: gi + 1 }));
  });
  return result;
}

// ─── MODELO C — "Geoespacial" ─────────────────────────────────────────────────
// Ignora el tiempo. Agrupa por proximidad geográfica < 500m (single-linkage).
export function runModelC(points) {
  const MAX_DIST_NM = 500 / 1852;
  const zcPts = points.map((p, i) => ({ p, i }))
    .filter(({ p }) => p.zone === "ZONA_COMUN" && p.lat != null && p.lon != null);
  if (!zcPts.length) return [];
  const groups = [];
  for (const item of zcPts) {
    let assigned = false;
    for (const grp of groups) {
      if (grp.some(({ p }) => haversine(p.lat, p.lon, item.p.lat, item.p.lon) <= MAX_DIST_NM)) {
        grp.push(item); assigned = true; break;
      }
    }
    if (!assigned) groups.push([item]);
  }
  groups.sort((a, b) => Math.min(...a.map(x=>x.i)) - Math.min(...b.map(x=>x.i)));
  const result = [];
  groups.forEach((grp, gi) => grp.forEach(({ i }) => result.push({ origIdx: i, servicio_num: gi + 1 })));
  return result;
}

// ─── CONSENSUS ENGINE ─────────────────────────────────────────────────────────
// Devuelve consensusMap: Map<origIdx, { servicio_num, ambiguous }>
// Un par de puntos va al mismo cluster de consenso si ≥ 2 de 3 modelos los unen.
export function buildConsensus(points, resA, resB, resC) {
  const mapA = new Map(resA.map(r => [r.origIdx, r.servicio_num]));
  const mapB = new Map(resB.map(r => [r.origIdx, r.servicio_num]));
  const mapC = new Map(resC.map(r => [r.origIdx, r.servicio_num]));
  const allZcIdx = [...new Set([...resA, ...resB, ...resC].map(r => r.origIdx))].sort((a,b)=>a-b);
  if (!allZcIdx.length) return new Map();

  const parent = {};
  allZcIdx.forEach(i => { parent[i] = i; });
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };

  const groupsByModel = [mapA, mapB, mapC].map(m => {
    const byGroup = {};
    m.forEach((snum, idx) => { if (!byGroup[snum]) byGroup[snum] = []; byGroup[snum].push(idx); });
    return byGroup;
  });

  const pairCount = new Map();
  groupsByModel.forEach(byGroup => {
    Object.values(byGroup).forEach(idxList => {
      for (let a = 0; a < idxList.length; a++) {
        for (let b = a + 1; b < idxList.length; b++) {
          const key = `${Math.min(idxList[a],idxList[b])}-${Math.max(idxList[a],idxList[b])}`;
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        }
      }
    });
  });

  pairCount.forEach((count, key) => {
    if (count >= 2) { const [a, b] = key.split("-").map(Number); union(a, b); }
  });

  const consensusGroups = {};
  allZcIdx.forEach(i => { const r = find(i); if (!consensusGroups[r]) consensusGroups[r] = []; consensusGroups[r].push(i); });
  const sortedRoots = Object.keys(consensusGroups).map(Number)
    .sort((a,b) => Math.min(...consensusGroups[a]) - Math.min(...consensusGroups[b]));

  const consensusMap = new Map();
  sortedRoots.forEach((root, gi) => {
    const indices = consensusGroups[root];
    const groupPairs = [];
    for (let a = 0; a < indices.length; a++)
      for (let b = a+1; b < indices.length; b++) {
        const key = `${Math.min(indices[a],indices[b])}-${Math.max(indices[a],indices[b])}`;
        groupPairs.push(pairCount.get(key) ?? 0);
      }
    const ambiguous = groupPairs.length > 0 && groupPairs.some(c => c < 2);
    indices.forEach(i => consensusMap.set(i, { servicio_num: gi + 1, ambiguous }));
  });
  return consensusMap;
}

// ─── HELPER: contar servicios únicos en un resultado de modelo ────────────────
// Devuelve el número de servicio_num distintos (= clusters detectados).
export function countModelServices(modelResult) {
  return new Set(modelResult.map(r => r.servicio_num)).size;
}

// ─── PROJECTED AGGREGATION ────────────────────────────────────────────────────
/**
 * aggregateProjected(trips, modelKey)
 *
 * Combina datos reales de viajes validados con estimaciones automáticas de
 * viajes pendientes usando uno de los 3 modelos (o el consenso).
 *
 * modelKey: "A" | "B" | "C" | "cons"
 *
 * Retorna la misma forma que aggregateKPIs pero con dos fuentes:
 *   - validatedServices: servicios reales (de viajes validated=true)
 *   - projectedServices: servicios estimados (de viajes validated=false)
 *   - totalServices: suma de ambos
 *   - ops: suma de ambas fuentes por tipo
 *   - opsValidated: solo los reales
 *   - opsProjected: solo los estimados
 */
export function aggregateProjected(trips, modelKey) {
  const emptyOps = () => ({
    agua_zc:0, slop_zc:0, lub_zc:0, alijo_zc:0, alijo_za:0, alijo_zd:0,
  });

  const opsVal  = emptyOps();
  const opsPrj  = emptyOps();
  let   svcVal  = 0;
  let   svcPrj  = 0;

  // Helper: sumar tipo_servicio de un grupo de puntos al ops destino
  const addGroup = (pts, opsTarget) => {
    const typeCount = {};
    for (const pt of pts) {
      const t = pt?.tipo_servicio;
      if (t && t !== "SIN_CLASIFICAR" && t !== "BORRADO")
        typeCount[t] = (typeCount[t] || 0) + 1;
    }
    const dominant = Object.entries(typeCount).sort((a,b)=>b[1]-a[1])[0]?.[0];
    if (dominant) {
      const plRow = SERVICE_TYPES[dominant]?.plRow;
      if (plRow && opsTarget[plRow] !== undefined) opsTarget[plRow]++;
    }
  };

  for (const trip of trips) {
    if (!trip.points?.length) continue;

    if (trip.validated) {
      // ── Viaje validado: usar clasificación manual (servicio_num) ──────────
      const byNum = {};
      for (const pt of trip.points) {
        if (pt.servicio_num == null) continue;
        if (!byNum[pt.servicio_num]) byNum[pt.servicio_num] = [];
        byNum[pt.servicio_num].push(pt);
      }
      for (const pts of Object.values(byNum)) {
        svcVal++;
        addGroup(pts, opsVal);
      }
    } else {
      // ── Viaje pendiente: estimar con el modelo elegido ────────────────────
      let modelResult;
      if (modelKey === "A")    modelResult = runModelA(trip.points);
      else if (modelKey === "B") modelResult = runModelB(trip.points);
      else if (modelKey === "C") modelResult = runModelC(trip.points);
      else {
        // consenso
        const rA = runModelA(trip.points);
        const rB = runModelB(trip.points);
        const rC = runModelC(trip.points);
        const cMap = buildConsensus(trip.points, rA, rB, rC);
        // Convertir consensusMap a groups
        const byNum = {};
        cMap.forEach(({ servicio_num }, origIdx) => {
          if (!byNum[servicio_num]) byNum[servicio_num] = [];
          byNum[servicio_num].push(trip.points[origIdx]);
        });
        for (const pts of Object.values(byNum)) {
          svcPrj++;
          addGroup(pts, opsPrj);
        }
        continue; // ya procesado
      }

      // Para modelos A/B/C: groupear por servicio_num del resultado
      const byNum = {};
      for (const { origIdx, servicio_num } of modelResult) {
        if (!byNum[servicio_num]) byNum[servicio_num] = [];
        byNum[servicio_num].push(trip.points[origIdx]);
      }
      for (const pts of Object.values(byNum)) {
        svcPrj++;
        addGroup(pts, opsPrj);
      }
    }
  }

  // Combinar
  const ops = emptyOps();
  for (const k of Object.keys(ops)) {
    ops[k] = opsVal[k] + opsPrj[k];
  }

  return {
    validatedServices: svcVal,
    projectedServices: svcPrj,
    totalServices:     svcVal + svcPrj,
    ops,
    opsValidated: opsVal,
    opsProjected: opsPrj,
  };
}

// ─── CALIBRATION AGGREGATION ──────────────────────────────────────────────────
/**
 * aggregateCalibration(trips)
 *
 * Para cada modelo (A, B, C, consenso), calcula:
 *   - detectedAll:       servicios detectados en TODOS los viajes
 *   - detectedValidated: servicios detectados en viajes validados (por el modelo)
 *   - realValidated:     servicios reales en viajes validados (clasificación manual)
 *   - uncatalogued:      detectedAll - detectedValidated  (solo pendientes)
 *   - error:             detectedValidated - realValidated (0 = modelo perfecto)
 *   - opsValidated:      conteo por tipo de los servicios reales validados
 *
 * La lógica:
 *   uncatalogued = total detectado - lo que el modelo detecta en los ya-validados
 *   Así se puede ver: "para los viajes que YA validé, ¿cuántos detectó el modelo
 *   vs cuántos hay realmente?" — eso muestra la precisión del modelo.
 */
export function aggregateCalibration(trips) {
  const MODEL_KEYS = ["A", "B", "C", "cons"];

  // Helper: contar servicios únicos en un modelResult
  const countSvcs = (modelResult) =>
    new Set(modelResult.map(r => r.servicio_num)).size;

  // Helper: correr modelo sobre puntos
  const runModel = (key, points) => {
    if (key === "A")    return runModelA(points);
    if (key === "B")    return runModelB(points);
    if (key === "C")    return runModelC(points);
    // consenso
    const rA = runModelA(points), rB = runModelB(points), rC = runModelC(points);
    const cMap = buildConsensus(points, rA, rB, rC);
    // Convertir consensusMap a formato Array<{origIdx, servicio_num}>
    const result = [];
    cMap.forEach(({ servicio_num }, origIdx) => result.push({ origIdx, servicio_num }));
    return result;
  };

  // Conteos por modelo
  const detectedAll       = { A:0, B:0, C:0, cons:0 };
  const detectedValidated = { A:0, B:0, C:0, cons:0 };

  // Servicios reales (clasificación manual) en viajes validados
  let realValidated = 0;
  const emptyOps = () => ({ agua_zc:0, slop_zc:0, lub_zc:0, alijo_zc:0, alijo_za:0, alijo_zd:0 });
  const opsValidated = emptyOps();

  for (const trip of trips) {
    if (!trip.points?.length) continue;

    // Correr los 4 modelos sobre este viaje
    for (const key of MODEL_KEYS) {
      const res = runModel(key, trip.points);
      const n   = countSvcs(res);
      detectedAll[key] += n;
      if (trip.validated) detectedValidated[key] += n;
    }

    // Si está validado: contar servicios reales
    if (trip.validated) {
      const byNum = {};
      for (const pt of trip.points) {
        if (pt.servicio_num == null) continue;
        if (!byNum[pt.servicio_num]) byNum[pt.servicio_num] = [];
        byNum[pt.servicio_num].push(pt);
      }
      for (const pts of Object.values(byNum)) {
        realValidated++;
        // Tipo dominante
        const typeCount = {};
        for (const pt of pts) {
          const t = pt?.tipo_servicio;
          if (t && t !== "SIN_CLASIFICAR" && t !== "BORRADO")
            typeCount[t] = (typeCount[t] || 0) + 1;
        }
        const dominant = Object.entries(typeCount).sort((a,b)=>b[1]-a[1])[0]?.[0];
        if (dominant) {
          const plRow = SERVICE_TYPES[dominant]?.plRow;
          if (plRow && opsValidated[plRow] !== undefined) opsValidated[plRow]++;
        }
      }
    }
  }

  // Construir resultado por modelo
  const models = {};
  for (const key of MODEL_KEYS) {
    const uncatalogued = detectedAll[key] - detectedValidated[key];
    const error        = detectedValidated[key] - realValidated;
    models[key] = {
      detectedAll:       detectedAll[key],
      detectedValidated: detectedValidated[key],
      uncatalogued:      Math.max(0, uncatalogued), // nunca negativo
      error,                                         // + = sobreestima, - = subestima
      total:             uncatalogued + realValidated,
    };
  }

  return { models, realValidated, opsValidated };
}
