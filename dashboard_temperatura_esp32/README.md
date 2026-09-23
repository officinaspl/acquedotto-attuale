# Dashboard temperatura ESP32 (DS18B20)

Dashboard PHP per monitoraggio temperatura: **ingest compatibile** con l’ESP32 esistente + UI stile control-room.

## Cosa fa

- Accetta `GET ?temp=<float>` (obbligatorio) e `?rssi=<int>` (opzionale)
- Risponde `OK` e appende una riga a `storico_temperature.txt`
- Formato riga legacy: `d/m/Y|H:i:s|temp|rssi` (timezone `Europe/Rome`)
- Mostra metriche, grafico snello (Chart.js), tabella paginata, refresh via `?api=1`

**Non richiede modifiche al firmware ESP32.**

## Setup hosting

1. Carica la cartella `dashboard_temperatura_esp32/` sul server PHP (7.4+ / 8.x).
2. Assicurati che PHP possa scrivere `storico_temperature.txt` nella stessa cartella (permessi directory/file).
3. Apri nel browser: `https://tuodominio.tld/dashboard_temperatura_esp32/`

Test locale:

```bash
cd dashboard_temperatura_esp32
php -S 127.0.0.1:8080
```

Poi visita `http://127.0.0.1:8080/` e prova l’ingest:

```bash
curl "http://127.0.0.1:8080/?temp=23.45&rssi=-67"
# → OK
```

## URL ESP32 (esempio)

Senza chiave (legacy, come oggi):

```text
http://TUO_HOST/dashboard_temperatura_esp32/?temp=23.5&rssi=-70
```

Solo temperatura:

```text
http://TUO_HOST/dashboard_temperatura_esp32/?temp=23.5
```

## Chiave ingest opzionale (`INGEST_KEY`)

In `config.php` (oppure meglio in `config.local.php`, non versionato):

```php
define('INGEST_KEY', 'la-tua-chiave-segreta');
```

- Se `INGEST_KEY` è **stringa vuota** → nessun controllo (compatibilità totale).
- Se valorizzata → obbligatoria via `?key=...` oppure header `X-Ingest-Key`.

Esempio con chiave:

```text
http://TUO_HOST/dashboard_temperatura_esp32/?temp=23.5&rssi=-70&key=la-tua-chiave-segreta
```

Su Apache, `.htaccess` blocca l’accesso HTTP diretto a `config.php` / `config.local.php`.

## Validazione

| Campo | Regola |
|-------|--------|
| `temp` | numerico, finito, tra −55 e 125 °C |
| `rssi` | se presente: intero tra −120 e 0 dBm |
| `key`  | solo se `INGEST_KEY` non vuota |

Errori tipici (testo plain): `FORBIDDEN`, `BAD_TEMP`, `TEMP_RANGE`, `BAD_RSSI`, `RSSI_RANGE`, `WRITE_ERR`.

## Compatibilità storico

- Legge e scrive lo stesso file `storico_temperature.txt`.
- Righe vuote o malformate vengono ignorate in lettura (niente `trim` ingenuo sull’intero file).
- Nessuna migrazione obbligatoria: puoi lasciare il file già presente sul server.

## File

| File | Ruolo |
|------|-------|
| `index.php` | ingest + API JSON + HTML dashboard |
| `config.php` | impostazioni di default |
| `config.local.php` | override locali (opzionale, gitignored) |
| `assets/dashboard.css` | stile SCADA / dark tech |
| `assets/dashboard.js` | countdown, Chart.js, refresh API |
| `storico_temperature.txt` | storico misure |

## Note

- Firmware / sketch ESP in altre cartelle del repo: **non toccati**.
- Chart.js caricato da CDN jsDelivr; offline serve solo la tabella/metriche se il CDN non è raggiungibile.
