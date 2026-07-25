/*
 * Dashboard Web + API dati ThingSpeak (Google Apps Script)
 *
 * Endpoints:
 * - GET ?action=data&days=4h|6h|8h|1|7|30  -> JSON (ultimo feed + storico periodo)
 * - GET (senza action) -> Pagina HTML dashboard
 *
 * Nota HTML: in questo progetto il file locale è dashboard_vasca_principale.html.
 * In Apps Script caricalo come file HTML con nome esatto: dashboard_vasca_index
 * (HtmlService.createHtmlOutputFromFile lo richiede).
 *
 * Nota API: consumo (field4) e storico ieri (field5) non sono più esposti
 * alla dashboard. Restano livello (field1), diagnostica (field6) e temperatura
 * dal canale TEMP_CHANNEL.
 *
 * Sampling reale canale: ~1 punto/minuto.
 * ThingSpeak average restituisce solo ~1-2 giorni recenti (inutile per mese).
 * Per 7/30 giorni: più richieste raw con start/end a finestre da 4 giorni
 * (livello + temperatura), poi downsample (max MAX_DASHBOARD_POINTS).
 */

const DASHBOARD_CHANNEL_ID = "234684";
const DASHBOARD_READ_API_KEY = "V4LZ0YR7H82ONV97";
const TEMP_CHANNEL_ID = "343440";
const TEMP_READ_API_KEY = "KUNK7T9GQZFS264S";
const TEMP_FIELD_NUMBER = 1;
const MAX_HISTORY_RESULTS = 8000;
/** Punti massimi restituiti alla dashboard dopo il merge delle finestre. */
const MAX_DASHBOARD_POINTS = 2000;
/** Giorni per richiesta raw (4g × ~1440/min < 8000). */
const HISTORY_CHUNK_DAYS = 4;

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";

  if (action === "data") {
    const days = parsePeriodParameter(e && e.parameter && e.parameter.days);
    const data = getLatestDashboardData(days);
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService
    .createHtmlOutputFromFile("dashboard_vasca_index")
    .setTitle("Dashboard Vasca Principale")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Endpoint interno per chiamate client-side via google.script.run
function apiData(days) {
  var d = parsePeriodParameter(days);
  return getLatestDashboardData(d);
}

/**
 * Accetta "4h"|"6h"|"8h" oppure giorni interi 1|7|30.
 * Restituisce frazione di giorno (es. 4h -> 4/24).
 */
function parsePeriodParameter(raw) {
  if (raw === null || raw === undefined || raw === "") return 1;
  var s = String(raw).toLowerCase();
  if (s.indexOf("h") >= 0) {
    var hours = parseInt(s, 10);
    if (isNaN(hours) || hours < 1) hours = 4;
    if (hours > 24) hours = 24;
    return hours / 24;
  }
  var n = parseFloat(s);
  if (isNaN(n) || n <= 0) return 1;
  if (n > 30) return 30;
  return n;
}

/** Etichetta periodo per la meta dashboard (allineata all'HTML). */
function periodLabelFromDays(daySpan) {
  var hours = Math.round(daySpan * 24);
  if (Math.abs(daySpan - 4 / 24) < 0.001) return "4h";
  if (Math.abs(daySpan - 6 / 24) < 0.001) return "6h";
  if (Math.abs(daySpan - 8 / 24) < 0.001) return "8h";
  if (daySpan === 1) return "1";
  if (daySpan === 7) return "7";
  if (daySpan === 30) return "30";
  if (hours < 24) return hours + "h";
  return String(daySpan);
}

function getLatestDashboardData(days) {
  var daySpan = days;
  if (daySpan === undefined || daySpan === null) daySpan = 1;

  const lastUrl =
    "https://api.thingspeak.com/channels/" +
    DASHBOARD_CHANNEL_ID +
    "/feeds/last.json?api_key=" +
    DASHBOARD_READ_API_KEY;

  const tempLastUrl =
    "https://api.thingspeak.com/channels/" +
    TEMP_CHANNEL_ID +
    "/fields/" +
    TEMP_FIELD_NUMBER +
    "/last.json?api_key=" +
    TEMP_READ_API_KEY;

  const res = UrlFetchApp.fetch(lastUrl, { muteHttpExceptions: true });
  const code = res.getResponseCode();

  if (code !== 200) {
    return {
      ok: false,
      error: "ThingSpeak HTTP " + code
    };
  }

  const last = JSON.parse(res.getContentText() || "{}");
  const levelHistory = getChannelHistoryForDays(
    daySpan,
    DASHBOARD_CHANNEL_ID,
    DASHBOARD_READ_API_KEY,
    1,
    "livello"
  );
  const tempHistory = getChannelHistoryForDays(
    daySpan,
    TEMP_CHANNEL_ID,
    TEMP_READ_API_KEY,
    TEMP_FIELD_NUMBER,
    "temperaturaAcqua"
  );
  const history = mergeLevelAndTempHistory(levelHistory, tempHistory);
  const tempLast = getTempLast(tempLastUrl);

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

/** Formato data ThingSpeak: YYYY-MM-DD HH:MM:SS (UTC). */
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

function fetchHistoryChunk(channelId, apiKey, fieldNumber, valueKey, startDate, endDate) {
  try {
    const res = UrlFetchApp.fetch(
      buildRawHistoryUrl(channelId, apiKey, startDate, endDate),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return [];

    const json = JSON.parse(res.getContentText() || "{}");
    const feeds = json.feeds || [];
    const out = [];
    const fieldName = "field" + fieldNumber;

    for (var i = 0; i < feeds.length; i++) {
      var f = feeds[i];
      var row = { ts: f.created_at || "" };
      row[valueKey] = toNumber(f[fieldName]);
      out.push(row);
    }
    return out;
  } catch (e) {
    return [];
  }
}

/**
 * Scarica storico raw a finestre (ThingSpeak average non copre periodi lunghi).
 */
function getChannelHistoryForDays(days, channelId, apiKey, fieldNumber, valueKey) {
  var end = new Date();
  var start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  var chunkMs = HISTORY_CHUNK_DAYS * 24 * 60 * 60 * 1000;
  var all = [];
  var cursor = new Date(start.getTime());

  while (cursor.getTime() < end.getTime()) {
    var chunkEndMs = Math.min(cursor.getTime() + chunkMs, end.getTime());
    var chunkEnd = new Date(chunkEndMs);
    var part = fetchHistoryChunk(
      channelId, apiKey, fieldNumber, valueKey, cursor, chunkEnd
    );
    for (var i = 0; i < part.length; i++) {
      all.push(part[i]);
    }
    cursor = chunkEnd;
  }

  return downsampleHistory(all, MAX_DASHBOARD_POINTS);
}

/** Unisce temp sul timeline del livello (nearest neighbor per timestamp). */
function mergeLevelAndTempHistory(levelHistory, tempHistory) {
  if (!levelHistory || !levelHistory.length) return [];
  if (!tempHistory || !tempHistory.length) {
    for (var i = 0; i < levelHistory.length; i++) {
      levelHistory[i].temperaturaAcqua = null;
    }
    return levelHistory;
  }

  var tempMs = [];
  for (var t = 0; t < tempHistory.length; t++) {
    tempMs.push(new Date(tempHistory[t].ts).getTime());
  }

  var j = 0;
  for (var i = 0; i < levelHistory.length; i++) {
    var ms = new Date(levelHistory[i].ts).getTime();
    if (isNaN(ms)) {
      levelHistory[i].temperaturaAcqua = null;
      continue;
    }
    while (j < tempMs.length - 1 && Math.abs(tempMs[j + 1] - ms) <= Math.abs(tempMs[j] - ms)) {
      j++;
    }
    var best = j;
    if (j > 0 && Math.abs(tempMs[j - 1] - ms) < Math.abs(tempMs[j] - ms)) {
      best = j - 1;
    }
    // Accetta solo se entro 10 minuti.
    if (Math.abs(tempMs[best] - ms) <= 10 * 60 * 1000) {
      levelHistory[i].temperaturaAcqua = tempHistory[best].temperaturaAcqua;
    } else {
      levelHistory[i].temperaturaAcqua = null;
    }
  }
  return levelHistory;
}

/** Riduce i punti in modo uniforme, tenendo sempre primo e ultimo. */
function downsampleHistory(history, maxPoints) {
  if (!history || !history.length) return [];
  if (history.length <= maxPoints) return history;

  var out = [];
  var lastIdx = history.length - 1;
  var step = lastIdx / (maxPoints - 1);
  var prev = -1;

  for (var i = 0; i < maxPoints; i++) {
    var idx = Math.round(i * step);
    if (idx === prev) continue;
    out.push(history[idx]);
    prev = idx;
  }

  if (prev !== lastIdx) out.push(history[lastIdx]);
  return out;
}

function getTempLast(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { temperaturaAcqua: null, ts: "" };
    }
    const j = JSON.parse(res.getContentText() || "{}");
    return {
      temperaturaAcqua: toNumber(j["field" + TEMP_FIELD_NUMBER]),
      ts: j.created_at || ""
    };
  } catch (e) {
    return { temperaturaAcqua: null, ts: "" };
  }
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
