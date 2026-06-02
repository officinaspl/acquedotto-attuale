/*
  
  Hardware: Arduino MKR1000
  
  !!! IMPORTANT - Modify the secrets.h file for this project with your network connection and ThingSpeak channel details. !!!
  
  Note:
  - Requires WiFi101 library version 0.15.3 or newer.
  - This example is written for a network using WPA encryption. For WEP or WPA, change the WiFi.begin() call accordingly.
  
  * 
 //  SISTEMA PER RILEVAZIONE LIVELLO CON SENSORE SONAR E ARDUINO UNO MKR
 //  PREREQUISITO RETE WIFI E ALIMENTAZIONE ARDUINO DA USB


  
  Maxbotix simple test
  
  - Change code below according to your model (LV, XL and
  HRLV supported)

  Note:
  For convenience, the getRange method will always return centimeters.
  You can use convert fuctions to convert to another unit (toInches and
  toCentimeters are available)
  
    Instructions:
  - PIN  DA COLLEGARE SU ARDUINO mkr 1000
    * PW is digital pin 1
    * TX is digital pin 6  NON USATO
    * AN is analog pin A1
    * 
    * 
  sensore 2   PWM filo giallo
  sensore 3   ANALOGICO filo verde
  sensore 4 non collegato 
  sensore 5 nero RS 232 non usato
  sensore 6 marrone  positivo alimentazione  +
  sensore 7 bianco   negativo alimentazione GND

*/

#include <WiFi101.h>
#include "secrets.h"
#include "ThingSpeak.h" 
#include "Maxbotix.h"
Maxbotix rangeSensorPW(1, Maxbotix::PW, Maxbotix::XL);  //pin 1 su arduino MKR 


char ssid[] = SECRET_SSID;   // your network SSID (name) 
char pass[] = SECRET_PASS;   // your network password
int keyIndex = 0;            // your network key Index number (needed only for WEP)
WiFiClient  client;

unsigned long myChannelNumber = SECRET_CH_ID;
const char * myWriteAPIKey = SECRET_WRITE_APIKEY;


void setup() {
  ThingSpeak.begin(client);  // Initialize ThingSpeak  
}

void loop() {

  // Connect or reconnect to WiFi
  if(WiFi.status() != WL_CONNECTED){
//Serial.print("Attempting to connect to SSID: ");
 //   Serial.println(SECRET_SSID);
    while(WiFi.status() != WL_CONNECTED){
      WiFi.begin(ssid,pass);  // Connect to WPA/WPA2 network. Change this line if using open or WEP network
  //    Serial.print(".");
      delay(5000);     
    } 
  }
{

  // set the fields with the values
    ThingSpeak.setField(1, (408-rangeSensorPW.getRange()));// calcolo differenzza lettura altezza vasca

  ThingSpeak.writeFields(myChannelNumber, myWriteAPIKey);
  
  }
  
  delay(30000); // tempo 5 minuti
}
