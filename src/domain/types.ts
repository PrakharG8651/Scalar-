export type ConductivityUnit = 'mS/cm' | 'µS/cm';

export interface Reading {
  /** Browser receive time, used for the visible local clock and export. */
  time: string;
  /** Arduino uptime in milliseconds when the reading was sampled, if supplied. */
  deviceTimeMs?: number | null;
  conductivity: number;
  temperature: number | null;
}

export interface ParsedReading {
  deviceTimeMs: number | null;
  conductivity: number;
  temperature: number | null;
}

export interface ExperimentSession {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  readings: Reading[];
}
