/*
  ARDUINO UNO WIFI REV 2

  DATI RETE acquedotto

  SONDA DS18B20 CON RESISTENZA COLLEGATA AL PIN 2
  TENSIONE SONDA 3,3 VOLT
  MANDA DATI SU SITO THINGSPEAK AL TEMPO PREDETERMINATO.


*/



#include <WiFiNINA.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#define ONE_WIRE_BUS 2  //Definizione pin 2 arduino uno 

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);
float dsTemp;


#include "secrets.h"
#include "ThingSpeak.h" // always include thingspeak header file after other header files and custom macros

char ssid[] = SECRET_SSID;    //  your network SSID (name)
char pass[] = SECRET_PASS;    //  your network password
int keyIndex = 0;             //  your network key Index number (needed only for WEP)
WiFiClient  client;

unsigned long myChannelNumber = SECRET_CH_ID;
const char * myWriteAPIKey = SECRET_WRITE_APIKEY;



void setup() {
  Serial.begin(115200);  // Initialize serial
  sensors.begin();      //inizializza Sensore -- DS18B20



  while (!Serial) {
    ; // wait for serial port to connect. Needed for Leonardo native USB port only
  }

  // check for the WiFi module:
  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println("Communication with WiFi module failed!");
    // don't continue
    while (true);
  }

  String fv = WiFi.firmwareVersion();
  if (fv != "1.0.0") {
    Serial.println("Please upgrade the firmware");
  }

  ThingSpeak.begin(client);  //Initialize ThingSpeak
}

void loop() {

  // Connect or reconnect to WiFi

  if (WiFi.status() != WL_CONNECTED) {
    Serial.print("Attempting to connect to SSID: ");
    Serial.println(SECRET_SSID);
    while (WiFi.status() != WL_CONNECTED) {
      WiFi.begin(ssid, pass); // Connect to WPA/WPA2 network. Change this line if using open or WEP network
      Serial.print(".");
      delay(5000);

    }
    Serial.println("\nConnesso.");
  }
  delay(5000);
  {
    sensors.setResolution(12);  //  settaggio risoluzione before each measurement
    //sensors.setResolution(10);
    //sensors.setResolution(11);
    //sensors.setResolution(12);
    sensors.requestTemperatures();         // Temp conversion command; waiting here until comversion is done
    dsTemp = sensors.getTempCByIndex(0);  //read temp data from Sensor #0 and convert to celsius float

    Serial.print("Temperatura C°:");
    Serial.println(dsTemp, 2);    //1-settaggio 1 decimale dopo virgola
    //Serial.println(dsTemp, 2);  //2-settaggio 2 decimale dopo virgola
    //Serial.println(dsTemp, 3);  //3-settaggio 3 decimale dopo virgola
    //Serial.println(dsTemp, 4);  //4-settaggio 4 decimale dopo virgola
    delay(5000);                  // tempo intervallo lettura temp.


    ThingSpeak.setField(1, dsTemp);

    ThingSpeak.writeFields(myChannelNumber, myWriteAPIKey);

    Serial.println("Aggiornamento sito avvenuto");
  }
  delay(300000);  // ritardo per aggiornamento sito
}
