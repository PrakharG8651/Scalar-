import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sparkline from './components/Sparkline';
import type { ExperimentSession, Reading, SharedExperiment, TdsUnit } from './domain/types';
import { displayTds } from './services/measurements';
import { SerialDevice } from './services/serialDevice';
import { sessionRepository } from './services/sessionRepository';
import { closeSharedExperiment, getSourceIdentity, publishReading, subscribeToSharedFeed } from './services/sharedFeed';

function clockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function elapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

type ExportFormat = 'csv' | 'txt';

function deltaSeconds(readingTime: string, startedAt: string): string {
  const delta = (new Date(readingTime).getTime() - new Date(startedAt).getTime()) / 1000;
  return Number.isFinite(delta) ? Math.max(0, delta).toFixed(3) : '';
}

function dataForSession(session: ExperimentSession, format: ExportFormat): string {
  const separator = format === 'csv' ? ',' : '\t';
  const rows = [
    ['session_name', 'started_at', 'ended_at', 'timestamp_local', 'delta_t_s', 'arduino_elapsed_ms', 'tds_ppm', 'temperature_C'].join(separator),
  ];
  session.readings.forEach((reading) => rows.push([
    `"${session.name.replaceAll('"', '""')}"`, session.startedAt, session.endedAt || '',
    reading.time, deltaSeconds(reading.time, session.startedAt), reading.deviceTimeMs ?? '', reading.tdsPpm, reading.temperature ?? '',
  ].join(separator)));
  return rows.join('\r\n');
}

function downloadSession(session: ExperimentSession, format: ExportFormat): void {
  const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
  const url = URL.createObjectURL(new Blob([dataForSession(session, format)], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  const name = session.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'scalar-session';
  anchor.download = `${name}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [savedSessions, setSavedSessions] = useState(() => sessionRepository.list());
  const [unit, setUnit] = useState<TdsUnit>(() => sessionRepository.readUnit());
  const [connected, setConnected] = useState(false);
  const [feedConnected, setFeedConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState<ExperimentSession | null>(null);
  const [networkExperiments, setNetworkExperiments] = useState<SharedExperiment[]>([]);
  const [latest, setLatest] = useState<Reading | null>(null);
  const [toast, setToast] = useState('');
  const [duration, setDuration] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const serialRef = useRef<SerialDevice | null>(null);
  const activeSessionRef = useRef<ExperimentSession | null>(null);
  const sourceIdentity = useMemo(() => getSourceIdentity(), []);
  const shareFailureNotified = useRef(false);
  const pausedRef = useRef(paused);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  pausedRef.current = paused;
  const display = useMemo(() => latest ? displayTds(latest.tdsPpm, unit) : null, [latest, unit]);
  const activeReadings = active?.readings ?? [];

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => subscribeToSharedFeed({
    onSnapshot: setNetworkExperiments,
    onStatus: setFeedConnected,
    onReading: (message) => setNetworkExperiments((current) => {
      const index = current.findIndex((item) => item.sourceId === message.sourceId && item.experimentId === message.experimentId);
      const item: SharedExperiment = index < 0
        ? { sourceId: message.sourceId, sourceLabel: message.sourceLabel, experimentId: message.experimentId, name: message.name, startedAt: message.startedAt, endedAt: null, count: message.count, readings: [message.reading] }
        : { ...current[index], count: message.count, readings: [...current[index].readings, message.reading] };
      if (index < 0) return [item, ...current];
      const next = [...current];
      next[index] = item;
      return next;
    }),
    onClosed: (message) => setNetworkExperiments((current) => current.map((item) => item.sourceId === message.sourceId && item.experimentId === message.experimentId ? { ...item, endedAt: message.endedAt } : item)),
  }), []);

  useEffect(() => {
    if (!active || paused) return;
    const started = new Date(active.startedAt).getTime();
    const tick = () => setDuration(Date.now() - started);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [active?.id, active?.startedAt, paused]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    void serialRef.current?.disconnect();
  }, []);

  const acceptReading = useCallback((reading: Reading) => {
    if (pausedRef.current) return;
    setLatest(reading);
    let current = activeSessionRef.current;
    if (!current || current.endedAt) {
      current = {
        id: crypto.randomUUID(),
        name: `TDS experiment ${new Date().toLocaleString()}`,
        startedAt: reading.time,
        endedAt: '',
        readings: [],
      };
    }
    const next = { ...current, readings: [...current.readings, reading] };
    activeSessionRef.current = next;
    setActive(next);
    void publishReading({ ...sourceIdentity, experimentId: next.id, name: next.name, startedAt: next.startedAt, reading }).catch(() => {
      if (!shareFailureNotified.current) {
        shareFailureNotified.current = true;
        notify('Network live sharing is unavailable. Local readings are still being collected.');
      }
    });
  }, [notify, sourceIdentity]);

  const connect = async () => {
    if (connected) {
      const current = activeSessionRef.current;
      if (current) void closeSharedExperiment(sourceIdentity.sourceId, current.id);
      await serialRef.current?.disconnect();
      serialRef.current = null;
      setConnected(false);
      if (current) {
        const ended = { ...current, endedAt: new Date().toISOString() };
        activeSessionRef.current = ended;
        setActive(ended);
      }
      notify('Device disconnected. Save the current session to keep its readings.');
      return;
    }
    if (!SerialDevice.isSupported()) {
      notify('Web Serial is not available here. Try Chrome or Edge on desktop.');
      return;
    }
    const device = new SerialDevice();
    serialRef.current = device;
    const experiment: ExperimentSession = {
      id: crypto.randomUUID(),
      name: `TDS experiment ${new Date().toLocaleString()}`,
      startedAt: new Date().toISOString(),
      endedAt: '',
      readings: [],
    };
    activeSessionRef.current = experiment;
    setActive(experiment);
    try {
      await device.connect(acceptReading, () => {
        serialRef.current = null;
        setConnected(false);
        setPaused(false);
        const current = activeSessionRef.current;
        if (current) {
          const ended = { ...current, endedAt: new Date().toISOString() };
          activeSessionRef.current = ended;
          setActive(ended);
          void closeSharedExperiment(sourceIdentity.sourceId, current.id);
        }
        notify('The Arduino disconnected. Save the readings collected so far.');
      });
      setConnected(true);
    } catch (error) {
      serialRef.current = null;
      activeSessionRef.current = null;
      setActive(null);
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      notify(error instanceof Error ? error.message : 'Could not connect to the serial port.');
    }
  };

  const saveSession = () => {
    if (!active?.readings.length) return;
    const completed = { ...active, endedAt: new Date().toISOString() };
    const next = [completed, ...savedSessions];
    try {
      sessionRepository.saveAll(next);
      setSavedSessions(next);
      void closeSharedExperiment(sourceIdentity.sourceId, completed.id);
      activeSessionRef.current = null;
      setActive(null);
      setDuration(0);
      notify('Session saved on this device.');
    } catch {
      notify('Device storage is full. Export a session and remove older data.');
    }
  };

  const stopSession = async () => {
    if (active) {
      const ended = { ...active, endedAt: new Date().toISOString() };
      activeSessionRef.current = ended;
      setActive(ended);
      void closeSharedExperiment(sourceIdentity.sourceId, active.id);
    }
    if (connected) {
      await serialRef.current?.disconnect();
      serialRef.current = null;
      setConnected(false);
    }
    setPaused(false);
    notify(active?.readings.length ? 'Experiment stopped. Save the session to keep its readings.' : 'Experiment stopped.');
  };

  const changeUnit = (value: TdsUnit) => {
    setUnit(value);
    sessionRepository.saveUnit(value);
  };

  const removeSession = (id: string) => {
    const next = savedSessions.filter((item) => item.id !== id);
    try {
      sessionRepository.saveAll(next);
      setSavedSessions(next);
      notify('Session removed from this device.');
    } catch { notify('Could not update device storage.'); }
  };

  const exportAll = (format: ExportFormat) => {
    const separator = format === 'csv' ? ',' : '\t';
    const rows = [['experiment', 'timestamp_local', 'delta_t_s', 'arduino_elapsed_ms', 'tds_ppm', 'temperature_C'].join(separator)];
    savedSessions.forEach((session) => session.readings.forEach((reading) => {
      rows.push([`"${session.name.replaceAll('"', '""')}"`, reading.time, deltaSeconds(reading.time, session.startedAt), reading.deviceTimeMs ?? '', reading.tdsPpm, reading.temperature ?? ''].join(separator));
    }));
    const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8';
    const url = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `scalar-all-experiments.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const setPause = () => setPaused((value) => !value);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#dashboard" aria-label="Scalar home">
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M4 17h5l4-9 6 17 4-8h5" /></svg></span>
          <span>scalar<span className="brand-dot">.</span><small>CONDUCTIVITY LAB</small></span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <a className="nav-item active" href="#dashboard"><span className="nav-icon">⌂</span> Overview</a>
        <a className="nav-item" href="#sessions"><span className="nav-icon">▤</span> Experiments <span className="nav-count">{savedSessions.length}</span></a>
        <a className="nav-item" href="#help"><span className="nav-icon">?</span> Help &amp; setup</a>
        <div className="sidebar-note"><div className="note-icon">⌁</div><strong>Your lab, in real time.</strong><p>Connect an Arduino to turn measurements into useful insight.</p></div>
        <div className="sidebar-footer"><span className="local-dot" /> Saved on this device <span className="privacy-lock">⌑</span></div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div><div className="topbar-right"><span className="local-badge"><span className={`local-dot${feedConnected ? '' : ' offline'}`} /> {feedConnected ? 'LAN LIVE' : 'LAN OFFLINE'}</span><span className="avatar" aria-label="No account required">L</span></div></header>
        <div className="page-wrap">
          <section className="page-heading"><div><div className="eyebrow">UNIT OPERATIONS LAB <span>•</span> CONDUCTIVITY</div><h1>Good afternoon, researcher<span className="heading-period">.</span></h1><p className="subheading">Your measurement bench is ready when you are.</p></div><div className="date-stamp"><span className="date-icon">▦</span><span>{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</span></div></section>

          <section className="device-card" aria-label="Arduino connection">
            <div className="device-visual" aria-hidden="true"><div className="device-chip"><span className="chip-pin top" /><span className="chip-pin bottom" /><span className="chip-core">TDS</span></div><span className="device-wave wave-one" /><span className="device-wave wave-two" /></div>
            <div className="device-copy"><div className="device-title-row"><h2>TDS measurement device</h2><span className={`status-pill${connected ? ' connected' : ''}`}><span className="status-dot" /> {connected ? 'Connected' : 'Disconnected'}</span></div><p>{connected ? 'Arduino serial stream connected. Incoming TDS readings will appear below and be shared with LAN viewers.' : 'Connect your Arduino over USB to start receiving live total dissolved solids readings.'}</p><div className="device-meta"><span className="usb-icon">⌁</span><span>{connected ? `USB serial · 9600 baud · ${sourceIdentity.sourceLabel}` : 'USB serial · 9600 baud · TDS in ppm'}</span></div></div>
            <div className="device-actions"><button className="button button-primary" onClick={() => void connect()}><span className="button-icon">{connected ? '✓' : '⌁'}</span> {connected ? 'Disconnect device' : 'Connect Arduino'}</button><span className="browser-hint">{SerialDevice.isSupported() ? 'Choose a serial port in your browser' : 'Serial requires Chrome or Edge on desktop'}</span></div>
          </section>

          <div className="section-heading"><div><div className="eyebrow">LIVE MONITOR</div><h2>Measurement overview</h2></div><div className="live-label"><span className={`pulse-dot${connected && !paused ? ' active' : ''}`} />{paused ? 'PAUSED' : connected ? 'RECEIVING DATA' : 'AWAITING DEVICE'}</div></div>

          <section className="metrics-grid" aria-label="Current measurements">
            <article className="metric-card primary-metric"><div className="metric-top"><span className="metric-label">TOTAL DISSOLVED SOLIDS</span><span className="metric-symbol">↗</span></div><div className="metric-value"><span>{display === null ? '—' : display.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><span className="metric-unit">{unit}</span></div><div className="metric-foot"><span className="metric-indicator">●</span>{latest ? `Updated ${clockTime(new Date(latest.time))}` : 'Waiting for first reading'}</div><div className="metric-decoration" /></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">TEMPERATURE</span><span className="metric-symbol warm">♨</span></div><div className="metric-value"><span>{latest?.temperature === null || !latest ? '—' : latest.temperature.toFixed(1)}</span><span className="metric-unit">°C</span></div><div className="metric-foot"><span className="muted-dot">●</span>Optional sensor input</div></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">SESSION DURATION</span><span className="metric-symbol">◷</span></div><div className="metric-value"><span>{elapsed(duration)}</span></div><div className="metric-foot"><span className="muted-dot">●</span>{activeReadings.length} {activeReadings.length === 1 ? 'reading' : 'readings'} collected</div></article>
          </section>

          <section className="chart-card" aria-labelledby="chart-heading">
            <div className="chart-header"><div><div className="chart-title-row"><h2 id="chart-heading">TDS over time</h2><span className="chart-live"><span className={`pulse-dot${connected && !paused ? ' active' : ''}`} /> LIVE</span></div><p>Track the current experiment by local sample time.</p></div><label className="unit-select-wrap"><span className="sr-only">TDS unit</span><select value={unit} onChange={(event) => changeUnit(event.target.value as TdsUnit)}><option value="ppm">ppm</option><option value="mg/L">mg/L</option></select><span className="select-chevron">⌄</span></label></div>
            <div className="chart-legend"><span className="legend-line" /> TDS <span className="legend-current">{display === null ? '—' : `${display.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`}</span></div>
            {activeReadings.length ? <Sparkline readings={activeReadings} unit={unit} /> : <div className="chart-area"><div className="chart-y-labels"><span>—</span><span>—</span><span>—</span><span>—</span></div><div className="chart-plot"><div className="chart-grid"><i /><i /><i /><i /></div><div className="chart-empty"><span className="empty-wave">⌁</span><strong>Your readings will appear here</strong><span>Connect your Arduino to begin a live experiment.</span></div><div className="chart-x-labels"><span>—</span><span>—</span><span>—</span><span>—</span><span>—</span></div></div></div>}
          </section>

          <section className="readings-card" aria-labelledby="readings-heading">
            <div className="readings-header"><div><div className="eyebrow">LIVE DATA</div><h2 id="readings-heading">Recent TDS readings</h2><p>Rolling queue · newest five measurements stay on screen</p></div><span className="queue-count">{Math.min(activeReadings.length, 5)} / 5 SHOWN</span></div>
            <div className="readings-table-wrap"><table className="readings-table"><thead><tr><th>TIME (LOCAL)</th><th>ΔT (S)</th><th>ARDUINO UPTIME</th><th>TDS</th><th>TEMPERATURE</th></tr></thead><tbody>{activeReadings.slice(-5).map((reading, index) => <tr key={`${reading.time}-${index}`}><td>{clockTime(new Date(reading.time))}</td><td>{active ? deltaSeconds(reading.time, active.startedAt) : '—'}</td><td>{reading.deviceTimeMs === null || reading.deviceTimeMs === undefined ? '—' : `${(reading.deviceTimeMs / 1000).toFixed(2)} s`}</td><td><strong>{displayTds(reading.tdsPpm, unit).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> <span>{unit}</span></td><td>{reading.temperature === null ? '—' : `${reading.temperature.toFixed(1)} °C`}</td></tr>)}{activeReadings.length === 0 && <tr className="readings-placeholder"><td colSpan={5}>Waiting for Arduino readings. Each new measurement enters at the bottom of this five-row queue.</td></tr>}</tbody></table></div>
            <div className="readings-footer">{activeReadings.length > 5 ? `${activeReadings.length - 5} earlier ${activeReadings.length - 5 === 1 ? 'reading has' : 'readings have'} rolled off the table.` : 'Earlier readings roll off the top as new data arrives.'}</div>
          </section>

          <section className="experiment-row"><div className="experiment-info"><div className="experiment-icon">◉</div><div><h2>Current experiment</h2><p>{active ? `${activeReadings.length} readings · ${active.endedAt ? 'stopped' : paused ? 'paused' : 'in progress'}` : 'No active experiment. Connect a device to begin.'}</p></div></div><div className="experiment-controls"><button className="button button-subtle" disabled={!active || Boolean(active.endedAt)} onClick={setPause}><span>{paused ? '▶' : 'Ⅱ'}</span> {paused ? 'Resume' : 'Pause'}</button><button className="button button-outline" disabled={!activeReadings.length} onClick={saveSession}><span>▣</span> Save session</button><details className="export-menu"><summary className="button button-export">↓ Export <span>⌄</span></summary><div className="export-options"><button disabled={!activeReadings.length} onClick={() => active && downloadSession(active, 'csv')}>Download CSV</button><button disabled={!activeReadings.length} onClick={() => active && downloadSession(active, 'txt')}>Download TXT</button></div></details><button className="button button-stop" disabled={(!active && !connected) || Boolean(active?.endedAt && !connected)} onClick={() => void stopSession()} aria-label="Stop experiment"><span>■</span></button></div></section>

          <section className="sessions-section" id="sessions"><div className="sessions-heading"><div><div className="eyebrow">YOUR DEVICE</div><h2>Recent experiments</h2></div><details className="export-menu export-all-menu"><summary className={`text-button${savedSessions.length ? '' : ' disabled'}`}>Export all <span>↗</span></summary><div className="export-options"><button disabled={!savedSessions.length} onClick={() => exportAll('csv')}>Download CSV</button><button disabled={!savedSessions.length} onClick={() => exportAll('txt')}>Download TXT</button></div></details></div><div className="sessions-list">{savedSessions.length === 0 ? <div className="sessions-empty"><span>▤</span><div><strong>No saved experiments yet</strong><p>Save a session to keep its readings on this device.</p></div></div> : savedSessions.map((item) => <article className="session-item" key={item.id}><div><div className="session-name">{item.name}</div><div className="session-meta">{new Date(item.startedAt).toLocaleString()} · {item.readings.length} samples</div></div><div className="session-stat">{item.readings.length ? <><strong>{item.readings[item.readings.length - 1].tdsPpm.toFixed(2)}</strong> ppm</> : 'No data'}</div><div className="session-buttons"><details className="export-menu"><summary className="mini-button">↓ Export</summary><div className="export-options"><button onClick={() => downloadSession(item, 'csv')}>Download CSV</button><button onClick={() => downloadSession(item, 'txt')}>Download TXT</button></div></details><button className="mini-button" onClick={() => removeSession(item.id)} aria-label={`Delete ${item.name}`}>×</button></div></article>)}</div></section>
          <section className="network-section" id="network">
            <div className="sessions-heading"><div><div className="eyebrow">SHARED ON THIS NETWORK</div><h2>Live experiments</h2></div><span className={`network-state${feedConnected ? ' online' : ''}`}><i />{feedConnected ? `${networkExperiments.length} experiments · LIVE` : 'Connecting to LAN feed…'}</span></div>
            <p className="network-description">Read-only live feed from every connected measurement device. Each device appears as a separate experiment. Only the device that collected a session can save it locally.</p>
            {networkExperiments.length === 0 ? <div className="network-empty">No shared readings yet. Connect an Arduino to publish the first experiment to this LAN.</div> : <div className="network-list">{[...networkExperiments].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((experiment) => {
              const current = experiment.readings.at(-1);
              return <article className="network-experiment" key={`${experiment.sourceId}:${experiment.experimentId}`}>
                <div className="network-experiment-head"><div><span className="device-label">{experiment.sourceLabel}{experiment.sourceId === sourceIdentity.sourceId ? ' · THIS DEVICE' : ''}</span><h3>{experiment.name}</h3><p>Started {new Date(experiment.startedAt).toLocaleString()} · {experiment.count} readings</p></div><span className={`experiment-live${experiment.endedAt ? ' ended' : ''}`}><i />{experiment.endedAt ? 'ENDED' : 'LIVE'}</span></div>
                {current && <><div className="network-current"><strong>{displayTds(current.tdsPpm, unit).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><span>{unit}</span><small>Updated {clockTime(new Date(current.time))}</small></div><div className="network-chart"><Sparkline readings={experiment.readings} unit={unit} /></div><details className="network-readings"><summary>View all {experiment.count} readings</summary><div className="readings-table-wrap"><table className="readings-table"><thead><tr><th>TIME (LOCAL)</th><th>ΔT (S)</th><th>ARDUINO UPTIME</th><th>TDS</th><th>TEMPERATURE</th></tr></thead><tbody>{experiment.readings.map((reading, index) => <tr key={`${reading.time}-${index}`}><td>{clockTime(new Date(reading.time))}</td><td>{deltaSeconds(reading.time, experiment.startedAt)}</td><td>{reading.deviceTimeMs == null ? '—' : `${(reading.deviceTimeMs / 1000).toFixed(2)} s`}</td><td><strong>{displayTds(reading.tdsPpm, unit).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> {unit}</td><td>{reading.temperature == null ? '—' : `${reading.temperature.toFixed(1)} °C`}</td></tr>)}</tbody></table></div></details></>}
              </article>;
            })}</div>}
          </section>

          <section className="help-section" id="help"><div className="eyebrow">QUICK GUIDE</div><h2>How to use Scalar</h2><p className="help-intro">A quick path from Arduino readings to a saved experiment.</p><div className="help-grid"><article><span>01</span><h3>Open the lab on your network</h3><p>Start the app on the computer that will host readings. Open the same site address on other devices connected to the same Wi-Fi. The LAN indicator shows whether live sharing is available.</p></article><article><span>02</span><h3>Connect an Arduino</h3><p>Use Chrome or Edge on the computer connected to the Arduino. Choose its serial port when prompted. The board sends one newline-terminated Scalar TDS row at 9600 baud.</p></article><article><span>03</span><h3>Watch readings and graphs</h3><p>The main table keeps the newest five readings; the graph and experiment history keep the full run. The network section shows separate live experiments from each device.</p></article><article><span>04</span><h3>Save and export</h3><p>Save on the collecting device to keep a local copy. Export CSV or tab-delimited TXT. Other network viewers can see live data but do not write to their local log.</p></article></div><div className="protocol-note"><strong>Arduino line format</strong><code>SCALAR,1,&lt;elapsed_ms&gt;,&lt;tds_ppm&gt;,&lt;temperature_C&gt;</code><span>Temperature is optional. Live LAN data is held in host memory and clears when its server restarts. Saved sessions remain only in the browser that saved them.</span></div></section>
          <footer className="page-footer"><span>SCALAR <span className="footer-divider">/</span> TDS LAB</span><span>Live network data is temporary; saved sessions stay on the saving device.</span></footer>
        </div>
      </main>
      <div className={`toast${toast ? ' visible' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
