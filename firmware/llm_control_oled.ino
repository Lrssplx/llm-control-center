// ESP32-WROOM-32 + OLED SSD1306 128x64 I2C
// SDA = GPIO21, SCL = GPIO22, VCC = 3V3, GND = GND
// Libraries: Adafruit SSD1306, Adafruit GFX, ArduinoJson
#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

#include "secrets.h"
Adafruit_SSD1306 display(128,64,&Wire,-1);
unsigned long lastPoll=0,lastDraw=0,lastReconnect=0;
String state="INICIANDO", model="-";
int latency=0,errors=0,inputTokens=0,outputTokens=0;
float cost=0;
bool hasData=false;
void draw(){
 display.clearDisplay();display.setTextColor(SSD1306_WHITE);display.setTextSize(1);display.setTextWrap(false);
 display.setCursor(0,0);display.print("LLM CONTROL CENTER");display.drawLine(0,13,127,13,SSD1306_WHITE);
 display.setCursor(0,17);display.print("API: ");
 if(WiFi.status()==WL_CONNECTED) display.print(state);else display.print("WIFI OFFLINE");
 display.setCursor(0,27);display.print("MODEL: ");display.print(model.substring(0,13));
 display.setCursor(0,37);display.print("LAT:");display.print(latency);display.print("ms  ERR:");display.print(errors);
 display.setCursor(0,47);display.print("TOKENS: ");display.print(inputTokens+outputTokens);
 display.drawLine(0,55,127,55,SSD1306_WHITE);
 display.setCursor(0,57);display.print("USD ");display.print(cost,5);display.print(hasData?" LIVE":" WAIT");
 display.display();
}
void poll(){
 if(WiFi.status()!=WL_CONNECTED){hasData=false;return;}
 HTTPClient http;http.setTimeout(4000);
 // HTTP/1.0 evita respostas chunked ao ler o JSON diretamente do stream.
 http.useHTTP10(true);
 if(!http.begin(URL_METRICS)){state="BACKEND OFF";hasData=false;return;}
 int code=http.GET();
 if(code==HTTP_CODE_OK){
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<1024> doc;
#endif
  DeserializationError err=deserializeJson(doc,http.getStream());if(!err){
  state=doc["status"] | "SEM STATUS";model=doc["model"] | "-";
  latency=doc["latency"]|0;errors=doc["errors"]|0;inputTokens=doc["input"]|0;outputTokens=doc["output"]|0;cost=doc["cost"]|0.0f;hasData=true;
  }else {state="JSON INVALIDO";hasData=false;Serial.print("Erro JSON: ");Serial.println(err.c_str());}
 }else {state="BACKEND OFF";hasData=false;Serial.print("Erro HTTP: ");Serial.println(code);}
 http.end();
}
void setup(){Serial.begin(115200);Wire.begin(21,22);if(!display.begin(SSD1306_SWITCHCAPVCC,0x3C)){Serial.println("OLED nao encontrado");while(true)delay(1000);}
 WiFi.mode(WIFI_STA);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);draw();}
void loop(){unsigned long now=millis();
 if(WiFi.status()!=WL_CONNECTED && now-lastReconnect>10000){lastReconnect=now;WiFi.reconnect();}
 if(lastPoll==0||now-lastPoll>=3000){lastPoll=now;poll();}
 if(now-lastDraw>=1000){lastDraw=now;draw();}
}
