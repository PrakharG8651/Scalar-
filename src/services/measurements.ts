import type { ConductivityUnit, ParsedReading } from '../domain/types';

/** Parse a bare value or a CSV row with conductivity in the penultimate column. */
export function parseArduinoLine(line: string): ParsedReading | null {
  const text = line.trim();
  if (!text) return null;
  const fields = text.split(',').map((field) => field.trim());
  let deviceTimeMs: number | null = null;
  let conductivity: number;
  let rawTemperature: number | null = null;

  if (fields[0] === 'SCALAR' && fields[1] === '1') {
    // Canonical format: SCALAR,1,<millis>,<conductivity_mS_cm>,<temperature_C or empty>
    if (fields.length < 4 || fields.length > 5) return null;
    deviceTimeMs = Number(fields[2]);
    conductivity = Number(fields[3]);
    rawTemperature = fields[4] === undefined || fields[4] === '' ? null : Number(fields[4]);
  } else if (fields.length === 1) {
    // Legacy bare value, timestamped by the browser on receipt.
    conductivity = Number(fields[0]);
  } else if (fields.length === 3) {
    // Legacy time,conductivity,temperature rows from the first prototype.
    const candidateTimestamp = Number(fields[0]);
    deviceTimeMs = Number.isFinite(candidateTimestamp) ? candidateTimestamp : null;
    conductivity = Number(fields[1]);
    rawTemperature = fields[2] === '' ? null : Number(fields[2]);
  } else {
    // Legacy value[,temperature] format.
    conductivity = Number(fields[0]);
    rawTemperature = fields[1] === '' ? null : Number(fields[1]);
  }

  if (deviceTimeMs !== null && (!Number.isFinite(deviceTimeMs) || deviceTimeMs < 0)) return null;
  if (!Number.isFinite(conductivity) || Math.abs(conductivity) > 1e9) return null;
  return {
    deviceTimeMs,
    conductivity,
    temperature: rawTemperature !== null && Number.isFinite(rawTemperature) && rawTemperature >= -100 && rawTemperature <= 200 ? rawTemperature : null,
  };
}

export function displayConductivity(value: number, unit: ConductivityUnit): number {
  return unit === 'µS/cm' ? value * 1000 : value;
}
