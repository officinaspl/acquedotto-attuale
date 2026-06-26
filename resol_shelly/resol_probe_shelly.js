// =============================================================================

// Shelly Plus — test DeltaSol SLT (risultato su webhook.site, anche da remoto)

// =============================================================================

//

// 1. Cambia sltIp con l'IP del tuo DeltaSol / modulo LAN Resol

// 2. App Shelly → Scripts → incolla tutto → Save → Enable

// 3. Apri https://webhook.site/0c807e5a-6345-43ef-9352-3d0709032956

//

// Revisione: rev004



let CONFIG = {

  // IP del DeltaSol SLT sulla rete di casa (menu rete Resol o router)

  sltIp: "192.168.1.XX",



  webhookUrl: "https://webhook.site/0c807e5a-6345-43ef-9352-3d0709032956",



  virtualId: 200,

  urls: [

    "/",

    "/current/current_packets.vbus",

    "/dlx/download/live"

  ]

};



let lastProbe = { sltIp: CONFIG.sltIp, tested: [], time: 0 };

let pending = 0;



function byteAt(s, i) {

  return s.charCodeAt(i) & 0xff;

}



function showInApp(text) {

  Shelly.call("Text.Set", { id: CONFIG.virtualId, value: text });

}



function sendRemote(payload) {

  Shelly.call("KVS.Set", { key: "resol_probe", value: JSON.stringify(payload) });



  Shelly.call("HTTP.POST", {

    url: CONFIG.webhookUrl,

    headers: [["Content-Type", "application/json"]],

    body: JSON.stringify(payload),

    timeout: 15

  }, function (res, ec, em) {

    if (ec !== 0) {

      print("Webhook err " + ec + " " + em);

    } else {

      print("Webhook OK code " + (res ? res.code : "?"));

    }

  });

}



function buildSummary() {

  let lines = ["Resol " + CONFIG.sltIp, ""];

  for (let i = 0; i < lastProbe.tested.length; i++) {

    let e = lastProbe.tested[i];

    lines.push(e.path);

    lines.push("HTTP " + (e.code !== null ? e.code : "err"));

    if (e.hint) {

      lines.push(e.hint);

    }

    lines.push("");

  }

  return lines.join("\n");

}



function probeDone() {

  pending = pending - 1;

  if (pending > 0) {

    return;

  }

  lastProbe.time = Date.now();

  showInApp(buildSummary());

  sendRemote(lastProbe);

  print(buildSummary());

}



function probeUrl(path) {

  let url = "http://" + CONFIG.sltIp + path;



  Shelly.call("HTTP.GET", { url: url, timeout: 12 }, function (res, ec, em) {

    let entry = { path: path, code: null, bodyLen: 0, hint: "" };



    if (ec !== 0) {

      entry.hint = "Shelly err " + ec;

    } else {

      entry.code = res ? res.code : null;



      if (res && res.body) {

        entry.bodyLen = res.body.length;



        if (path.indexOf("current_packets") >= 0 && res.code === 200 && res.body.length > 20) {

          entry.hint = byteAt(res.body, 0) === 0xa5 ? "OK VBus — km2_direct" : "200 ma non VBus";

        } else if (path.indexOf("dlx/download") >= 0 && res.body.indexOf("headersets") >= 0) {

          entry.hint = "OK JSON temperature";

        } else if (path === "/" && res.code === 200) {

          entry.hint = "Web OK";

        } else if (res.code === 404) {

          entry.hint = "Non trovato (404)";

        } else if (entry.code !== 200) {

          entry.hint = "Risposta " + entry.code;

        }

      } else if (res && res.code === 404) {

        entry.hint = "Non trovato (404)";

      }

    }



    lastProbe.tested.push(entry);

    probeDone();

  });

}



function runProbe() {

  lastProbe.tested = [];

  pending = CONFIG.urls.length;

  showInApp("Test in corso...\nResol " + CONFIG.sltIp);



  for (let i = 0; i < CONFIG.urls.length; i++) {

    probeUrl(CONFIG.urls[i]);

  }

}



Shelly.call("Virtual.Add", {

  type: "text",

  id: CONFIG.virtualId,

  config: { name: "Resol test", default_value: "Avvio..." }

}, function (res, ec) {

  if (ec !== 0) {

    print("Virtual.Add err " + ec);

  }

  runProbe();

});



Timer.set(120000, true, runProbe);

