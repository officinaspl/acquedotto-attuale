/*
 * Heltec WiFi LoRa 32 V2 — valvola a tre vie via Telegram
 *
 * Valvola motorizzata: alimentazione comune + uscita APRI + uscita CHIUDI.
 * Due relè (mai entrambi ON). Impulso di durata IMPULSO_VALVOLA_MS, poi OFF.
 *
 * Cablaggio Heltec V2 → modulo 2 relè:
 *   GND Heltec     → GND modulo
 *   3V3 o 5V       → VCC modulo (secondo datasheet modulo)
 *   GPIO 12        → IN1 (APRI)
 *   GPIO 13        → IN2 (CHIUDI)
 *
 * Cablaggio relè → valvola (es. 230 V / 24 V):
 *   COM1 e COM2    → alimentazione comune valvola (fase o +)
 *   NO1            → filo APRI
 *   NO2            → filo CHIUDI
 *   Neutro / −     → direttamente alla valvola (non passa dai relè)
 *
 * ATTENZIONE: tensione di rete solo sui contatti relè, mai sui pin ESP.
 * Se il modulo è active-HIGH, metti RELAY_ACTIVE_LOW a 0.
 *
 * OLED integrato: oled_heltec_v2.h (SDA=4, SCL=15, RST=16).
 *
 * Arduino IDE → Scheda: "Heltec WiFi LoRa 32(V2)"
 * Librerie: UniversalTelegramBot, ArduinoJson
 *
 * Telegram: /apri  /chiudi  /stato  /start
 * Solo SECRET_CHAT_ID in secrets.h può comandare.
 *
 * Revisione: rev002 — notifica Telegram a fine impulso
 */

#define SKETCH_REV 2
#define SKETCH_REV_STR "rev002"

// 1 = messaggi su Monitor Seriale
#define SERIAL_DEBUG 1

// ========== IMPOSTAZIONI ==========
// Durata impulso motore valvola (ms). Regola secondo datasheet (es. 30–120 s).
const unsigned long IMPULSO_VALVOLA_MS = 10000;

// 1 = relè ON con livello LOW (moduli optoisolati tipici); 0 = active HIGH
const uint8_t RELAY_ACTIVE_LOW = 1;

// Polling Telegram (ms)
const unsigned long BOT_POLL_MS = 1500;

// Riavvio programmato (minuti); 0 = disabilitato
const unsigned long RIAVVIO_MINUTI = 1440;

// Refresh OLED (ms)
const unsigned long OLED_REFRESH_MS = 1000;
// =================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <UniversalTelegramBot.h>
#include "secrets.h"
#include "oled_heltec_v2.h"

// --- Pin relè (liberi rispetto a OLED 4/15/16) ---
const uint8_t PIN_RELE_APRI = 12;
const uint8_t PIN_RELE_CHIUDI = 13;

// --- Tempi ---
const unsigned long WIFI_RETRY_MS = 30000;
const unsigned long WIFI_TIMEOUT_SETUP_MS = 60000;
const unsigned long RIAVVIO_MS = RIAVVIO_MINUTI * 60UL * 1000UL;

char ssid[] = SECRET_SSID;
char pass[] = SECRET_PASS;

WiFiClientSecure securedClient;
UniversalTelegramBot bot(SECRET_BOT_TOKEN, securedClient);

unsigned long botLastPollMs = 0;
unsigned long ultimoTentativoWiFi = 0;
unsigned long momentoAvvio = 0;
unsigned long oledTimer = 0;
bool oledForzaRefresh = true;

// Stato valvola: 0=sconosciuto, 1=aperta (ultimo comando), 2=chiusa
uint8_t posizioneValvola = 0;
bool impulsoInCorso = false;
uint8_t impulsoPinAttivo = 0; // PIN_RELE_APRI o PIN_RELE_CHIUDI
unsigned long impulsoInizioMs = 0;
String ultimaAzione = "---";
String chatNotificaImpulso; // chat da avvisare a fine impulso

const char* livelloOn() {
  return RELAY_ACTIVE_LOW ? "LOW" : "HIGH";
}

// Imposta uscita relè: on=true attiva la bobina
void setRele(uint8_t pin, bool on) {
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(pin, on ? LOW : HIGH);
  } else {
    digitalWrite(pin, on ? HIGH : LOW);
  }
}

void spegniEntrambiRele() {
  setRele(PIN_RELE_APRI, false);
  setRele(PIN_RELE_CHIUDI, false);
  impulsoInCorso = false;
  impulsoPinAttivo = 0;
}

// Avvia impulso su un solo relè (mutua esclusione); chatId riceve stato a fine
bool avviaImpulso(uint8_t pin, const char* nomeAzione, const String& chatId) {
  if (impulsoInCorso) {
    return false;
  }
  spegniEntrambiRele();
  setRele(pin, true);
  impulsoInCorso = true;
  impulsoPinAttivo = pin;
  impulsoInizioMs = millis();
  ultimaAzione = nomeAzione;
  chatNotificaImpulso = chatId;
  oledForzaRefresh = true;
#if SERIAL_DEBUG
  Serial.print(F("Impulso ON pin "));
  Serial.print(pin);
  Serial.print(F(" ("));
  Serial.print(nomeAzione);
  Serial.print(F(") per "));
  Serial.print(IMPULSO_VALVOLA_MS / 1000UL);
  Serial.println(F(" s"));
#endif
  return true;
}

// Dichiarazione: testoStato è più sotto; Arduino genera prototipo automatico
String testoStato();

// Notifica Telegram a fine movimento (motore fermo + posizione)
void notificaFineImpulso() {
  if (chatNotificaImpulso.length() == 0) {
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
#if SERIAL_DEBUG
    Serial.println(F("Fine impulso: WiFi assente, no notifica TG"));
#endif
    return;
  }
  String msg = "Movimento completato.\n";
  msg += testoStato();
  bot.sendMessage(chatNotificaImpulso, msg, "");
#if SERIAL_DEBUG
  Serial.println(F("Notifica fine impulso inviata su Telegram"));
#endif
}

// Termina impulso allo scadere del tempo (non bloccante)
void aggiornaImpulso() {
  if (!impulsoInCorso) {
    return;
  }
  if (millis() - impulsoInizioMs < IMPULSO_VALVOLA_MS) {
    return;
  }
  spegniEntrambiRele();
  oledForzaRefresh = true;
#if SERIAL_DEBUG
  Serial.println(F("Impulso terminato, relè OFF"));
#endif
  notificaFineImpulso();
}

void aggiornaOled() {
  if (!oledForzaRefresh && (millis() - oledTimer < OLED_REFRESH_MS)) {
    return;
  }
  oledTimer = millis();
  oledForzaRefresh = false;

  char l1[22];
  char l2[22];
  char l3[22];
  char l4[22];
  char l5[22];
  char l6[22];

  snprintf(l1, sizeof(l1), "VALVOLA %s", SKETCH_REV_STR);
  snprintf(l2, sizeof(l2), "%s", WiFi.status() == WL_CONNECTED ? "WIFI OK" : "WIFI ...");

  if (WiFi.status() == WL_CONNECTED) {
    snprintf(l3, sizeof(l3), "IP %s", WiFi.localIP().toString().c_str());
  } else {
    snprintf(l3, sizeof(l3), "IP ---");
  }

  if (impulsoInCorso) {
    unsigned long restanti = 0;
    unsigned long trascorsi = millis() - impulsoInizioMs;
    if (trascorsi < IMPULSO_VALVOLA_MS) {
      restanti = (IMPULSO_VALVOLA_MS - trascorsi + 999UL) / 1000UL;
    }
    snprintf(l4, sizeof(l4), "MOTORE %lus", restanti);
  } else if (posizioneValvola == 1) {
    snprintf(l4, sizeof(l4), "POS APERTA");
  } else if (posizioneValvola == 2) {
    snprintf(l4, sizeof(l4), "POS CHIUSA");
  } else {
    snprintf(l4, sizeof(l4), "POS ---");
  }

  snprintf(l5, sizeof(l5), "ULT %s", ultimaAzione.c_str());
  snprintf(l6, sizeof(l6), "TG /apri /chiudi");

  oledShowLinesCompact(l1, l2, l3, l4, l5, l6);
}

void connettiWiFi(unsigned long timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
#if SERIAL_DEBUG
  Serial.print(F("WiFi: connessione a "));
  Serial.println(ssid);
#endif
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - t0) < timeoutMs) {
    delay(250);
#if SERIAL_DEBUG
    Serial.print('.');
#endif
  }
#if SERIAL_DEBUG
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("WiFi OK IP "));
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(F("WiFi fallita"));
  }
#endif
  oledForzaRefresh = true;
}

void mantieniWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  if (millis() - ultimoTentativoWiFi < WIFI_RETRY_MS) {
    return;
  }
  ultimoTentativoWiFi = millis();
  connettiWiFi(15000);
}

bool chatAutorizzata(const String& chatId) {
  return chatId == SECRET_CHAT_ID;
}

String testoStato() {
  String s = "Valvola Heltec ";
  s += SKETCH_REV_STR;
  s += "\nWiFi: ";
  s += (WiFi.status() == WL_CONNECTED) ? "OK" : "NO";
  if (WiFi.status() == WL_CONNECTED) {
    s += "\nIP: ";
    s += WiFi.localIP().toString();
  }
  s += "\nPosizione: ";
  if (posizioneValvola == 1) {
    s += "aperta";
  } else if (posizioneValvola == 2) {
    s += "chiusa";
  } else {
    s += "sconosciuta";
  }
  s += "\nUltima azione: ";
  s += ultimaAzione;
  if (impulsoInCorso) {
    s += "\nMotore: in movimento";
  } else {
    s += "\nMotore: fermo";
  }
  s += "\nImpulso: ";
  s += String(IMPULSO_VALVOLA_MS / 1000UL);
  s += " s";
  return s;
}

String testoAiuto() {
  String msg = "Bot valvola a tre vie\n\n";
  msg += "/apri — impulso APRI\n";
  msg += "/chiudi — impulso CHIUDI\n";
  msg += "/stato — posizione e WiFi\n";
  msg += "/help — questa lista\n";
  return msg;
}

void gestisciMessaggi(int numNuovi) {
  for (int i = 0; i < numNuovi; i++) {
    String chatId = bot.messages[i].chat_id;
    String text = bot.messages[i].text;
    text.trim();

#if SERIAL_DEBUG
    Serial.print(F("TG chat="));
    Serial.print(chatId);
    Serial.print(F(" text="));
    Serial.println(text);
#endif

    if (!chatAutorizzata(chatId)) {
      // Mostra il chat_id reale così puoi copiarlo in secrets.h
      bot.sendMessage(chatId, "Non autorizzato. Il tuo chat_id e': " + chatId, "");
      continue;
    }

    // Accetta anche /comando@NomeBot
    int at = text.indexOf('@');
    if (at > 0) {
      text = text.substring(0, at);
    }

    if (text == "/start" || text == "/help") {
      bot.sendMessage(chatId, testoAiuto(), "");
    } else if (text == "/apri") {
      if (avviaImpulso(PIN_RELE_APRI, "APRI", chatId)) {
        posizioneValvola = 1;
        bot.sendMessage(chatId, "Apertura in corso...", "");
      } else {
        bot.sendMessage(chatId, "Attendi: motore già in movimento.", "");
      }
    } else if (text == "/chiudi") {
      if (avviaImpulso(PIN_RELE_CHIUDI, "CHIUDI", chatId)) {
        posizioneValvola = 2;
        bot.sendMessage(chatId, "Chiusura in corso...", "");
      } else {
        bot.sendMessage(chatId, "Attendi: motore già in movimento.", "");
      }
    } else if (text == "/stato") {
      bot.sendMessage(chatId, testoStato(), "");
    } else {
      bot.sendMessage(chatId, "Comando sconosciuto.\n\n" + testoAiuto(), "");
    }
  }
}

void pollTelegram() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  if (millis() - botLastPollMs < BOT_POLL_MS) {
    return;
  }
  botLastPollMs = millis();

  int numNuovi = bot.getUpdates(bot.last_message_received + 1);
  while (numNuovi) {
    gestisciMessaggi(numNuovi);
    numNuovi = bot.getUpdates(bot.last_message_received + 1);
  }
}

void setup() {
#if SERIAL_DEBUG
  Serial.begin(115200);
  delay(400);
  Serial.println();
  Serial.println(F("=== Valvola Heltec V2 + Telegram ==="));
  Serial.println(F(SKETCH_REV_STR));
  Serial.print(F("Relè APRI GPIO "));
  Serial.print(PIN_RELE_APRI);
  Serial.print(F("  CHIUDI GPIO "));
  Serial.println(PIN_RELE_CHIUDI);
  Serial.print(F("Active "));
  Serial.print(livelloOn());
  Serial.print(F("  impulso "));
  Serial.print(IMPULSO_VALVOLA_MS / 1000UL);
  Serial.println(F(" s"));
#endif

  pinMode(PIN_RELE_APRI, OUTPUT);
  pinMode(PIN_RELE_CHIUDI, OUTPUT);
  spegniEntrambiRele();

  oledInitPins(4, 15, 16);
  oledShowLines("VALVOLA", SKETCH_REV_STR, "Avvio...", "");

  momentoAvvio = millis();
  securedClient.setCACert(TELEGRAM_CERTIFICATE_ROOT);
  connettiWiFi(WIFI_TIMEOUT_SETUP_MS);

  // Ora NTP utile per TLS / log
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  oledForzaRefresh = true;
  aggiornaOled();
}

void loop() {
  // Riavvio periodico (opzionale)
  if (RIAVVIO_MINUTI > 0 && (millis() - momentoAvvio) >= RIAVVIO_MS) {
#if SERIAL_DEBUG
    Serial.println(F("Riavvio programmato"));
    Serial.flush();
#endif
    spegniEntrambiRele();
    delay(100);
    ESP.restart();
  }

  aggiornaImpulso();
  mantieniWiFi();
  pollTelegram();
  aggiornaOled();
}
