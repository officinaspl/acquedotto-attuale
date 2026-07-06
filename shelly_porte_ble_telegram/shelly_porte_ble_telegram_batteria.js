// Shelly Plus 1 - porte BLE -> Telegram (versione con batteria)
// Comandi: /stato /log /scan
// File: shelly_porte_ble_telegram_batteria.js
// Emoji: CHIUSA = verde, APERTA = rosso, SCONOSCIUTO = neutro
// BLE_SCAN_ACTIVE=true: scan attivo per service_data (SOPRA spesso li perde in passivo)

let MAC_PORTA_SOTTO = "b0:c7:de:06:cc:23";
let MAC_PORTA_SOPRA = "7c:c6:b6:08:9b:91";
let BOT_TOKEN = "7571321217:AAHpnoXN4y8IvylG4wNLAe7bB0dV6z_4Avg";
let BOT_CHAT_ID = 358203719;

let STABILITA_MS = 2000;
let HTTP_TIMEOUT_SEC = 20;
let TG_POLL_MS = 5000;
let TZ_OFFSET_SEC = 7200;

let statoPortaSotto = "SCONOSCIUTO";
let statoPortaSopra = "SCONOSCIUTO";
let ultimoStatoSotto = "SCONOSCIUTO";
let ultimoStatoSopra = "SCONOSCIUTO";
let candidateStatoSotto = null;
let candidateStatoSopra = null;
let timerSotto = null;
let timerSopra = null;
let lastUpdateId = 0;
let isCheckingTelegram = false;
let tgPollStartedAt = 0;
let tgPollPendingCount = 0;
let bootTgSent = false;
let pendingChatId = 0;
let hasPendingUpdates = false;
let pendingUpdatesBody = "";
let pendingSendChatId = 0;
let pendingSendText = "";
let pendingSendTextEncoded = false;
let logCount = 0;
let hexWarnSopra = 0;
let bleSubscribed = false;
let bleScanActive = false;
let bleActiveRetryDone = false;
let BLE_SCAN_ACTIVE = true;
let MAX_RAW_STORE = 80;

let batteriaSopra = -1;
let batteriaSotto = -1;

let pktSopra = 0;
let pktSotto = 0;
let pktSopraFcd2 = 0;
let pktSottoFcd2 = 0;
let pktSopraNoSvc = 0;
let pktSottoNoSvc = 0;
let parseFailSopra = 0;
let parseFailSotto = 0;
let bootMs = 0;
let lastRssiSopra = 0;
let lastRssiSotto = 0;
let lastHexSopra = "";
let lastHexSotto = "";
let lastRawSopra = "";
let lastRawSotto = "";
let lastSvcKeySopra = "";

let TG_API = "";

function aggiornaApi() {
  TG_API = "https://api.telegram.org/bot" + BOT_TOKEN;
}

function scrMsg(msg) {
  print(msg);
  logCount = logCount + 1;
}

function tokenOk() {
  return BOT_TOKEN.indexOf("INSERISCI") < 0;
}

function scrMsgTg(msg) {
  scrMsg(msg);
}

function scrMsgTgCritical(msg) {
  scrMsg(msg);
  if (!tokenOk()) return;
  pendingChatId = BOT_CHAT_ID;
  httpGet(TG_API + "/sendMessage?chat_id=" + BOT_CHAT_ID + "&text=" + urlEscapeLogAscii("[ERR] " + msg), "sendLog");
}

function digitChar(cc) {
  switch (cc) {
    case 48: return "0";
    case 49: return "1";
    case 50: return "2";
    case 51: return "3";
    case 52: return "4";
    case 53: return "5";
    case 54: return "6";
    case 55: return "7";
    case 56: return "8";
    case 57: return "9";
    default: return "";
  }
}

function upperChar(cc) {
  switch (cc) {
    case 65: return "A";
    case 66: return "B";
    case 67: return "C";
    case 68: return "D";
    case 69: return "E";
    case 70: return "F";
    case 71: return "G";
    case 72: return "H";
    case 73: return "I";
    case 74: return "J";
    case 75: return "K";
    case 76: return "L";
    case 77: return "M";
    case 78: return "N";
    case 79: return "O";
    case 80: return "P";
    case 81: return "Q";
    case 82: return "R";
    case 83: return "S";
    case 84: return "T";
    case 85: return "U";
    case 86: return "V";
    case 87: return "W";
    case 88: return "X";
    case 89: return "Y";
    case 90: return "Z";
    default: return "";
  }
}

function lowerChar(cc) {
  switch (cc) {
    case 97: return "a";
    case 98: return "b";
    case 99: return "c";
    case 100: return "d";
    case 101: return "e";
    case 102: return "f";
    case 103: return "g";
    case 104: return "h";
    case 105: return "i";
    case 106: return "j";
    case 107: return "k";
    case 108: return "l";
    case 109: return "m";
    case 110: return "n";
    case 111: return "o";
    case 112: return "p";
    case 113: return "q";
    case 114: return "r";
    case 115: return "s";
    case 116: return "t";
    case 117: return "u";
    case 118: return "v";
    case 119: return "w";
    case 120: return "x";
    case 121: return "y";
    case 122: return "z";
    default: return "";
  }
}

function punctChar(cc) {
  switch (cc) {
    case 33: return "!";
    case 34: return "\"";
    case 35: return "#";
    case 36: return "$";
    case 39: return "'";
    case 40: return "(";
    case 41: return ")";
    case 42: return "*";
    case 44: return ",";
    case 45: return "-";
    case 46: return ".";
    case 47: return "/";
    case 58: return ":";
    case 59: return ";";
    case 60: return "<";
    case 62: return ">";
    case 64: return "@";
    case 91: return "[";
    case 92: return "\\";
    case 93: return "]";
    case 94: return "^";
    case 95: return "_";
    case 96: return "`";
    case 123: return "{";
    case 124: return "|";
    case 125: return "}";
    case 126: return "~";
    default: return "";
  }
}

function asciiPrintableChar(cc) {
  if (cc >= 48 && cc <= 57) return digitChar(cc);
  if (cc >= 65 && cc <= 90) return upperChar(cc);
  if (cc >= 97 && cc <= 122) return lowerChar(cc);
  return punctChar(cc);
}

function urlEscapeLogAscii(str) {
  let out = "";
  let i = 0;
  for (i = 0; i < str.length; i++) {
    let cc = str.charCodeAt(i);
    if (cc === 32) { out = out + "%20"; continue; }
    if (cc === 10) { out = out + "%0A"; continue; }
    if (cc === 38) { out = out + "%26"; continue; }
    if (cc === 61) { out = out + "%3D"; continue; }
    if (cc === 63) { out = out + "%3F"; continue; }
    if (cc === 37) { out = out + "%25"; continue; }
    if (cc === 43) { out = out + "%2B"; continue; }
    let ch = asciiPrintableChar(cc);
    if (ch.length > 0) out = out + ch;
  }
  return out;
}

function encodeTitolo(titolo) {
  if (titolo === "ok") return "ok";
  if (titolo === "stato attuale") return "stato%20attuale";
  return "stato%20attuale";
}

function encodeStato(stato) {
  if (stato === "CHIUSA") return "CHIUSA";
  if (stato === "APERTA") return "APERTA";
  if (stato === "SCONOSCIUTO") return "SCONOSCIUTO";
  if (stato === "in attesa BLE") return "in%20attesa%20BLE";
  return "SCONOSCIUTO";
}

function intToStr2(n) {
  if (n >= 100) return "100";
  if (n >= 10) return digitChar(48 + Math.floor(n / 10)) + digitChar(48 + (n % 10));
  return digitChar(48 + n);
}

function encodeBattPct(batt) {
  return "%20" + intToStr2(batt) + "%25";
}

function encodeTimestamp(ts) {
  let out = "";
  let i = 0;
  for (i = 0; i < ts.length; i++) {
    let cc = ts.charCodeAt(i);
    if (cc === 58) { out = out + "%3A"; continue; }
    if (cc >= 48 && cc <= 57) { out = out + digitChar(cc); continue; }
    if (cc === 63) { out = out + "?"; continue; }
  }
  return out;
}

function rawToHex(str) {
  let out = "";
  let i = 0;
  let max = str.length;
  if (max > 40) max = 40;
  for (i = 0; i < max; i++) {
    let h = str.charCodeAt(i).toString(16);
    if (h.length < 2) h = "0" + h;
    out = out + h + " ";
  }
  return out;
}

function stringToHexArray(str) {
  let hexArray = [];
  let i = 0;
  for (i = 0; i < str.length; i++) {
    let hex = str.charCodeAt(i).toString(16);
    if (hex.length < 2) hex = "0" + hex;
    hexArray.push(hex);
  }
  return hexArray;
}

function getStato(byteStr) {
  if (byteStr === "00") return "CHIUSA";
  if (byteStr === "01") return "APERTA";
  return "SCONOSCIUTO";
}

function getStatoDaCharCode(code) {
  if (code === 0) return "CHIUSA";
  if (code === 1) return "APERTA";
  return "SCONOSCIUTO";
}

function getStatoDaRaw(raw, hard) {
  if (!raw || typeof raw !== "string" || raw.length === 0) return "SCONOSCIUTO";
  let bytes = stringToHexArray(raw);
  let tryIdx = [10, 9, 8, 11, 12, 13, 7, 6, 5, 14, 15];
  let i = 0;
  for (i = 0; i < tryIdx.length; i++) {
    let idx = tryIdx[i];
    if (bytes.length > idx) {
      let s = getStato(bytes[idx]);
      if (s !== "SCONOSCIUTO") return s;
    }
  }
  if (bytes.length > 0) {
    let sTail = getStato(bytes[bytes.length - 1]);
    if (sTail !== "SCONOSCIUTO") return sTail;
  }
  for (i = 0; i < raw.length - 1; i++) {
    if (raw.charCodeAt(i) === 45) {
      if (raw.charCodeAt(i + 1) === 0) return "APERTA";
      if (raw.charCodeAt(i + 1) === 1) return "CHIUSA";
    }
  }
  if (hard === true) {
    for (i = 0; i < raw.length; i++) {
      let s = getStatoDaCharCode(raw.charCodeAt(i));
      if (s !== "SCONOSCIUTO") return s;
    }
    for (i = 0; i < bytes.length; i++) {
      let s = getStato(bytes[i]);
      if (s !== "SCONOSCIUTO") return s;
    }
  }
  return "SCONOSCIUTO";
}

function isBatteryPct(code) {
  return code >= 0 && code <= 100;
}

function getBatteriaDaRaw(raw) {
  if (!raw || typeof raw !== "string" || raw.length === 0) return -1;
  if (raw.length > 4) {
    let c4 = raw.charCodeAt(4);
    if (isBatteryPct(c4)) return c4;
  }
  if (raw.length > 9) {
    let c9 = raw.charCodeAt(9);
    if (isBatteryPct(c9)) return c9;
  }
  let tryIdx = [5, 6, 7, 11];
  let i = 0;
  for (i = 0; i < tryIdx.length; i++) {
    let idx = tryIdx[i];
    if (raw.length > idx) {
      let c = raw.charCodeAt(idx);
      if (isBatteryPct(c)) return c;
    }
  }
  return -1;
}

function formatBattLog(batt) {
  if (batt >= 0 && batt <= 100) return batt + "%";
  return "?";
}

function hexSpacedToRaw(hexStr) {
  if (!hexStr || typeof hexStr !== "string") return "";
  let parts = hexStr.split(" ");
  let out = "";
  let i = 0;
  for (i = 0; i < parts.length; i++) {
    if (parts[i].length === 0) continue;
    out = out + String.fromCharCode(parseInt(parts[i], 16));
  }
  return out;
}

function storeLastRaw(mac, raw) {
  let s = raw;
  if (s.length > MAX_RAW_STORE) s = s.substring(0, MAX_RAW_STORE);
  if (mac === MAC_PORTA_SOPRA) lastRawSopra = s;
  else lastRawSotto = s;
}

function getColorEmojiEncoded(stato) {
  if (stato === "APERTA") return "%F0%9F%94%B4";
  if (stato === "CHIUSA") return "%F0%9F%9F%A2";
  return "%3F";
}

function getColorEmojiLog(stato) {
  if (stato === "APERTA") return "[R]";
  if (stato === "CHIUSA") return "[V]";
  return "[?]";
}

function buildStatoLineEncoded(label, titolo, stato, ts, batt) {
  let battStr = "";
  if (batt >= 0 && batt <= 100) {
    battStr = encodeBattPct(batt);
  }
  return getColorEmojiEncoded(stato) + "%20" + label + "%20" + encodeTitolo(titolo) +
         "%3A%20" + encodeStato(stato) + battStr + "%20" + encodeTimestamp(ts);
}

function getStatoLiveSopra() {
  if (candidateStatoSopra !== null) return candidateStatoSopra;
  if (ultimoStatoSopra !== "SCONOSCIUTO") return ultimoStatoSopra;
  return statoPortaSopra;
}

function ritentaParsePerStato(isSopra) {
  let liveFn = isSopra ? getStatoLiveSopra : getStatoLiveSotto;
  if (liveFn() !== "SCONOSCIUTO") return;
  let pkt = isSopra ? pktSopra : pktSotto;
  if (pkt <= 0) return;
  let raw = isSopra ? lastRawSopra : lastRawSotto;
  let hex = isSopra ? lastHexSopra : lastHexSotto;
  if (raw.length === 0 && hex.length > 0) raw = hexSpacedToRaw(hex);
  if (raw.length === 0) return;
  let stato = getStatoDaRaw(raw, true);
  if (stato === "SCONOSCIUTO") return;
  let batt = getBatteriaDaRaw(raw);
  if (isSopra) {
    ultimoStatoSopra = stato;
    if (batt >= 0) batteriaSopra = batt;
    if (statoPortaSopra === "SCONOSCIUTO") {
      statoPortaSopra = stato;
      scrMsg("SOPRA /stato retry " + stato);
    }
  } else {
    ultimoStatoSotto = stato;
    if (batt >= 0) batteriaSotto = batt;
    if (statoPortaSotto === "SCONOSCIUTO") {
      statoPortaSotto = stato;
      scrMsg("SOTTO /stato retry " + stato);
    }
  }
}

function ritentaParseSopraPerStato() {
  ritentaParsePerStato(true);
}

function ritentaParseSottoPerStato() {
  ritentaParsePerStato(false);
}

function getStatoLiveSotto() {
  if (candidateStatoSotto !== null) return candidateStatoSotto;
  if (ultimoStatoSotto !== "SCONOSCIUTO") return ultimoStatoSotto;
  return statoPortaSotto;
}

function buildStatoMessageEncoded(titoloSopra, titoloSotto) {
  let ts = getTimestamp();
  return buildStatoLineEncoded("SOPRA", titoloSopra, statoPortaSopra, ts, batteriaSopra) + "%0A" +
         buildStatoLineEncoded("SOTTO", titoloSotto, statoPortaSotto, ts, batteriaSotto);
}

function getStatoDisplay(isSopra) {
  let live = isSopra ? getStatoLiveSopra() : getStatoLiveSotto();
  if (live !== "SCONOSCIUTO") return live;
  let pkt = isSopra ? pktSopra : pktSotto;
  if (pkt <= 0) return "in attesa BLE";
  return "SCONOSCIUTO";
}

function buildStatoMessageEncodedForStato(titoloSopra, titoloSotto) {
  let ts = getTimestamp();
  return buildStatoLineEncoded("SOPRA", titoloSopra, getStatoDisplay(true), ts, batteriaSopra) + "%0A" +
         buildStatoLineEncoded("SOTTO", titoloSotto, getStatoDisplay(false), ts, batteriaSotto);
}

function messaggioStatoEntrambeLog(titoloSopra, titoloSotto) {
  let ts = getTimestamp();
  return getColorEmojiLog(statoPortaSopra) + " SOPRA " + titoloSopra + ": " + statoPortaSopra +
         " " + formatBattLog(batteriaSopra) + " " + ts + "\n" +
         getColorEmojiLog(statoPortaSotto) + " SOTTO " + titoloSotto + ": " + statoPortaSotto +
         " " + formatBattLog(batteriaSotto) + " " + ts;
}

function pad2(n) {
  if (n < 10) return "0" + n;
  return "" + n;
}

function nowMs() {
  let sys = Shelly.getComponentStatus("sys");
  if (sys && sys.unixtime) return sys.unixtime * 1000;
  return 0;
}

function getTimestamp() {
  let sys = Shelly.getComponentStatus("sys");
  if (!sys || !sys.unixtime) return "??:??:??";
  let t = sys.unixtime + TZ_OFFSET_SEC;
  let sec = t % 60;
  let min = Math.floor(t / 60) % 60;
  let hour = Math.floor(t / 3600) % 24;
  return pad2(hour) + ":" + pad2(min) + ":" + pad2(sec);
}

function getServiceDataEntries(result) {
  let entries = [];
  if (!result.service_data) return entries;
  let keys = Object.keys(result.service_data);
  let i = 0;
  for (i = 0; i < keys.length; i++) {
    let key = keys[i];
    let raw = result.service_data[key];
    if (raw && typeof raw === "string" && raw.length > 0) {
      entries.push({ key: key, raw: raw });
    }
  }
  return entries;
}

function getFcd2(result) {
  let entries = getServiceDataEntries(result);
  let i = 0;
  for (i = 0; i < entries.length; i++) {
    let k = entries[i].key;
    if (k === "fcd2" || k === "FCD2") return entries[i].raw;
  }
  return null;
}

function normalizeMac(addr) {
  if (!addr || typeof addr !== "string") return "";
  let lower = addr.toLowerCase();
  let s = "";
  let i = 0;
  for (i = 0; i < lower.length; i++) {
    let cc = lower.charCodeAt(i);
    if ((cc >= 48 && cc <= 57) || (cc >= 97 && cc <= 102)) {
      s = s + lower.charAt(i);
    }
  }
  if (s.length !== 12) return lower;
  return s.substring(0, 2) + ":" + s.substring(2, 4) + ":" + s.substring(4, 6) + ":" +
         s.substring(6, 8) + ":" + s.substring(8, 10) + ":" + s.substring(10, 12);
}

function motivoSconosciuto(isSopra) {
  let pkt = isSopra ? pktSopra : pktSotto;
  let live = isSopra ? getStatoLiveSopra() : getStatoLiveSotto();
  let label = isSopra ? "SOPRA" : "SOTTO";
  if (live !== "SCONOSCIUTO") return label + " OK";
  if (pkt <= 0) {
    let sec = 0;
    if (bootMs > 0) sec = Math.floor((nowMs() - bootMs) / 1000);
    return "in attesa BLE (" + sec + "s da boot)";
  }
  let parseFail = isSopra ? parseFailSopra : parseFailSotto;
  let noSvc = isSopra ? pktSopraNoSvc : pktSottoNoSvc;
  if (noSvc > 0 && noSvc >= pkt) return "pacchetti senza service_data";
  if (parseFail > 0) return "parse fallito (" + parseFail + "x)";
  return "parse fallito, hex salvato";
}

function msgDiagnostica() {
  ritentaParseSopraPerStato();
  ritentaParseSottoPerStato();
  let secBoot = 0;
  if (bootMs > 0) secBoot = Math.floor((nowMs() - bootMs) / 1000);
  let msg = "DIAG " + getTimestamp() + " boot=" + secBoot + "s\n";
  msg = msg + "SOPRA stato=" + statoPortaSopra + " live=" + getStatoLiveSopra() + "\n";
  msg = msg + "  perche: " + motivoSconosciuto(true) + "\n";
  msg = msg + "SOTTO stato=" + statoPortaSotto + " live=" + getStatoLiveSotto() + "\n";
  msg = msg + "  perche: " + motivoSconosciuto(false) + "\n";
  msg = msg + "ultimo SOPRA=" + ultimoStatoSopra + " SOTTO=" + ultimoStatoSotto + "\n";
  msg = msg + "batt SOPRA=" + formatBattLog(batteriaSopra) + " SOTTO=" + formatBattLog(batteriaSotto) + "\n";
  msg = msg + "pkt SOPRA=" + pktSopra + " ok=" + pktSopraFcd2 + " fail=" + parseFailSopra + "\n";
  msg = msg + "pkt SOTTO=" + pktSotto + " ok=" + pktSottoFcd2 + " fail=" + parseFailSotto + "\n";
  msg = msg + "SOPRA noSvc=" + pktSopraNoSvc + " SOTTO noSvc=" + pktSottoNoSvc + "\n";
  msg = msg + "rssi SOPRA=" + lastRssiSopra + " SOTTO=" + lastRssiSotto + "\n";
  msg = msg + "scan active=" + bleScanActive + " sub=" + bleSubscribed;
  msg = msg + " running=" + (BLE.Scanner.isRunning ? BLE.Scanner.isRunning() : "?") + "\n";
  if (lastSvcKeySopra.length > 0) msg = msg + "svcKey SOPRA=" + lastSvcKeySopra + "\n";
  if (lastHexSopra.length > 0) msg = msg + "hex SOPRA=" + lastHexSopra + "\n";
  if (lastHexSotto.length > 0) msg = msg + "hex SOTTO=" + lastHexSotto;
  return msg;
}

function httpGet(url, label) {
  Shelly.call("HTTP.REQUEST", {
    method: "GET",
    url: url,
    timeout: HTTP_TIMEOUT_SEC,
    ssl_ca: "*"
  }, function(res, err, msg) {
    httpHandleResponse(label, res, err, msg);
  });
}

function httpHandleResponse(label, result, error_code, error_message) {
  if (label === "getUpdates") {
    isCheckingTelegram = false;
    tgPollStartedAt = 0;
    tgPollPendingCount = 0;
  }
  if (error_code !== 0) {
    scrMsg("HTTP err " + label + " " + error_code + " " + error_message);
    if (label === "sendLog" || label === "sendMessage" || label === "sendBoot") pendingChatId = 0;
    return;
  }
  if (!result || typeof result.code === "undefined" || result.code !== 200) {
    let codeStr = "?";
    if (result && typeof result.code !== "undefined") codeStr = "" + result.code;
    scrMsg("HTTP code " + label + " " + codeStr);
    if (label === "sendLog" || label === "sendMessage" || label === "sendBoot") pendingChatId = 0;
    return;
  }
  if (label === "getMe") {
    scrMsg("OK: /stato /log /scan");
    if (!bootTgSent && tokenOk()) {
      bootTgSent = true;
      pendingChatId = BOT_CHAT_ID;
      httpGet(TG_API + "/sendMessage?chat_id=" + BOT_CHAT_ID +
        "&text=" + urlEscapeLogAscii("[OK] Script avviato - /stato /log /scan"), "sendBoot");
    }
    return;
  }
  if (label === "getUpdates") {
    pendingUpdatesBody = "";
    if (result.body && typeof result.body === "string") {
      pendingUpdatesBody = result.body;
    }
    hasPendingUpdates = true;
    return;
  }
  if (label === "sendLog" || label === "sendMessage" || label === "sendBoot") {
    pendingChatId = 0;
  }
}

function handleGetUpdatesBody(body) {
  if (!body || typeof body !== "string" || body.length === 0) return;
  let data = null;
  try {
    data = JSON.parse(body);
  } catch (e) {
    scrMsg("JSON parse getUpdates: " + e);
    return;
  }
  if (!data || data.ok !== true || !data.result || typeof data.result.length === "undefined") return;
  let i = 0;
  for (i = 0; i < data.result.length; i++) {
    let update = data.result[i];
    if (!update || typeof update.update_id === "undefined") continue;
    lastUpdateId = update.update_id;
    if (!update.message) continue;
    let msg = update.message;
    if (!msg.text || typeof msg.text !== "string") continue;
    if (!msg.chat || typeof msg.chat.id === "undefined") continue;
    let text = msg.text;
    let chatId = msg.chat.id;
    // Piu comandi nello stesso batch: vince l'ultimo (sovrascrive pendingSend*)
    if (text === "/stato" || text === "/Stato") {
      ritentaParseSopraPerStato();
      ritentaParseSottoPerStato();
      pendingSendChatId = chatId;
      pendingSendText = buildStatoMessageEncodedForStato("stato attuale", "stato attuale");
      pendingSendTextEncoded = true;
    } else if (text === "/log" || text === "/Log") {
      pendingSendChatId = chatId;
      pendingSendText = msgDiagnostica();
      pendingSendTextEncoded = false;
    } else if (text === "/scan" || text === "/Scan") {
      pendingSendChatId = chatId;
      pendingSendText = msgDiagnostica();
      pendingSendTextEncoded = false;
    }
  }
}

function inviaStatoEntrambe() {
  let msgLog = messaggioStatoEntrambeLog("ok", "ok");
  if (!tokenOk()) {
    scrMsg(msgLog);
    return;
  }
  scrMsg(msgLog);
  pendingChatId = BOT_CHAT_ID;
  httpGet(TG_API + "/sendMessage?chat_id=" + BOT_CHAT_ID + "&text=" + buildStatoMessageEncoded("ok", "ok"), "sendMessage");
}

function confermaStatoPortaSopra() {
  statoPortaSopra = candidateStatoSopra !== null ? candidateStatoSopra : statoPortaSopra;
  candidateStatoSopra = null;
  timerSopra = null;
  inviaStatoEntrambe();
}

function confermaStatoPortaSotto() {
  statoPortaSotto = candidateStatoSotto !== null ? candidateStatoSotto : statoPortaSotto;
  candidateStatoSotto = null;
  timerSotto = null;
  inviaStatoEntrambe();
}

function schedulaConferma(mac, nuovoStato) {
  if (nuovoStato === "SCONOSCIUTO") return;
  if (mac === MAC_PORTA_SOPRA) {
    if (nuovoStato === statoPortaSopra) return;
    if (statoPortaSopra === "SCONOSCIUTO") {
      statoPortaSopra = nuovoStato;
      scrMsg("SOPRA iniziale " + nuovoStato);
      return;
    }
    if (candidateStatoSopra !== nuovoStato) {
      candidateStatoSopra = nuovoStato;
      if (timerSopra) Timer.clear(timerSopra);
      timerSopra = Timer.set(STABILITA_MS, false, confermaStatoPortaSopra);
      scrMsg("SOPRA candidato " + candidateStatoSopra);
    }
    return;
  }
  if (mac === MAC_PORTA_SOTTO) {
    if (nuovoStato === statoPortaSotto) return;
    if (statoPortaSotto === "SCONOSCIUTO") {
      statoPortaSotto = nuovoStato;
      scrMsg("SOTTO iniziale " + nuovoStato);
      return;
    }
    if (candidateStatoSotto !== nuovoStato) {
      candidateStatoSotto = nuovoStato;
      if (timerSotto) Timer.clear(timerSotto);
      timerSotto = Timer.set(STABILITA_MS, false, confermaStatoPortaSotto);
      scrMsg("SOTTO candidato " + candidateStatoSotto);
    }
  }
}

function processUpdate(mac, raw, svcKey) {
  let hex = rawToHex(raw);
  storeLastRaw(mac, raw);
  let isSopra = (mac === MAC_PORTA_SOPRA);
  if (isSopra) {
    lastHexSopra = hex;
    if (svcKey) lastSvcKeySopra = svcKey;
  } else {
    lastHexSotto = hex;
  }
  let stato = getStatoDaRaw(raw, false);
  if (stato === "SCONOSCIUTO") stato = getStatoDaRaw(raw, true);
  if (stato === "SCONOSCIUTO") {
    if (isSopra) {
      parseFailSopra = parseFailSopra + 1;
      hexWarnSopra = hexWarnSopra + 1;
      if (hexWarnSopra <= 2) {
        scrMsg("SOPRA hex?" + hex + " key=" + (svcKey ? svcKey : "?"));
      }
    } else {
      parseFailSotto = parseFailSotto + 1;
    }
    return;
  }
  let batt = getBatteriaDaRaw(raw);
  if (isSopra) {
    pktSopraFcd2 = pktSopraFcd2 + 1;
    ultimoStatoSopra = stato;
    if (batt >= 0) batteriaSopra = batt;
  } else {
    pktSottoFcd2 = pktSottoFcd2 + 1;
    ultimoStatoSotto = stato;
    if (batt >= 0) batteriaSotto = batt;
  }
  schedulaConferma(mac, stato);
}

function maybeRetryActiveScan() {
  if (bleActiveRetryDone || bleScanActive) return;
  if (pktSopra < 15) return;
  if (ultimoStatoSopra !== "SCONOSCIUTO" && statoPortaSopra !== "SCONOSCIUTO") return;
  if (pktSopraNoSvc < 5 && pktSopraFcd2 > 0) return;
  bleActiveRetryDone = true;
  scrMsg("SOPRA: riavvio scan BLE attivo (service_data mancante)");
  startBleScanner(true);
}

function bleScanCb(event, result) {
  try {
    if (event !== BLE.Scanner.SCAN_RESULT) return;
    if (!result || !result.addr) return;
    let mac = normalizeMac(result.addr);
    let isSopra = (mac === MAC_PORTA_SOPRA);
    let isSotto = (mac === MAC_PORTA_SOTTO);
    if (!isSopra && !isSotto) return;

    if (isSopra) {
      pktSopra = pktSopra + 1;
      lastRssiSopra = result.rssi;
      if (pktSopra === 30) maybeRetryActiveScan();
    } else {
      pktSotto = pktSotto + 1;
      lastRssiSotto = result.rssi;
    }

    let entries = getServiceDataEntries(result);
    if (entries.length === 0) {
      if (isSopra) {
        pktSopraNoSvc = pktSopraNoSvc + 1;
        if (pktSopraNoSvc <= 2) scrMsg("SOPRA visto rssi=" + result.rssi + " senza service_data");
      } else {
        pktSottoNoSvc = pktSottoNoSvc + 1;
      }
      return;
    }

    let i = 0;
    for (i = 0; i < entries.length; i++) {
      let raw = entries[i].raw;
      let stato = getStatoDaRaw(raw, false);
      if (stato === "SCONOSCIUTO") stato = getStatoDaRaw(raw, true);
      if (stato !== "SCONOSCIUTO") {
        processUpdate(mac, raw, entries[i].key);
        return;
      }
    }

    let bestRaw = entries[0].raw;
    let bestKey = entries[0].key;
    for (i = 0; i < entries.length; i++) {
      if (entries[i].raw.length > bestRaw.length) {
        bestRaw = entries[i].raw;
        bestKey = entries[i].key;
      }
    }
    processUpdate(mac, bestRaw, bestKey);
  } catch (e) {
    scrMsg("BLE cb err: " + e);
  }
}

function startBleScanner(forceActive) {
  let bleCfg = Shelly.getComponentConfig("ble");
  if (!bleCfg || !bleCfg.enable) {
    scrMsgTgCritical("BLE non abilitato");
    return;
  }
  let active = forceActive === true || BLE_SCAN_ACTIVE === true;
  if (BLE.Scanner.isRunning()) {
    BLE.Scanner.Stop();
  }
  BLE.Scanner.Start({ duration_ms: BLE.Scanner.INFINITE_SCAN, active: active });
  bleScanActive = active;
  if (!bleSubscribed) {
    BLE.Scanner.Subscribe(bleScanCb);
    bleSubscribed = true;
  }
  scrMsg("Scanner BLE avviato active=" + active);
}

function checkTelegramUpdates() {
  if (!tokenOk()) return;

  if (hasPendingUpdates) {
    hasPendingUpdates = false;
    let body = pendingUpdatesBody;
    pendingUpdatesBody = "";
    try {
      handleGetUpdatesBody(body);
    } catch (e) {
      scrMsg("handleGetUpdatesBody err: " + e);
    }
  }

  if (pendingSendChatId > 0) {
    let chatId = pendingSendChatId;
    let text = pendingSendText;
    let encoded = pendingSendTextEncoded;
    pendingSendChatId = 0;
    pendingSendText = "";
    pendingSendTextEncoded = false;
    pendingChatId = chatId;
    if (encoded) {
      httpGet(TG_API + "/sendMessage?chat_id=" + chatId + "&text=" + text, "sendMessage");
    } else {
      httpGet(TG_API + "/sendMessage?chat_id=" + chatId + "&text=" + urlEscapeLogAscii(text), "sendMessage");
    }
  }

  if (isCheckingTelegram) {
    let timedOut = false;
    if (tgPollStartedAt > 0) {
      let elapsed = nowMs() - tgPollStartedAt;
      if (elapsed > ((HTTP_TIMEOUT_SEC + 5) * 1000)) timedOut = true;
    } else {
      tgPollPendingCount = tgPollPendingCount + 1;
      if (tgPollPendingCount > 3) timedOut = true;
    }
    if (timedOut) {
      scrMsg("TG poll timeout, reset");
      isCheckingTelegram = false;
      tgPollStartedAt = 0;
      tgPollPendingCount = 0;
    } else {
      return;
    }
  }
  isCheckingTelegram = true;
  tgPollStartedAt = nowMs();
  tgPollPendingCount = 0;
  httpGet(TG_API + "/getUpdates?offset=" + (lastUpdateId + 1) + "&limit=5&timeout=0", "getUpdates");
}

function runGetMe() {
  if (!tokenOk()) return;
  httpGet(TG_API + "/getMe", "getMe");
}

function initScript() {
  aggiornaApi();
  bootMs = nowMs();
  scrMsg("Script avviato");
  startBleScanner();
  if (tokenOk()) {
    Timer.set(TG_POLL_MS, true, checkTelegramUpdates);
    Timer.set(3000, false, runGetMe);
  }
}

Timer.set(500, false, initScript);
