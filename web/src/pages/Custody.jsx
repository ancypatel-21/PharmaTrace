import { useCallback, useEffect, useState } from "react";
import { isAddress } from "ethers";
import RequireRole from "../components/RequireRole.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useWallet } from "../context/WalletContext.jsx";
import {
  CUSTODY_ROLES,
  canSendFrom,
  classifyBatches,
  custodyErrorMessage,
  eligibleRecipients,
  hasPendingTransfer,
  loadBatches,
  loadParticipantsSafely,
  nextHopRoles,
  participantName,
} from "../lib/custody.js";
import { STATUS, formatDate, shortAddress } from "../lib/format.js";
import { getReadContract } from "../lib/providers.js";
import { ROLE_LABELS } from "../lib/roles.js";

// Custody actions (N5): batches I hold, send to the next hop, incoming transfers to accept,
// cancel a transfer I sent, and Mark Stored / Mark Dispensed (Shreyanshi's StatusModule).
// The contract enforces every rule; the page only hides actions that would revert. The
// Manufacturer is included because it makes the first handoff of every batch.
export default function Custody() {
  return (
    <section>
      <h1>Custody</h1>
      <RequireRole roles={CUSTODY_ROLES}>
        <CustodyActions />
      </RequireRole>
    </section>
  );
}

const FROZEN_TEXT = {
  [STATUS.Quarantined]: "quarantined (waiting for the Regulator)",
  [STATUS.Recalled]: "recalled",
  [STATUS.Dispensed]: "dispensed",
};

function CustodyActions() {
  const { config, account, roles, getWriteContract } = useWallet();
  const [batches, setBatches] = useState(null);
  const [directory, setDirectory] = useState(new Map());
  const [namesError, setNamesError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (config.mock) return undefined;
    let cancelled = false;
    const contract = getReadContract();
    Promise.all([loadBatches(contract), loadParticipantsSafely(contract)])
      .then(([loadedBatches, participants]) => {
        if (cancelled) return;
        setBatches(loadedBatches);
        setDirectory(participants.directory);
        setNamesError(participants.error);
        setLoadError(null);
      })
      .catch((err) => !cancelled && setLoadError(custodyErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [config.mock, account, refreshKey]);

  // Sends one transaction, waits for it to be mined, then reloads the batches.
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
      } catch (err) {
        setResult({ ok: false, text: `${label}: ${custodyErrorMessage(err)}` });
      } finally {
        setBusy(null);
      }
    },
    [getWriteContract],
  );

  if (config.mock) {
    return (
      <div className="notice">
        <p>No contract is deployed yet, so there are no batches to show.</p>
        <p className="muted">
          Once <code>scripts/export-abi.js</code> (A7) exports a deployment, this page lists the batches
          you hold, sends them to the next participant and accepts incoming transfers.
        </p>
      </div>
    );
  }

  if (loadError) return <div className="notice notice-error">Could not load batches: {loadError}</div>;
  if (!batches) return <p className="muted">Loading batches…</p>;

  const { incoming, held } = classifyBatches(batches, account);
  const nameOf = (address) => participantName(directory, address) ?? shortAddress(address);
  const recipients = eligibleRecipients(directory, roles, account);

  return (
    <>
      {result && (
        <div
          className={result.ok ? "notice" : "notice notice-error"}
          role="status"
          style={{ marginBottom: 16 }}
        >
          {result.text}
        </div>
      )}
      {namesError && (
        <p className="muted" style={{ marginTop: 0 }}>
          Participant names couldn't be loaded ({namesError}), so addresses are shown instead. To send
          a batch, choose "Other address" and paste the recipient's address.
        </p>
      )}

      <section className="card">
        <h2>Incoming transfers</h2>
        {incoming.length === 0 ? (
          <p className="muted">Nothing waiting for you to accept.</p>
        ) : (
          incoming.map((b) => {
            const inTransit = Number(b.status) === STATUS.InTransit;
            return (
              <BatchRow key={b.id} batch={b} nameOf={nameOf}>
                <p>
                  Sent by <strong>{nameOf(b.currentCustodian)}</strong>. Accepting signs for the batch
                  and makes you its custodian.
                </p>
                {inTransit ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== null}
                    onClick={() =>
                      send(`accept-${b.id}`, `Accept batch #${b.id}`, (c) => c.acceptTransfer(b.id))
                    }
                  >
                    {busy === `accept-${b.id}` ? "Accepting…" : "Accept"}
                  </button>
                ) : (
                  <p className="muted">
                    Can't be accepted while the batch is {FROZEN_TEXT[Number(b.status)] ?? "in this status"}.
                  </p>
                )}
              </BatchRow>
            );
          })
        )}
      </section>

      <section className="card">
        <h2>Batches you hold</h2>
        {held.length === 0 ? (
          <p className="muted">You are not the custodian of any batch.</p>
        ) : (
          held.map((b) => (
            <BatchRow key={b.id} batch={b} nameOf={nameOf}>
              <HeldActions batch={b} roles={roles} recipients={recipients} nameOf={nameOf} busy={busy} send={send} />
            </BatchRow>
          ))
        )}
      </section>
    </>
  );
}

function BatchRow({ batch, nameOf, children }) {
  return (
    <article className="card" style={{ marginBottom: 12 }} data-testid={`batch-${batch.id}`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <strong>
          #{String(batch.id)} {batch.productName}
        </strong>
        <StatusBadge status={batch.status} />
      </div>
      <p className="muted" style={{ margin: "4px 0 8px" }}>
        Lot {batch.lotNumber} · expires {formatDate(batch.expiryDate)} · made by {nameOf(batch.manufacturer)}
      </p>
      {children}
    </article>
  );
}

function HeldActions({ batch, roles, recipients, nameOf, busy, send }) {
  const [to, setTo] = useState("");
  const [manual, setManual] = useState("");
  const id = batch.id;
  const status = Number(batch.status);
  const disabled = busy !== null;

  if (hasPendingTransfer(batch)) {
    return (
      <>
        <p>
          Waiting for <strong>{nameOf(batch.pendingCustodian)}</strong> to accept.
        </p>
        <button
          type="button"
          className="btn btn-warn"
          disabled={disabled || status !== STATUS.InTransit}
          onClick={() => send(`cancel-${id}`, `Cancel transfer of batch #${id}`, (c) => c.cancelTransfer(id))}
        >
          {busy === `cancel-${id}` ? "Cancelling…" : "Cancel transfer"}
        </button>
        {status !== STATUS.InTransit && (
          <p className="muted">Can't be cancelled while the batch is {FROZEN_TEXT[status]}.</p>
        )}
      </>
    );
  }

  if (FROZEN_TEXT[status]) {
    return <p className="muted">No custody actions: the batch is {FROZEN_TEXT[status]}.</p>;
  }

  const canSend = canSendFrom(status) && nextHopRoles(roles).length > 0;
  const isPharmacy = roles.includes("PHARMACY");
  const target = to === "other" ? manual.trim() : to;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {canSend && (
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            send(`send-${id}`, `Send batch #${id}`, (c) => c.initiateTransfer(id, target));
          }}
        >
          <label htmlFor={`to-${id}`}>Send to</label>
          <select
            id={`to-${id}`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ font: "inherit", padding: "8px 10px", borderRadius: 6, maxWidth: "100%" }}
          >
            <option value="">Choose the next participant…</option>
            {recipients.map((p) => (
              <option key={p.address} value={p.address}>
                {p.name || shortAddress(p.address)} ({p.roles.map((r) => ROLE_LABELS[r]).join(", ")})
              </option>
            ))}
            <option value="other">Other address…</option>
          </select>
          {to === "other" && (
            <input
              aria-label="Recipient address"
              placeholder="0x…"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              style={{ width: "26rem", maxWidth: "100%" }}
            />
          )}
          <button type="submit" className="btn" disabled={disabled || !isAddress(target)}>
            {busy === `send-${id}` ? "Sending…" : "Send"}
          </button>
        </form>
      )}

      {(status === STATUS.Received || (isPharmacy && status === STATUS.Stored)) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {status === STATUS.Received && (
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => send(`store-${id}`, `Mark batch #${id} stored`, (c) => c.markStored(id))}
            >
              {busy === `store-${id}` ? "Saving…" : "Mark stored"}
            </button>
          )}
          {isPharmacy && status === STATUS.Stored && (
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() =>
                send(`dispense-${id}`, `Mark batch #${id} dispensed`, (c) => c.markDispensed(id))
              }
            >
              {busy === `dispense-${id}` ? "Saving…" : "Mark dispensed"}
            </button>
          )}
        </div>
      )}

      {!canSend && isPharmacy && (
        <p className="muted">A pharmacy is the final holder: mark the batch stored, then dispensed.</p>
      )}
    </div>
  );
}
