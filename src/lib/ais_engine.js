import * as XLSX from "xlsx";

// ─── GEOFENCES ────────────────────────────────────────────────────────────────
export const ZONES = {
  DARSENA_E:  { label: "Dársena E",  color: "#1a3a6c", polygon: [[-34.57310,-58.38449],[-34.57103,-58.38054],[-34.57393,-58.37554],[-34.57567,-58.37996]] },
  ZONA_COMUN: { label: "Zona Común", color: "#E91E63", polygon: [[-34.7086,-57.8866],[-34.7715,-57.9213],[-34.8200,-57.7610],[-34.7450,-57.7407]] },
  KM171:      { label: "KM 171",     color: "#FF5722", polygon: [[-33.8745,-58.8784],[-33.9321,-58.7400],[-33.9837,-58.7997],[-33.9067,-58.9151]] },
  UPRIVER:    { label: "Upriver",    color: "#00BCD4", polygon: [[-33.4069,-59.8336],[-33.6624,-60.1950],[-32.4096,-61.0937],[-32.4176,-60.3570]] },
  RECALADA:   { label: "Recalada",   color: "#9C27B0", polygon: [[-35.0793,-55.7757],[-35.0486,-55.1312],[-35.3035,-55.1416],[-35.2767,-55.8117]] },
};

export const OPERATIONAL_ZONES = ["ZONA_COMUN", "KM171", "UPRIVER", "RECALADA"];

export const STATES = {
  IN_PORT:       { label: "En Puerto",       color: "#1a3a6c" },
  TRANSIT:       { label: "Navegando",        color: "#64B5F6" },
  WORKING_STOP:  { label: "Servicio",         color: "#66BB6A" },
  MICRO_TRANSIT: { label: "Micro-tránsito",   color: "#FFA726" },
  IDLE_OUTSIDE:  { label: "Fondeo / Espera",  color: "#78909C" },
};

export const SERVICE_TYPES = {
  AGUA:           { label: "Transporte de Agua",     color: "#2196F3", plRow: "agua_zc"  },
  SLOP:           { label: "Transporte de Slop",     color: "#FF9800", plRow: "slop_zc"  },
  LUBRICANTES:    { label: "Transporte Lubricantes", color: "#4CAF50", plRow: "lub_zc"   },
  ALIJO_ZC:       { label: "Alijo — Zona Común",     color: "#9C27B0", plRow: "alijo_zc" },
  ALIJO_ZA:       { label: "Alijo — Zona Alfa",      color: "#673AB7", plRow: "alijo_za" },
  ALIJO_ZD:       { label: "Alijo — Zona Delta",     color: "#3F51B5", plRow: "alijo_zd" },
  BORRADO:        { label: "No es servicio",          color: "#EF5350", plRow: null       },
  SIN_CLASIFICAR: { label: "Sin clasificar",          color: "#9E9E9E", plRow: null       },
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
function pointInPolygon(lat, lon, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i], [yj, xj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function classifyZone(lat, lon) {
  for (const [name, zone] of Object.entries(ZONES)) {
    if (pointInPolygon(lat, lon, zone.polygon)) return name;
  }
  return "OPEN_SEA";
}

export function classifyState(zone, sog) {
  if (zone === "DARSENA_E" && sog <= 0.5)                                      return "IN_PORT";
  if (OPERATIONAL_ZONES.includes(zone) && sog <= 1.5)                         return "WORKING_STOP";
  if (OPERATIONAL_ZONES.includes(zone) && sog > 1.5)                          return "MICRO_TRANSIT";
  if (zone !== "DARSENA_E" && !OPERATIONAL_ZONES.includes(zone) && sog > 3)   return "TRANSIT";
  return "IDLE_OUTSIDE";
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 0.539957;
}

// ─── PARSER ───────────────────────────────────────────────────────────────────
export function parseAISExcel(buffer) {
  const wb  = XLSX.read(buffer, { type: "array" });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // Find header row
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, raw.length); i++) {
    if (raw[i].map(c => String(c || "").toUpperCase()).some(c => c.includes("DATE") || c.includes("TIME"))) {
      headerIdx = i; break;
    }
  }

  const headers = raw[headerIdx].map(h => String(h || "").toUpperCase().trim());
  const dateCol = headers.findIndex(h => h.includes("DATE") || h.includes("TIME"));
  const latCol  = headers.findIndex(h => h.includes("LAT"));
  const lonCol  = headers.findIndex(h => h.includes("LON"));
  const sogCol  = headers.findIndex(h => h.includes("SPEED") || h.includes("SOG"));

  if (dateCol < 0 || latCol < 0 || lonCol < 0) throw new Error("No se encontraron columnas DATE, LAT, LON en el archivo.");

  const points = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row[dateCol]) continue;

    let dt;
    const rawDate = row[dateCol];
    dt = typeof rawDate === "number"
      ? new Date(Math.round((rawDate - 25569) * 86400000))
      : new Date(rawDate);
    if (isNaN(dt.getTime())) continue;

    let lat = parseFloat(row[latCol]), lon = parseFloat(row[lonCol]);
    if (isNaN(lat) || isNaN(lon)) continue;
    if (Math.abs(lat) > 10000) { lat /= 100000; lon /= 100000; }

    const sog   = sogCol >= 0 ? (parseFloat(row[sogCol]) || 0) : 0;
    const zone  = classifyZone(lat, lon);
    const state = classifyState(zone, sog);

    points.push({
      datetime: dt, lat, lon, sog, zone, state,
      tipo_servicio: state === "WORKING_STOP" ? "SIN_CLASIFICAR" : null,
      zona_servicio: zone,
    });
  }

  points.sort((a, b) => a.datetime - b.datetime);
  return points;
}

// ─── TRIP DETECTION ───────────────────────────────────────────────────────────
// Viaje = zarpe (sale de Darsena, SOG>3) → arribo (entra a Darsena, SOG≤0.5)
// Tiempo muerto = todo lo que ocurre dentro de Darsena entre viajes
export function detectTrips(points) {
  const trips = [];
  let departureIdx = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    // Zarpe: primer punto fuera de Darsena con SOG > 3
    if (departureIdx === null && p.zone !== "DARSENA_E" && p.sog > 3) {
      departureIdx = i;
      continue;
    }

    // Arribo: vuelve a Darsena con SOG <= 0.5
    if (departureIdx !== null && p.zone === "DARSENA_E" && p.sog <= 0.5) {
      const tp = points.slice(departureIdx, i + 1);

      let nServices = 0, prev = null;
      for (const pt of tp) {
        if (pt.state === "WORKING_STOP" && prev !== "WORKING_STOP" && pt.tipo_servicio !== "BORRADO") nServices++;
        prev = pt.state;
      }

      let distNm = 0;
      for (let j = 1; j < tp.length; j++) distNm += haversine(tp[j-1].lat, tp[j-1].lon, tp[j].lat, tp[j].lon);

      const zones = [...new Set(tp.map(p => p.zone).filter(z => z !== "DARSENA_E" && z !== "OPEN_SEA"))];

      trips.push({
        id:            trips.length + 1,
        dateStart:     points[departureIdx].datetime,
        dateDeparture: points[departureIdx].datetime,
        dateEnd:       points[i].datetime,
        durationHs:    (points[i].datetime - points[departureIdx].datetime) / 3600000,
        navHs:         (points[i].datetime - points[departureIdx].datetime) / 3600000,
        distNm:        Math.round(distNm),
        nServices,
        zones,
        points:        tp,
        validated:     false,
      });

      departureIdx = null;
    }
  }
  return trips;
}

// ─── IDLE PERIODS (tiempos muertos en Darsena entre viajes) ──────────────────
export function detectIdlePeriods(points, trips) {
  if (!trips.length) return [];
  const idle = [];

  for (let i = 0; i < trips.length - 1; i++) {
    const arribo = trips[i].dateEnd;
    const zarpe  = trips[i+1].dateStart;
    const hs = (zarpe - arribo) / 3600000;
    if (hs > 0.5) {
      idle.push({
        id: i + 1,
        type: "idle",
        dateStart:  arribo,
        dateEnd:    zarpe,
        durationHs: hs,
        label: `Entre viaje ${trips[i].id} y ${trips[i+1].id}`,
      });
    }
  }

  return idle;
}

// ─── KPI AGGREGATION ─────────────────────────────────────────────────────────
export function aggregateKPIs(trips) {
  const ops = { agua_zc: 0, slop_zc: 0, lub_zc: 0, alijo_zc: 0, alijo_za: 0, alijo_zd: 0 };
  let totalServices = 0;

  for (const trip of trips) {
    let prevState = null;
    for (const pt of trip.points) {
      if (pt.state === "WORKING_STOP" && prevState !== "WORKING_STOP") {
        totalServices++;
        if (pt.tipo_servicio && pt.tipo_servicio !== "SIN_CLASIFICAR" && pt.tipo_servicio !== "BORRADO") {
          const plRow = SERVICE_TYPES[pt.tipo_servicio]?.plRow;
          if (plRow && ops[plRow] !== undefined) ops[plRow]++;
        }
      }
      prevState = pt.state;
    }
  }

  return {
    totalTrips:     trips.length,
    validatedTrips: trips.filter(t => t.validated).length,
    pendingTrips:   trips.filter(t => !t.validated).length,
    totalServices,
    ops,
  };
}
