// =============================================================================
// Shelly Plus — lettura temperature sonde Resol (DeltaSol SLT via bridge JSON)
// =============================================================================
//
// IMPORTANTE: il DeltaSol SLT non ha API HTTP. Parla VBus (o tramite KM2/DL2/
// VBus-LAN). Lo Shelly legge solo HTTP, quindi serve un bridge sulla rete che
// espone JSON, ad esempio:
//   http://192.168.1.50:3333/api/v1/live-data/
// (resol-vbus json-live-data-server su Raspberry/PC)
//
// Configura qui sotto, poi incolla in Shelly: Scripts → Add script → Enable
//
// Revisione: rev001

// --- CONFIGURAZIONE ---
let CONFIG = {
  // URL del bridge JSON (array di sensori Resol)
  bridgeUrl: "http://192.168.1.50:3333/api/v1/live-data/",

  // Intervallo lettura (ms)
  pollMs: 60000,

  // Password VBus del bridge (solo se il tuo bridge la richiede in URL/header)
  // Lascia "" se non serve
  bridgeUser: "",
  bridgePass: "",

  // Nomi sensori da salvare (match parziale, maiuscolo/minuscolo ignorato)
  // Esempio Resol: "Temperature sensor 1", "Temperature sensor 2"
  sensorFilter: "temperature"
};

// --- STATO ---
let lastTemps = {};
let lastUpdate = 0;
let lastError = "";

// Salva temperature in KVS Shelly (leggibili da scene/altri script)
function saveToKvs() {
  Shelly.call("KVS.Set", { key: "resol_temps", value: JSON.stringify(lastTemps) });
  Shelly.call("KVS.Set", { key: "resol_updated", value: String(lastUpdate) });
  Shelly.call("KVS.Set", { key: "resol_error", value: lastError });
}

// Filtra solo sonde temperatura dal JSON del bridge resol-vbus
function parseLiveData(body) {
  let list = JSON.parse(body);
  if (!Array.isArray(list)) {
    throw "JSON non valido: atteso array";
  }

  let found = {};
  let filter = CONFIG.sensorFilter.toLowerCase();

  for (let i = 0; i < list.length; i++) {
    let item = list[i];
    if (!item.name) {
      continue;
    }
    let name = String(item.name);
    if (name.toLowerCase().indexOf(filter) < 0) {
      continue;
    }
    // rawValue Resol: spesso in decimi di grado (es. 235 = 23.5 C)
    // Se il valore e gia in gradi, adatta il divisore
    let raw = Number(item.rawValue);
    if (isNaN(raw)) {
      continue;
    }
    let celsius = raw / 10.0;
    if (Math.abs(celsius) > 200) {
      celsius = raw;
    }
    found[name] = celsius;
  }

  if (Object.keys(found).length === 0) {
    throw "Nessuna sonda temperatura nel JSON";
  }
  return found;
}

// Richiesta HTTP al bridge
function pollResol() {
  let opts = { url: CONFIG.bridgeUrl, timeout: 15 };

  // Se il bridge richiede auth, usa URL tipo http://user:pass@192.168.x.x:3333/...

  Shelly.call("HTTP.GET", opts, function (res, error_code, error_message) {
    if (error_code !== 0) {
      lastError = "HTTP err " + error_code + ": " + error_message;
      print(lastError);
      saveToKvs();
      return;
    }
    if (!res || res.code !== 200) {
      lastError = "HTTP code " + (res ? res.code : "?");
      print(lastError);
      saveToKvs();
      return;
    }

    try {
      lastTemps = parseLiveData(res.body);
      lastUpdate = Date.now();
      lastError = "";

      for (let name in lastTemps) {
        print(name + ": " + lastTemps[name].toFixed(1) + " C");
      }
      saveToKvs();
    } catch (e) {
      lastError = String(e);
      print("Parse error: " + lastError);
      saveToKvs();
    }
  });
}

// Endpoint locale: http://IP_SHELLY/script/N/resol
// Risposta JSON con ultime temperature lette
function httpCallback(request, response) {
  let out = {
    updated: lastUpdate,
    error: lastError,
    temps: lastTemps
  };
  response(200, { "Content-Type": "application/json" }, JSON.stringify(out));
}

HTTPServer.registerEndpoint("resol", httpCallback);

print("Resol poll avviato ogni " + CONFIG.pollMs + " ms");
print("Bridge: " + CONFIG.bridgeUrl);
pollResol();
Timer.set(CONFIG.pollMs, true, pollResol);
