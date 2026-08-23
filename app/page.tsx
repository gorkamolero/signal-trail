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

type StoredSession = {
  id: string;
  startedAt: number;
  endedAt: number;
  samples: Sample[];
};

type Quality = {
  label: string;
  detail: string;
  tone: "idle" | "great" | "good" | "weak" | "lost";
};

const SAMPLE_INTERVAL = 5000;
const HISTORY_KEY = "signal-trail-sessions-v1";

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function classify(sample: Sample | undefined, jitter: number | null): Quality {
  if (!sample) return { label: "READY", detail: "Waiting to begin", tone: "idle" };
  if (!sample.ok || sample.rtt === null) {
    return { label: "NO LINK", detail: "Request failed", tone: "lost" };
  }
  if (sample.rtt < 90 && (jitter ?? 0) < 45) {
    return { label: "STRONG", detail: "Fast and stable", tone: "great" };
  }
  if (sample.rtt < 180 && (jitter ?? 0) < 100) {
    return { label: "USABLE", detail: "Connection is healthy", tone: "good" };
  }
  return { label: "WEAK", detail: "Slow or unstable", tone: "weak" };
}

function Sparkline({ samples }: { samples: Sample[] }) {
  const points = samples.slice(-30);
  const path = useMemo(() => {
    if (!points.length) return "";
    const values = points.map((point) => point.rtt ?? 700);
    const max = Math.max(220, ...values);
    return values
      .map((value, index) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
        const y = 94 - Math.min(value / max, 1) * 82;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);

  return (
    <div className="signal-chart" aria-label="Recent latency chart">
      <div className="chart-grid" />
      {path ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="signal-area" d={`${path} L100 100 L0 100 Z`} />
          <path className="signal-line" d={path} />
        </svg>
      ) : (
        <div className="empty-chart">Your signal trace will appear here</div>
      )}
    </div>
  );
}

export default function Home() {
  const [running, setRunning] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [gpsState, setGpsState] = useState<"idle" | "searching" | "locked" | "denied">("idle");
  const [history, setHistory] = useState<StoredSession[]>([]);
  const [expanded, setExpanded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const latestPosition = useRef<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const currentSamples = useRef<Sample[]>([]);
  const currentStart = useRef<number | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    try {
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
      if (Array.isArray(stored)) setHistory(stored.slice(0, 8));
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

  const recentRtts = samples.slice(-20).flatMap((sample) => sample.rtt === null ? [] : [sample.rtt]);
  const latest = samples.at(-1);
  const average = recentRtts.length
    ? Math.round(recentRtts.reduce((sum, value) => sum + value, 0) / recentRtts.length)
    : null;
  const jitter = recentRtts.length > 1
    ? Math.round(recentRtts.slice(1).reduce((sum, value, index) => sum + Math.abs(value - recentRtts[index]), 0) / (recentRtts.length - 1))
    : null;
  const failed = samples.filter((sample) => !sample.ok).length;
  const loss = samples.length ? Math.round((failed / samples.length) * 100) : 0;
  const quality = classify(latest, jitter);

  const takeSample = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4200);
    const before = performance.now();
    let ok = false;
    let rtt: number | null = null;

    try {
      const response = await fetch(`/api/ping?at=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      ok = response.ok;
      if (ok) rtt = Math.round(performance.now() - before);
    } catch {
      ok = false;
    } finally {
      window.clearTimeout(timeout);
    }

    const position = latestPosition.current;
    const sample: Sample = {
      at: Date.now(),
      rtt,
      ok,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      accuracy: position?.accuracy ?? null,
    };
    currentSamples.current = [...currentSamples.current, sample];
    setSamples(currentSamples.current);
    timerRef.current = setTimeout(takeSample, Math.max(0, SAMPLE_INTERVAL - (performance.now() - before)));
  }, []);

  const startGps = useCallback(() => {
    if (!gpsEnabled || !("geolocation" in navigator)) return;
    setGpsState("searching");
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        latestPosition.current = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: Math.round(coords.accuracy),
        };
        setGpsState("locked");
      },
      () => setGpsState("denied"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 },
    );
  }, [gpsEnabled]);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
    setRunning(false);
    setGpsState("idle");

    if (currentStart.current && currentSamples.current.length) {
      const session: StoredSession = {
        id: String(currentStart.current),
        startedAt: currentStart.current,
        endedAt: Date.now(),
        samples: currentSamples.current,
      };
      setHistory((previous) => {
        const next = [session, ...previous].slice(0, 8);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    }
  }, []);

  const start = useCallback(async () => {
    currentSamples.current = [];
    const now = Date.now();
    currentStart.current = now;
    latestPosition.current = null;
    setSamples([]);
    setStartedAt(now);
    setElapsed(0);
    setRunning(true);
    startGps();
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
      }
    } catch {
      wakeLockRef.current = null;
    }
    takeSample();
  }, [startGps, takeSample]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  function exportCsv(session?: StoredSession) {
    const exportSamples = session?.samples ?? samples;
    if (!exportSamples.length) return;
    const rows = [
      "timestamp,success,rtt_ms,latitude,longitude,accuracy_m",
      ...exportSamples.map((sample) => [
        new Date(sample.at).toISOString(), sample.ok, sample.rtt ?? "", sample.latitude ?? "", sample.longitude ?? "", sample.accuracy ?? "",
      ].join(",")),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `signal-trail-${new Date(session?.startedAt ?? startedAt ?? Date.now()).toISOString().slice(0, 19).replaceAll(":", "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={`app-shell tone-${quality.tone}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>SIGNAL TRAIL</span>
        </div>
        <div className={`live-pill ${running ? "active" : ""}`}>
          <span />{running ? "LIVE" : "STANDBY"}
        </div>
      </header>

      <section className="instrument" aria-live="polite">
        <div className="eyebrow">CONNECTION QUALITY</div>
        <div className="quality-label">{running && !samples.length ? "TESTING" : quality.label}</div>
        <div className="quality-detail">{running && !samples.length ? "Taking first reading…" : quality.detail}</div>
        <div className="latency-readout">
          <strong>{latest?.rtt ?? "—"}</strong><span>ms</span>
        </div>
        <div className="readout-caption">CURRENT RESPONSE</div>
      </section>

      <Sparkline samples={samples} />

      <section className="metric-row" aria-label="Session measurements">
        <div><span>MEDIAN</span><strong>{median(recentRtts) ?? "—"}<small> ms</small></strong></div>
        <div><span>JITTER</span><strong>{jitter ?? "—"}<small> ms</small></strong></div>
        <div><span>LOSS</span><strong>{loss}<small>%</small></strong></div>
      </section>

      <section className="controls">
        <button className={`main-control ${running ? "stop" : "start"}`} onClick={running ? stop : start}>
          <span className="control-icon" aria-hidden="true" />
          <strong>{running ? "STOP" : "START"}</strong>
          <small>{running ? formatDuration(elapsed) : "5 SEC INTERVAL"}</small>
        </button>

        <button
          className={`gps-toggle ${gpsEnabled ? "enabled" : ""}`}
          onClick={() => !running && setGpsEnabled((value) => !value)}
          disabled={running}
          aria-pressed={gpsEnabled}
        >
          <span className="gps-icon" aria-hidden="true">⌖</span>
          <span><strong>Location tagging</strong><small>{running ? gpsState : gpsEnabled ? "Ready to map readings" : "Off"}</small></span>
          <i />
        </button>
      </section>

      <section className="details">
        <button className="details-trigger" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          <span>SESSION DATA</span><span>{samples.length} readings</span><span>{expanded ? "−" : "+"}</span>
        </button>
        {expanded && (
          <div className="details-panel">
            <div className="detail-grid">
              <div><span>AVERAGE</span><strong>{average ?? "—"} ms</strong></div>
              <div><span>FAILURES</span><strong>{failed}</strong></div>
              <div><span>GPS</span><strong>{gpsState === "locked" ? `±${latestPosition.current?.accuracy} m` : gpsEnabled ? "Waiting" : "Off"}</strong></div>
            </div>
            <button className="export-button" onClick={() => exportCsv()} disabled={!samples.length}>Export current CSV</button>
            {!!history.length && (
              <div className="history">
                <h2>RECENT RUNS</h2>
                {history.slice(0, 3).map((session) => {
                  const valid = session.samples.flatMap((sample) => sample.rtt === null ? [] : [sample.rtt]);
                  return (
                    <div className="history-row" key={session.id}>
                      <span>{new Date(session.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      <strong>{session.samples.length} points · {median(valid) ?? "—"} ms</strong>
                      <button onClick={() => exportCsv(session)} aria-label="Export this session">↓</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <footer>
        <span>HTTP RTT · one sample every 5 seconds</span>
        <span>Keep this screen open while recording</span>
      </footer>
    </main>
  );
}
