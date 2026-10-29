"use client";

import { AlertCircle, Clock3, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { clearScanHistory, getScanHistory, type ScanHistoryItem } from "@/lib/scan-history";

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function ScanHistoryPage() {
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);

  useEffect(() => {
    setHistory(getScanHistory());
  }, []);

  function clearHistory() {
    clearScanHistory();
    setHistory([]);
  }

  return (
    <div className="content-wrap">
      <section className="page-heading">
        <div><div className="eyebrow">PHARMACY / HISTORY <span className="eyebrow-rule" /></div><h1>Scan history</h1><p>Recent verification responses saved on this device.</p></div>
        {history.length > 0 && <button className="button button-quiet" onClick={clearHistory}><Trash2 size={16} />Clear local history</button>}
      </section>
      <div className="history-note"><AlertCircle size={16} /><span>This list is stored in this browser. The backend does not currently provide pharmacy-scoped historical scans.</span></div>
      <section className="section-block history-block">
        {history.length ? <div className="table-scroll"><table><thead><tr><th>RESULT</th><th>CODE</th><th>MEDICINE / BATCH</th><th>REASON</th><th>TIME</th></tr></thead><tbody>
          {history.map((item) => <tr key={item.id}>
            <td><span className={`result-pill result-${item.result.toLowerCase()}`}>{item.result}</span></td>
            <td><span className="item-type">{item.targetType}</span><code>{item.code}</code></td>
            <td>{item.batchName ?? "Not found in registry"}</td>
            <td className="history-reason">{item.reason ?? "No anomaly reported"}</td>
            <td className="date-cell">{displayDate(item.createdAt)}</td>
          </tr>)}
        </tbody></table></div> : <div className="empty-state"><Clock3 size={21} /><span>No scans saved on this device</span><small>Completed pack and case checks will appear here.</small><Link className="button button-outline" href="/scan">Start a scan</Link></div>}
      </section>
      <footer className="page-footer"><span>VERITY · PHARMACY HISTORY</span><span>{history.length} of 100 recent records</span></footer>
    </div>
  );
}