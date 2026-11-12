import type { ParsedReading, TdsUnit } from '../domain/types';

// Least-squares calibration from the 24 paired reference/Arduino PPM readings.
const TDS_CALIBRATION_SLOPE = 1.863;
const TDS_CALIBRATION_INTERCEPT = -27.3;

/** Parse the versioned Scalar TDS protocol or early prototype formats. */
export function parseArduinoLine(line: string): ParsedReading | null {
  const text = line.trim();
  if (!text) return null;
  const fields = text.split(',').map((field) => field.trim());
  let deviceTimeMs: number | null = null;
  let tdsPpm: number;
  let rawTemperature: number | null = null;

  if (fields[0] === 'SCALAR' && fields[1] === '1') {
    // Canonical format: SCALAR,1,<millis>,<tds_ppm>,<temperature_C or empty>
    if (fields.length < 4 || fields.length > 5) return null;
    deviceTimeMs = Number(fields[2]);
    tdsPpm = Number(fields[3]);
    rawTemperature = fields[4] === undefined || fields[4] === '' ? null : Number(fields[4]);
  } else if (fields.length === 1) {
    // Legacy bare value, timestamped by the browser on receipt.
    tdsPpm = Number(fields[0]);
  } else if (fields.length === 3) {
    // Legacy time,TDS,temperature rows from the first prototype.
    const candidateTimestamp = Number(fields[0]);
    deviceTimeMs = Number.isFinite(candidateTimestamp) ? candidateTimestamp : null;
    tdsPpm = Number(fields[1]);
    rawTemperature = fields[2] === '' ? null : Number(fields[2]);
  } else {
    // Legacy value[,temperature] format.
    tdsPpm = Number(fields[0]);
    rawTemperature = fields[1] === '' ? null : Number(fields[1]);
  }

  if (deviceTimeMs !== null && (!Number.isFinite(deviceTimeMs) || deviceTimeMs < 0)) return null;
  if (!Number.isFinite(tdsPpm) || tdsPpm < 0 || tdsPpm > 1e7) return null;

  // Incoming serial values are the uncalibrated Arduino PPM readings.
  // ADC counts from analogRead(A0) must first be converted to PPM in firmware.
  tdsPpm = Math.max(0, TDS_CALIBRATION_SLOPE * tdsPpm + TDS_CALIBRATION_INTERCEPT);
  return {
    deviceTimeMs,
    tdsPpm,
    temperature: rawTemperature !== null && Number.isFinite(rawTemperature) && rawTemperature >= -100 && rawTemperature <= 200 ? rawTemperature : null,
  };
}

export function displayTds(value: number, _unit: TdsUnit): number {
  // For dilute water samples, ppm and mg/L are approximately equivalent.
  return value;
}
