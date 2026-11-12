export type TdsUnit = 'ppm' | 'mg/L';

export interface Reading {
  /** Browser receive time, used for the visible local clock and export. */
  time: string;
  /** Arduino uptime in milliseconds when the reading was sampled, if supplied. */
  deviceTimeMs?: number | null;
  tdsPpm: number;
  temperature: number | null;
}

export interface ParsedReading {
  deviceTimeMs: number | null;
  tdsPpm: number;
  temperature: number | null;
}

export interface SharedExperiment {
  sourceId: string;
  sourceLabel: string;
  experimentId: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  count: number;
  readings: Reading[];
}

export interface ExperimentSession {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  readings: Reading[];
}
