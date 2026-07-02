// Shelly Plus 1 - porte BLE -> Telegram
// Comandi: /stato  /log  /scan
// Emoji: CHIUSA = verde, APERTA = rosso, SCONOSCIUTO = neutro
// mJS: no callback come argomento custom; JSON.parse in try/catch; HTTP error solo print

let MAC_PORTA_SOTTO = "b0:c7:de:06:cc:23";
let MAC_PORTA_SOPRA = "7c:c6:b6:08:9b:91";
let BOT_TOKEN = "INSERISCI_QUI_IL_TOKEN_BOT";
let BOT_CHAT_ID = 358203719;

let STABILITA_MS = 2000;
let HTTP_TIMEOUT_SEC = 20;
let TG_POLL_MS = 5000;
let TZ_OFFSET_SEC = 7200;
let MAX_HTTP_PENDING = 2;

let statoPortaSotto = "SCONOSCIUTO";
let statoPortaSopra = "SCONOSCIUTO";
let candidateStatoSotto = null;
let candidateStatoSopra = null;
let timerSotto = null;
let timerSopra = null;
let lastUpdateId = 0;
let isCheckingTelegram = false;
let pendingChatId = 0;
let logCount = 0;
let httpPending = 0;
let hexWarnSopra = 0;
let bleSubscribed = false;

let pktSopra = 0;
let pktSotto = 0;
let pktSopraFcd2 = 0;
let pktSottoFcd2 = 0;
let pktSopraNoSvc = 0;
let pktSopraNoFcd2 = 0;
let lastRssiSopra = 0;
let lastRssiSotto = 0;
let lastHexSopra = "";
let lastHexSotto = "";

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
  if (!tokenOk()) return;
  if (httpPending >= MAX_HTTP_PENDING) {
    scrMsg("TG skip (HTTP busy): " + msg);
    return;
  }
  pendingChatId = BOT_CHAT_ID;
  httpGet(TG_API + "/sendMessage?chat_id=" + BOT_CHAT_ID + "&text=" + urlEncode("[LOG] " + msg), "sendLog");
}

function urlEscapeAscii(str) {
  let out = "";
  let map = {
    " ": "%20", "!": "%21", "\"": "%22", "#": "%23", "$": "%24", "%": "%25",
    "&": "%26", "'": "%27", "(": "%28", ")": "%29", "*": "%2A", "+": "%2B",
    ",": "%2C", "/": "%2F", ":": "%3A", ";": "%3B", "<": "%3C", "=": "%3D",
    ">": "%3E", "?": "%3F", "@": "%40", "\n": "%0A"
  };
  let i = 0;
  for (i = 0; i < str.length; i++) {
    let c = str[i];
    if (map[c]) out = out + map[c];
    else out = out + c;
  }
  return out;
}

function urlEncode(str) {
  if (typeof encodeURIComponent === "function") {
    return encodeURIComponent(str);
  }
  return urlEscapeAscii(str);
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

function getStatoDaRaw(raw) {
  let bytes = stringToHexArray(raw);
  if (bytes.length > 10) {
    let s = getStato(bytes[10]);
    if (s !== "SCONOSCIUTO") return s;
  }
  let i = 0;
  for (i = 0; i < raw.length - 1; i++) {
    if (raw.charCodeAt(i) === 45) {
      if (raw.charCodeAt(i + 1) === 0) return "APERTA";
      if (raw.charCodeAt(i + 1) === 1) return "CHIUSA";
    }
  }
  return "SCONOSCIUTO";
}

function getColorEmoji(stato) {
  if (stato === "APERTA") return "\uD83D\uDD34";
  if (stato === "CHIUSA") return "\uD83D\uDFE2";
  return "\u2753";
}

function pad2(n) {
  if (n < 10) return "0" + n;
  return "" + n;
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

function getFcd2(result) {
  if (!result.service_data) return null;
  if (result.service_data.fcd2) return result.service_data.fcd2;
  if (result.service_data.FCD2) return result.service_data.FCD2;
  return null;
}

function msgDiagnostica() {
  let msg = "DIAG " + getTimestamp() + "\n";
  msg = msg + "SOPRA stato=" + statoPortaSopra + "\n";
  msg = msg + "SOTTO stato=" + statoPortaSotto + "\n";
  msg = msg + "pkt SOPRA=" + pktSopra + " fcd2=" + pktSopraFcd2 + "\n";
  msg = msg + "pkt SOTTO=" + pktSotto + " fcd2=" + pktSottoFcd2 + "\n";
  msg = msg + "SOPRA noSvc=" + pktSopraNoSvc + " noFcd2=" + pktSopraNoFcd2 + "\n";
  msg = msg + "rssi SOPRA=" + lastRssiSopra + " SOTTO=" + lastRssiSotto + "\n";
  if (lastHexSopra.length > 0) msg = msg + "hex SOPRA=" + lastHexSopra + "\n";
  if (lastHexSotto.length > 0) msg = msg + "hex SOTTO=" + lastHexSotto;
  return msg;
}

function httpGet(url, label) {
  if (httpPending >= MAX_HTTP_PENDING) {
    scrMsg("HTTP skip " + label);
    if (label === "getUpdates") isCheckingTelegram = false;
    return;
  }
  httpPending = httpPending + 1;
  Shelly.call("HTTP.REQUEST", {
    method: "GET",
    url: url,
    timeout: HTTP_TIMEOUT_SEC,
    ssl_ca: "*"
  }, function(res, err, msg) {
    httpPending = httpPending - 1;
    httpHandleResponse(label, res, err, msg);
  });
}

function httpHandleResponse(label, result, error_code, error_message) {
  if (label === "getUpdates") isCheckingTelegram = false;
  if (error_code !== 0) {
    // solo print: scrMsgTg qui ricorsivo crashava lo script
    scrMsg("HTTP err " + label + " " + error_code + " " + error_message);
    if (label === "sendLog" || label === "sendMessage") pendingChatId = 0;
    return;
  }
  if (!result || result.code !== 200) {
    scrMsg("HTTP code " + label + " " + (result ? result.code : "?"));
    if (label === "sendLog" || label === "sendMessage") pendingChatId = 0;
    return;
  }
  if (label === "getMe") {
    scrMsgTg("OK: /stato /log /scan");
    return;
  }
  if (label === "getUpdates") {
    handleGetUpdatesBody(result.body);
    return;
  }
  if (label === "sendLog" || label === "sendMessage") {
    pendingChatId = 0;
  }
}

function handleGetUpdatesBody(body) {
  if (!body || body.length === 0) return;
  let data = null;
  try {
    data = JSON.parse(body);
  } catch (e) {
    scrMsg("JSON parse getUpdates: " + e);
    return;
  }
  if (!data || !data.ok || !data.result) return;
  let i = 0;
  for (i = 0; i < data.result.length; i++) {
    let update = data.result[i];
    lastUpdateId = update.update_id;
    if (update.message && update.message.text) {
      let text = update.message.text;
      let chatId = update.message.chat.id;
      if (text === "/stato" || text === "/Stato") {
        pendingChatId = chatId;
        httpGet(TG_API + "/sendMessage?chat_id=" + chatId + "&text=" + urlEncode(messaggioStatoEntrambe("stato attuale", "stato attuale")), "sendMessage");
      }
      if (text === "/log" || text === "/Log") {
        pendingChatId = chatId;
        httpGet(TG_API + "/sendMessage?chat_id=" + chatId + "&text=" + urlEncode(msgDiagnostica()), "sendMessage");
      }
      if (text === "/scan" || text === "/Scan") {
        pendingChatId = chatId;
        httpGet(TG_API + "/sendMessage?chat_id=" + chatId + "&text=" + urlEncode(msgDiagnostica()), "sendMessage");
      }
    }
  }
}

function messaggioStatoEntrambe(titoloSopra, titoloSotto) {
  let ts = getTimestamp();
  return getColorEmoji(statoPortaSopra) + " SOPRA " + titoloSopra + ": " + statoPortaSopra + " " + ts + "\n" +
         getColorEmoji(statoPortaSotto) + " SOTTO " + titoloSotto + ": " + statoPortaSotto + " " + ts;
}

function inviaStatoEntrambe() {
  if (!tokenOk()) {
    scrMsg(messaggioStatoEntrambe("ok", "ok"));
    return;
  }
  if (httpPending >= MAX_HTTP_PENDING) {
    scrMsg("TG stato skip (HTTP busy)");
    return;
  }
  let msg = messaggioStatoEntrambe("ok", "ok");
  scrMsg(msg);
  pendingChatId = BOT_CHAT_ID;
  httpGet(TG_API + "/sendMessage?chat_id=" + BOT_CHAT_ID + "&text=" + urlEncode(msg), "sendMessage");
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
      scrMsgTg("SOPRA iniziale " + nuovoStato);
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
      scrMsgTg("SOTTO iniziale " + nuovoStato);
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

function processUpdate(mac, raw) {
  let hex = rawToHex(raw);
  let stato = getStatoDaRaw(raw);
  if (mac === MAC_PORTA_SOPRA) {
    lastHexSopra = hex;
    pktSopraFcd2 = pktSopraFcd2 + 1;
  } else {
    lastHexSotto = hex;
    pktSottoFcd2 = pktSottoFcd2 + 1;
  }
  if (stato === "SCONOSCIUTO") {
    if (mac === MAC_PORTA_SOPRA && hexWarnSopra < 3) {
      hexWarnSopra = hexWarnSopra + 1;
      scrMsg("SOPRA hex?" + hex);
    }
    return;
  }
  schedulaConferma(mac, stato);
}

function bleScanCb(event, result) {
  if (event !== BLE.Scanner.SCAN_RESULT) return;
  if (!result || !result.addr) return;
  let mac = result.addr.toLowerCase();
  let isSopra = (mac === MAC_PORTA_SOPRA);
  let isSotto = (mac === MAC_PORTA_SOTTO);
  if (!isSopra && !isSotto) return;

  if (isSopra) {
    pktSopra = pktSopra + 1;
    lastRssiSopra = result.rssi;
  } else {
    pktSotto = pktSotto + 1;
    lastRssiSotto = result.rssi;
  }

  if (!result.service_data) {
    if (isSopra) {
      pktSopraNoSvc = pktSopraNoSvc + 1;
      if (pktSopraNoSvc <= 3) scrMsg("SOPRA visto rssi=" + result.rssi + " senza service_data");
    }
    return;
  }

  let raw = getFcd2(result);
  if (!raw) {
    if (isSopra) {
      pktSopraNoFcd2 = pktSopraNoFcd2 + 1;
      if (pktSopraNoFcd2 <= 3) scrMsg("SOPRA visto rssi=" + result.rssi + " senza fcd2");
    }
    return;
  }

  processUpdate(mac, raw);
}

function startBleScanner() {
  let bleCfg = Shelly.getComponentConfig("ble");
  if (!bleCfg || !bleCfg.enable) {
    scrMsg("BLE non abilitato");
    return;
  }
  if (!BLE.Scanner.isRunning()) {
    // passive: sensori porta pubblicano adv, meno carico radio
    BLE.Scanner.Start({ duration_ms: BLE.Scanner.INFINITE_SCAN, active: false });
  }
  if (!bleSubscribed) {
    BLE.Scanner.Subscribe(bleScanCb);
    bleSubscribed = true;
  }
  scrMsg("Scanner BLE avviato");
}

function checkTelegramUpdates() {
  if (isCheckingTelegram) return;
  if (!tokenOk()) return;
  isCheckingTelegram = true;
  httpGet(TG_API + "/getUpdates?offset=" + (lastUpdateId + 1) + "&limit=5&timeout=0", "getUpdates");
}

function initScript() {
  aggiornaApi();
  scrMsg("Script avviato");
  startBleScanner();
  if (tokenOk()) {
    Timer.set(TG_POLL_MS, true, checkTelegramUpdates);
    Timer.set(3000, false, function() {
      httpGet(TG_API + "/getMe", "getMe");
    });
  }
}

Timer.set(500, false, initScript);
