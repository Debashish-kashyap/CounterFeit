"use client";

import { Boxes, CircleAlert, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api";
import { useSession } from "@/lib/session";

type Batch = {
  id: string;
  drugName: string;
  batchNumber: string;
  mfgDate: string;
  expiryDate: string;
  createdAt: string;
  numCases: number;
  totalPacks: number;
};

type BatchForm = {
  drugName: string;
  batchNumber: string;
  mfgDate: string;
  expiryDate: string;
  numCases: number;
  packsPerCase: number;
};

const initialForm: BatchForm = {
  drugName: "",
  batchNumber: "",
  mfgDate: "",
  expiryDate: "",
  numCases: 3,
  packsPerCase: 10,
};

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export default function ManufacturerPage() {
  const { token } = useSession();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);

  async function loadBatches() {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      setBatches(await apiRequest<Batch[]>("/batches", token));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load batches");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadBatches();
  }, [token]);

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (form.mfgDate >= form.expiryDate) {
      setError("Manufacture date must be earlier than expiry date.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await apiRequest<Batch>("/batches", token, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setCreatedBatchId(created.id);
      setNotice(`Registered ${created.batchNumber} with ${created.totalPacks} signed pack records.`);
      setForm(initialForm);
      setBatches(await apiRequest<Batch[]>("/batches", token));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to register batch");
    } finally {
      setBusy(false);
    }
  }

  const totalCases = batches.reduce((total, batch) => total + batch.numCases, 0);
  const totalPacks = batches.reduce((total, batch) => total + batch.totalPacks, 0);

  return (
    <div className="content-wrap">
      <section className="page-heading">
        <div><div className="eyebrow">MANUFACTURER / REGISTRY <span className="eyebrow-rule" /></div><h1>Batch registry</h1><p>Register a medicine batch and issue signed identifiers for every case and pack.</p></div>
        <a className="button button-primary create-batch-link" href="#create-batch"><Plus size={17} />Create batch</a>
      </section>

      {error && <div className="error-banner page-error"><CircleAlert size={17} />{error}</div>}
      {notice && <div className="success-banner page-error"><Boxes size={17} /><span>{notice} {createdBatchId && <Link href={`/manufacturer/batches/${encodeURIComponent(createdBatchId)}`}>Open QR sheet</Link>}</span></div>}

      <section className="metrics manufacturer-metrics" aria-label="Manufacturer registry totals">
        <article className="metric"><div className="metric-top"><span>REGISTERED BATCHES</span><Boxes size={17} /></div><strong>{batches.length}</strong><span className="metric-foot">Current manufacturer account</span></article>
        <article className="metric"><div className="metric-top"><span>CASES</span><Boxes size={17} /></div><strong>{totalCases}</strong><span className="metric-foot">Across registered batches</span></article>
        <article className="metric"><div className="metric-top"><span>PACK SERIALS</span><Boxes size={17} /></div><strong>{totalPacks}</strong><span className="metric-foot">Signed pack identifiers</span></article>
      </section>

      <section className="manufacturer-grid">
        <form className="section-block batch-form" id="create-batch" onSubmit={createBatch}>
          <div className="section-heading"><div><span className="eyebrow">NEW REGISTRATION</span><h2>Batch details</h2></div><Plus size={19} className="section-mark" /></div>
          <label htmlFor="drug-name">Medicine name</label>
          <input id="drug-name" value={form.drugName} onChange={(event) => setForm({ ...form, drugName: event.target.value })} maxLength={160} required placeholder="Paracetamol 500 mg" />
          <label htmlFor="batch-number">Batch number</label>
          <input id="batch-number" value={form.batchNumber} onChange={(event) => setForm({ ...form, batchNumber: event.target.value })} maxLength={80} required placeholder="XUINO-2026-001" />
          <div className="form-two-col">
            <div><label htmlFor="mfg-date">Manufactured</label><input id="mfg-date" type="date" max={form.expiryDate || undefined} value={form.mfgDate} onChange={(event) => setForm({ ...form, mfgDate: event.target.value })} required /></div>
            <div><label htmlFor="expiry-date">Expires</label><input id="expiry-date" type="date" min={form.mfgDate || undefined} value={form.expiryDate} onChange={(event) => setForm({ ...form, expiryDate: event.target.value })} required /></div>
          </div>
          <div className="form-two-col">
            <div><label htmlFor="case-count">Number of cases</label><input id="case-count" type="number" min={1} max={50} value={form.numCases} onChange={(event) => setForm({ ...form, numCases: Number(event.target.value) })} required /></div>
            <div><label htmlFor="pack-count">Packs per case</label><input id="pack-count" type="number" min={1} max={100} value={form.packsPerCase} onChange={(event) => setForm({ ...form, packsPerCase: Number(event.target.value) })} required /></div>
          </div>
          <button className="button button-primary form-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}Register batch</button>
        </form>

        <section className="section-block batch-list-block" id="batches">
          <div className="section-heading" id="qr-sheets"><div><span className="eyebrow">YOUR REGISTRY</span><h2>Registered batches <span className="count-pill">{batches.length}</span></h2></div><Boxes size={19} className="section-mark" /></div>
          {batches.length ? <div className="batch-list">{batches.map((batch) => (
            <article className="batch-item" key={batch.id}>
              <div className="batch-item-main"><span className="batch-icon"><Boxes size={18} /></span><div className="batch-item-copy"><b>{batch.drugName}</b><span>{batch.batchNumber}</span></div><Link className="button button-outline" href={`/manufacturer/batches/${encodeURIComponent(batch.id)}`}>QR sheet</Link></div>
              <div className="batch-facts"><span>{batch.numCases} cases</span><span>{batch.totalPacks} packs</span><span>Expires {displayDate(batch.expiryDate)}</span></div>
            </article>
          ))}</div> : <div className="empty-state"><Boxes size={20} /><span>{busy ? "Loading registry" : "No batches registered"}</span><small>New batches will appear here after registration.</small></div>}
        </section>
      </section>
      <footer className="page-footer"><span>VERITY · MANUFACTURER</span><span>Signed serials are created by the registry API</span></footer>
    </div>
  );
}