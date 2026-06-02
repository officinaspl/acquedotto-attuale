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


  RICORDARSI TOGLIERE // DAVANTI A SERIAL PER FARLO ANDARE DA ALIMENTATORE ESTERNO E NON DA PC

*/

#include <WiFi101.h>
#include "secrets.h"
#include "ThingSpeak.h" // always include thingspeak header file after other header files and custom macros

#include "Maxbotix.h"
Maxbotix rangeSensorPW(1, Maxbotix::PW, Maxbotix::XL);  //pin 1
//Maxbotix rangeSensorAD(A1, Maxbotix::AN, Maxbotix::XL); // pin a1

char ssid[] = SECRET_SSID;   // your network SSID (name) 
char pass[] = SECRET_PASS;   // your network password
int keyIndex = 0;            // your network key Index number (needed only for WEP)
WiFiClient  client;

unsigned long myChannelNumber = SECRET_CH_ID;
const char * myWriteAPIKey = SECRET_WRITE_APIKEY;


void setup() {
  ThingSpeak.begin(client);  // Initialize ThingSpeak 
 Serial.begin(115200);      // Initialize serial 
while (!Serial) 
{
    ; // wait for serial port to connect. Needed for Leonardo native USB port only
  }
  
  
}

void loop() {

  // Connect or reconnect to WiFi
  if(WiFi.status() != WL_CONNECTED){
Serial.print("Attempting to connect to SSID: ");
   Serial.println(SECRET_SSID);
    while(WiFi.status() != WL_CONNECTED){
      WiFi.begin(ssid,pass);  // Connect to WPA/WPA2 network. Change this line if using open or WEP network
      Serial.print(".");
      delay(5000);     
    } 
    Serial.println("\nConnected.");
  }
{
   //scrittura seriale PWM
  
  Serial.print("Lettura livello pwm : ");
  Serial.print((408-rangeSensorPW.getRange()));
  Serial.print(" CM, ");
  Serial.println();

  // scrittura seriale Analogica
  
 // Serial.print("Lettura analogica : ");
 // Serial.print(rangeSensorAD.getRange());
 // Serial.print(" CM, ");
 // Serial.println();

//averageDistance = 408-(rangeSensorPW.getRange());

  // set the fields with the values
    ThingSpeak.setField(1, (408-rangeSensorPW.getRange()));
// ThingSpeak.setField(2, rangeSensorAD.getRange());
//  ThingSpeak.setField(3, number3);

  ThingSpeak.writeFields(myChannelNumber, myWriteAPIKey);
   
   
    
  Serial.println("Channel update successful."); 

  }
  
  delay(30000); // tempo 5 minuti
}
