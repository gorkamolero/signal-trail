"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Sample = {
  at: number;
  rtt: number | null;
  ok: boolean;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
};

type SpeedReading = {
  at: number;
  down: number | null;
  up: number | null;
};

type Trail = {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  samples: Sample[];
  speeds: SpeedReading[];
};

type Metrics = {
  ping: number | null;
  jitter: number | null;
  loss: number;
  down: number | null;
  up: number | null;
  distance: number;
  score: number | null;
};

const PING_INTERVAL = 5000;
const SPEED_INTERVAL = 30000;
const HISTORY_KEY = "signal-trail-sessions-v1";
const HISTORY_LIMIT = 24;

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function haversine(a: Sample, b: Sample) {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return 0;
  if ((a.accuracy ?? 999) > 100 || (b.accuracy ?? 999) > 100) return 0;
  const radius = 6371;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const km = radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  return km < 0.25 ? km : 0;
}

function callScore(ping: number | null, jitter: number | null, loss: number, down: number | null, up: number | null) {
  if (ping === null || jitter === null || down === null || up === null) return null;
  const latencyScore = ping < 100 ? 100 : ping < 150 ? 78 : ping < 250 ? 45 : ping < 400 ? 18 : 0;
  const jitterScore = jitter < 20 ? 100 : jitter < 35 ? 76 : jitter < 60 ? 42 : jitter < 100 ? 15 : 0;
  const lossScore = loss < 1 ? 100 : loss < 2.5 ? 72 : loss < 5 ? 35 : loss < 10 ? 10 : 0;
  const downScore = down >= 2 ? 100 : down >= 1.2 ? 72 : down >= 0.6 ? 28 : 0;
  const upScore = up >= 1.5 ? 100 : up >= 1 ? 72 : up >= 0.5 ? 28 : 0;
  return Math.round(latencyScore * .25 + jitterScore * .2 + lossScore * .25 + downScore * .12 + upScore * .18);
}

function getMetrics(samples: Sample[], speeds: SpeedReading[]): Metrics {
  const rtts = samples.flatMap((sample) => sample.rtt === null ? [] : [sample.rtt]);
  const ping = median(rtts);
  const jitter = rtts.length > 1
    ? Math.round(rtts.slice(1).reduce((sum, value, index) => sum + Math.abs(value - rtts[index]), 0) / (rtts.length - 1))
    : null;
  const loss = samples.length ? Math.round((samples.filter((sample) => !sample.ok).length / samples.length) * 1000) / 10 : 0;
  const down = median(speeds.flatMap((speed) => speed.down === null ? [] : [speed.down]));
  const up = median(speeds.flatMap((speed) => speed.up === null ? [] : [speed.up]));
  const distance = samples.slice(1).reduce((sum, sample, index) => sum + haversine(samples[index], sample), 0);
  return { ping, jitter, loss, down, up, distance, score: callScore(ping, jitter, loss, down, up) };
}

function statusFor(running: boolean, samples: Sample[], metrics: Metrics) {
  if (!samples.length) return { label: running ? "SCANNING" : "READY", tone: "idle", detail: running ? "Finding the signal" : "Start a trail" };
  if (!samples.at(-1)?.ok) return { label: "SIGNAL LOST", tone: "lost", detail: "Trying to reconnect" };
  if (metrics.score === null) return { label: "CHECKING", tone: "idle", detail: "Measuring call speed" };
  if (metrics.score >= 80) return { label: "CALL READY", tone: "great", detail: "Video should hold" };
  if (metrics.score >= 60) return { label: "CAUTION", tone: "weak", detail: "Call may break up" };
  return { label: "NOT READY", tone: "lost", detail: "Call quality is at risk" };
}

function SignalTrace({ samples, compact = false }: { samples: Sample[]; compact?: boolean }) {
  const points = samples.slice(compact ? -40 : -60);
  const path = useMemo(() => {
    if (!points.length) return "";
    const values = points.map((point) => point.rtt ?? 650);
    const max = Math.max(240, ...values);
    return values.map((value, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 92 - Math.min(value / max, 1) * 78;
      return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");
  }, [points]);

  return (
    <div className={`signal-trace ${compact ? "compact" : ""}`} aria-label="Connection trace">
      <div className="trace-grid" />
      {path ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="trace-area" d={`${path} L100 100 L0 100 Z`} />
          <path className="trace-line" d={path} />
        </svg>
      ) : <div className="flatline" />}
    </div>
  );
}

function SignalGlyph({ score, running }: { score: number | null; running: boolean }) {
  const level = score === null ? (running ? 2 : 0) : Math.max(1, Math.ceil(score / 20));
  return (
    <div className={`signal-glyph ${running && score === null ? "seeking" : ""}`} aria-hidden="true">
      <span className="orbit orbit-one" />
      <span className="orbit orbit-two" />
      <div className="signal-bars">
        {[1, 2, 3, 4, 5].map((bar) => <i className={bar <= level ? "on" : ""} key={bar} />)}
      </div>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>;
}

export default function Home() {
  const [view, setView] = useState<"test" | "history">("test");
  const [running, setRunning] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [speeds, setSpeeds] = useState<SpeedReading[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [gpsState, setGpsState] = useState<"idle" | "searching" | "locked" | "denied">("idle");
  const [history, setHistory] = useState<Trail[]>([]);
  const [speedTesting, setSpeedTesting] = useState(false);
  const pingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRequestRef = useRef<AbortController | null>(null);
  const speedRequestRef = useRef<AbortController | null>(null);
  const watchRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const activeRunRef = useRef(false);
  const latestPosition = useRef<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const currentSamples = useRef<Sample[]>([]);
  const currentSpeeds = useRef<SpeedReading[]>([]);
  const currentStart = useRef<number | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Array<Partial<Trail>>;
      if (Array.isArray(stored)) {
        setHistory(stored.slice(0, HISTORY_LIMIT).map((trail, index) => ({
          id: trail.id ?? String(trail.startedAt ?? Date.now() + index),
          name: trail.name ?? `Trail ${stored.length - index}`,
          startedAt: trail.startedAt ?? Date.now(),
          endedAt: trail.endedAt ?? trail.startedAt ?? Date.now(),
          samples: trail.samples ?? [],
          speeds: trail.speeds ?? [],
        })));
      }
    } catch {
      localStorage.removeItem(HISTORY_KEY);
    }
  }, []);

  useEffect(() => {
    if (!running || startedAt === null) return;
    const update = () => setElapsed(Date.now() - startedAt);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const metrics = useMemo(() => getMetrics(samples, speeds), [samples, speeds]);
  const status = statusFor(running, samples, metrics);
  const latestSpeed = speeds.at(-1);

  const takeSample = useCallback(async () => {
    if (!activeRunRef.current) return;
    const controller = new AbortController();
    pingRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 4200);
    const before = performance.now();
    let ok = false;
    let rtt: number | null = null;
    try {
      const response = await fetch(`/api/ping?at=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      ok = response.ok;
      if (ok) rtt = Math.round(performance.now() - before);
    } catch {
      ok = false;
    } finally {
      window.clearTimeout(timeout);
      pingRequestRef.current = null;
    }
    if (!activeRunRef.current) return;
    const position = latestPosition.current;
    const sample: Sample = {
      at: Date.now(), rtt, ok,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      accuracy: position?.accuracy ?? null,
    };
    currentSamples.current = [...currentSamples.current, sample];
    setSamples(currentSamples.current);
    pingTimerRef.current = setTimeout(() => void takeSample(), Math.max(0, PING_INTERVAL - (performance.now() - before)));
  }, []);

  const testSpeed = useCallback(async () => {
    if (!activeRunRef.current) return;
    setSpeedTesting(true);
    const controller = new AbortController();
    speedRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 16000);
    let down: number | null = null;
    let up: number | null = null;
    try {
      const downStart = performance.now();
      const response = await fetch(`/api/speed?bytes=262144&at=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.arrayBuffer();
      const downSeconds = (performance.now() - downStart) / 1000;
      if (response.ok && downSeconds > 0) down = Math.round((payload.byteLength * 8 / downSeconds / 1_000_000) * 10) / 10;

      const upload = new Uint8Array(131072);
      const upStart = performance.now();
      const upResponse = await fetch(`/api/speed?at=${Date.now()}`, {
        method: "POST", body: upload, cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/octet-stream" },
      });
      const upSeconds = (performance.now() - upStart) / 1000;
      if (upResponse.ok && upSeconds > 0) up = Math.round((upload.byteLength * 8 / upSeconds / 1_000_000) * 10) / 10;
    } catch {
      // A failed speed burst is recorded so weak sections remain visible.
    } finally {
      window.clearTimeout(timeout);
      speedRequestRef.current = null;
      setSpeedTesting(false);
    }
    if (!activeRunRef.current) return;
    const reading = { at: Date.now(), down, up };
    currentSpeeds.current = [...currentSpeeds.current, reading];
    setSpeeds(currentSpeeds.current);
    speedTimerRef.current = setTimeout(() => void testSpeed(), SPEED_INTERVAL);
  }, []);

  const startGps = useCallback(() => {
    if (!gpsEnabled || !("geolocation" in navigator)) return;
    setGpsState("searching");
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        latestPosition.current = { latitude: coords.latitude, longitude: coords.longitude, accuracy: Math.round(coords.accuracy) };
        setGpsState("locked");
      },
      () => setGpsState("denied"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
    );
  }, [gpsEnabled]);

  const persistHistory = useCallback((next: Trail[]) => {
    const limited = next.slice(0, HISTORY_LIMIT);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(limited));
    return limited;
  }, []);

  const stop = useCallback(() => {
    activeRunRef.current = false;
    pingRequestRef.current?.abort();
    speedRequestRef.current?.abort();
    if (pingTimerRef.current) clearTimeout(pingTimerRef.current);
    if (speedTimerRef.current) clearTimeout(speedTimerRef.current);
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    wakeLockRef.current?.release().catch(() => undefined);
    pingRequestRef.current = null;
    speedRequestRef.current = null;
    pingTimerRef.current = null;
    speedTimerRef.current = null;
    watchRef.current = null;
    wakeLockRef.current = null;
    setSpeedTesting(false);
    setRunning(false);
    setGpsState("idle");

    if (currentStart.current && currentSamples.current.length) {
      const trail: Trail = {
        id: String(currentStart.current),
        name: `Trail ${history.length + 1}`,
        startedAt: currentStart.current,
        endedAt: Date.now(),
        samples: currentSamples.current,
        speeds: currentSpeeds.current,
      };
      setHistory((previous) => persistHistory([trail, ...previous]));
      setView("history");
    }
  }, [history.length, persistHistory]);

  const start = useCallback(async () => {
    activeRunRef.current = true;
    currentSamples.current = [];
    currentSpeeds.current = [];
    latestPosition.current = null;
    const now = Date.now();
    currentStart.current = now;
    setSamples([]);
    setSpeeds([]);
    setStartedAt(now);
    setElapsed(0);
    setView("test");
    setRunning(true);
    startGps();
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
      }
    } catch {
      wakeLockRef.current = null;
    }
    void takeSample();
    void testSpeed();
  }, [startGps, takeSample, testSpeed]);

  useEffect(() => () => {
    activeRunRef.current = false;
    pingRequestRef.current?.abort();
    speedRequestRef.current?.abort();
    if (pingTimerRef.current) clearTimeout(pingTimerRef.current);
    if (speedTimerRef.current) clearTimeout(speedTimerRef.current);
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  function renameTrail(trail: Trail) {
    const name = window.prompt("Name this trail", trail.name)?.trim();
    if (!name) return;
    setHistory((previous) => persistHistory(previous.map((item) => item.id === trail.id ? { ...item, name } : item)));
  }

  function deleteTrail(trail: Trail) {
    if (!window.confirm(`Delete ${trail.name}?`)) return;
    setHistory((previous) => persistHistory(previous.filter((item) => item.id !== trail.id)));
  }

  function exportTrail(trail: Trail) {
    const rows = ["timestamp,success,rtt_ms,download_mbps,upload_mbps,latitude,longitude,accuracy_m"];
    let currentSpeed: SpeedReading | undefined;
    for (const sample of trail.samples) {
      currentSpeed = trail.speeds.filter((speed) => speed.at <= sample.at).at(-1) ?? currentSpeed ?? trail.speeds[0];
      rows.push([
        new Date(sample.at).toISOString(), sample.ok, sample.rtt ?? "", currentSpeed?.down ?? "", currentSpeed?.up ?? "",
        sample.latitude ?? "", sample.longitude ?? "", sample.accuracy ?? "",
      ].join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${trail.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "signal-trail"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={`app-shell tone-${status.tone}`}>
      <header className="topbar">
        <button className="brand" onClick={() => setView("test")} aria-label="Open test">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>SIGNAL TRAIL</span>
        </button>
        <nav aria-label="Views">
          <button className={view === "test" ? "selected" : ""} onClick={() => setView("test")}>TEST</button>
          <button className={view === "history" ? "selected" : ""} onClick={() => setView("history")}>TRAILS <b>{history.length}</b></button>
        </nav>
      </header>

      {view === "test" ? (
        <>
          <section className="instrument" aria-live="polite">
            <SignalGlyph score={metrics.score} running={running} />
            <div className="status-line">
              <h1>{status.label}</h1>
              {metrics.score !== null && <strong>{metrics.score}<small>%</small></strong>}
            </div>
            <p>{status.detail}{running ? ` · ${formatDuration(elapsed)}` : ""}</p>
          </section>

          <SignalTrace samples={samples} />

          <section className="metric-grid" aria-label="Video call measurements">
            <Metric label="PING" value={metrics.ping ?? "—"} unit="ms" />
            <Metric label="JITTER" value={metrics.jitter ?? "—"} unit="ms" />
            <Metric label="LOSS" value={metrics.loss} unit="%" />
            <Metric label="DOWN" value={latestSpeed?.down ?? "—"} unit="Mbps" />
            <Metric label="UP" value={latestSpeed?.up ?? "—"} unit="Mbps" />
          </section>

          <section className="controls">
            <button className={`main-control ${running ? "stop" : "start"}`} onClick={running ? stop : start}>
              <span className="control-icon" aria-hidden="true" />
              <strong>{running ? "STOP & SAVE" : "START TRAIL"}</strong>
              <small>{running ? `${samples.length} PINGS` : "VIDEO CALL TEST"}</small>
            </button>
            <div className="utility-row">
              <button
                className={`gps-button ${gpsEnabled ? "on" : ""}`}
                onClick={() => !running && setGpsEnabled((value) => !value)}
                disabled={running}
                aria-pressed={gpsEnabled}
              >
                <span>⌖</span> {running ? gpsState.toUpperCase() : gpsEnabled ? "GPS ON" : "GPS OFF"}
              </button>
              <span className={speedTesting ? "speed-burst active" : "speed-burst"}><i />{speedTesting ? "SPEED BURST" : "30s SPEED"}</span>
              {running && <span className="screen-note">KEEP OPEN</span>}
            </div>
          </section>
        </>
      ) : (
        <section className="history-view">
          <div className="history-head">
            <div><span>YOUR SIGNAL MAP</span><h1>TRAILS</h1></div>
            <button onClick={start}><span>＋</span> NEW</button>
          </div>

          {!history.length ? (
            <div className="empty-history">
              <SignalGlyph score={null} running={false} />
              <h2>NO TRAILS YET</h2>
              <button onClick={start}>START THE FIRST</button>
            </div>
          ) : (
            <div className="trail-list">
              {history.map((trail) => {
                const trailMetrics = getMetrics(trail.samples, trail.speeds);
                const trailStatus = statusFor(false, trail.samples, trailMetrics);
                return (
                  <article className={`trail-card tone-${trailStatus.tone}`} key={trail.id}>
                    <div className="trail-title">
                      <button onClick={() => renameTrail(trail)}><strong>{trail.name}</strong><span>✎</span></button>
                      <div className="trail-score">{trailMetrics.score ?? "—"}<small>%</small></div>
                    </div>
                    <div className="trail-meta">
                      <span>{new Date(trail.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      <span>{formatDuration(trail.endedAt - trail.startedAt)}</span>
                      {trailMetrics.distance > .01 && <span>{trailMetrics.distance.toFixed(2)} km</span>}
                      <b>{trailStatus.label}</b>
                    </div>
                    <SignalTrace samples={trail.samples} compact />
                    <div className="trail-metrics">
                      <Metric label="PING" value={trailMetrics.ping ?? "—"} unit="ms" />
                      <Metric label="DOWN" value={trailMetrics.down ?? "—"} unit="Mbps" />
                      <Metric label="UP" value={trailMetrics.up ?? "—"} unit="Mbps" />
                      <Metric label="LOSS" value={trailMetrics.loss} unit="%" />
                    </div>
                    <div className="trail-actions">
                      <button onClick={() => exportTrail(trail)}>↓ CSV</button>
                      <button className="delete" onClick={() => deleteTrail(trail)}>DELETE</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
