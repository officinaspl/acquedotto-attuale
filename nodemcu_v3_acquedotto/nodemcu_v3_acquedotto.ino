/*
 * NodeMCU V3 (ESP8266) — livello vasca acquedotto
 *
 * Port da heltec_esp32_lora_acquedotto rev008 (senza OLED).
 * Sensore: Maxbotix MB7060 (PWM). Livello (cm) = 408 − distanza.
 * Invio ThingSpeak campo 1, canale in secrets.h.
 *
 * Cablaggio MB7060 → NodeMCU V3:
 *   GND sensore (pin 7) → GND scheda
 *   V+  sensore (pin 6) → 3V3 o 5V (MB7060 max 5,5 V)
 *   PW  sensore (pin 2) → D5 (GPIO 14)
 *
 * LED onboard su D4 (GPIO2), logica invertita: lampeggi = stato WiFi/ThingSpeak.
 * Nessun display: diagnostica solo su Monitor Seriale (SERIAL_DEBUG 1).
 *
 * Arduino IDE → Scheda: "NodeMCU 1.0 (ESP-12E Module)"
 * Librerie: ESP8266 core, ThingSpeak
 * Campo: SERIAL_DEBUG 0, SIMULA_SENSORE commentato.
 * Casa/test USB: SERIAL_DEBUG 1 oppure SIMULA_SENSORE per valori finti.
 *
 * Revisione: rev003 — commenti completi
 */

#define SKETCH_REV 3
#define SKETCH_REV_STR "rev003"

// 1 = messaggi su Monitor Seriale (WiFi, ThingSpeak, livello)
#define SERIAL_DEBUG 1

// Monitor Seriale USB: di solito uguale a SERIAL_DEBUG
#define SERIAL_USB_ON  SERIAL_DEBUG

// LED onboard NodeMCU su D4 (GPIO2), logica invertita
#define LED_ON   LOW
#define LED_OFF  HIGH

// --- Test a casa senza MB7060: decommenta ---
 #define SIMULA_SENSORE 1

// ========== IMPOSTAZIONI ==========
// Riavvio programmato della scheda (indipendente da WiFi/ThingSpeak)
const unsigned long RIAVVIO_MINUTI = 1440;
// =================================

#include <ESP8266WiFi.h>
#include "secrets.h"
#include "ThingSpeak.h"

// --- Pin e sensore MB7060 (PWM diretto, 58 us/cm) ---
const uint8_t PIN_SENSORE_PWM = 14; // D5 su silkscreen NodeMCU
const int VASCA_ALTEZZA_CM = 408;
const unsigned long US_PER_CM = 58;
const unsigned long TIMEOUT_PW_US = 80000;
const int MB7060_DIST_MIN_CM = 20;
const int MB7060_DIST_MAX_CM = 765;

#if defined(SIMULA_SENSORE)
static int distanzaSimulataCm = 74;
static bool simNuovoValore = false;

// Comandi da Monitor Seriale: 74 = distanza cm, L334 = livello cm, ? = aiuto
void gestisciInputSerialeSim() {
  while (Serial.available()) {
    String linea = Serial.readStringUntil('\n');
    linea.trim();
    if (linea.length() == 0) {
      continue;
    }

    if (linea.equalsIgnoreCase("?") || linea.equalsIgnoreCase("help")) {
      Serial.println(F("=== Simulazione sensore ==="));
      Serial.println(F("Scrivi un numero e premi Invio:"));
      Serial.println(F("  74      distanza cm (come MB7060)"));
      Serial.println(F("  L334    livello acqua cm"));
      Serial.println(F("  ?       questo aiuto"));
      continue;
    }

    int dist = 0;
    char primo = linea.charAt(0);
    if (primo == 'L' || primo == 'l') {
      int liv = linea.substring(1).toInt();
      if (liv > 0 && liv < VASCA_ALTEZZA_CM) {
        dist = VASCA_ALTEZZA_CM - liv;
      }
    } else {
      dist = linea.toInt();
    }

    if (dist >= MB7060_DIST_MIN_CM && dist <= MB7060_DIST_MAX_CM) {
      distanzaSimulataCm = dist;
      simNuovoValore = true;
      Serial.print(F("OK  dist="));
      Serial.print(dist);
      Serial.print(F(" cm   liv="));
      Serial.println(VASCA_ALTEZZA_CM - dist);
    } else {
      Serial.println(F("Fuori range: distanza 20-765 cm"));
    }
  }
}
#endif

// --- Tempi ---
const unsigned long INTERVALLO_WIFI_MS = 30000;
const unsigned long WIFI_ATTESA_CONN_MS = 60000;
const unsigned long WIFI_IDLE_MAX_MS = 90000;
const unsigned long WIFI_TIMEOUT_SETUP_MS = 60000;
const unsigned long INTERVALLO_SENSORE_MS = 100;
const unsigned long INTERVALLO_THINGSPEAK_MS = 30000;
const unsigned long TIMEOUT_SENZA_INVIO_MS = 600000; // 10 min senza invio OK → riavvio
const unsigned long RIAVVIO_MS = RIAVVIO_MINUTI * 60UL * 1000UL;
const unsigned long MAX_ETA_DATI_MS = 120000;
const unsigned long PAUSA_RETRY_THINGSPEAK_MS = 2000;

// --- Media mobile e filtro outlier ---
const int NUM_LETTURE = 10;
const int MIN_CAMPIONI_PER_INVIO = 3;
const int SOGLIA_SCARTO_PERCENT = 10;
const int MAX_TENTATIVI_INVIO_TS = 3;

char ssid[] = SECRET_SSID;
char pass[] = SECRET_PASS;
WiFiClient client;

unsigned long myChannelNumber = SECRET_CH_ID;
const char* myWriteAPIKey = SECRET_WRITE_APIKEY;

int lettureLivello[NUM_LETTURE];
int indiceLettura = 0;
long sommaMediaMobile = 0;
int campioniValidi = 0;

unsigned long ultimoInvioSuccesso = 0;
unsigned long ultimoTentativoWiFi = 0;
unsigned long wifiUltimoBeginMs = 0;
unsigned long timerLetturaSensore = 0;
unsigned long timerInvioThingSpeak = 0;
unsigned long ultimaLetturaValidaMs = 0;
unsigned long momentoAvvio = 0;
unsigned int tentativiWiFiFalliti = 0;

float ultimoLivelloCm = -1.0f;
int ultimaDistanzaCm = 0;
int ultimoCodiceThingSpeak = 0;
bool lampeggioWiFiFatto = false;

unsigned long timerLogStatoSerial = 0;
const unsigned long INTERVALLO_LOG_SERIAL_MS = 30000;

void avviaSerialUsb() {
#if SERIAL_USB_ON || defined(SIMULA_SENSORE)
  Serial.begin(115200);
  delay(400);
  Serial.println();
  Serial.println(F("=== Acquedotto NodeMCU V3 ==="));
  Serial.println(F(SKETCH_REV_STR));
  Serial.println(F("Monitor: 115200 baud, fine riga = Nuova riga"));
  Serial.print(F("Riavvio programmato ogni "));
  Serial.print(RIAVVIO_MINUTI);
  Serial.println(F(" min"));
#if defined(SIMULA_SENSORE)
  Serial.println(F("SIMULA_SENSORE: scrivi 74 o L334 o ?"));
#else
  Serial.println(F("Sensore reale su D5 (GPIO 14, PWM)"));
#endif
#endif
}

#if SERIAL_DEBUG
// Stampa ogni 30 s WiFi, livello, campioni e ultimo codice ThingSpeak
void logStatoPeriodico() {
  if (millis() - timerLogStatoSerial < INTERVALLO_LOG_SERIAL_MS) {
    return;
  }
  timerLogStatoSerial = millis();

  Serial.print(F("WiFi: "));
  Serial.print(WiFi.status() == WL_CONNECTED ? F("OK") : F("NO"));
  Serial.print(F("  Liv: "));
  if (ultimoLivelloCm > 0.0f) {
    Serial.print(ultimoLivelloCm, 1);
  } else {
    Serial.print(F("---"));
  }
  Serial.print(F(" cm  campioni: "));
  Serial.print(campioniValidi);
  Serial.print(F("  TS: "));
  Serial.println(ultimoCodiceThingSpeak);
}
#endif

void riavviaScheda(const char* motivo) {
#if SERIAL_USB_ON || SERIAL_DEBUG
  Serial.print(F("Riavvio: "));
  Serial.println(motivo);
  Serial.flush();
  delay(50);
#else
  (void)motivo;
#endif
  ESP.restart();
}

// Lampeggio LED onboard (5× = WiFi OK, 10× rapido = ThingSpeak OK, 3× lento = errore)
void lampeggio(int volte, int msOn, int msOff) {
  for (int i = 0; i < volte; i++) {
    digitalWrite(LED_BUILTIN, LED_ON);
    delay(msOn);
    digitalWrite(LED_BUILTIN, LED_OFF);
    delay(msOff);
  }
}

// Legge impulso PWM MB7060 e converte in distanza cm
int leggiDistanzaCm() {
#if defined(SIMULA_SENSORE)
  return distanzaSimulataCm;
#else
  unsigned long pw = pulseIn(PIN_SENSORE_PWM, HIGH, TIMEOUT_PW_US);
  if (pw == 0) {
    return 0;
  }
  return (int)((pw / US_PER_CM) + 0.5f);
#endif
}

// Livello vasca = altezza fissa − distanza; scarta fuori range o ≤ 0
int distanzaToLivello(int distanzaCm) {
  if (distanzaCm < MB7060_DIST_MIN_CM || distanzaCm > MB7060_DIST_MAX_CM) {
    return -1;
  }
  int livello = VASCA_ALTEZZA_CM - distanzaCm;
  if (livello <= 0 || livello > VASCA_ALTEZZA_CM) {
    return -1;
  }
  return livello;
}

void resetBufferLetture() {
  for (int i = 0; i < NUM_LETTURE; i++) {
    lettureLivello[i] = 0;
  }
  sommaMediaMobile = 0;
  indiceLettura = 0;
  campioniValidi = 0;
}

// Media mobile circolare su NUM_LETTURE campioni
void aggiornaMediaMobile(int livelloCm) {
  sommaMediaMobile -= lettureLivello[indiceLettura];
  lettureLivello[indiceLettura] = livelloCm;
  sommaMediaMobile += livelloCm;
  indiceLettura = (indiceLettura + 1) % NUM_LETTURE;
  if (campioniValidi < NUM_LETTURE) {
    campioniValidi++;
  }
  ultimaLetturaValidaMs = millis();
  ultimoLivelloCm = (float)livelloCm;
}

void registraLetturaSensore(int distanzaCm, int livelloCm) {
  if (distanzaCm > 0) {
    ultimaDistanzaCm = distanzaCm;
  }
  aggiornaMediaMobile(livelloCm);
}

float mediaLivello() {
  if (campioniValidi == 0) {
    return 0.0f;
  }
  return (float)sommaMediaMobile / (float)campioniValidi;
}

// Dati troppo vecchi: azzera buffer al prossimo ciclo
bool datiSonoObsoleti() {
  if (campioniValidi == 0 || ultimaLetturaValidaMs == 0) {
    return false;
  }
  return (millis() - ultimaLetturaValidaMs) > MAX_ETA_DATI_MS;
}

// Serve almeno MIN_CAMPIONI_PER_INVIO letture recenti per inviare
bool datiSonoFreschi() {
  if (campioniValidi < MIN_CAMPIONI_PER_INVIO || ultimaLetturaValidaMs == 0) {
    return false;
  }
  return (millis() - ultimaLetturaValidaMs) <= MAX_ETA_DATI_MS;
}

// Scarta picchi oltre SOGLIA_SCARTO_PERCENT rispetto alla media
bool livelloCoerenteConMedia(int nuovoCm) {
  if (campioniValidi == 0) {
    return true;
  }
  int riferimento = (int)(mediaLivello() + 0.5f);
  if (riferimento < 1) {
    riferimento = 1;
  }
  int delta = abs(nuovoCm - riferimento);
  return (delta * 100) <= (riferimento * SOGLIA_SCARTO_PERCENT);
}

#if SERIAL_DEBUG
const char* nomeCifraturaWiFi(uint8_t enc) {
  switch (enc) {
    case ENC_TYPE_NONE: return "APERTA";
    case ENC_TYPE_WEP: return "WEP";
    case ENC_TYPE_TKIP: return "WPA";
    case ENC_TYPE_CCMP: return "WPA2 OK";
    default: return "?";
  }
}

void scanRetiDebug() {
  Serial.println(F("Scan reti WiFi (2.4 GHz)..."));
  int n = WiFi.scanNetworks();
  if (n <= 0) {
    Serial.println(F("  Nessuna rete trovata"));
    return;
  }
  bool trovata = false;
  for (int i = 0; i < n; i++) {
    Serial.print(F("  "));
    Serial.print(WiFi.SSID(i));
    Serial.print(F("  "));
    Serial.print(WiFi.RSSI(i));
    Serial.print(F(" dBm  "));
    Serial.println(nomeCifraturaWiFi(WiFi.encryptionType(i)));
    if (WiFi.SSID(i) == ssid) {
      trovata = true;
    }
  }
  Serial.print(F("Rete configurata \""));
  Serial.print(ssid);
  Serial.println(trovata ? F("\": TROVATA") : F("\": NON in lista"));
}
#endif

#if SERIAL_DEBUG
const char* nomeStatoWiFi(wl_status_t s) {
  switch (s) {
    case WL_IDLE_STATUS: return "in connessione (0)";
    case WL_NO_SSID_AVAIL: return "rete non trovata (1)";
    case WL_CONNECTED: return "connesso (3)";
    case WL_CONNECT_FAILED: return "password/tipo rete (4)";
    case WL_CONNECTION_LOST: return "persa (5)";
    case WL_DISCONNECTED: return "disconnesso (6)";
    default: return "?";
  }
}
#endif

// Attesa connessione con timeout; non richiama WiFi.begin durante idle
bool attendiWiFiCollegato(unsigned long timeoutMs) {
  unsigned long start = millis();
  while (millis() - start < timeoutMs) {
    wl_status_t s = WiFi.status();
    if (s == WL_CONNECTED) {
      return true;
    }
    if (s == WL_CONNECT_FAILED || s == WL_NO_SSID_AVAIL) {
      return false;
    }
    delay(300);
  }
  return WiFi.status() == WL_CONNECTED;
}

void tentaConnessioneWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.persistent(false);
  WiFi.disconnect();
  delay(200);
  WiFi.begin(ssid, pass);
  wifiUltimoBeginMs = millis();
  ultimoTentativoWiFi = millis();
#if SERIAL_DEBUG
  Serial.print(F("WiFi.begin -> \""));
  Serial.print(ssid);
  Serial.println(F("\""));
#endif
}

void gestisciWiFi() {
  wl_status_t stato = WiFi.status();

  if (stato == WL_CONNECTED) {
    if (!lampeggioWiFiFatto) {
      lampeggio(5, 200, 200);
      lampeggioWiFiFatto = true;
#if SERIAL_DEBUG
      Serial.print(F("WiFi OK  IP "));
      Serial.println(WiFi.localIP());
#endif
    }
    tentativiWiFiFalliti = 0;
    return;
  }

  lampeggioWiFiFatto = false;

  unsigned long daBegin = millis() - wifiUltimoBeginMs;

  // Stato 0 = connessione in corso: NON chiamare di nuovo WiFi.begin
  if (stato == WL_IDLE_STATUS && daBegin < WIFI_IDLE_MAX_MS) {
    return;
  }

  // Attesa minima dopo ogni begin (tranne fallimento chiaro)
  if (daBegin < WIFI_ATTESA_CONN_MS &&
      stato != WL_CONNECT_FAILED && stato != WL_NO_SSID_AVAIL) {
    return;
  }

  if (millis() - ultimoTentativoWiFi < INTERVALLO_WIFI_MS) {
    return;
  }

  tentativiWiFiFalliti++;

#if SERIAL_DEBUG
  Serial.print(F("WiFi retry "));
  Serial.println(nomeStatoWiFi(stato));
#endif

  tentaConnessioneWiFi();
}

#if SERIAL_DEBUG
void logErroreThingSpeak(int codice, int tentativo) {
  Serial.print(F("ThingSpeak "));
  Serial.print(tentativo);
  Serial.print(F("/"));
  Serial.print(MAX_TENTATIVI_INVIO_TS);
  Serial.print(F(" codice "));
  Serial.println(codice);
}
#endif

// Invio campo 1 ThingSpeak con MAX_TENTATIVI_INVIO_TS retry
int inviaLivelloThingSpeak(float livelloMedio) {
  int ultimaRisposta = -301;

  for (int tentativo = 1; tentativo <= MAX_TENTATIVI_INVIO_TS; tentativo++) {
    client.stop();
    delay(200);

    ThingSpeak.setField(1, livelloMedio);
    ultimaRisposta = ThingSpeak.writeFields(myChannelNumber, myWriteAPIKey);
    ultimoCodiceThingSpeak = ultimaRisposta;

    if (ultimaRisposta == 200) {
      ultimoLivelloCm = livelloMedio;
      return 200;
    }

#if SERIAL_DEBUG
    logErroreThingSpeak(ultimaRisposta, tentativo);
#endif

    if (tentativo < MAX_TENTATIVI_INVIO_TS) {
      delay(PAUSA_RETRY_THINGSPEAK_MS);
    }
  }

  return ultimaRisposta;
}

void setup() {
  avviaSerialUsb();

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LED_OFF);
  pinMode(PIN_SENSORE_PWM, INPUT);

  resetBufferLetture();

  ThingSpeak.begin(client);
  momentoAvvio = millis();
  ultimoInvioSuccesso = momentoAvvio;

#if SERIAL_DEBUG
  scanRetiDebug();
  delay(500);
#endif
  tentaConnessioneWiFi();

#if SERIAL_DEBUG
  Serial.println(F("Attendo WiFi (max 60 s)..."));
#endif
  if (attendiWiFiCollegato(WIFI_TIMEOUT_SETUP_MS)) {
    lampeggioWiFiFatto = true;
#if SERIAL_DEBUG
    Serial.print(F("WiFi OK  IP "));
    Serial.println(WiFi.localIP());
#endif
  } else {
#if SERIAL_DEBUG
    Serial.print(F("WiFi non pronto: "));
    Serial.println(nomeStatoWiFi(WiFi.status()));
    if (WiFi.status() == WL_CONNECT_FAILED) {
      Serial.println(F("-> Controlla password in secrets.h"));
    } else {
      Serial.println(F("-> Il loop continuera a provare"));
    }
#endif
  }
}

void loop() {
#if defined(SIMULA_SENSORE)
  gestisciInputSerialeSim();
#endif

#if SERIAL_DEBUG
  logStatoPeriodico();
#endif

  // Riavvio programmato (RIAVVIO_MINUTI)
  if (RIAVVIO_MINUTI > 0 && millis() - momentoAvvio >= RIAVVIO_MS) {
    delay(1000);
    riavviaScheda("Riavvio programmato");
  }

  // Watchdog: nessun invio ThingSpeak OK da 10 min
  if (millis() - ultimoInvioSuccesso > TIMEOUT_SENZA_INVIO_MS) {
    delay(1000);
    riavviaScheda("10 min senza invio OK");
  }

  gestisciWiFi();

  if (datiSonoObsoleti()) {
    resetBufferLetture();
    ultimaLetturaValidaMs = 0;
    lampeggio(3, 500, 500);
#if SERIAL_DEBUG
    Serial.println(F("Buffer azzerato: dati obsoleti"));
#endif
  }

  // Lettura sensore ogni INTERVALLO_SENSORE_MS
  if (millis() - timerLetturaSensore > INTERVALLO_SENSORE_MS) {
    timerLetturaSensore = millis();

    int distanza = leggiDistanzaCm();
    int livello = distanzaToLivello(distanza);

#if defined(SIMULA_SENSORE)
    if (simNuovoValore) {
      resetBufferLetture();
      simNuovoValore = false;
    }
    if (livello > 0) {
      registraLetturaSensore(distanza, livello);
    }
#else
    if (livello > 0 && livelloCoerenteConMedia(livello)) {
      registraLetturaSensore(distanza, livello);
    }
#endif
  }

  // Invio ThingSpeak ogni 30 s se WiFi OK e dati freschi
  if (WiFi.status() == WL_CONNECTED &&
      millis() - timerInvioThingSpeak > INTERVALLO_THINGSPEAK_MS) {
    timerInvioThingSpeak = millis();

    if (datiSonoFreschi()) {
      float livelloMedio = mediaLivello();
      if (livelloMedio > 0.0f) {
        if (inviaLivelloThingSpeak(livelloMedio) == 200) {
          ultimoInvioSuccesso = millis();
          lampeggio(10, 50, 50);
        } else {
          lampeggio(3, 500, 500);
        }
      }
    }
  }

#if SERIAL_DEBUG
  if (millis() - momentoAvvio > 5000 &&
      campioniValidi == 0 &&
      WiFi.status() == WL_CONNECTED) {
    Serial.println(F("Attenzione: nessun campione sensore valido"));
  }
#endif
}
