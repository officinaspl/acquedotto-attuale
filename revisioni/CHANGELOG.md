# Storico revisioni — Heltec acquedotto

## Convenzione (aggiornata)

| Cartella | Uso |
|----------|-----|
| `heltec_esp32_lora_acquedotto/` | **Sempre l'ultima versione** — unica cartella da modificare |
| `heltec_esp32_lora_acquedotto_revNNN/` | **Snapshot congelati** — si tengono solo gli **ultimi 3**; le più vecchie si eliminano |

### Prima di ogni modifica

1. Archivia lo stato attuale in `heltec_esp32_lora_acquedotto_revNNN/` (NNN = `SKETCH_REV` corrente).
2. Rinomina il `.ino` come la cartella; copia `oled_heltec_v2.h` e `secrets.h`.
3. Modifica solo la cartella principale; aumenta `SKETCH_REV`.
4. Se esistono più di 3 cartelle `_rev*`, elimina quelle con numero più basso.

### Arduino IDE

- **Ultima:** `heltec_esp32_lora_acquedotto/heltec_esp32_lora_acquedotto.ino`
- **Precedente:** es. `heltec_esp32_lora_acquedotto_rev007/heltec_esp32_lora_acquedotto_rev007.ino`

---

## Snapshot su disco (rotazione max 3)

| Cartella | Rev | Note |
|----------|-----|------|
| `heltec_esp32_lora_acquedotto_rev007/` | rev007 | OLED maiuscole, 3 pagine — archiviato maggio 2026 |

*rev004 rimossa (politica ultimi 3). rev005–rev006 non erano mai state archiviate.*

### rev008 — IP su OLED pagina sistema
- Pagina 1/3: riga `IP x.x.x.x` quando WiFi connesso (`IP: ---` altrimenti)
- Principale: `heltec_esp32_lora_acquedotto/` (SKETCH_REV 8)

---

## Elenco storico (testo)

### rev001 — Port iniziale Heltec
- Da MKR, WiFi + ThingSpeak + Maxbotix, OLED locale

### rev002 — Test sensore
- `SIMULA_SENSORE`, GPIO 17, simulazione da seriale

### rev003 — WiFi ESP32
- Fix connessione, scan reti, `RIAVVIO_MINUTI`

### rev004 — Stabile campo
- WiFi e ThingSpeak campo — *cartella eliminata*

### rev005 — OLED compatto 6 righe

### rev006 — OLED a pagine (3 s)

### rev007 — Fix caratteri OLED
- Archivio: `heltec_esp32_lora_acquedotto_rev007/`
- Principale: `heltec_esp32_lora_acquedotto/` (fino a prossima modifica → rev008)
