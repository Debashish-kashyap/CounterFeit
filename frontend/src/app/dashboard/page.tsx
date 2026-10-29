"use client";

import {
  Activity,
  AlertTriangle,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useSession } from "@/lib/session";

const REFRESH_INTERVAL = 30; // seconds

/** SVG ring that counts down from REFRESH_INTERVAL to 0 */
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const r = 10;
  const circ = 2 * Math.PI * r;
  const progress = seconds / total;
  const dash = circ * progress;
  return (
    <svg className="countdown-ring" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r={r} className="countdown-track" />
      <circle
        cx="14" cy="14" r={r}
        className="countdown-fill"
        strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset={circ * 0.25} /* start at top */
        style={{ transition: "stroke-dasharray 1s linear" }}
      />
    </svg>
  );
}

type Summary = {
  totalScans: number;
  genuine: number;
  suspicious: number;
  expired: number;
  unknown: number;
};

type Scan = {
  id: string;
  targetType: "PACK" | "CASE";
  serialOrCode: string;
  result: "GENUINE" | "SUSPICIOUS" | "EXPIRED" | "UNKNOWN";
  reason: string | null;
  createdAt: string;
  scanner: { name: string; locationName: string | null };
};

type Page<T> = { data: T[]; pagination: { total: number } };

const metricDetails = [
  { key: "totalScans", label: "TOTAL SCANS", icon: ScanLine, foot: "All verification attempts" },
  { key: "genuine", label: "GENUINE", icon: ShieldCheck, foot: "Verified in registry" },
  { key: "suspicious", label: "SUSPICIOUS", icon: AlertTriangle, foot: "Requires review" },
  { key: "expired", label: "EXPIRED", icon: Clock3, foot: "Past expiry date" },
  { key: "unknown", label: "UNKNOWN", icon: CircleAlert, foot: "Not in registry" },
] as const;

type Hotspot = { lat: number; lng: number; count: number };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function DashboardPage() {
  const { token } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [flagged, setFlagged] = useState<Scan[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const countdownRef = useRef(REFRESH_INTERVAL);

  const load = useCallback(async (isAuto = false) => {
    if (!token) return;
    if (!isAuto) setBusy(true);
    setError("");
    try {
      const [nextSummary, nextScans, nextFlagged, nextHotspots] = await Promise.all([
        apiRequest<Summary>("/dashboard/summary", token),
        apiRequest<Page<Scan>>("/dashboard/scans?page=1&limit=8", token),
        apiRequest<Page<Scan>>("/dashboard/flagged?page=1&limit=5", token),
        apiRequest<Hotspot[]>("/dashboard/hotspots", token),
      ]);
      setSummary(nextSummary);
      setScans(nextScans.data);
      setFlagged(nextFlagged.data);
      setHotspots(nextHotspots);
      setLastUpdated(new Date());
      // reset countdown
      countdownRef.current = REFRESH_INTERVAL;
      setCountdown(REFRESH_INTERVAL);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load dashboard");
    } finally {
      setBusy(false);
    }
  }, [token]);

  // Initial load
  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh: tick countdown every second, fire load every 30s
  useEffect(() => {
    if (!token) return;
    const ticker = setInterval(() => {
      countdownRef.current -= 1;
      setCountdown(countdownRef.current);
      if (countdownRef.current <= 0) {
        countdownRef.current = REFRESH_INTERVAL;
        setCountdown(REFRESH_INTERVAL);
        void load(true);
      }
    }, 1000);
    return () => clearInterval(ticker);
  }, [token, load]);

  return (
    <div className="content-wrap">
      <section className="page-heading">
        <div>
          <div className="eyebrow">REGULATOR / OVERVIEW <span className="eyebrow-rule" /></div>
          <h1>Supply-chain overview</h1>
          <p>Recent verification activity and cases that need attention.</p>
        </div>
        <div className="refresh-bar">
          {lastUpdated && (
            <span className="last-updated">
              <span className="live-dot" />
              Updated {new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(lastUpdated)}
            </span>
          )}
          <span className="countdown-wrap" title={`Next refresh in ${countdown}s`}>
            <CountdownRing seconds={countdown} total={REFRESH_INTERVAL} />
            <span className="countdown-secs">{countdown}s</span>
          </span>
          <button className="button button-quiet refresh-button" onClick={() => void load()} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}Refresh
          </button>
        </div>
      </section>


      {error && <div className="error-banner page-error"><CircleAlert size={17} />{error}</div>}

      <section className="metrics" aria-label="Scan summary">
        {metricDetails.map(({ key, label, icon: Icon, foot }) => (
          <article className="metric" key={key}>
            <div className="metric-top"><span>{label}</span><Icon size={17} /></div>
            <strong>{summary?.[key] ?? "—"}</strong>
            <span className="metric-foot">{foot}</span>
          </article>
        ))}
      </section>

      <div className="dashboard-grid">
        <section className="section-block dashboard-table" id="scan-log">
          <div className="section-heading events-heading">
            <div><span className="eyebrow">LIVE REGISTER</span><h2>Recent scans</h2></div>
            <span className="count-pill">{summary?.totalScans ?? 0}</span>
          </div>
          {scans.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>RESULT</th><th>ITEM</th><th>SCANNED BY</th><th>TIME</th></tr></thead>
                <tbody>{scans.map((scan) => (
                  <tr key={scan.id}>
                    <td><span className={`result-pill result-${scan.result.toLowerCase()}`}>{scan.result}</span></td>
                    <td><span className="item-type">{scan.targetType}</span><code>{scan.serialOrCode}</code></td>
                    <td>{scan.scanner.locationName || scan.scanner.name}</td>
                    <td>{formatDate(scan.createdAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="empty-state"><Activity size={20} /><span>{busy ? "Loading scans" : "No scans recorded"}</span><small>Verification activity will appear here.</small></div>}
          <div className="table-footer"><span>Latest 8 records</span><span>{busy && <LoaderCircle className="spin" size={13} />} {scans.length} shown</span></div>
        </section>

        <section className="section-block flagged-panel" id="flagged">
          <div className="section-heading events-heading">
            <div><span className="eyebrow">ATTENTION</span><h2>Flagged scans</h2></div>
            <AlertTriangle size={18} className="flagged-icon" />
          </div>
          {flagged.length ? (
            <div className="flagged-list">{flagged.map((scan) => (
              <article className="flagged-item" key={scan.id}>
                <div className="flagged-item-top"><span className="result-pill result-suspicious">SUSPICIOUS</span><time>{formatDate(scan.createdAt)}</time></div>
                <b>{scan.targetType} · {scan.serialOrCode}</b>
                <p>{scan.reason || "No reason recorded"}</p>
                <small>{scan.scanner.locationName || scan.scanner.name}</small>
              </article>
            ))}</div>
          ) : <div className="empty-state"><ShieldCheck size={20} /><span>No flagged scans</span><small>Suspicious attempts will be listed here.</small></div>}
        </section>
      </div>

      <section className="section-block hotspot-block">
        <div className="section-heading events-heading"><div><span className="eyebrow">LOCATION SIGNALS</span><h2>Suspicious-scan hotspots</h2></div><span className="count-pill">{hotspots.length}</span></div>
        {hotspots.length ? <div className="table-scroll"><table><thead><tr><th>LATITUDE</th><th>LONGITUDE</th><th>FLAGGED SCANS</th></tr></thead><tbody>{hotspots.slice(0, 8).map((spot) => <tr key={`${spot.lat}-${spot.lng}`}><td>{spot.lat.toFixed(4)}</td><td>{spot.lng.toFixed(4)}</td><td><span className="result-pill result-suspicious">{spot.count}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><MapPin size={20} /><span>No location hotspots</span><small>Flagged scans with coordinates will be grouped here.</small></div>}
      </section>

      <footer className="page-footer"><span>VERITY · REGULATOR OVERVIEW</span><span>{summary?.totalScans ?? 0} scan records</span></footer>
    </div>
  );
}