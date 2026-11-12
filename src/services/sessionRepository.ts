import type { ExperimentSession, TdsUnit } from '../domain/types';

const SESSIONS_KEY = 'scalar-lab-tds-sessions-v1';
const UNIT_KEY = 'scalar-lab-tds-unit';

/** Browser-local persistence boundary. Replace this adapter if storage needs change later. */
export const sessionRepository = {
  list(): ExperimentSession[] {
    try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') as ExperimentSession[]; }
    catch { return []; }
  },
  saveAll(sessions: ExperimentSession[]): void { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); },
  readUnit(): TdsUnit { return localStorage.getItem(UNIT_KEY) === 'mg/L' ? 'mg/L' : 'ppm'; },
  saveUnit(unit: TdsUnit): void { localStorage.setItem(UNIT_KEY, unit); },
};
