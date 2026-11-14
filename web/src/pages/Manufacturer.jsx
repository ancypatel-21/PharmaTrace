import { useCallback, useEffect, useState } from "react";
import { ZeroHash, id as keccakId } from "ethers";
import RequireRole from "../components/RequireRole.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useWallet } from "../context/WalletContext.jsx";
import { custodyErrorMessage, loadBatches } from "../lib/custody.js";
import { formatDate, shortAddress } from "../lib/format.js";
import { getReadContract } from "../lib/providers.js";

const lower = (address) => String(address).toLowerCase();

// Manufacturer batch registration: register a new batch and show its batch ID (and QR link,
// once the QR page lands) plus the list of batches this manufacturer has registered so far.
// The contract enforces every rule (manufacturer only, no empty fields, no past expiry, no
// duplicate lot number); this page only shows a readable error when one of those checks fails.
export default function Manufacturer() {
  return (
    <section>
      <h1>Manufacturer</h1>
      <RequireRole roles={["MANUFACTURER"]}>
        <ManufacturerActions />
      </RequireRole>
    </section>
  );
}

function ManufacturerActions() {
  const { config, account, getWriteContract } = useWallet();
  const [batches, setBatches] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (config.mock) return undefined;
    let cancelled = false;
    loadBatches(getReadContract())
      .then((loaded) => {
        if (!cancelled) {
          setBatches(loaded);
          setLoadError(null);
        }
      })
      .catch((err) => !cancelled && setLoadError(custodyErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [config.mock, refreshKey]);

  const register = useCallback(
    async ({ productName, lotNumber, expiryDate, certificateNote }) => {
      setBusy(true);
      setResult(null);
      try {
        const contract = await getWriteContract();
        const certificateHash = certificateNote.trim() ? keccakId(certificateNote.trim()) : ZeroHash;
        const tx = await contract.registerBatch(productName, lotNumber, expiryDate, certificateHash);
        const receipt = await tx.wait();

        let newId = null;
        for (const log of receipt.logs) {
          try {
            const parsed = contract.interface.parseLog(log);
            if (parsed?.name === "BatchRegistered") {
              newId = parsed.args.batchId;
              break;
            }
          } catch {
            // Not one of our events; ignore.
          }
        }

        setResult({
          ok: true,
          text: newId !== null ? `Registered batch #${newId}.` : "Batch registered.",
        });
        setRefreshKey((k) => k + 1);
      } catch (err) {
        setResult({ ok: false, text: custodyErrorMessage(err) });
      } finally {
        setBusy(false);
      }
    },
    [getWriteContract]
  );

  if (config.mock) {
    return (
      <div className="notice">
        <p>No contract is deployed yet, so there are no batches to show.</p>
        <p className="muted">
          Once <code>scripts/export-abi.js</code> exports a deployment, this page registers a
          new batch and lists the ones you have already registered.
        </p>
      </div>
    );
  }

  if (loadError) return <div className="notice notice-error">Could not load batches: {loadError}</div>;

  const mine = batches?.filter((b) => lower(b.manufacturer) === lower(account)) ?? null;

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

      <section className="card">
        <h2>Register a batch</h2>
        <RegisterBatchForm busy={busy} onSubmit={register} />
      </section>

      <section className="card">
        <h2>Your batches</h2>
        {mine === null ? (
          <p className="muted">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="muted">You have not registered a batch yet.</p>
        ) : (
          mine.map((batch) => (
            <article key={String(batch.id)} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <strong>
                  #{String(batch.id)} {batch.productName}
                </strong>
                <StatusBadge status={batch.status} />
              </div>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Lot {batch.lotNumber} · expires {formatDate(batch.expiryDate)} · held by{" "}
                {shortAddress(batch.currentCustodian)}
                {batch.approved ? " · approved" : ""}
              </p>
            </article>
          ))
        )}
      </section>
    </>
  );
}

function RegisterBatchForm({ busy, onSubmit }) {
  const [productName, setProductName] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [certificateNote, setCertificateNote] = useState("");

  const expiryDate = expiry ? Math.floor(new Date(`${expiry}T00:00:00Z`).getTime() / 1000) : null;
  const canSubmit =
    productName.trim().length > 0 &&
    lotNumber.trim().length > 0 &&
    expiryDate !== null &&
    expiryDate > Math.floor(Date.now() / 1000);

  return (
    <form
      className="lookup"
      style={{ flexDirection: "column", alignItems: "flex-start" }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          productName: productName.trim(),
          lotNumber: lotNumber.trim(),
          expiryDate,
          certificateNote,
        });
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <label htmlFor="mfr-product">Product name</label>
        <input
          id="mfr-product"
          placeholder="e.g. Insulin 10ml"
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          style={{ width: "16rem", maxWidth: "100%" }}
        />
        <label htmlFor="mfr-lot">Lot number</label>
        <input
          id="mfr-lot"
          placeholder="e.g. LOT-001"
          value={lotNumber}
          onChange={(e) => setLotNumber(e.target.value)}
          style={{ width: "10rem", maxWidth: "100%" }}
        />
        <label htmlFor="mfr-expiry">Expiry date</label>
        <input
          id="mfr-expiry"
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}>
        <label htmlFor="mfr-cert">Certificate note (optional)</label>
        <input
          id="mfr-cert"
          placeholder="Hashed and anchored on-chain; a Regulator can replace it on approval"
          value={certificateNote}
          onChange={(e) => setCertificateNote(e.target.value)}
          style={{ width: "26rem", maxWidth: "100%" }}
        />
      </div>
      <button type="submit" className="btn" disabled={busy || !canSubmit} style={{ marginTop: 8 }}>
        {busy ? "Registering…" : "Register batch"}
      </button>
    </form>
  );
}
