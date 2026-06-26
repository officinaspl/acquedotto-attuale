// Shelly Plus 1 - porte BLE -> Telegram
// Comando bot: /stato
// Nota: niente callback come parametro (mJS Shelly va in crash)

let MAC_PORTA_SOTTO = "b0:c7:de:06:cc:23";
let MAC_PORTA_SOPRA = "7c:c6:b6:08:9b:91";

let BOT_TOKEN = "INSERISCI_QUI_IL_TOKEN_BOT";
let BOT1_CHAT_ID = 358203719;

let statoPortaSotto = "SCONOSCIUTO";
let statoPortaSopra = "SCONOSCIUTO";

let candidateStatoSotto = null;
let candidateStatoSopra = null;

let timerSotto = null;
let timerSopra = null;

const STABILITA_MS = 2000;
const HTTP_TIMEOUT_SEC = 20;
const TG_POLL_MS = 5000;

let lastUpdateId = 0;
let isCheckingTelegram = false;
let pendingChatId = 0;

const TG_API = "https://api.telegram.org/bot" + BOT_TOKEN;

function httpGet(url, label) {
  Shelly.call("HTTP.REQUEST", {
    method: "GET",
    url: url,
    timeout: HTTP_TIMEOUT_SEC,
    ssl_ca: "*"
  }, function(result, error_code, error_message) {
    httpHandleResponse(label, result, error_code, error_message);
  });
}

function httpHandleResponse(label, result, error_code, error_message) {
  if (label === "getUpdates") {
    isCheckingTelegram = false;
  }

  if (error_code !== 0) {
    print("Errore HTTP " + label + ": " + error_code + " " + error_message);
    return;
  }

  if (!result || result.code !== 200) {
    print("Errore HTTP " + label + " code=" + (result ? result.code : 0));
    return;
  }

  if (label === "getMe") {
    print("Test Telegram OK");
    return;
  }

  if (label === "getUpdates") {
    handleGetUpdatesBody(result.body);
    return;
  }

  if (label === "sendMessage") {
    print("Telegram inviato a chat " + pendingChatId);
    pendingChatId = 0;
  }
}

function handleGetUpdatesBody(body) {
  if (!body || body.length === 0) {
    return;
  }

  let data = null;
  try {
    data = JSON.parse(body);
  } catch (e) {
    print("Errore parse JSON getUpdates");
    return;
  }

  if (!data.ok || !data.result || data.result.length === 0) {
    return;
  }

  print("Ricevuti " + data.result.length + " messaggi Telegram");

  for (let i = 0; i < data.result.length; i++) {
    let update = data.result[i];
    lastUpdateId = update.update_id;

    if (!update.message || !update.message.text) {
      continue;
    }

    let text = update.message.text.trim().toLowerCase();
    let chatId = update.message.chat.id;

    print("Msg: " + text + " chat " + chatId);

    if (text === "/stato") {
      pendingChatId = chatId;
      let msg = messaggioStatoEntrambe("stato attuale", "stato attuale");
      let url = TG_API + "/sendMessage?chat_id=" + chatId + "&text=" + encodeURIComponent(msg);
      httpGet(url, "sendMessage");
    }
  }
}

function testInternetTelegram() {
  if (BOT_TOKEN.indexOf("INSERISCI") >= 0) {
    print("ATTENZIONE: inserisci BOT_TOKEN");
    return;
  }

  Shelly.call("HTTP.REQUEST", {
    method: "GET",
    url: "http://httpbin.org/get",
    timeout: HTTP_TIMEOUT_SEC
  }, function(res1, err1, msg1) {
    if (err1 !== 0) {
      print("Test HTTP base FALLITO: " + err1 + " " + msg1);
      print("Controlla DNS router 8.8.8.8");
      return;
    }
    print("Test HTTP base OK");
    httpGet(TG_API + "/getMe", "getMe");
  });
}

function stringToHexArray(str) {
  let hexArray = [];
  for (let i = 0; i < str.length; i++) {
    let hex = str.charCodeAt(i).toString(16);
    if (hex.length < 2) {
      hex = "0" + hex;
    }
    hexArray.push(hex);
  }
  return hexArray;
}

function getStato(byteStr) {
  if (byteStr === "00") {
    return "CHIUSA";
  }
  if (byteStr === "01") {
    return "APERTA";
  }
  return "SCONOSCIUTO";
}

function getColorEmoji(stato) {
  if (stato === "APERTA") {
    return "[A]";
  }
  if (stato === "CHIUSA") {
    return "[C]";
  }
  return "[?]";
}

function getTimestamp() {
  function pad(n) {
    return n < 10 ? "0" + n : n;
  }
  let now = new Date();
  return now.getFullYear() + "-" +
         pad(now.getMonth() + 1) + "-" +
         pad(now.getDate()) + " " +
         pad(now.getHours()) + ":" +
         pad(now.getMinutes()) + ":" +
         pad(now.getSeconds());
}

function mandaTelegram(msg, chatId) {
  pendingChatId = chatId;
  let url = TG_API + "/sendMessage?chat_id=" + chatId + "&text=" + encodeURIComponent(msg);
  httpGet(url, "sendMessage");
}

function inviaMessaggioTelegramPerEntrambi(msg) {
  mandaTelegram(msg, BOT1_CHAT_ID);
}

function messaggioStatoEntrambe(titoloSopra, titoloSotto) {
  return getColorEmoji(statoPortaSopra) + " SOPRA " + titoloSopra + ": " + statoPortaSopra + " " + getTimestamp() + "\n" +
         getColorEmoji(statoPortaSotto) + " SOTTO " + titoloSotto + ": " + statoPortaSotto + " " + getTimestamp();
}

function inviaStatoEntrambe() {
  let msg = messaggioStatoEntrambe("ok", "ok");
  print(msg);
  inviaMessaggioTelegramPerEntrambi(msg);
}

function confermaStatoPortaSopra() {
  statoPortaSopra = candidateStatoSopra;
  candidateStatoSopra = null;
  timerSopra = null;
  inviaStatoEntrambe();
}

function confermaStatoPortaSotto() {
  statoPortaSotto = candidateStatoSotto;
  candidateStatoSotto = null;
  timerSotto = null;
  inviaStatoEntrambe();
}

function processUpdate(mac, rssi, raw) {
  let bytes = stringToHexArray(raw);
  if (bytes.length <= 10) {
    return;
  }

  let stato = getStato(bytes[10]);

  if (mac === MAC_PORTA_SOPRA) {
    if (stato === statoPortaSopra) {
      return;
    }
    if (candidateStatoSopra !== stato) {
      candidateStatoSopra = stato;
      if (timerSopra) {
        Timer.clear(timerSopra);
      }
      timerSopra = Timer.set(STABILITA_MS, false, confermaStatoPortaSopra);
      print("SOPRA candidato: " + candidateStatoSopra);
    }
    return;
  }

  if (mac === MAC_PORTA_SOTTO) {
    if (stato === statoPortaSotto) {
      return;
    }
    if (candidateStatoSotto !== stato) {
      candidateStatoSotto = stato;
      if (timerSotto) {
        Timer.clear(timerSotto);
      }
      timerSotto = Timer.set(STABILITA_MS, false, confermaStatoPortaSotto);
      print("SOTTO candidato: " + candidateStatoSotto);
    }
  }
}

function startBleScanner() {
  if (!Shelly.getComponentConfig("ble").enable) {
    print("BLE non abilitato");
    return;
  }

  if (!BLE.Scanner.isRunning()) {
    BLE.Scanner.Start({ duration_ms: BLE.Scanner.INFINITE_SCAN, active: false });
  }

  BLE.Scanner.Subscribe(function(event, result) {
    if (event !== BLE.Scanner.SCAN_RESULT) {
      return;
    }

    let mac = result.addr.toLowerCase();
    if (mac !== MAC_PORTA_SOTTO && mac !== MAC_PORTA_SOPRA) {
      return;
    }
    if (!result.service_data) {
      return;
    }

    let keys = Object.keys(result.service_data);
    for (let i = 0; i < keys.length; i++) {
      processUpdate(mac, result.rssi, result.service_data[keys[i]]);
    }
  });

  print("Scanner BLE avviato");
}

function checkTelegramUpdates() {
  if (isCheckingTelegram) {
    return;
  }
  if (BOT_TOKEN.indexOf("INSERISCI") >= 0) {
    return;
  }

  isCheckingTelegram = true;
  let url = TG_API + "/getUpdates?offset=" + (lastUpdateId + 1) + "&limit=5&timeout=0";
  httpGet(url, "getUpdates");
}

startBleScanner();
testInternetTelegram();
Timer.set(TG_POLL_MS, true, checkTelegramUpdates);
