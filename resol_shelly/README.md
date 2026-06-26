# Resol DeltaSol SLT → Shelly Plus (solo Shelly)

## Cosa serve in casa (nessun componente extra)

| Hai gia | Soluzione | Costo aggiuntivo |
|---------|-----------|------------------|
| **KM2** o **DL2/DL3** sulla LAN | Script `resol_km2_direct_shelly.js` | **0 €** (solo Shelly) |
| Solo **SLT** senza modulo LAN | Impossibile via rete | Serve KM2/VBus-LAN (~100 €) |
| Solo **VBus/LAN** (no KM2) | Impossibile con Shelly | VBus/LAN ha solo TCP 7053, non HTTP |

Il **DeltaSol SLT** non ha Ethernet: parla **VBus** sul cavo. Per leggerlo in rete serve un modulo Resol gia installato (spesso il **KM2** e gia nel impianto solare).

---

## Soluzione consigliata — solo Shelly + KM2

```
DeltaSol SLT ──VBus──► KM2 (gia in rete)
                         │
                         ▼ HTTP binario
                    Shelly Plus (script)
```

### Passo 1 — Verifica KM2

Dal PC, apri nel browser:

```
http://IP_KM2/current/current_packets.vbus
```

Se scarica un file (anche illeggibile), il KM2 risponde e lo Shelly puo leggerlo.

### Passo 2 — Script Shelly

1. Shelly app / web → **Scripts**
2. Incolla `resol_km2_direct_shelly.js`
3. Modifica l'IP del KM2:

```javascript
km2Url: "http://192.168.1.40/current/current_packets.vbus",
pollMs: 60000,
```

4. **Enable** lo script

### Cosa fa lo script

- Ogni 60 s scarica `current_packets.vbus` dal KM2
- Cerca il pacchetto **DeltaSol SLT** (indirizzo VBus `0x1001`)
- Estrae **Temperature sensor 1..4**
- Salva in KVS Shelly: `resol_temps`, `resol_updated`, `resol_error`
- Espone: `http://IP_SHELLY/script/N/resol`

### Test

Nel log dello script devono comparire righe tipo:

```
Temperature sensor 1: 45.2 C
Temperature sensor 2: 38.1 C
```

---

## Quando NON basta lo Shelly

| Situazione | Perche |
|------------|--------|
| SLT senza KM2/DL | Nessuna IP sulla rete |
| Solo VBus/LAN | Protocollo TCP 7053, Shelly fa solo HTTP |
| KM2 spento o su altra rete VLAN | HTTP non raggiungibile |

In quei casi serve hardware Resol aggiuntivo, non un Raspberry.

---

## Script alternativo (solo se hai gia un PC/Raspberry acceso)

`resol_temperature_shelly.js` — legge JSON da bridge `resol-vbus` su porta 3333.  
Usalo **solo** se hai gia un server sempre acceso; altrimenti usa `resol_km2_direct_shelly.js`.

---

## Test da remoto (non sulla rete Shelly/Resol)

L'IP locale `http://192.168.x.x` **non funziona** se il tuo telefono/PC è su un'altra rete.

### Metodo webhook.site (semplice)

1. Apri [https://webhook.site](https://webhook.site) da qualsiasi posto
2. Copia l'URL unico che ti assegna (es. `https://webhook.site/abc-123...`)
3. Nell'app Shelly → Scripts → `resol_probe_shelly.js` → incolla in `webhookUrl`
4. Save → Enable
5. Torna su webhook.site: dopo ~1 minuto compare il JSON con il risultato del test

Lo Shelly (sulla rete del Resol) interroga il DeltaSol e **ti manda il risultato su Internet**.

---

## Info utili per configurazione

1. Interfaccia LAN: **KM2**, **DL2**, **DL3** o **LAN integrata SLT**?
2. IP del modulo Resol / SLT
3. Modello Shelly Plus
4. Quante sonde Pt1000 sono collegate (S1..S4)
