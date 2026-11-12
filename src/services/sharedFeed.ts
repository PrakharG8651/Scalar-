import type { Reading, SharedExperiment } from '../domain/types';

export interface SharedReadingMessage {
  sourceId: string;
  sourceLabel: string;
  experimentId: string;
  name: string;
  startedAt: string;
  count: number;
  reading: Reading;
}

export function getSourceIdentity(): { sourceId: string; sourceLabel: string } {
  let sourceId = sessionStorage.getItem('scalar-source-id');
  if (!sourceId) {
    sourceId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('scalar-source-id', sourceId);
  }
  return { sourceId, sourceLabel: `Device ${sourceId.slice(0, 4).toUpperCase()}` };
}

export function subscribeToSharedFeed(handlers: {
  onSnapshot: (experiments: SharedExperiment[]) => void;
  onReading: (message: SharedReadingMessage) => void;
  onClosed: (message: { sourceId: string; experimentId: string; endedAt: string }) => void;
  onStatus: (connected: boolean) => void;
}): () => void {
  const stream = new EventSource('/api/live');
  stream.onopen = () => handlers.onStatus(true);
  stream.onerror = () => handlers.onStatus(false);
  stream.addEventListener('snapshot', (event) => handlers.onSnapshot(JSON.parse((event as MessageEvent<string>).data) as SharedExperiment[]));
  stream.addEventListener('reading', (event) => handlers.onReading(JSON.parse((event as MessageEvent<string>).data) as SharedReadingMessage));
  stream.addEventListener('closed', (event) => handlers.onClosed(JSON.parse((event as MessageEvent<string>).data)));
  return () => stream.close();
}

export async function publishReading(payload: {
  sourceId: string;
  sourceLabel: string;
  experimentId: string;
  name: string;
  startedAt: string;
  reading: Reading;
}): Promise<void> {
  const response = await fetch('/api/readings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Live network sharing is unavailable.');
}

export async function closeSharedExperiment(sourceId: string, experimentId: string): Promise<void> {
  try {
    await fetch('/api/experiments/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, experimentId }),
    });
  } catch { /* The local session remains usable if LAN sharing drops. */ }
}
