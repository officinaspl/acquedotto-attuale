// =============================================================================

// Shelly Plus — temperature Resol DeltaSol SLT SOLO via KM2 (nessun bridge)

// =============================================================================

//

// Requisito: modulo KM2 (o DL2/DL3) gia collegato al SLT sulla LAN.

// Lo Shelly scarica il file binario VBus esposto in HTTP dal KM2 e lo decodifica.

//

// NON funziona con:

//   - SLT senza interfaccia LAN (solo cavo VBus)

//   - VBus/LAN (solo TCP porta 7053, non HTTP)

//

// Configura km2Url sotto, poi Shelly: Scripts → Add script → Enable

//

// Revisione: rev001



// --- CONFIGURAZIONE ---

let CONFIG = {

  // URL file VBus corrente sul KM2 (o DL2/DL3)

  km2Url: "http://192.168.1.40/current/current_packets.vbus",



  // Intervallo lettura (ms)

  pollMs: 60000,



  // Indirizzo VBus DeltaSol SLT (standard Resol)

  sltSource: 0x1001,

  sltDest: 0x0010,

  sltCommand: 0x0100,



  // Offset nel frame dati del pacchetto SLT (da specifica resol-vbus 0x1001)

  // Temperature sensor 1..4

  tempOffsets: [4, 6, 8, 10]

};



// --- STATO ---

let lastTemps = {};

let lastUpdate = 0;

let lastError = "";



function saveToKvs() {

  Shelly.call("KVS.Set", { key: "resol_temps", value: JSON.stringify(lastTemps) });

  Shelly.call("KVS.Set", { key: "resol_updated", value: String(lastUpdate) });

  Shelly.call("KVS.Set", { key: "resol_error", value: lastError });

}



// Legge un byte da stringa binaria Shelly (0..255)

function byteAt(body, i) {

  return body.charCodeAt(i) & 0xff;

}



// UInt16 little-endian

function u16le(body, i) {

  return byteAt(body, i) | (byteAt(body, i + 1) << 8);

}



// Temperatura VBus: 16 bit signed, fattore 0.1 C

function decodeTemp(body, offset) {

  let lsb = byteAt(body, offset);

  let msb = byteAt(body, offset + 1);

  let raw;

  if (msb > 127) {

    raw = (65536 - msb * 256 - lsb) * -1;

  } else {

    raw = msb * 256 + lsb;

  }

  return raw * 0.1;

}



// Cerca pacchetto SLT nel file recording VBus (record tipo 0x66)

function findSltFrame(body) {

  let pos = 0;

  let len = body.length;

  let frame = null;



  while (pos + 14 < len) {

    if (byteAt(body, pos) !== 0xa5) {

      pos += 1;

      continue;

    }



    let recType = byteAt(body, pos + 1);

    let recLen = u16le(body, pos + 2);

    if (recLen < 14 || pos + recLen > len) {

      pos += 1;

      continue;

    }



    if (recType === 0x66) {

      let base = pos + 0x0e;

      let dest = u16le(body, base);

      let source = u16le(body, base + 2);

      let command = u16le(body, base + 6);

      let frameLen = u16le(body, base + 8);



      if (

        source === CONFIG.sltSource &&

        dest === CONFIG.sltDest &&

        command === CONFIG.sltCommand &&

        frameLen > 0

      ) {

        let dataStart = base + 12;

        if (dataStart + frameLen <= pos + recLen) {

          frame = body.substring(dataStart, dataStart + frameLen);

        }

      }

    }



    pos += recLen;

  }



  if (!frame || frame.length < 12) {

    throw "Pacchetto SLT non trovato nel file KM2";

  }

  return frame;

}



function parseKm2Vbus(body) {

  let frame = findSltFrame(body);

  let temps = {};



  for (let n = 0; n < CONFIG.tempOffsets.length; n++) {

    let off = CONFIG.tempOffsets[n];

    if (off + 1 >= frame.length) {

      continue;

    }

    let t = decodeTemp(frame, off);

    // 888.8 / 999.9 = sonda non collegata su Resol

    if (t > 200 || t < -50) {

      continue;

    }

    temps["Temperature sensor " + (n + 1)] = t;

  }



  if (Object.keys(temps).length === 0) {

    throw "Nessuna temperatura valida nel pacchetto SLT";

  }

  return temps;

}



function pollKm2() {

  Shelly.call("HTTP.GET", { url: CONFIG.km2Url, timeout: 15 }, function (res, error_code, error_message) {

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

    if (!res.body || res.body.length < 50) {

      lastError = "Risposta KM2 troppo corta";

      print(lastError);

      saveToKvs();

      return;

    }



    try {

      lastTemps = parseKm2Vbus(res.body);

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

function httpCallback(request, response) {

  let out = {

    updated: lastUpdate,

    error: lastError,

    temps: lastTemps,

    source: "km2-direct"

  };

  response(200, { "Content-Type": "application/json" }, JSON.stringify(out));

}



HTTPServer.registerEndpoint("resol", httpCallback);



print("Resol KM2 direct — poll ogni " + CONFIG.pollMs + " ms");

print("KM2: " + CONFIG.km2Url);

pollKm2();

Timer.set(CONFIG.pollMs, true, pollKm2);

