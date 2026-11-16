import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import RequireRole from "../components/RequireRole.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useWallet } from "../context/WalletContext.jsx";
import { loadBatches, loadParticipantsSafely, participantName } from "../lib/custody.js";
import { STATUS, formatDate, formatTenthsC, shortAddress } from "../lib/format.js";
import { getReadContract } from "../lib/providers.js";
import {
  FILTERS,
  batchFacts,
  buildRegulatorIndex,
  cleanReason,
  dashboardCounts,
  filterBatches,
  hashCertificateBytes,
  loadRegulatorEvents,
  needsApproval,
  parseCertificateHash,
  regulatorActions,
  regulatorErrorMessage,
  sortForReview,
} from "../lib/regulator.js";

// Regulator dashboard (S6): every batch with a status filter, quarantined and excursion batches
// highlighted, and the four regulator actions from StatusModule (S3, S4): approve (with the
// certificate hash), quarantine, release and recall (each with a reason). The contract enforces
// every rule; the page only offers actions that would not revert.
export default function Regulator() {
  return (
    <section>
      <h1>Regulator dashboard</h1>
      <RequireRole roles={["REGULATOR"]}>
        <Dashboard />
      </RequireRole>
    </section>
  );
}

function Dashboard() {
  const { config, account, getWriteContract } = useWallet();
  const [batches, setBatches] = useState(null);
  const [index, setIndex] = useState(new Map());
  const [eventsError, setEventsError] = useState(null);
  const [directory, setDirectory] = useState(new Map());
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState("attention");
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (config.mock) return undefined;
    let cancelled = false;
    const contract = getReadContract();
    Promise.all([
      loadBatches(contract),
      loadParticipantsSafely(contract),
      loadRegulatorEvents(contract, config.deployBlock).then(
        (logs) => ({ logs, error: null }),
        (err) => ({ logs: [], error: regulatorErrorMessage(err) }),
      ),
    ])
      .then(([loaded, participants, events]) => {
        if (cancelled) return;
        setBatches(loaded);
        setDirectory(participants.directory);
        setIndex(buildRegulatorIndex(events.logs));
        setEventsError(events.error);
        setLoadError(null);
      })
      .catch((err) => !cancelled && setLoadError(regulatorErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [config.mock, config.deployBlock, account, refreshKey]);

  // Sends one transaction, waits for it to be mined, then reloads everything.
  const send = useCallback(
    async (key, label, call) => {
      setBusy(key);
      setResult(null);
      try {
        const contract = await getWriteContract();
        const tx = await call(contract);
        await tx.wait();
        setResult({ ok: true, text: `${label}: done.` });
        setRefreshKey((k) => k + 1);
        return true;
      } catch (err) {
        setResult({ ok: false, text: `${label}: ${regulatorErrorMessage(err)}` });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [getWriteContract],
  );

  if (config.mock) {
    return (
      <div className="notice">
        <p>No contract is deployed yet, so there are no batches to review.</p>
        <p className="muted">
          Once <code>scripts/export-abi.js</code> (A7) exports a deployment, this page lists every batch
          and lets you approve, quarantine, release and recall them.
        </p>
      </div>
    );
  }

  if (loadError) return <div className="notice notice-error">Could not load batches: {loadError}</div>;
  if (!batches) return <p className="muted">Loading batches…</p>;

  const nameOf = (address) => participantName(directory, address) ?? shortAddress(address);
  const counts = dashboardCounts(batches, index);
  const shown = sortForReview(filterBatches(batches, filter, index), index);

  return (
    <>
      <dl className="stats" aria-label="Batch summary">
        <Stat label="Batches" value={counts.total} />
        <Stat label="Waiting for approval" value={counts.approval} tone={counts.approval ? "warn" : ""} />
        <Stat label="Quarantined" value={counts.quarantined} tone={counts.quarantined ? "warn" : ""} />
        <Stat label="Had an excursion" value={counts.excursion} tone={counts.excursion ? "danger" : ""} />
        <Stat label="Recalled" value={counts.recalled} />
      </dl>

      {result && (
        <div className={result.ok ? "notice" : "notice notice-error"} role="status" style={{ marginBottom: 16 }}>
          {result.text}
        </div>
      )}
      {eventsError && (
        <p className="muted">
          Event history couldn't be loaded ({eventsError}), so excursions and reasons aren't shown.
          Statuses and actions still work.
        </p>
      )}

      <div className="lookup" style={{ marginBottom: 16 }}>
        <label htmlFor="regulator-filter">Show</label>
        <select
          id="regulator-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ font: "inherit", padding: "8px 10px", borderRadius: 6 }}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="muted">
          {shown.length} of {batches.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="muted">
          {filter === "attention" ? "Nothing needs your attention right now." : "No batches match this filter."}
        </p>
      ) : (
        shown.map((b) => (
          <RegulatorBatch
            key={String(b.id)}
            batch={b}
            facts={batchFacts(index, b.id)}
            nameOf={nameOf}
            busy={busy}
            send={send}
          />
        ))
      )}
    </>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RegulatorBatch({ batch, facts, nameOf, busy, send }) {
  const id = batch.id;
  const status = Number(batch.status);
  const actions = regulatorActions(batch);
  const highlight =
    status === STATUS.Quarantined || (facts.excursions > 0 && status !== STATUS.Recalled && status !== STATUS.Dispensed)
      ? "card-alert"
      : needsApproval(batch)
        ? "card-pending"
        : "";

  return (
    <article className={`card ${highlight}`} data-testid={`regulator-batch-${id}`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <strong>
          #{String(id)} {batch.productName}
        </strong>
        <StatusBadge status={batch.status} />
        {batch.approved ? (
          <span className="badge status-stored">Approved</span>
        ) : (
          <span className="badge status-quarantined">Not approved</span>
        )}
        <Link to={`/verify/${id}`} className="small">
          Public verify page
        </Link>
      </div>
      <p className="muted" style={{ margin: "4px 0 8px" }}>
        Lot {batch.lotNumber} · expires {formatDate(batch.expiryDate)} · made by {nameOf(batch.manufacturer)} ·
        held by {nameOf(batch.currentCustodian)}
      </p>

      {facts.excursions > 0 && (
        <p className="regulator-flag">
          Temperature excursion{facts.excursions > 1 ? `s: ${facts.excursions}` : ""}
          {facts.lastExcursion &&
            ` (latest window ${formatTenthsC(facts.lastExcursion.min)} to ${formatTenthsC(facts.lastExcursion.max)}, safe range 2.0–8.0 °C)`}
        </p>
      )}
      {status === STATUS.Quarantined && facts.quarantineReason && (
        <p>
          <strong>Quarantine reason:</strong> {facts.quarantineReason}
        </p>
      )}
      {status === STATUS.Recalled && facts.recallReason && (
        <p>
          <strong>Recall reason:</strong> {facts.recallReason}
        </p>
      )}

      {actions.approve || actions.quarantine || actions.release || actions.recall ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {actions.approve && <ApproveForm batchId={id} busy={busy} send={send} />}
          {(actions.quarantine || actions.recall || actions.release) && (
            <ReasonActions batchId={id} actions={actions} busy={busy} send={send} />
          )}
        </div>
      ) : (
        <p className="muted">No regulator actions: the batch is {status === STATUS.Recalled ? "recalled" : "dispensed"}.</p>
      )}
    </article>
  );
}

function ApproveForm({ batchId, busy, send }) {
  const [hashInput, setHashInput] = useState("");
  const [fileNote, setFileNote] = useState(null);
  const hash = parseCertificateHash(hashInput);
  const inputId = `cert-${batchId}`;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    setHashInput(hashCertificateBytes(bytes));
    setFileNote(`Hashed ${file.name} in your browser; the file itself is not uploaded.`);
  };

  return (
    <form
      className="lookup"
      onSubmit={(e) => {
        e.preventDefault();
        if (hash) send(`approve-${batchId}`, `Approve batch #${batchId}`, (c) => c.approveBatch(batchId, hash));
      }}
    >
      <label htmlFor={inputId}>Certificate hash</label>
      <input
        id={inputId}
        placeholder="0x… (32-byte hash)"
        value={hashInput}
        onChange={(e) => {
          setHashInput(e.target.value);
          setFileNote(null);
        }}
        style={{ width: "34rem", maxWidth: "100%" }}
      />
      <label className="small">
        or hash a file <input type="file" aria-label="Certificate file" onChange={onFile} />
      </label>
      <button type="submit" className="btn" disabled={busy !== null || !hash}>
        {busy === `approve-${batchId}` ? "Approving…" : "Approve batch"}
      </button>
      {fileNote && <span className="muted small">{fileNote}</span>}
      {hashInput && !hash && <span className="muted small">Enter 0x followed by 64 hex characters.</span>}
    </form>
  );
}

function ReasonActions({ batchId, actions, busy, send }) {
  const [reasonInput, setReasonInput] = useState("");
  const reason = cleanReason(reasonInput);
  const disabled = busy !== null;
  const inputId = `reason-${batchId}`;

  const run = async (key, label, call) => {
    const ok = await send(`${key}-${batchId}`, `${label} batch #${batchId}`, call);
    if (ok) setReasonInput("");
  };

  return (
    <div className="lookup">
      {(actions.quarantine || actions.recall) && (
        <>
          <label htmlFor={inputId}>Reason</label>
          <input
            id={inputId}
            placeholder="Shown on the public verify page"
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            style={{ width: "24rem", maxWidth: "100%" }}
          />
        </>
      )}
      {actions.quarantine && (
        <button
          type="button"
          className="btn btn-warn"
          disabled={disabled || !reason}
          onClick={() => run("quarantine", "Quarantine", (c) => c.quarantineBatch(batchId, reason))}
        >
          {busy === `quarantine-${batchId}` ? "Quarantining…" : "Quarantine"}
        </button>
      )}
      {actions.release && (
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => run("release", "Release", (c) => c.releaseQuarantine(batchId))}
        >
          {busy === `release-${batchId}` ? "Releasing…" : "Release quarantine"}
        </button>
      )}
      {actions.recall && (
        <button
          type="button"
          className="btn btn-danger"
          disabled={disabled || !reason}
          onClick={() => {
            if (window.confirm(`Recall batch #${batchId}? A recall is permanent and cannot be undone.`)) {
              run("recall", "Recall", (c) => c.recallBatch(batchId, reason));
            }
          }}
        >
          {busy === `recall-${batchId}` ? "Recalling…" : "Recall"}
        </button>
      )}
    </div>
  );
}
