"use client";

import { ArrowLeft, CircleAlert, LoaderCircle, Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { QrCodeTile } from "@/components/qr-code-tile";
import { apiRequest } from "@/lib/api";
import { useSession } from "@/lib/session";

type QrSheet = {
  batch: {
    id: string;
    drugName: string;
    batchNumber: string;
    mfgDate: string;
    expiryDate: string;
  };
  cases: Array<{
    caseCode: string;
    content: string;
    packs: Array<{ serial: string; content: string }>;
  }>;
};

type Recipient = { id: string; name: string; locationName: string | null };

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export default function BatchDetailsPage() {
  const params = useParams<{ id: string }>();
  const { token } = useSession();
  const [sheet, setSheet] = useState<QrSheet | null>(null);
  const [selectedCase, setSelectedCase] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState("");
  const [busy, setBusy] = useState(true);
  const [shipping, setShipping] = useState(false);
  const [shipmentNotice, setShipmentNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !params.id) return;
    let active = true;
    setBusy(true);
    void Promise.all([
      apiRequest<QrSheet>(`/batches/${encodeURIComponent(params.id)}/qr`, token),
      apiRequest<Recipient[]>("/shipments/recipients", token),
    ])
      .then(([result, nextRecipients]) => {
        if (!active) return;
        setSheet(result);
        setSelectedCase(result.cases[0]?.caseCode ?? "");
        setRecipients(nextRecipients);
        setSelectedRecipient(nextRecipients[0]?.id ?? "");
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Unable to load QR sheet");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [params.id, token]);

  const caseData = sheet?.cases.find((item) => item.caseCode === selectedCase);
  const packCount = sheet?.cases.reduce((total, item) => total + item.packs.length, 0) ?? 0;

  async function shipSelectedCase() {
    if (!token || !caseData || !selectedRecipient) return;
    setShipping(true);
    setError("");
    setShipmentNotice("");
    try {
      await apiRequest("/shipments", token, {
        method: "POST",
        body: JSON.stringify({
          caseCode: caseData.caseCode,
          toOrgId: selectedRecipient,
        }),
      });
      const recipient = recipients.find((item) => item.id === selectedRecipient);
      setShipmentNotice(`Shipment recorded to ${recipient?.name ?? "pharmacy"}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to record shipment");
    } finally {
      setShipping(false);
    }
  }

  return (
    <div className="content-wrap">
      <Link className="back-link" href="/manufacturer"><ArrowLeft size={16} />Back to batches</Link>
      {error && <div className="error-banner page-error"><CircleAlert size={17} />{error}</div>}
      {busy ? <div className="section-block batch-loading"><LoaderCircle className="spin" size={20} />Loading signed batch records</div> : sheet ? <>
        <section className="page-heading">
          <div><div className="eyebrow">MANUFACTURER / QR SHEET <span className="eyebrow-rule" /></div><h1>{sheet.batch.drugName}</h1><p>{sheet.batch.batchNumber} · {sheet.cases.length} cases · {packCount} signed packs</p></div>
          <button className="button button-primary print-button" onClick={() => window.print()} disabled={!caseData}><Printer size={17} />Print selected case</button>
        </section>

        <section className="metrics batch-detail-metrics">
          <article className="metric"><div className="metric-top"><span>BATCH NUMBER</span></div><strong className="batch-number-value">{sheet.batch.batchNumber}</strong><span className="metric-foot">Registered medicine lot</span></article>
          <article className="metric"><div className="metric-top"><span>MANUFACTURED</span></div><strong className="metric-date">{displayDate(sheet.batch.mfgDate)}</strong><span className="metric-foot">Production date</span></article>
          <article className="metric"><div className="metric-top"><span>EXPIRY</span></div><strong className="metric-date">{displayDate(sheet.batch.expiryDate)}</strong><span className="metric-foot">Registry expiry date</span></article>
          <article className="metric"><div className="metric-top"><span>IDENTIFIERS</span></div><strong>{sheet.cases.length + packCount}</strong><span className="metric-foot">Cases and unique packs</span></article>
        </section>

        <section className="section-block qr-sheet-block">
          <div className="qr-toolbar">
            <div><span className="eyebrow">SIGNED IDENTIFIERS</span><h2>Printable QR codes</h2></div>
            <label htmlFor="case-select">Case
              <select id="case-select" value={selectedCase} onChange={(event) => setSelectedCase(event.target.value)}>
                {sheet.cases.map((item) => <option value={item.caseCode} key={item.caseCode}>{item.caseCode}</option>)}
              </select>
            </label>
          </div>
          <div className="shipment-toolbar">
            <label htmlFor="shipment-recipient">Ship selected case to
              <select id="shipment-recipient" value={selectedRecipient} onChange={(event) => setSelectedRecipient(event.target.value)} disabled={!recipients.length}>
                {recipients.map((recipient) => <option value={recipient.id} key={recipient.id}>{recipient.name}{recipient.locationName ? ` · ${recipient.locationName}` : ""}</option>)}
              </select>
            </label>
            <button className="button button-outline" type="button" onClick={() => void shipSelectedCase()} disabled={shipping || !caseData || !selectedRecipient}>{shipping ? <LoaderCircle className="spin" size={16} /> : null}Record shipment</button>
          </div>
          {shipmentNotice && <div className="success-banner page-error">{shipmentNotice}</div>}
          {caseData ? <div className="qr-print-area">
            <header className="qr-print-heading"><span>VERITY · MEDICINE TRACEABILITY</span><b>{sheet.batch.drugName} / {sheet.batch.batchNumber}</b><small>Expiry {displayDate(sheet.batch.expiryDate)} · {caseData.caseCode}</small></header>
            <div className="qr-grid"><QrCodeTile value={caseData.content} label={`Case ${caseData.caseCode}`} />{caseData.packs.map((pack) => <QrCodeTile key={pack.serial} value={pack.content} label={`Pack ${pack.serial}`} />)}</div>
          </div> : <div className="empty-state">No case QR records available.</div>}
        </section>
        <footer className="page-footer qr-screen-footer"><span>Signed QR values are generated by the backend registry</span><span>{caseData?.packs.length ?? 0} pack identifiers in selected case</span></footer>
      </> : <div className="empty-state"><CircleAlert size={20} /><span>Batch could not be loaded</span></div>}
    </div>
  );
}