#include <OneWire.h>
#include <DallasTemperature.h>
#include "arduino_secrets.h"

// Sulla Uno Q, Serial1 comunica con il processore Linux/WiFi
#define BridgeSerial Serial1 
#define ONE_WIRE_BUS 2
#define LED_STATO 13 // Pin del LED "L" (non quello rosso dell'alimentazione)

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

void setup() {
  // Avvio seriale per il PC
  Serial.begin(115200);      
  
  // Avvio seriale per il bridge Linux
  BridgeSerial.begin(115200); 
  
  // Configurazione LED
  pinMode(LED_STATO, OUTPUT);
  digitalWrite(LED_STATO, LOW); // Assicuriamoci che parta spento
  
  sensors.begin();
  
  Serial.println("--- Sistema Arduino Uno Q Avviato ---");
  Serial.println("Lettura sonda DS18B20 sul pin 2...");
}

// Funzione dedicata al lampeggio
void lampeggia(int volte) {
  for (int i = 0; i < volte; i++) {
    digitalWrite(LED_STATO, HIGH);
    delay(150);
    digitalWrite(LED_STATO, LOW);
    delay(150);
  }
}

void loop() {
  // Richiesta temperatura alla sonda
  sensors.requestTemperatures(); 
  float tempC = sensors.getTempCByIndex(0);

  // Verifichiamo se la sonda è connessa
  if (tempC != DEVICE_DISCONNECTED_C) {
    Serial.print("Temperatura letta: ");
    Serial.print(tempC);
    Serial.println(" C");

    // Costruzione comando per il lato Linux (WiFi)
    // Nota: SECRET_WRITE_APIKEY deve essere definita in arduino_secrets.h
    String comando = "curl -k \"http://thingspeak.com";
    comando += SECRET_WRITE_APIKEY;
    comando += "&field1=";
    comando += String(tempC);
    comando += "\"";

    // Invio comando al processore Linux
    BridgeSerial.println(comando);
    
    Serial.println("Dati inviati a ThingSpeak.");

    // Lampeggio di stato: 3 volte
    lampeggia(3);
    
  } else {
    Serial.println("ERRORE: Sonda DS18B20 non trovata! Controlla i collegamenti.");
    // Lampeggio veloce di errore se la sonda non va
    digitalWrite(LED_STATO, HIGH);
    delay(1000);
    digitalWrite(LED_STATO, LOW);
  }

  // ThingSpeak accetta dati ogni 15-20 secondi
  Serial.println("In attesa per il prossimo invio...");
  delay(20000); 
}

