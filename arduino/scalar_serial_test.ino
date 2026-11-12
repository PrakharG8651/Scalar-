/*
  Scalar serial protocol test generator.
  This sketch emits SIMULATED measurements to verify the browser connection,
  rolling five-row table, chart, save flow, and CSV/TXT exports.

  Serial line format at 9600 baud:
  SCALAR,1,<elapsed_ms>,<tds_ppm>,<temperature_C>

  This is not a TDS sensor driver. Replace simulatedTdsPpm()
  and simulatedTemperatureC() with values from the calibrated probe circuit
  once the team's sensor wiring and conversion formula are finalized.
*/

#include <math.h>

const unsigned long SAMPLE_INTERVAL_MS = 1000;
unsigned long lastSampleMs = 0;

float simulatedTdsPpm(unsigned long elapsedMs) {
  // Smooth, clearly synthetic variation for checking the interface.
  const float phase = (float)elapsedMs / 8000.0f;
  return 240.0f + 25.0f * sinf(phase);
}

float simulatedTemperatureC(unsigned long elapsedMs) {
  const float phase = (float)elapsedMs / 12000.0f;
  return 24.8f + 0.4f * sinf(phase);
}

void setup() {
  Serial.begin(9600);
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSampleMs < SAMPLE_INTERVAL_MS) return;
  lastSampleMs = now;

  Serial.print("SCALAR,1,");
  Serial.print(now);
  Serial.print(',');
  Serial.print(simulatedTdsPpm(now), 2);
  Serial.print(',');
  Serial.println(simulatedTemperatureC(now), 1);
}
