const MAX_MESSAGE_BYTES = 16 * 1024;

function sendEvent(response, name, payload) {
  response.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function createLiveFeed() {
  const clients = new Set();
  const experiments = new Map();

  function broadcast(name, payload) {
    for (const client of clients) {
      try { sendEvent(client, name, payload); } catch { clients.delete(client); }
    }
  }

  function readJson(request) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      request.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_MESSAGE_BYTES) {
          reject(new Error('Request body is too large.'));
          request.destroy?.();
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      request.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Request body must be valid JSON.')); }
      });
      request.on('error', reject);
    });
  }

  function respond(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  }

  async function handle(request, response) {
    const url = new URL(request.url || '/', 'http://scalar.local');
    if (!url.pathname.startsWith('/api/')) return false;

    if (request.method === 'GET' && url.pathname === '/api/live') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders?.();
      clients.add(response);
      sendEvent(response, 'snapshot', [...experiments.values()]);
      const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000);
      response.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/status') {
      respond(response, 200, { viewers: clients.size, experiments: experiments.size });
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/readings') {
      try {
        const body = await readJson(request);
        const { sourceId, sourceLabel, experimentId, name, startedAt, reading } = body;
        if (typeof sourceId !== 'string' || sourceId.length > 80 || typeof experimentId !== 'string' || experimentId.length > 80 ||
            typeof sourceLabel !== 'string' || sourceLabel.length > 80 || typeof name !== 'string' || name.length > 120 ||
            typeof startedAt !== 'string' || !reading || typeof reading.time !== 'string' ||
            !Number.isFinite(reading.tdsPpm) || reading.tdsPpm < 0 || reading.tdsPpm > 1e7 ||
            (reading.deviceTimeMs !== null && reading.deviceTimeMs !== undefined && (!Number.isFinite(reading.deviceTimeMs) || reading.deviceTimeMs < 0)) ||
            (reading.temperature !== null && reading.temperature !== undefined && (!Number.isFinite(reading.temperature) || reading.temperature < -100 || reading.temperature > 200))) {
          respond(response, 400, { error: 'Reading does not match the Scalar TDS message format.' });
          return true;
        }
        const key = `${sourceId}:${experimentId}`;
        let experiment = experiments.get(key);
        if (!experiment) {
          experiment = { sourceId, sourceLabel, experimentId, name, startedAt, endedAt: null, count: 0, readings: [] };
          experiments.set(key, experiment);
        }
        if (experiment.endedAt) {
          respond(response, 409, { error: 'This experiment is already closed.' });
          return true;
        }
        const cleanReading = {
          time: reading.time,
          deviceTimeMs: reading.deviceTimeMs ?? null,
          tdsPpm: reading.tdsPpm,
          temperature: reading.temperature ?? null,
        };
        experiment.readings.push(cleanReading);
        experiment.count = experiment.readings.length;
        broadcast('reading', { sourceId, sourceLabel, experimentId, name, startedAt, count: experiment.count, reading: cleanReading });
        respond(response, 202, { accepted: true, count: experiment.count });
      } catch (error) {
        respond(response, 400, { error: error instanceof Error ? error.message : 'Invalid reading.' });
      }
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/experiments/close') {
      try {
        const body = await readJson(request);
        const key = `${body.sourceId}:${body.experimentId}`;
        const experiment = experiments.get(key);
        if (!experiment) {
          respond(response, 404, { error: 'Experiment was not found.' });
          return true;
        }
        experiment.endedAt ||= new Date().toISOString();
        broadcast('closed', { sourceId: experiment.sourceId, experimentId: experiment.experimentId, endedAt: experiment.endedAt });
        respond(response, 200, { closed: true });
      } catch (error) {
        respond(response, 400, { error: error instanceof Error ? error.message : 'Invalid close request.' });
      }
      return true;
    }

    respond(response, 404, { error: 'API route not found.' });
    return true;
  }

  return { handle };
}
