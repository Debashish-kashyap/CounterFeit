"use client";

import { Camera, CircleAlert, CircleCheck, LoaderCircle, MapPin, ScanLine, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { QrInput } from "@/components/qr-input";
import { apiRequest } from "@/lib/api";
import { addScanHistoryItem, getVerificationDeviceId } from "@/lib/scan-history";
import { useSession } from "@/lib/session";

type Verification = {
  result: "GENUINE" | "SUSPICIOUS" | "EXPIRED" | "UNKNOWN";
  reasons: string[];
  reason: string | null;
  message?: string | null;
  sold?: boolean;
  soldAt?: string | null;
  soldBy?: { id: string; name: string };
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
  const [saleBusy, setSaleBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportNotice, setReportNotice] = useState("");
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
      const body = {
        deviceId: getVerificationDeviceId(),
        payload: payload.trim(),
        ...(location ?? {}),
      };
      const eventBody = {
        deviceId: body.deviceId,
        ...(location ?? {}),
      };
      const verified = await apiRequest<Verification>(
        targetType === "PACK"
          ? "/verify/check"
          : `/cases/${encodeURIComponent(qrIdentity(payload.trim()))}/receive`,
        targetType === "CASE" ? token ?? undefined : undefined,
        {
          method: "POST",
          body: JSON.stringify(targetType === "CASE" ? eventBody : body),
        },
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
        reason: verified.reasons?.join("; ") || verified.reason,
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

  async function completeSale() {
    if (!token || !verifiedCode) return;
    setSaleBusy(true);
    setError("");
    try {
      const location = await getCoordinates();
      const sold = await apiRequest<Verification>(
        `/packs/${encodeURIComponent(verifiedCode)}/sell`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            deviceId: getVerificationDeviceId(),
            ...(location ?? {}),
          }),
        },
      );
      setResult(sold);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to record sale");
    } finally {
      setSaleBusy(false);
    }
  }

  async function reportPurchase() {
    if (!payload.trim()) return;
    setReportBusy(true);
    setError("");
    setReportNotice("");
    try {
      await apiRequest("/reports", undefined, {
        method: "POST",
        body: JSON.stringify({
          payload: payload.trim(),
          message: "I bought this elsewhere",
        }),
      });
      setReportNotice("Your report was recorded.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to submit report");
    } finally {
      setReportBusy(false);
    }
  }

  function scanAnother() {
    setPayload("");
    setResult(null);
    setVerifiedAt(null);
    setVerifiedType(null);
    setVerifiedCode("");
    setError("");
    setReportNotice("");
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
          <button className="button button-primary form-submit" type="submit" disabled={busy || !payload.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <ScanLine size={17} />}{targetType === "CASE" ? "Record case receipt" : "Check pack"}</button>
          <div className="location-note"><MapPin size={15} /><span>Checks are read-only; record a sale separately at billing. Location is shared when available.</span></div>
        </form>

        <section className={`section-block result-panel ${result ? `result-panel-${result.result.toLowerCase()}` : ""}`} aria-live="polite">
          <div className="section-heading"><div><span className="eyebrow">VERIFICATION RESULT</span><h2>{result ? result.result : "Awaiting scan"}</h2></div>{result ? <ResultIcon size={21} /> : <ShieldCheck size={20} />}</div>
          {result ? <>
            <div className="result-metadata"><span>{verifiedType} · {verifiedCode}</span><time>{verifiedAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(verifiedAt)) : ""}</time></div>
            <p className="result-reason">{result.message || result.reasons?.join("; ") || result.reason || "No conflicts detected."}</p>
            {result.batch && <dl className="result-details"><div><dt>Medicine</dt><dd>{result.batch.drugName}</dd></div><div><dt>Batch</dt><dd>{result.batch.batchNumber}</dd></div>{result.expiry && <div><dt>Expiry</dt><dd>{expiryLabel(result.expiry)}</dd></div>}{typeof result.packsReceived === "number" && <div><dt>Packs received</dt><dd>{result.packsReceived}</dd></div>}</dl>}
            {verifiedType === "PACK" && result.result === "GENUINE" && !result.sold && <button className="button button-primary scan-another" type="button" onClick={() => void completeSale()} disabled={saleBusy}>{saleBusy ? <LoaderCircle className="spin" size={17} /> : <CircleCheck size={17} />}Complete sale</button>}
            {verifiedType === "PACK" && <button className="button button-quiet scan-another" type="button" onClick={() => void reportPurchase()} disabled={reportBusy}>{reportBusy ? <LoaderCircle className="spin" size={17} /> : <CircleAlert size={17} />}I bought this elsewhere</button>}
            {reportNotice && <p className="custody-confirmation">{reportNotice}</p>}
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