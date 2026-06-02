/*
 * Heltec WiFi LoRa 32 V2 — livello vasca acquedotto
 *
 * Sensore: Maxbotix MB7060 (PWM). Livello (cm) = 408 − distanza.
 * Invio ThingSpeak campo 1, canale in secrets.h.
 *
 * Cablaggio MB7060 → Heltec V2:
 *   GND sensore (pin 7) → pin 1 scheda
 *   V+  sensore (pin 6) → pin 2 scheda (5 V, max 5,5 V)
 *   PW  sensore (pin 2) → GPIO 17
 *
 * OLED integrato: oled_heltec_v2.h (driver locale, pin 4/15/16).
 *
 * Arduino IDE → Scheda: "Heltec WiFi LoRa 32(V2)"
 * Librerie: ThingSpeak
 * Campo: SERIAL_DEBUG 0, SIMULA_SENSORE commentato.
 * Casa/test USB: SERIAL_DEBUG 1 (vedi messaggi) oppure SIMULA_SENSORE per inviare valori.
 *
 * Rete Parabola: ESP32 solo 2,4 GHz + WPA2. Se iPhone OK e Parabola no, sul router
 * usa WPA2-PSK (non WPA3 solo) e WiFi 2,4 GHz attivo (vedi scan cifratura su seriale).
 *
 * Revisione: rev007 — OLED: fix caratteri minuscoli
 */

#define SKETCH_REV 7
#define SKETCH_REV_STR "rev007"

// 1 = messaggi su Monitor Seriale (WiFi, ThingSpeak, livello)
#define SERIAL_DEBUG 0

// Monitor Seriale USB: di solito uguale a SERIAL_DEBUG; metti 1 se vuoi solo USB senza troppi log
#define SERIAL_USB_ON  SERIAL_DEBUG

// --- Test a casa senza MB7060: decommenta ---
// #define SIMULA_SENSORE 1

// ========== IMPOSTAZIONI ==========
// Riavvio programmato della scheda (indipendente da WiFi/ThingSpeak)
const unsigned long RIAVVIO_MINUTI = 1440;

// OLED: pagine che si alternano (0 = una sola schermata compatta)
const unsigned long OLED_CAMBIO_PAGINA_MS = 5000;
const uint8_t OLED_NUM_PAGINE = 3;
// =================================

#include <WiFi.h>
#include "secrets.h"
#include "ThingSpeak.h"
#include "oled_heltec_v2.h"

// --- Pin e sensore MB7060 (PWM diretto, 58 us/cm) ---
const uint8_t PIN_SENSORE_PWM = 17; // numero gpio 17 su heltec 
const int VASCA_ALTEZZA_CM = 408;
const unsigned long US_PER_CM = 58;
const unsigned long TIMEOUT_PW_US = 80000;
const int MB7060_DIST_MIN_CM = 20;
const int MB7060_DIST_MAX_CM = 765;

#if defined(SIMULA_SENSORE)
static int distanzaSimulataCm = 74;
static bool simNuovoValore = false;

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
const unsigned long TIMEOUT_SENZA_INVIO_MS = 600000;
const unsigned long RIAVVIO_MS = RIAVVIO_MINUTI * 60UL * 1000UL;
const unsigned long MAX_ETA_DATI_MS = 120000;
const unsigned long PAUSA_RETRY_THINGSPEAK_MS = 2000;

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

char oledStatoCloud[12] = "---";
uint8_t oledPaginaCorrente = 0;
unsigned long oledTimerPagina = 0;
bool oledForzaRefresh = true;
unsigned long timerLogStatoSerial = 0;
const unsigned long INTERVALLO_LOG_SERIAL_MS = 30000;

void avviaSerialUsb() {
#if SERIAL_USB_ON || defined(SIMULA_SENSORE)
  Serial.begin(115200);
  delay(400);
  Serial.println();
  Serial.println(F("=== Acquedotto Heltec V2 ==="));
  Serial.println(F(SKETCH_REV_STR));
  Serial.println(F("Monitor: 115200 baud, fine riga = Nuova riga"));
  Serial.print(F("Riavvio programmato ogni "));
  Serial.print(RIAVVIO_MINUTI);
  Serial.println(F(" min"));
#if defined(SIMULA_SENSORE)
  Serial.println(F("SIMULA_SENSORE: scrivi 74 o L334 o ?"));
#else
  Serial.println(F("Sensore reale su GPIO 17 (PWM)"));
#endif
#endif
}

#if SERIAL_DEBUG
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

void lampeggio(int volte, int msOn, int msOff) {
  for (int i = 0; i < volte; i++) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(msOn);
    digitalWrite(LED_BUILTIN, LOW);
    delay(msOff);
  }
}

void disegnaPaginaOled(uint8_t pagina) {
  char l1[22];
  char l2[22];
  char l3[22];
  char l4[22];

  if (OLED_NUM_PAGINE == 0 || OLED_CAMBIO_PAGINA_MS == 0) {
    snprintf(l1, sizeof(l1), "ACQ %s", SKETCH_REV_STR);
    snprintf(l2, sizeof(l2), "%s", WiFi.status() == WL_CONNECTED ? "WIFI OK" : "WIFI ...");
    if (ultimoLivelloCm > 0.0f) {
      snprintf(l3, sizeof(l3), "LIV %.1f CM", ultimoLivelloCm);
    } else {
      snprintf(l3, sizeof(l3), "LIV --- CM");
    }
    if (ultimoCodiceThingSpeak == 200) {
      snprintf(l4, sizeof(l4), "TS OK  N:%d", campioniValidi);
    } else if (ultimoCodiceThingSpeak != 0) {
      snprintf(l4, sizeof(l4), "TS ERR %d", ultimoCodiceThingSpeak);
    } else {
      snprintf(l4, sizeof(l4), "N:%d %s", campioniValidi, oledStatoCloud);
    }
    oledShowLinesCompact(l1, l2, l3, l4, "", "");
    return;
  }

  switch (pagina) {
    case 0:
      snprintf(l1, sizeof(l1), "ACQUEDOTTO V2");
      snprintf(l2, sizeof(l2), SKETCH_REV_STR);
      snprintf(l3, sizeof(l3), "%s", WiFi.status() == WL_CONNECTED ? "WIFI: OK" : "WIFI: ...");
      snprintf(l4, sizeof(l4), "%s  1/%d", oledStatoCloud, OLED_NUM_PAGINE);
      break;
    case 1:
      snprintf(l1, sizeof(l1), "-- VASCA 2/%d --", OLED_NUM_PAGINE);
      if (ultimoLivelloCm > 0.0f) {
        snprintf(l2, sizeof(l2), "LIV: %.1f CM", ultimoLivelloCm);
      } else {
        snprintf(l2, sizeof(l2), "LIV: --- CM");
      }
      if (ultimaDistanzaCm > 0) {
        snprintf(l3, sizeof(l3), "DIST: %d CM", ultimaDistanzaCm);
      } else {
        snprintf(l3, sizeof(l3), "DIST: --- CM");
      }
      snprintf(l4, sizeof(l4), "CAMP: %d/%d", campioniValidi, NUM_LETTURE);
      break;
    default:
      snprintf(l1, sizeof(l1), "-- CLOUD --");
      if (ultimoCodiceThingSpeak == 200) {
        snprintf(l2, sizeof(l2), "THINGSPEAK: OK");
        if (ultimoLivelloCm > 0.0f) {
          snprintf(l3, sizeof(l3), "INVIO: %.1f CM", ultimoLivelloCm);
        } else {
          snprintf(l3, sizeof(l3), "DATI INVIATI");
        }
      } else if (ultimoCodiceThingSpeak != 0) {
        snprintf(l2, sizeof(l2), "THINGSPEAK ERR");
        snprintf(l3, sizeof(l3), "COD: %d", ultimoCodiceThingSpeak);
      } else {
        snprintf(l2, sizeof(l2), "THINGSPEAK: ---");
        snprintf(l3, sizeof(l3), "OGNI 30 SEC");
      }
      snprintf(l4, sizeof(l4), "PAG 3/%d", OLED_NUM_PAGINE);
      break;
  }

  oledShowLines(l1, l2, l3, l4);
}

void aggiornaOled(const char* statoCloud) {
  strncpy(oledStatoCloud, statoCloud, sizeof(oledStatoCloud) - 1);
  oledStatoCloud[sizeof(oledStatoCloud) - 1] = '\0';
  oledForzaRefresh = true;
}

void gestisciOledPagine() {
  if (OLED_NUM_PAGINE == 0 || OLED_CAMBIO_PAGINA_MS == 0) {
    if (oledForzaRefresh) {
      oledForzaRefresh = false;
      disegnaPaginaOled(0);
    }
    return;
  }

  if (millis() - oledTimerPagina >= OLED_CAMBIO_PAGINA_MS) {
    oledTimerPagina = millis();
    oledPaginaCorrente = (oledPaginaCorrente + 1) % OLED_NUM_PAGINE;
    oledForzaRefresh = true;
  }

  if (oledForzaRefresh) {
    oledForzaRefresh = false;
    disegnaPaginaOled(oledPaginaCorrente);
  }
}

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

bool datiSonoObsoleti() {
  if (campioniValidi == 0 || ultimaLetturaValidaMs == 0) {
    return false;
  }
  return (millis() - ultimaLetturaValidaMs) > MAX_ETA_DATI_MS;
}

bool datiSonoFreschi() {
  if (campioniValidi < MIN_CAMPIONI_PER_INVIO || ultimaLetturaValidaMs == 0) {
    return false;
  }
  return (millis() - ultimaLetturaValidaMs) <= MAX_ETA_DATI_MS;
}

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
const char* nomeCifraturaWiFi(wifi_auth_mode_t auth) {
  switch (auth) {
    case WIFI_AUTH_OPEN: return "APERTA";
    case WIFI_AUTH_WEP: return "WEP (obsoleta)";
    case WIFI_AUTH_WPA_PSK: return "WPA";
    case WIFI_AUTH_WPA2_PSK: return "WPA2 OK";
    case WIFI_AUTH_WPA_WPA2_PSK: return "WPA+WPA2 OK";
    case WIFI_AUTH_WPA2_ENTERPRISE: return "WPA2 Enterprise NO";
    case WIFI_AUTH_WPA3_PSK: return "WPA3 solo NO ESP32";
    case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2+WPA3 prova";
    default: return "?";
  }
}

void scanRetiDebug() {
  Serial.println(F("Scan reti WiFi (2.4 GHz)..."));
  Serial.println(F("ESP32: solo 2,4 GHz, WPA/WPA2 (non WPA3 solo, non Enterprise)"));
  int n = WiFi.scanNetworks(false, true);
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
      wifi_auth_mode_t auth = WiFi.encryptionType(i);
      if (auth == WIFI_AUTH_WPA3_PSK) {
        Serial.println(F("  *** Parabola in WPA3 solo: cambia router in WPA2 ***"));
      }
      if (auth == WIFI_AUTH_WPA2_ENTERPRISE) {
        Serial.println(F("  *** Enterprise: ESP32 non supporta ***"));
      }
    }
  }
  Serial.print(F("Rete configurata \""));
  Serial.print(ssid);
  Serial.println(trovata ? F("\": TROVATA") : F("\": NON in lista"));
  WiFi.scanDelete();
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

// Attesa affidabile: waitForConnectResult su ESP32 spesso restituisce 0 (idle) anche se poi connette
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
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.disconnect(true);
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
      aggiornaOled("ONLINE");
#if SERIAL_DEBUG
      Serial.print(F("WiFi OK  IP "));
      Serial.println(WiFi.localIP());
#endif
    }
    tentativiWiFiFalliti = 0;
    return;
  }

  lampeggioWiFiFatto = false;
  aggiornaOled("OFFLINE");

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

int inviaLivelloThingSpeak(float livelloMedio) {
  int ultimaRisposta = -301;

  for (int tentativo = 1; tentativo <= MAX_TENTATIVI_INVIO_TS; tentativo++) {
    aggiornaOled("INVIO");
    client.stop();
    delay(200);

    ThingSpeak.setField(1, livelloMedio);
    ultimaRisposta = ThingSpeak.writeFields(myChannelNumber, myWriteAPIKey);
    ultimoCodiceThingSpeak = ultimaRisposta;

    if (ultimaRisposta == 200) {
      ultimoLivelloCm = livelloMedio;
      aggiornaOled("OK");
      return 200;
    }

#if SERIAL_DEBUG
    logErroreThingSpeak(ultimaRisposta, tentativo);
#endif

    if (tentativo < MAX_TENTATIVI_INVIO_TS) {
      delay(PAUSA_RETRY_THINGSPEAK_MS);
    }
  }

  aggiornaOled("FAIL");
  return ultimaRisposta;
}

void setup() {
  avviaSerialUsb();

  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(PIN_SENSORE_PWM, INPUT);

  resetBufferLetture();

  oledInitPins(4, 15, 16);
  oledTimerPagina = millis();
  oledForzaRefresh = true;
  disegnaPaginaOled(0);

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
    aggiornaOled("ONLINE");
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

  if (RIAVVIO_MINUTI > 0 && millis() - momentoAvvio >= RIAVVIO_MS) {
    aggiornaOled("REBOOT");
    delay(1000);
    riavviaScheda("Riavvio programmato");
  }

  if (millis() - ultimoInvioSuccesso > TIMEOUT_SENZA_INVIO_MS) {
    aggiornaOled("TIMEOUT");
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
      aggiornaOled(WiFi.status() == WL_CONNECTED ? "LETTURA" : "OFFLINE");
    }
#else
    if (livello > 0 && livelloCoerenteConMedia(livello)) {
      registraLetturaSensore(distanza, livello);
      aggiornaOled(WiFi.status() == WL_CONNECTED ? "LETTURA" : "OFFLINE");
    }
#endif
  }

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

  if (millis() - momentoAvvio > 5000 &&
      campioniValidi == 0 &&
      WiFi.status() == WL_CONNECTED) {
    aggiornaOled("SENS.ERR");
  }

  gestisciOledPagine();
}
