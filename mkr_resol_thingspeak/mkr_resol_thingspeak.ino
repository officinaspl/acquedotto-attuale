/*

 * MKR WiFi 1000 — temperature Resol DeltaSol SLT via VBus TCP → ThingSpeak

 *

 * Cablaggio: nessun filo sul VBus; il MKR legge il regolatore in rete (LAN integrata).

 * Rete: MKR sulla Wi-Fi 2,4 GHz del modem di casa (stessa LAN del Resol, es. 192.168.8.x).

 * Scheda: Arduino MKR WiFi 1000 (WiFi101, solo 2.4 GHz)

 * Librerie: WiFi101, ThingSpeak

 *

 * Resol: TCP porta 7053, sequenza PASS → DATA, protocollo VBus binario.

 * Il Resol accetta una sola connessione VBus alla volta (disabilitare script Shelly probe).

 *

 * ThingSpeak campi (3 sonde collegate):

 *   1 = Temperature sensor 1 (S1)

 *   2 = Temperature sensor 2 (S2)

 *   3 = Temperature sensor 3 (S3)

 *

 * LED onboard:

 *   5 lampeggi = WiFi connesso

 *   3 lampeggi rapidi = invio ThingSpeak OK (codice 200)

 *

 * Credenziali: secrets.h (WiFi, ThingSpeak, IP/password Resol)

 *

 * Revisione: rev007

 */



#include <WiFi101.h>

#include "secrets.h"

#include "ThingSpeak.h"



// --- DEBUG ---

// 1 = messaggi su Monitor Seriale (WiFi, Resol, temperature, ThingSpeak)

#define SERIAL_DEBUG 1



// --- Tempi ---

const unsigned long INTERVALLO_LETTURA_MS = 60000;   // ciclo lettura + invio (ms), min 15 s per ThingSpeak

const unsigned long TIMEOUT_WIFI_MS = 600000;        // 10 min senza invio OK → riavvio scheda

const unsigned long TIMEOUT_RESOL_MS = 8000;         // attesa massima stream VBus dopo DATA (ms)

const unsigned long TIMEOUT_RIGA_MS = 5000;          // attesa riga testo TCP (+HELLO, +OK) (ms)



// --- Resol VBus (da secrets.h) ---

const char RESOL_HOST[] = SECRET_RESOL_IP;           // IP DeltaSol SLT, es. 192.168.8.201

const uint16_t RESOL_PORT = SECRET_RESOL_PORT;       // standard Resol: 7053

const char RESOL_PASS[] = SECRET_RESOL_PASS;         // default fabbrica: vbus



// Indirizzi pacchetto DeltaSol SLT nella specifica resol-vbus

const uint16_t SLT_SOURCE = 0x1001;                  // indirizzo sorgente regolatore SLT

const uint16_t SLT_DEST = 0x0010;                  // destinazione DFA

const uint16_t SLT_COMMAND = 0x0100;               // comando dati misura



// Offset nel frame decodificato (sonde 1..3, fattore 0.1 °C)

const uint8_t TEMP_OFFSETS[3] = {4, 6, 8};

const uint8_t NUM_SONDE = 3;



// --- WiFi / ThingSpeak ---

char ssid[] = SECRET_SSID;

char pass[] = SECRET_PASS;

WiFiClient client;



unsigned long myChannelNumber = SECRET_CH_ID;

const char *myWriteAPIKey = SECRET_WRITE_APIKEY;



unsigned long ultimoInvioSuccesso = 0;               // ultimo ThingSpeak 200 (watchdog)

unsigned long timerLettura = 0;                    // ultimo ciclo Resol



// --- Parser VBus protocollo 1.0 (logica da ESPHome vbus.cpp) ---

uint8_t vbusState = 0;                             // 0=attesa, 1=header, 2=frame dati

uint8_t vbusHeader[16];

uint8_t vbusHeaderLen = 0;

uint8_t vbusProtocol = 0;

uint16_t vbusSource = 0;

uint16_t vbusDest = 0;

uint16_t vbusCommand = 0;

uint8_t vbusFrames = 0;                            // numero frame nel pacchetto

uint8_t vbusCframe = 0;                            // frame corrente in ricezione

uint8_t vbusFbytes[6];                             // blocco grezzo 4 byte + septet + checksum

uint8_t vbusFbcount = 0;



uint8_t vbusPayload[64];                           // frame dati ricomposto

uint8_t vbusPayloadLen = 0;



float tempsRilevate[3];                            // ultime temperature valide (°C)

bool pacchettoSltTrovato = false;



#if SERIAL_DEBUG

#define DBG_PRINT(x) Serial.print(x)

#define DBG_PRINTLN(x) Serial.println(x)

#else

#define DBG_PRINT(x)

#define DBG_PRINTLN(x)

#endif



// Verifica checksum VBus su header o blocco frame

bool vbusChecksum(const uint8_t *data, int start, int count) {

  uint8_t csum = 0x7F;

  for (int i = 0; i < count; i++) {

    csum = (csum - data[start + i]) & 0x7F;

  }

  return csum == 0;

}



// Ripristina il bit alto (0x80) nei byte dati usando il byte septet VBus

void vbusSeptetSpread(uint8_t *data, int start, int count, uint8_t septet) {

  for (int i = 0; i < count; i++, septet >>= 1) {

    if (septet & 1) {

      data[start + i] |= 0x80;

    }

  }

}



// Decodifica temperatura Resol: int16 little-endian, scala 0.1 °C

// Ritorna NAN se sonda scollegata (888 °C / 999 °C) o valore fuori range

float decodificaTemperatura(const uint8_t *frame, uint8_t frameLen, uint8_t offset) {

  if (offset + 1 >= frameLen) {

    return NAN;

  }



  unsigned lsb = frame[offset];

  unsigned msb = frame[offset + 1];

  int raw;



  if (msb > 127) {

    raw = (int)((65536 - msb * 256 - lsb) * -1);

  } else {

    raw = (int)(msb * 256 + lsb);

  }



  float t = raw * 0.1f;

  if (t > 200.0f || t < -50.0f) {

    return NAN;

  }

  return t;

}



// Copia le 3 sonde dal payload del pacchetto SLT trovato

void estraiTemperatureSlt(const uint8_t *frame, uint8_t frameLen) {

  for (int i = 0; i < NUM_SONDE; i++) {

    tempsRilevate[i] = decodificaTemperatura(frame, frameLen, TEMP_OFFSETS[i]);

  }

  pacchettoSltTrovato = true;

}



// Chiamata quando un pacchetto VBus completo è stato ricostruito dal flusso TCP

void onVbusMessage(uint16_t command, uint16_t source, uint16_t dest,

                   const uint8_t *payload, uint8_t payloadLen) {

  if (command != SLT_COMMAND || source != SLT_SOURCE || dest != SLT_DEST) {

    return;

  }

  if (payloadLen < 12) {

    return;

  }



  estraiTemperatureSlt(payload, payloadLen);



#if SERIAL_DEBUG

  DBG_PRINT(F("SLT pkt len="));

  DBG_PRINTLN(payloadLen);

  for (int i = 0; i < NUM_SONDE; i++) {

    DBG_PRINT(F("  T"));

    DBG_PRINT(i + 1);

    DBG_PRINT(F(": "));

    if (isnan(tempsRilevate[i])) {

      DBG_PRINTLN(F("N/A"));

    } else {

      DBG_PRINTLN(tempsRilevate[i]);

    }

  }

#endif

}



// Alimenta il parser VBus con un byte del flusso TCP (dopo comando DATA)

void vbusFeedByte(uint8_t c) {

  // Sync byte inizio pacchetto VBus 1.0

  if (c == 0xAA) {

    vbusState = 1;

    vbusHeaderLen = 0;

    return;

  }



  // Byte con MSB=1 fuori posto: reset parser

  if (c & 0x80) {

    vbusState = 0;

    return;

  }



  if (vbusState == 0) {

    return;

  }



  // Stato 1: raccolta header pacchetto (9 byte per protocollo 0x10)

  if (vbusState == 1) {

    if (vbusHeaderLen < sizeof(vbusHeader)) {

      vbusHeader[vbusHeaderLen++] = c;

    }



    if (vbusHeaderLen == 7) {

      vbusProtocol = vbusHeader[4];

      vbusSource = (uint16_t)(vbusHeader[3] << 8) + vbusHeader[2];

      vbusDest = (uint16_t)(vbusHeader[1] << 8) + vbusHeader[0];

      vbusCommand = (uint16_t)(vbusHeader[6] << 8) + vbusHeader[5];

    }



    if (vbusProtocol == 0x10 && vbusHeaderLen == 9) {

      if (!vbusChecksum(vbusHeader, 0, 9)) {

        vbusState = 0;

        return;

      }



      vbusFrames = vbusHeader[7];

      if (vbusFrames > 0 && vbusFrames <= 16) {

        vbusState = 2;

        vbusCframe = 0;

        vbusFbcount = 0;

        vbusPayloadLen = 0;

      } else {

        vbusState = 0;

      }

    } else if (vbusHeaderLen > 15) {

      vbusState = 0;

    }

    return;

  }



  // Stato 2: ricezione frame dati (blocchi da 6 byte)

  if (vbusState == 2) {

    vbusFbytes[vbusFbcount++] = c;

    if (vbusFbcount < 6) {

      return;

    }

    vbusFbcount = 0;



    if (!vbusChecksum(vbusFbytes, 0, 6)) {

      return;

    }



    vbusSeptetSpread(vbusFbytes, 0, 4, vbusFbytes[4]);



    if (vbusPayloadLen + 4 <= sizeof(vbusPayload)) {

      for (int i = 0; i < 4; i++) {

        vbusPayload[vbusPayloadLen++] = vbusFbytes[i];

      }

    }



    vbusCframe++;

    if (vbusCframe < vbusFrames) {

      return;

    }



    onVbusMessage(vbusCommand, vbusSource, vbusDest, vbusPayload, vbusPayloadLen);

    vbusState = 0;

  }

}



// Azzera parser e array temperature prima di una nuova connessione Resol

void resetVbusParser() {

  vbusState = 0;

  vbusHeaderLen = 0;

  vbusPayloadLen = 0;

  pacchettoSltTrovato = false;

  for (int i = 0; i < NUM_SONDE; i++) {

    tempsRilevate[i] = NAN;

  }

}



// Legge una riga terminata da \n dalla fase comando TCP (+HELLO, +OK, ...)

bool leggiRigaTcp(WiFiClient &tcp, char *buf, size_t bufLen, unsigned long timeoutMs) {

  size_t pos = 0;

  unsigned long start = millis();



  while (millis() - start < timeoutMs) {

    while (tcp.available()) {

      char ch = (char)tcp.read();

      if (ch == '\r') {

        continue;

      }

      if (ch == '\n') {

        buf[pos] = '\0';

        return pos > 0;

      }

      if (pos < bufLen - 1) {

        buf[pos++] = ch;

      }

    }

    if (!tcp.connected()) {

      break;

    }

  }



  buf[pos] = '\0';

  return false;

}



// Connessione TCP al Resol: +HELLO → PASS → DATA → lettura stream VBus

bool leggiTemperatureResol() {

  resetVbusParser();



  WiFiClient resol;

  if (!resol.connect(RESOL_HOST, RESOL_PORT)) {

    DBG_PRINTLN(F("Resol: connect fallita"));

    return false;

  }



  char riga[128];



  // Attesa messaggio +HELLO dal modulo LAN

  if (!leggiRigaTcp(resol, riga, sizeof(riga), TIMEOUT_RIGA_MS)) {

    DBG_PRINTLN(F("Resol: nessun HELLO"));

    resol.stop();

    return false;

  }

  DBG_PRINT(F("Resol: "));

  DBG_PRINTLN(riga);



  // Autenticazione VBus (password in secrets.h)

  resol.print(F("PASS "));

  resol.print(RESOL_PASS);

  resol.print(F("\r\n"));



  if (!leggiRigaTcp(resol, riga, sizeof(riga), TIMEOUT_RIGA_MS)) {

    DBG_PRINTLN(F("Resol: risposta PASS mancante"));

    resol.stop();

    return false;

  }

  DBG_PRINTLN(riga);



  if (strstr(riga, "rejected") != NULL || strstr(riga, "-ERROR") != NULL) {

    DBG_PRINTLN(F("Resol: password VBus rifiutata"));

    DBG_PRINTLN(F("-> Aggiorna SECRET_RESOL_PASS in secrets.h (default: vbus)"));

    resol.stop();

    return false;

  }



  // Passaggio in modalità dati binari VBus

  resol.print(F("DATA\r\n"));



  if (!leggiRigaTcp(resol, riga, sizeof(riga), TIMEOUT_RIGA_MS)) {

    DBG_PRINTLN(F("Resol: risposta DATA mancante"));

    resol.stop();

    return false;

  }

  DBG_PRINTLN(riga);



  // Lettura stream fino a pacchetto SLT o timeout

  unsigned long startLettura = millis();

  while (millis() - startLettura < TIMEOUT_RESOL_MS) {

    while (resol.available()) {

      vbusFeedByte((uint8_t)resol.read());

      if (pacchettoSltTrovato) {

        break;

      }

    }

    if (pacchettoSltTrovato) {

      break;

    }

    if (!resol.connected()) {

      break;

    }

  }



  resol.stop();



  if (!pacchettoSltTrovato) {

    DBG_PRINTLN(F("Resol: pacchetto SLT non trovato"));

    return false;

  }



  return true;

}



// Stampa motivo fallimento WiFi101 (solo debug seriale)
void stampaErroreWiFi() {
#if SERIAL_DEBUG
  DBG_PRINT(F("WiFi stato: "));
  DBG_PRINTLN(WiFi.status());

  switch (WiFi.status()) {
    case WL_NO_SSID_AVAIL:
      DBG_PRINTLN(F("  SSID non trovato — nome rete errato o router spento"));
      break;
    case WL_CONNECT_FAILED:
      DBG_PRINTLN(F("  Connessione rifiutata — password errata o rete 5 GHz"));
      break;
    case WL_CONNECTION_LOST:
      DBG_PRINTLN(F("  Connessione persa"));
      break;
    case WL_DISCONNECTED:
      DBG_PRINTLN(F("  Disconnesso"));
      break;
    default:
      DBG_PRINTLN(F("  Timeout o segnale debole"));
      break;
  }

  DBG_PRINT(F("  Cerco reti visibili con nome \""));
  DBG_PRINT(ssid);
  DBG_PRINTLN(F("\""));

  int reti = WiFi.scanNetworks();
  bool trovata = false;
  for (int i = 0; i < reti; i++) {
    if (strcmp(WiFi.SSID(i), ssid) == 0) {
      trovata = true;
      DBG_PRINT(F("  Trovata, segnale RSSI "));
      DBG_PRINTLN(WiFi.RSSI(i));
      break;
    }
  }
  if (!trovata) {
    DBG_PRINTLN(F("  Rete NON vista dallo MKR — SSID sbagliato o troppo lontano"));
  }
#endif
}

// Attende connessione WiFi con log ogni 5 s (timeoutMs in millisecondi)
bool attendiWiFi(unsigned long timeoutMs) {
  unsigned long start = millis();
  unsigned long ultimoLog = start;

  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(500);

#if SERIAL_DEBUG
    if (millis() - ultimoLog >= 5000) {
      ultimoLog = millis();
      DBG_PRINT(F("  ancora in connessione, stato "));
      DBG_PRINT(WiFi.status());
      DBG_PRINT(F(" ("));
      DBG_PRINT((millis() - start) / 1000);
      DBG_PRINTLN(F(" s)"));
    }
#endif

    if (millis() - ultimoInvioSuccesso > TIMEOUT_WIFI_MS) {
      NVIC_SystemReset();
    }
  }

  return WiFi.status() == WL_CONNECTED;
}

// Connessione Wi-Fi modem casa (2.4 GHz, WPA2); lampeggio LED se OK
void connettiWiFi() {

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

#if SERIAL_DEBUG
  DBG_PRINT(F("Connessione WiFi SSID: "));
  DBG_PRINTLN(ssid);
#endif

  const int MAX_TENTATIVI_WIFI = 3;

  for (int tentativo = 1; tentativo <= MAX_TENTATIVI_WIFI; tentativo++) {
#if SERIAL_DEBUG
    DBG_PRINT(F("Tentativo WiFi "));
    DBG_PRINT(tentativo);
    DBG_PRINT(F("/"));
    DBG_PRINTLN(MAX_TENTATIVI_WIFI);
#endif

    WiFi.disconnect();
    delay(500);
    WiFi.begin(ssid, pass);

    if (attendiWiFi(20000)) {
      break;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {

    for (int i = 0; i < 5; i++) {

      digitalWrite(LED_BUILTIN, HIGH);

      delay(200);

      digitalWrite(LED_BUILTIN, LOW);

      delay(200);

    }

#if SERIAL_DEBUG

    IPAddress ip = WiFi.localIP();

    DBG_PRINT(F("WiFi OK "));

    DBG_PRINT(ip[0]);

    DBG_PRINT('.');

    DBG_PRINT(ip[1]);

    DBG_PRINT('.');

    DBG_PRINT(ip[2]);

    DBG_PRINT('.');

    DBG_PRINTLN(ip[3]);

#endif

  } else {

#if SERIAL_DEBUG

    DBG_PRINTLN(F("WiFi FALLITO — controlla secrets.h (rete 2.4 GHz modem casa)"));

    stampaErroreWiFi();

#endif

  }

}



// Invia su ThingSpeak solo sonde con valore valido (campi 1..3)

int inviaThingSpeak() {

  int campiImpostati = 0;



  for (int i = 0; i < NUM_SONDE; i++) {

    if (!isnan(tempsRilevate[i])) {

      ThingSpeak.setField(i + 1, tempsRilevate[i]);

      campiImpostati++;

    }

  }



  if (campiImpostati == 0) {

    return -1;

  }



  int codice = ThingSpeak.writeFields(myChannelNumber, myWriteAPIKey);



#if SERIAL_DEBUG

  DBG_PRINT(F("ThingSpeak "));

  DBG_PRINTLN(codice);

#endif



  return codice;

}



void setup() {

#if SERIAL_DEBUG

  Serial.begin(115200);

  while (!Serial && millis() < 3000) {

    ;

  }

  DBG_PRINTLN(F("MKR Resol → ThingSpeak avvio"));
  DBG_PRINT(F("WiFi101 firmware: "));
  DBG_PRINTLN(WiFi.firmwareVersion());
  DBG_PRINTLN(F("Se WiFi fallisce: antenna MKR, WPA2 (no solo WPA3), aggiorna FW WiFi101"));

#endif

  pinMode(LED_BUILTIN, OUTPUT);

  ThingSpeak.begin(client);

  ultimoInvioSuccesso = millis();

  // Prima lettura subito (non aspettare 60 s)

  timerLettura = millis() - INTERVALLO_LETTURA_MS;

}



void loop() {

  // Watchdog: riavvio se nessun invio ThingSpeak OK da 10 minuti

  if (millis() - ultimoInvioSuccesso > TIMEOUT_WIFI_MS) {

    NVIC_SystemReset();

  }



  // Attesa tra un ciclo e il successivo (60 s)

  if (millis() - timerLettura < INTERVALLO_LETTURA_MS) {

    delay(200);

    return;

  }

  timerLettura = millis();



#if SERIAL_DEBUG

  DBG_PRINTLN(F("--- Ciclo lettura Resol ---"));

#endif



  // 1. WiFi modem casa

  connettiWiFi();

  if (WiFi.status() != WL_CONNECTED) {

    return;

  }



  // 2. Lettura temperature Resol via VBus TCP

  if (leggiTemperatureResol()) {

    // 3. Invio cloud ThingSpeak

    int codice = inviaThingSpeak();

    if (codice == 200) {

      ultimoInvioSuccesso = millis();

      for (int i = 0; i < 3; i++) {

        digitalWrite(LED_BUILTIN, HIGH);

        delay(100);

        digitalWrite(LED_BUILTIN, LOW);

        delay(100);

      }

    }

  }

}


