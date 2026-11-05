import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sparkline from './components/Sparkline';
import type { ConductivityUnit, ExperimentSession, Reading } from './domain/types';
import { displayConductivity } from './services/measurements';
import { SerialDevice } from './services/serialDevice';
import { sessionRepository } from './services/sessionRepository';

function clockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function elapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

type ExportFormat = 'csv' | 'txt';

function dataForSession(session: ExperimentSession, format: ExportFormat): string {
  const separator = format === 'csv' ? ',' : '\t';
  const rows = [
    ['session_name', 'started_at', 'ended_at', 'timestamp_local', 'arduino_elapsed_ms', 'conductivity_mS_cm', 'temperature_C'].join(separator),
  ];
  session.readings.forEach((reading) => rows.push([
    `"${session.name.replaceAll('"', '""')}"`, session.startedAt, session.endedAt || '',
    reading.time, reading.deviceTimeMs ?? '', reading.conductivity, reading.temperature ?? '',
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
  const [unit, setUnit] = useState<ConductivityUnit>(() => sessionRepository.readUnit());
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState<ExperimentSession | null>(null);
  const [latest, setLatest] = useState<Reading | null>(null);
  const [toast, setToast] = useState('');
  const [duration, setDuration] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const serialRef = useRef<SerialDevice | null>(null);
  const pausedRef = useRef(paused);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  pausedRef.current = paused;
  const display = useMemo(() => latest ? displayConductivity(latest.conductivity, unit) : null, [latest, unit]);
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
    setActive((current) => {
      const next = current ?? {
        id: crypto.randomUUID(),
        name: `Conductivity run ${new Date().toLocaleString()}`,
        startedAt: reading.time,
        endedAt: '',
        readings: [],
      };
      return { ...next, readings: [...next.readings, reading] };
    });
  }, []);

  const connect = async () => {
    if (connected) {
      await serialRef.current?.disconnect();
      serialRef.current = null;
      setConnected(false);
      notify('Device disconnected. Save the current session to keep its readings.');
      return;
    }
    if (!SerialDevice.isSupported()) {
      notify('Web Serial is not available here. Try Chrome or Edge on desktop.');
      return;
    }
    const device = new SerialDevice();
    serialRef.current = device;
    setActive((current) => current?.endedAt ? null : current);
    try {
      await device.connect(acceptReading, () => {
        serialRef.current = null;
        setConnected(false);
        setPaused(false);
        setActive((current) => current ? { ...current, endedAt: new Date().toISOString() } : null);
        notify('The Arduino disconnected. Save the readings collected so far.');
      });
      setConnected(true);
    } catch (error) {
      serialRef.current = null;
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
      setActive(null);
      setDuration(0);
      notify('Session saved on this device.');
    } catch {
      notify('Device storage is full. Export a session and remove older data.');
    }
  };

  const stopSession = async () => {
    if (active) setActive((current) => current ? { ...current, endedAt: new Date().toISOString() } : null);
    if (connected) {
      await serialRef.current?.disconnect();
      serialRef.current = null;
      setConnected(false);
    }
    setPaused(false);
    notify(active?.readings.length ? 'Experiment stopped. Save the session to keep its readings.' : 'Experiment stopped.');
  };

  const changeUnit = (value: ConductivityUnit) => {
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
    const rows = [['session', 'timestamp_local', 'arduino_elapsed_ms', 'conductivity_mS_cm', 'temperature_C'].join(separator)];
    savedSessions.forEach((session) => session.readings.forEach((reading) => {
      rows.push([`"${session.name.replaceAll('"', '""')}"`, reading.time, reading.deviceTimeMs ?? '', reading.conductivity, reading.temperature ?? ''].join(separator));
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
        <div className="sidebar-note"><div className="note-icon">⌁</div><strong>Your lab, in real time.</strong><p>Connect an Arduino to turn measurements into useful insight.</p></div>
        <div className="sidebar-footer"><span className="local-dot" /> Saved on this device <span className="privacy-lock">⌑</span></div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div><div className="topbar-right"><span className="local-badge"><span className="local-dot" /> LOCAL WORKSPACE</span><span className="avatar" aria-label="No account required">L</span></div></header>
        <div className="page-wrap">
          <section className="page-heading"><div><div className="eyebrow">UNIT OPERATIONS LAB <span>•</span> CONDUCTIVITY</div><h1>Good afternoon, researcher<span className="heading-period">.</span></h1><p className="subheading">Your measurement bench is ready when you are.</p></div><div className="date-stamp"><span className="date-icon">▦</span><span>{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</span></div></section>

          <section className="device-card" aria-label="Arduino connection">
            <div className="device-visual" aria-hidden="true"><div className="device-chip"><span className="chip-pin top" /><span className="chip-pin bottom" /><span className="chip-core">A</span></div><span className="device-wave wave-one" /><span className="device-wave wave-two" /></div>
            <div className="device-copy"><div className="device-title-row"><h2>Measurement device</h2><span className={`status-pill${connected ? ' connected' : ''}`}><span className="status-dot" /> {connected ? 'Connected' : 'Disconnected'}</span></div><p>{connected ? 'Arduino serial stream connected. Incoming readings will appear below.' : 'Connect your Arduino over USB to start receiving live conductivity readings.'}</p><div className="device-meta"><span className="usb-icon">⌁</span><span>{connected ? 'USB serial · 9600 baud · port ready' : 'USB serial · 9600 baud'}</span></div></div>
            <div className="device-actions"><button className="button button-primary" onClick={() => void connect()}><span className="button-icon">{connected ? '✓' : '⌁'}</span> {connected ? 'Disconnect device' : 'Connect Arduino'}</button><span className="browser-hint">{SerialDevice.isSupported() ? 'Choose a serial port in your browser' : 'Serial requires Chrome or Edge on desktop'}</span></div>
          </section>

          <div className="section-heading"><div><div className="eyebrow">LIVE MONITOR</div><h2>Measurement overview</h2></div><div className="live-label"><span className={`pulse-dot${connected && !paused ? ' active' : ''}`} />{paused ? 'PAUSED' : connected ? 'RECEIVING DATA' : 'AWAITING DEVICE'}</div></div>

          <section className="metrics-grid" aria-label="Current measurements">
            <article className="metric-card primary-metric"><div className="metric-top"><span className="metric-label">CONDUCTIVITY</span><span className="metric-symbol">↗</span></div><div className="metric-value"><span>{display === null ? '—' : display.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span><span className="metric-unit">{unit}</span></div><div className="metric-foot"><span className="metric-indicator">●</span>{latest ? `Updated ${clockTime(new Date(latest.time))}` : 'Waiting for first reading'}</div><div className="metric-decoration" /></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">TEMPERATURE</span><span className="metric-symbol warm">♨</span></div><div className="metric-value"><span>{latest?.temperature === null || !latest ? '—' : latest.temperature.toFixed(1)}</span><span className="metric-unit">°C</span></div><div className="metric-foot"><span className="muted-dot">●</span>Optional sensor input</div></article>
            <article className="metric-card"><div className="metric-top"><span className="metric-label">SESSION DURATION</span><span className="metric-symbol">◷</span></div><div className="metric-value"><span>{elapsed(duration)}</span></div><div className="metric-foot"><span className="muted-dot">●</span>{activeReadings.length} {activeReadings.length === 1 ? 'reading' : 'readings'} collected</div></article>
          </section>

          <section className="chart-card" aria-labelledby="chart-heading">
            <div className="chart-header"><div><div className="chart-title-row"><h2 id="chart-heading">Conductivity over time</h2><span className="chart-live"><span className={`pulse-dot${connected && !paused ? ' active' : ''}`} /> LIVE</span></div><p>Watch your readings update as the experiment runs.</p></div><label className="unit-select-wrap"><span className="sr-only">Conductivity unit</span><select value={unit} onChange={(event) => changeUnit(event.target.value as ConductivityUnit)}><option value="mS/cm">mS/cm</option><option value="µS/cm">µS/cm</option></select><span className="select-chevron">⌄</span></label></div>
            <div className="chart-legend"><span className="legend-line" /> Conductivity <span className="legend-current">{display === null ? '—' : `${display.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`}</span></div>
            {activeReadings.length ? <Sparkline readings={activeReadings} unit={unit} /> : <div className="chart-area"><div className="chart-y-labels"><span>—</span><span>—</span><span>—</span><span>—</span></div><div className="chart-plot"><div className="chart-grid"><i /><i /><i /><i /></div><div className="chart-empty"><span className="empty-wave">⌁</span><strong>Your readings will appear here</strong><span>Connect your Arduino to begin a live experiment.</span></div><div className="chart-x-labels"><span>—</span><span>—</span><span>—</span><span>—</span><span>—</span></div></div></div>}
          </section>

          <section className="readings-card" aria-labelledby="readings-heading">
            <div className="readings-header"><div><div className="eyebrow">LIVE DATA</div><h2 id="readings-heading">Recent readings</h2><p>Rolling queue · newest five measurements stay on screen</p></div><span className="queue-count">{Math.min(activeReadings.length, 5)} / 5 SHOWN</span></div>
            <div className="readings-table-wrap"><table className="readings-table"><thead><tr><th>TIME (LOCAL)</th><th>ARDUINO TIME</th><th>CONDUCTIVITY</th><th>TEMPERATURE</th></tr></thead><tbody>{activeReadings.slice(-5).map((reading, index) => <tr key={`${reading.time}-${index}`}><td>{clockTime(new Date(reading.time))}</td><td>{reading.deviceTimeMs === null || reading.deviceTimeMs === undefined ? '—' : `${(reading.deviceTimeMs / 1000).toFixed(2)} s`}</td><td><strong>{displayConductivity(reading.conductivity, unit).toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong> <span>{unit}</span></td><td>{reading.temperature === null ? '—' : `${reading.temperature.toFixed(1)} °C`}</td></tr>)}{activeReadings.length === 0 && <tr className="readings-placeholder"><td colSpan={4}>Waiting for Arduino readings. Each new measurement enters at the bottom of this five-row queue.</td></tr>}</tbody></table></div>
            <div className="readings-footer">{activeReadings.length > 5 ? `${activeReadings.length - 5} earlier ${activeReadings.length - 5 === 1 ? 'reading has' : 'readings have'} rolled off the table.` : 'Earlier readings roll off the top as new data arrives.'}</div>
          </section>

          <section className="experiment-row"><div className="experiment-info"><div className="experiment-icon">◉</div><div><h2>Current experiment</h2><p>{active ? `${activeReadings.length} readings · ${active.endedAt ? 'stopped' : paused ? 'paused' : 'in progress'}` : 'No active experiment. Connect a device to begin.'}</p></div></div><div className="experiment-controls"><button className="button button-subtle" disabled={!active || Boolean(active.endedAt)} onClick={setPause}><span>{paused ? '▶' : 'Ⅱ'}</span> {paused ? 'Resume' : 'Pause'}</button><button className="button button-outline" disabled={!activeReadings.length} onClick={saveSession}><span>▣</span> Save session</button><details className="export-menu"><summary className="button button-export">↓ Export <span>⌄</span></summary><div className="export-options"><button disabled={!activeReadings.length} onClick={() => active && downloadSession(active, 'csv')}>Download CSV</button><button disabled={!activeReadings.length} onClick={() => active && downloadSession(active, 'txt')}>Download TXT</button></div></details><button className="button button-stop" disabled={(!active && !connected) || Boolean(active?.endedAt && !connected)} onClick={() => void stopSession()} aria-label="Stop experiment"><span>■</span></button></div></section>

          <section className="sessions-section" id="sessions"><div className="sessions-heading"><div><div className="eyebrow">YOUR DEVICE</div><h2>Recent experiments</h2></div><details className="export-menu export-all-menu"><summary className={`text-button${savedSessions.length ? '' : ' disabled'}`}>Export all <span>↗</span></summary><div className="export-options"><button disabled={!savedSessions.length} onClick={() => exportAll('csv')}>Download CSV</button><button disabled={!savedSessions.length} onClick={() => exportAll('txt')}>Download TXT</button></div></details></div><div className="sessions-list">{savedSessions.length === 0 ? <div className="sessions-empty"><span>▤</span><div><strong>No saved experiments yet</strong><p>Save a session to keep its readings on this device.</p></div></div> : savedSessions.map((item) => <article className="session-item" key={item.id}><div><div className="session-name">{item.name}</div><div className="session-meta">{new Date(item.startedAt).toLocaleString()} · {item.readings.length} samples</div></div><div className="session-stat">{item.readings.length ? <><strong>{item.readings[item.readings.length - 1].conductivity.toFixed(2)}</strong> mS/cm</> : 'No data'}</div><div className="session-buttons"><details className="export-menu"><summary className="mini-button">↓ Export</summary><div className="export-options"><button onClick={() => downloadSession(item, 'csv')}>Download CSV</button><button onClick={() => downloadSession(item, 'txt')}>Download TXT</button></div></details><button className="mini-button" onClick={() => removeSession(item.id)} aria-label={`Delete ${item.name}`}>×</button></div></article>)}</div></section>
          <footer className="page-footer"><span>SCALAR <span className="footer-divider">/</span> LAB TOOLS</span><span>Measurements stay in this browser on this device.</span></footer>
        </div>
      </main>
      <div className={`toast${toast ? ' visible' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
