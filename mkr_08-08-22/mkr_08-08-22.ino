//data 9 maggio 2026 - Corretto errore NVIC_SystemReset

#include <WiFi101.h>
#include "secrets.h"
#include "ThingSpeak.h" 
#include "Maxbotix.h"

Maxbotix rangeSensorPW(1, Maxbotix::PW, Maxbotix::XL);

char ssid[] = SECRET_SSID;   
char pass[] = SECRET_PASS;   
WiFiClient  client;

unsigned long myChannelNumber = SECRET_CH_ID;
const char * myWriteAPIKey = SECRET_WRITE_APIKEY;

// Variabile per monitorare l'ultimo invio riuscito
unsigned long ultimoInvioSuccesso = 0;

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  ThingSpeak.begin(client);  
  ultimoInvioSuccesso = millis(); // Inizializza il timer all'avvio
}

void loop() {
  // 1. Controllo Time-out: se non invia da più di 10 minuti, riavvia la scheda
  if (millis() - ultimoInvioSuccesso > 600000) {
    NVIC_SystemReset(); // Comando corretto per MKR1000
  }

  // Connessione WiFi
  if(WiFi.status() != WL_CONNECTED){
    while(WiFi.status() != WL_CONNECTED){
      WiFi.begin(ssid, pass);  
      delay(5000);
      // Controllo timeout anche durante il tentativo di connessione
      if (millis() - ultimoInvioSuccesso > 600000) NVIC_SystemReset();
    } 
    
    // Lampeggio 5 volte alla connessione
    for (int i = 0; i < 5; i++) {
      digitalWrite(LED_BUILTIN, HIGH); delay(200);
      digitalWrite(LED_BUILTIN, LOW); delay(200);
    }
  }

  // 2. Media 5 letture valide (no zeri)
  long sommaRange = 0;
  int lettureValide = 0;
  unsigned long startLettura = millis();

  while (lettureValide < 5) {
    // Se il sensore non risponde per 30 secondi, esce per far valutare il reset al loop principale
    if (millis() - startLettura > 30000) break; 

    int letturaAttuale = rangeSensorPW.getRange();
    if (letturaAttuale > 0) {
      sommaRange += letturaAttuale;
      lettureValide++;
    }
    delay(100);
  }

  // 3. Invio dati se abbiamo le 5 letture
  if (lettureValide == 5) {
    float mediaRange = (float)sommaRange / 5.0;
    float livelloCalcolato = 408.0 - mediaRange;

    ThingSpeak.setField(1, livelloCalcolato);
    int x = ThingSpeak.writeFields(myChannelNumber, myWriteAPIKey);
    
    if(x == 200){
      ultimoInvioSuccesso = millis(); // Reset del timer di sicurezza
      // Lampeggio 3 volte all'invio
      for (int i = 0; i < 3; i++) {
        digitalWrite(LED_BUILTIN, HIGH); delay(100);
        digitalWrite(LED_BUILTIN, LOW); delay(100);
      }
    }
  }
  
  delay(60000); // Attesa di 1 minuto
}
