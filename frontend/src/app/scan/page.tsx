"use client";

import { Camera, CircleAlert, CircleCheck, LoaderCircle, MapPin, ScanLine, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { QrInput } from "@/components/qr-input";
import { apiRequest } from "@/lib/api";
import { addScanHistoryItem } from "@/lib/scan-history";
import { useSession } from "@/lib/session";

type Verification = {
  result: "GENUINE" | "SUSPICIOUS" | "EXPIRED" | "UNKNOWN";
  reason: string | null;
  scanCount?: number | null;
  packsReceived?: number;
  batch: { drugName: string; batchNumber: string } | null;
  expiry: string | null;
};

type Coordinates = { lat: number; lng: number };

function detectType(qrContent: string): "PACK" | "CASE" | null {
  try {
    const encoded = qrContent.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(window.atob(encoded)) as { t?: string };
    if (payload.t === "P") return "PACK";
    if (payload.t === "C") return "CASE";
  } catch {
    return null;
  }
  return null;
}

function qrIdentity(qrContent: string): string {
  try {
    const encoded = qrContent.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(window.atob(encoded)) as { s?: unknown };
    return typeof payload.s === "string" ? payload.s : "Unparsed QR value";
  } catch {
    return "Unparsed QR value";
  }
}

function getCoordinates(): Promise<Coordinates | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(null),
      { timeout: 3500, maximumAge: 60_000 },
    );
  });
}

function expiryLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export default function ScanPage() {
  const { token, user } = useSession();
  const [payload, setPayload] = useState("");
  const [manualType, setManualType] = useState<"AUTO" | "PACK" | "CASE">("AUTO");
  const [result, setResult] = useState<Verification | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [verifiedType, setVerifiedType] = useState<"PACK" | "CASE" | null>(null);
  const [verifiedCode, setVerifiedCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const detectedType = detectType(payload.trim());
  const targetType = manualType === "AUTO" ? detectedType : manualType;

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !targetType) {
      setError("QR type could not be detected. Choose pack or case and try again.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const location = await getCoordinates();
      const body = { payload: payload.trim(), ...(location ?? {}) };
      const verified = await apiRequest<Verification>(
        `/verify/${targetType === "PACK" ? "pack" : "case"}`,
        token,
        { method: "POST", body: JSON.stringify(body) },
      );
      setResult(verified);
      const createdAt = new Date().toISOString();
      const code = qrIdentity(payload.trim());
      setVerifiedAt(createdAt);
      setVerifiedType(targetType);
      setVerifiedCode(code);
      addScanHistoryItem({
        id: `${createdAt}-${code}`,
        targetType,
        code,
        result: verified.result,
        reason: verified.reason,
        createdAt,
        batchName: verified.batch
          ? `${verified.batch.drugName} · ${verified.batch.batchNumber}`
          : null,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  function scanAnother() {
    setPayload("");
    setResult(null);
    setVerifiedAt(null);
    setVerifiedType(null);
    setVerifiedCode("");
    setError("");
  }

  const resultIcon = result?.result === "GENUINE" ? CircleCheck : result?.result === "SUSPICIOUS" ? ShieldAlert : CircleAlert;
  const ResultIcon = resultIcon;

  return (
    <div className="content-wrap">
      <section className="page-heading">
        <div><div className="eyebrow">PHARMACY / VERIFY <span className="eyebrow-rule" /></div><h1>Verify a medicine</h1><p>Check a pack before dispensing, or record receipt of a full case.</p></div>
        <a className="button button-quiet" href="/scan/history">Scan history</a>
      </section>
      {error && <div className="error-banner page-error"><CircleAlert size={17} />{error}</div>}

      <section className="scan-grid">
        <form className="section-block scan-form" onSubmit={verify}>
          <div className="section-heading"><div><span className="eyebrow">SIGNED QR CONTENT</span><h2>Scan details</h2></div><Camera size={19} className="section-mark" /></div>
          <label htmlFor="qr-content">QR content</label>
          <QrInput onScan={setPayload} />
          <textarea id="qr-content" value={payload} onChange={(event) => setPayload(event.target.value)} required maxLength={2048} placeholder="Paste the signed QR value" rows={5} />
          <div className="scan-form-row">
            <div><label htmlFor="qr-type">Code type</label><select id="qr-type" value={manualType} onChange={(event) => setManualType(event.target.value as "AUTO" | "PACK" | "CASE")}><option value="AUTO">Detect automatically</option><option value="PACK">Single pack</option><option value="CASE">Case delivery</option></select></div>
            <div className="detected-type"><span>DETECTED</span><b>{targetType ?? "—"}</b></div>
          </div>
          <button className="button button-primary form-submit" type="submit" disabled={busy || !payload.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <ScanLine size={17} />}{targetType === "CASE" ? "Record case receipt" : "Verify pack"}</button>
          <div className="location-note"><MapPin size={15} /><span>Location is shared when available; otherwise your registered pharmacy location is used.</span></div>
        </form>

        <section className={`section-block result-panel ${result ? `result-panel-${result.result.toLowerCase()}` : ""}`} aria-live="polite">
          <div className="section-heading"><div><span className="eyebrow">VERIFICATION RESULT</span><h2>{result ? result.result : "Awaiting scan"}</h2></div>{result ? <ResultIcon size={21} /> : <ShieldCheck size={20} />}</div>
          {result ? <>
            <div className="result-metadata"><span>{verifiedType} · {verifiedCode}</span><time>{verifiedAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(verifiedAt)) : ""}</time></div>
            <p className="result-reason">{result.reason || "No anomalies detected for this verification."}</p>
            {result.batch && <dl className="result-details"><div><dt>Medicine</dt><dd>{result.batch.drugName}</dd></div><div><dt>Batch</dt><dd>{result.batch.batchNumber}</dd></div>{result.expiry && <div><dt>Expiry</dt><dd>{expiryLabel(result.expiry)}</dd></div>}{typeof result.scanCount === "number" && <div><dt>Pack scans</dt><dd>{result.scanCount}</dd></div>}{typeof result.packsReceived === "number" && <div><dt>Packs received</dt><dd>{result.packsReceived}</dd></div>}</dl>}
            {verifiedType === "CASE" && result.result === "GENUINE" && result.reason !== "case already received by this pharmacy" && <p className="custody-confirmation"><CircleCheck size={16} />One custody event recorded.</p>}
            {(result.result === "SUSPICIOUS" || result.result === "UNKNOWN") && <p className="review-advice">Hold the medicine for review and follow your pharmacy’s escalation process.</p>}
            <button className="button button-quiet scan-another" type="button" onClick={scanAnother}>Scan another</button>
          </> : <div className="result-empty"><ShieldCheck size={31} /><span>Verification details will appear here.</span><small>{user?.locationName || "Registered pharmacy location"}</small></div>}
        </section>
      </section>
      <footer className="page-footer"><span>VERITY · PHARMACY CHECK</span><span>Records are checked against the signed registry</span></footer>
    </div>
  );
}