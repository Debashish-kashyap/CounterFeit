"use client";

import {
  Activity,
  ArrowDownToLine,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  FileCheck2,
  Fingerprint,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { API_BASE, apiRequest } from "@/lib/api";
import { useSession } from "@/lib/session";

type LedgerEvent = {
  id: string;
  eventType: string;
  payload: unknown;
  prevHash: string;
  hash: string;
  createdAt: string;
};

type ChainCheck = {
  valid: boolean;
  brokenAtId: string | null;
  checkedEvents: number;
};

type MerkleAnchor = {
  id: string;
  fromEventId: string;
  toEventId: string;
  merkleRoot: string;
  txHash: string | null;
  createdAt: string;
};

function shortHash(value: string) {
  return value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function eventDetail(payload: unknown) {
  if (payload === null || typeof payload !== "object") return String(payload ?? "No details");
  return Object.entries(payload).slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
}

export default function LedgerView() {
  const { token } = useSession();
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [anchors, setAnchors] = useState<MerkleAnchor[]>([]);
  const [chainCheck, setChainCheck] = useState<ChainCheck | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"refresh" | "verify" | "anchor" | null>(null);
  const [error, setError] = useState("");

  async function loadLedger(action: "refresh" | null = null) {
    if (!token) return;
    setBusy(action);
    setError("");
    try {
      const [nextEvents, nextAnchors, nextCheck] = await Promise.all([
        apiRequest<LedgerEvent[]>("/ledger/events?limit=100", token),
        apiRequest<MerkleAnchor[]>("/ledger/anchors?limit=20", token),
        apiRequest<ChainCheck>("/ledger/verify", token),
      ]);
      setEvents(nextEvents);
      setAnchors(nextAnchors);
      setChainCheck(nextCheck);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load ledger data");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadLedger();
  }, [token]);

  async function verifyChain() {
    if (!token) return;
    setBusy("verify");
    setError("");
    try {
      setChainCheck(await apiRequest<ChainCheck>("/ledger/verify", token));
      setVerifiedAt(new Date().toISOString());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Verification failed");
    } finally {
      setBusy(null);
    }
  }

  async function createAnchor() {
    if (!token) return;
    setBusy("anchor");
    setError("");
    try {
      await apiRequest<MerkleAnchor>("/ledger/anchor?limit=100", token, { method: "POST" });
      await loadLedger();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create an anchor");
    } finally {
      setBusy(null);
    }
  }

  const latestEvent = events[0];
  const latestAnchor = anchors[0];
  const chainValid = chainCheck?.valid;

  return (
    <div className="content-wrap">
      <section className="page-heading">
        <div><div className="eyebrow">REGULATOR / RECORD INTEGRITY <span className="eyebrow-rule" /></div><h1>Ledger integrity</h1><p>Review custody events, verify the hash chain, and create local Merkle anchors.</p></div>
        <button className="button button-quiet refresh-button" onClick={() => void loadLedger("refresh")} disabled={busy !== null}>{busy === "refresh" ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}Refresh</button>
      </section>
      {error && <div className="error-banner page-error"><CircleAlert size={17} />{error}</div>}

      <section className="metrics" aria-label="Ledger summary">
        <article className="metric"><div className="metric-top"><span>RECORDED EVENTS</span><Activity size={17} /></div><strong>{events.length}</strong><span className="metric-foot">Most recent 100 records</span></article>
        <article className={`metric metric-integrity ${chainValid === false ? "metric-danger" : ""}`}><div className="metric-top"><span>CHAIN STATUS</span>{chainValid === undefined ? <ShieldCheck size={17} /> : chainValid ? <CheckCheck size={17} /> : <ShieldX size={17} />}</div><strong>{chainValid === undefined ? "Not checked" : chainValid ? "Verified" : "Tampered"}</strong><span className="metric-foot">{chainCheck ? `${chainCheck.checkedEvents} events checked` : "Run verification to inspect"}</span></article>
        <article className="metric"><div className="metric-top"><span>MERKLE ANCHORS</span><FileCheck2 size={17} /></div><strong>{anchors.length}</strong><span className="metric-foot">{latestAnchor ? `Latest covers #${latestAnchor.fromEventId}–#${latestAnchor.toEventId}` : "No local anchors yet"}</span></article>
        <article className="metric"><div className="metric-top"><span>LATEST EVENT</span><Clock3 size={17} /></div><strong className="metric-date">{latestEvent ? formatDate(latestEvent.createdAt) : "No events"}</strong><span className="metric-foot">{latestEvent ? `Event #${latestEvent.id} · ${latestEvent.eventType}` : "Waiting for ledger records"}</span></article>
      </section>

      <section className={`integrity-panel ${chainValid === false ? "integrity-panel-broken" : chainValid ? "integrity-panel-valid" : ""}`}>
        <div className="integrity-icon">{chainValid === false ? <TriangleAlert size={21} /> : chainValid ? <Check size={21} /> : <ShieldCheck size={21} />}</div>
        <div className="integrity-copy"><span className="eyebrow">HASH-CHAIN VERIFICATION</span><h2>{chainValid === false ? `Tampering detected at event #${chainCheck?.brokenAtId}` : chainValid ? "All recorded events are consistent" : "Verify the event chain"}</h2><p>{verifiedAt ? `Last checked ${formatDate(verifiedAt)} · ${chainCheck?.checkedEvents} events examined` : chainCheck ? `${chainCheck.checkedEvents} events examined on latest load` : "Recompute each event hash and compare it with the stored chain."}</p></div>
        <button className="button button-dark" onClick={() => void verifyChain()} disabled={busy !== null}>{busy === "verify" ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}Verify chain</button>
      </section>

      <section className="ledger-grid">
        <div className="section-block anchors-block">
          <div className="section-heading"><div><span className="eyebrow">LOCAL CHECKPOINTS</span><h2>Merkle anchors</h2></div><button className="button button-outline" onClick={() => void createAnchor()} disabled={busy !== null || !events.length}>{busy === "anchor" ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}Create anchor</button></div>
          <p className="section-description">Roots summarize a contiguous range of ledger event hashes.</p>
          {anchors.length ? <div className="anchor-list">{anchors.map((anchor) => <article className="anchor-row" key={anchor.id}><div className="anchor-icon"><FileCheck2 size={18} /></div><div className="anchor-data"><div className="anchor-title">Events #{anchor.fromEventId}–#{anchor.toEventId}<span className="anchor-badge">LOCAL</span></div><code title={anchor.merkleRoot}>{shortHash(anchor.merkleRoot)}</code><span className="anchor-date">{formatDate(anchor.createdAt)}</span></div><button className="icon-button copy-button" onClick={() => void navigator.clipboard.writeText(anchor.merkleRoot)} title="Copy Merkle root" aria-label="Copy Merkle root"><Fingerprint size={16} /></button></article>)}</div> : <div className="empty-state"><FileCheck2 size={20} /><span>No anchors created</span><small>Create a local checkpoint from unanchored events.</small></div>}
          <div className="local-only"><span className="status-dot" />Local Merkle storage <b>TESTNET NOT CONNECTED</b></div>
        </div>
        <div className="section-block chain-note-block"><div className="section-heading"><div><span className="eyebrow">LEDGER MODEL</span><h2>What this proves</h2></div><Fingerprint size={19} className="section-mark" /></div><div className="model-list"><div><span className="model-number">01</span><p><b>Events link to their predecessors</b><br />Each SHA-256 digest includes the previous event hash.</p></div><div><span className="model-number">02</span><p><b>Verification detects edits</b><br />Changing stored event data invalidates the chain.</p></div><div><span className="model-number">03</span><p><b>Records, not medicines</b><br />The ledger protects the audit trail, not the physical pack.</p></div></div></div>
      </section>

      <section className="section-block events-block">
        <div className="section-heading events-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>Recent events <span className="count-pill">{events.length}</span></h2></div><span className="event-order">Newest first <ArrowDownToLine size={14} /></span></div>
        {events.length ? <div className="table-scroll"><table><thead><tr><th>EVENT</th><th>DETAIL</th><th>PREVIOUS HASH</th><th>EVENT HASH</th><th>RECORDED</th></tr></thead><tbody>{events.map((ledgerEvent) => <tr key={ledgerEvent.id}><td><span className="event-id">#{ledgerEvent.id}</span><span className={`event-type event-type-${ledgerEvent.eventType.toLowerCase()}`}>{ledgerEvent.eventType.replaceAll("_", " ")}</span></td><td className="detail-cell" title={JSON.stringify(ledgerEvent.payload)}>{eventDetail(ledgerEvent.payload)}</td><td><code title={ledgerEvent.prevHash}>{shortHash(ledgerEvent.prevHash)}</code></td><td><code title={ledgerEvent.hash}>{shortHash(ledgerEvent.hash)}</code></td><td className="date-cell">{formatDate(ledgerEvent.createdAt)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><Activity size={20} /><span>{busy ? "Loading events" : "No ledger events found"}</span><small>Events will appear here as batches and scans are recorded.</small></div>}
        <div className="table-footer"><span>Showing latest {events.length} of {chainCheck?.checkedEvents ?? events.length} checked records</span><span><span className="status-dot" /> Append-only event log</span></div>
      </section>
      <footer className="page-footer"><span>VERITY LEDGER · REGULATOR VIEW</span><span>API <code>{API_BASE}</code></span></footer>
    </div>
  );
}