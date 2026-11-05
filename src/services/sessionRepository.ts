import type { ConductivityUnit, ExperimentSession } from '../domain/types';

const SESSIONS_KEY = 'scalar-lab-sessions-v1';
const UNIT_KEY = 'scalar-lab-unit';

/** Browser-local persistence boundary. Replace this adapter if storage needs change later. */
export const sessionRepository = {
  list(): ExperimentSession[] {
    try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') as ExperimentSession[]; }
    catch { return []; }
  },
  saveAll(sessions: ExperimentSession[]): void { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); },
  readUnit(): ConductivityUnit { return localStorage.getItem(UNIT_KEY) === 'µS/cm' ? 'µS/cm' : 'mS/cm'; },
  saveUnit(unit: ConductivityUnit): void { localStorage.setItem(UNIT_KEY, unit); },
};
