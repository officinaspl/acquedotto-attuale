/**
 * Dashboard Vasca — server Node per Raspberry Pi
 * Espone:
 *   GET /              → HTML statico (public/)
 *   GET /api/data?days=4h|6h|8h|1|7|30 → JSON (logica come Code.gs)
 */
require("dotenv").config();
const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT || 3000);
const DASHBOARD_CHANNEL_ID = process.env.DASHBOARD_CHANNEL_ID || "234684";
const DASHBOARD_READ_API_KEY = process.env.DASHBOARD_READ_API_KEY || "";
const TEMP_CHANNEL_ID = process.env.TEMP_CHANNEL_ID || "343440";
const TEMP_READ_API_KEY = process.env.TEMP_READ_API_KEY || "";
const TEMP_FIELD_NUMBER = Number(process.env.TEMP_FIELD_NUMBER || 1);
const MAX_HISTORY_RESULTS = 8000;
const MAX_DASHBOARD_POINTS = 2000;
const HISTORY_CHUNK_DAYS = 4;

const app = express();

function parsePeriodParameter(raw) {
  if (raw === null || raw === undefined || raw === "") return 1;
  const s = String(raw).toLowerCase();
  if (s.indexOf("h") >= 0) {
    let hours = parseInt(s, 10);
    if (isNaN(hours) || hours < 1) hours = 4;
    if (hours > 24) hours = 24;
    return hours / 24;
  }
  let n = parseFloat(s);
  if (isNaN(n) || n <= 0) return 1;
  if (n > 30) return 30;
  return n;
}

function periodLabelFromDays(daySpan) {
  const hours = Math.round(daySpan * 24);
  if (Math.abs(daySpan - 4 / 24) < 0.001) return "4h";
  if (Math.abs(daySpan - 6 / 24) < 0.001) return "6h";
  if (Math.abs(daySpan - 8 / 24) < 0.001) return "8h";
  if (daySpan === 1) return "1";
  if (daySpan === 7) return "7";
  if (daySpan === 30) return "30";
  if (hours < 24) return hours + "h";
  return String(daySpan);
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function decodeDiag(code) {
  switch (code) {
    case 100: return "Sistema appena riavviato";
    case 200: return "Invio dati OK";
    case 410: return "Errore WiFi";
    case 420: return "Errore sensore";
    case 430: return "Errore ThingSpeak";
    case 440: return "Errore NTP";
    default: return "Codice non disponibile";
  }
}

function formatThingSpeakDate(d) {
  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }
  return d.getUTCFullYear() + "-" +
    pad(d.getUTCMonth() + 1) + "-" +
    pad(d.getUTCDate()) + " " +
    pad(d.getUTCHours()) + ":" +
    pad(d.getUTCMinutes()) + ":" +
    pad(d.getUTCSeconds());
}

function buildRawHistoryUrl(channelId, apiKey, startDate, endDate) {
  return "https://api.thingspeak.com/channels/" +
    channelId +
    "/feeds.json?api_key=" +
    apiKey +
    "&start=" + encodeURIComponent(formatThingSpeakDate(startDate)) +
    "&end=" + encodeURIComponent(formatThingSpeakDate(endDate)) +
    "&results=" + MAX_HISTORY_RESULTS;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error("ThingSpeak HTTP " + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchHistoryChunk(channelId, apiKey, fieldNumber, valueKey, startDate, endDate) {
  try {
    const json = await fetchJson(
      buildRawHistoryUrl(channelId, apiKey, startDate, endDate)
    );
    const feeds = json.feeds || [];
    const fieldName = "field" + fieldNumber;
    const out = [];
    for (let i = 0; i < feeds.length; i++) {
      const f = feeds[i];
      const row = { ts: f.created_at || "" };
      row[valueKey] = toNumber(f[fieldName]);
      out.push(row);
    }
    return out;
  } catch (e) {
    return [];
  }
}

async function getChannelHistoryForDays(days, channelId, apiKey, fieldNumber, valueKey) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const chunkMs = HISTORY_CHUNK_DAYS * 24 * 60 * 60 * 1000;
  const all = [];
  let cursor = new Date(start.getTime());

  while (cursor.getTime() < end.getTime()) {
    const chunkEndMs = Math.min(cursor.getTime() + chunkMs, end.getTime());
    const chunkEnd = new Date(chunkEndMs);
    const part = await fetchHistoryChunk(
      channelId, apiKey, fieldNumber, valueKey, cursor, chunkEnd
    );
    for (let i = 0; i < part.length; i++) all.push(part[i]);
    cursor = chunkEnd;
  }

  return downsampleHistory(all, MAX_DASHBOARD_POINTS);
}

function mergeLevelAndTempHistory(levelHistory, tempHistory) {
  if (!levelHistory || !levelHistory.length) return [];
  if (!tempHistory || !tempHistory.length) {
    for (let i = 0; i < levelHistory.length; i++) {
      levelHistory[i].temperaturaAcqua = null;
    }
    return levelHistory;
  }

  const tempMs = [];
  for (let t = 0; t < tempHistory.length; t++) {
    tempMs.push(new Date(tempHistory[t].ts).getTime());
  }

  let j = 0;
  for (let i = 0; i < levelHistory.length; i++) {
    const ms = new Date(levelHistory[i].ts).getTime();
    if (isNaN(ms)) {
      levelHistory[i].temperaturaAcqua = null;
      continue;
    }
    while (j < tempMs.length - 1 && Math.abs(tempMs[j + 1] - ms) <= Math.abs(tempMs[j] - ms)) {
      j++;
    }
    let best = j;
    if (j > 0 && Math.abs(tempMs[j - 1] - ms) < Math.abs(tempMs[j] - ms)) {
      best = j - 1;
    }
    if (Math.abs(tempMs[best] - ms) <= 10 * 60 * 1000) {
      levelHistory[i].temperaturaAcqua = tempHistory[best].temperaturaAcqua;
    } else {
      levelHistory[i].temperaturaAcqua = null;
    }
  }
  return levelHistory;
}

function downsampleHistory(history, maxPoints) {
  if (!history || !history.length) return [];
  if (history.length <= maxPoints) return history;

  const out = [];
  const lastIdx = history.length - 1;
  const step = lastIdx / (maxPoints - 1);
  let prev = -1;

  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    if (idx === prev) continue;
    out.push(history[idx]);
    prev = idx;
  }
  if (prev !== lastIdx) out.push(history[lastIdx]);
  return out;
}

async function getTempLast() {
  try {
    const url =
      "https://api.thingspeak.com/channels/" +
      TEMP_CHANNEL_ID +
      "/fields/" +
      TEMP_FIELD_NUMBER +
      "/last.json?api_key=" +
      TEMP_READ_API_KEY;
    const j = await fetchJson(url);
    return {
      temperaturaAcqua: toNumber(j["field" + TEMP_FIELD_NUMBER]),
      ts: j.created_at || ""
    };
  } catch (e) {
    return { temperaturaAcqua: null, ts: "" };
  }
}

async function getLatestDashboardData(days) {
  let daySpan = days;
  if (daySpan === undefined || daySpan === null) daySpan = 1;

  if (!DASHBOARD_READ_API_KEY || DASHBOARD_READ_API_KEY.indexOf("INSERISCI") >= 0) {
    return { ok: false, error: "Configura DASHBOARD_READ_API_KEY in .env" };
  }

  const lastUrl =
    "https://api.thingspeak.com/channels/" +
    DASHBOARD_CHANNEL_ID +
    "/feeds/last.json?api_key=" +
    DASHBOARD_READ_API_KEY;

  let last;
  try {
    last = await fetchJson(lastUrl);
  } catch (e) {
    return { ok: false, error: e.message || "ThingSpeak last feed fallito" };
  }

  const levelHistory = await getChannelHistoryForDays(
    daySpan,
    DASHBOARD_CHANNEL_ID,
    DASHBOARD_READ_API_KEY,
    1,
    "livello"
  );
  const tempHistory = await getChannelHistoryForDays(
    daySpan,
    TEMP_CHANNEL_ID,
    TEMP_READ_API_KEY,
    TEMP_FIELD_NUMBER,
    "temperaturaAcqua"
  );
  const history = mergeLevelAndTempHistory(levelHistory, tempHistory);
  const tempLast = await getTempLast();

  const livello = toNumber(last.field1);
  const temperaturaAcqua = tempLast.temperaturaAcqua;
  const diag = toInt(last.field6);
  const lastSampleAt = history.length
    ? (history[history.length - 1].ts || "")
    : (last.created_at || "");

  return {
    ok: true,
    livello: livello,
    temperaturaAcqua: temperaturaAcqua,
    diagnostica: diag,
    diagnosticaTxt: decodeDiag(diag),
    createdAt: last.created_at || "",
    lastSampleAt: lastSampleAt,
    historyDays: periodLabelFromDays(daySpan),
    history: history
  };
}

app.get("/api/data", async (req, res) => {
  try {
    const days = parsePeriodParameter(req.query.days);
    const data = await getLatestDashboardData(days);
    res.set("Cache-Control", "no-store");
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "vasca-dashboard" });
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, "0.0.0.0", () => {
  console.log("Vasca dashboard su http://0.0.0.0:" + PORT);
});
