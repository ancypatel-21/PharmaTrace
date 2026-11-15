import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import BatchLookup from "../components/BatchLookup.jsx";
import CustodyTimeline from "../components/CustodyTimeline.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { getContractConfig } from "../lib/config.js";
import { loadParticipantsSafely, participantName } from "../lib/custody.js";
import {
  formatDate,
  formatTenthsC,
  formatTimestamp,
  shortAddress,
  statusLabel,
} from "../lib/format.js";
import { getReadContract } from "../lib/providers.js";
import { loadVerification, parseBatchId, temperatureState, verificationWarnings } from "../lib/verify.js";

const ZERO = "0x0000000000000000000000000000000000000000";

// Public verify page (V3): no wallet needed. A consumer opens /verify/:id from the batch QR
// code (V4) or types the ID. Reads getBatchSummary plus this batch's events through the
// read-only provider; the custody timeline is N6's <CustodyTimeline>. See docs/ui-data.md.
export default function Verify() {
  const { id } = useParams();
  const batchId = parseBatchId(id);
  const [state, setState] = useState({ forId: null });
  const [directory, setDirectory] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const key = `${id}:${refreshKey}`;

  useEffect(() => {
    if (!id || batchId === null) return undefined;
    const contract = getReadContract();
    if (!contract) {
      setState({ forId: key, error: "No contract is deployed for this network yet." });
      return undefined;
    }

    let cancelled = false;
    const { deployBlock } = getContractConfig();
    loadVerification(contract, batchId, { fromBlock: deployBlock })
      .then((data) => !cancelled && setState({ forId: key, ...data }))
      .catch(
        (err) =>
          !cancelled &&
          setState({ forId: key, error: err?.shortMessage ?? err?.message ?? "Could not reach the network." }),
      );
    loadParticipantsSafely(contract).then(({ directory: d }) => !cancelled && setDirectory(d));
    return () => {
      cancelled = true;
    };
    // batchId is derived from id, and key covers both id and refresh.
  }, [key]);

  return (
    <section className="verify">
      <h1>Verify a batch</h1>
      <BatchLookup key={id} initial={id ?? ""} />

      {id && batchId === null && (
        <div className="card notice-error" role="alert">
          “{id}” is not a valid batch ID. Batch IDs are whole numbers starting at 1.
        </div>
      )}

      {batchId !== null && state.forId !== key && <p className="muted">Checking batch #{id}…</p>}

      {state.forId === key && state.error && (
        <div className="card notice-error" role="alert">
          <p>Could not check this batch: {state.error}</p>
          <button type="button" className="btn" onClick={() => setRefreshKey((k) => k + 1)}>
            Try again
          </button>
        </div>
      )}

      {state.forId === key && state.exists === false && (
        <div className="card" data-testid="not-found">
          <h2>Not found</h2>
          <p>
            No batch with ID <strong>#{id}</strong> is registered on PharmaTrace. Check the number on
            the pack. If it is right, this product may not be genuine: ask your pharmacist.
          </p>
        </div>
      )}

      {state.forId === key && state.exists && (
        <BatchDetails
          id={id}
          data={state}
          directory={directory}
          refreshKey={refreshKey}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </section>
  );
}

function BatchDetails({ id, data, directory, refreshKey, onRefresh }) {
  const { batch, temperature, reportCount, approvedBy, activity, eventsError } = data;
  const config = getContractConfig();
  const warnings = verificationWarnings({ batch, activity });
  const temp = temperatureState(temperature);
  const approval = [...activity].reverse().find((e) => e.kind === "approved");
  const excursions = activity.filter((e) => e.kind === "excursion");
  const reports = activity.filter((e) => e.kind === "temperature").slice(-5).reverse();

  const name = (address) => {
    const display = participantName(directory, address);
    return (
      <span title={address}>
        {display ?? <code>{shortAddress(address)}</code>}
      </span>
    );
  };

  return (
    <>
      {warnings
        .filter((w) => w.level === "danger")
        .map((w) => (
          <div key={w.title} className="verify-alert" role="alert" data-testid="danger-banner">
            <strong>{w.title}</strong>
            {w.detail && <div>Reason: {w.detail}</div>}
          </div>
        ))}

      <div className="card">
        <div className="verify-head">
          <div>
            <h2 data-testid="product-name">{batch.productName}</h2>
            <p className="muted">
              Batch #{id} · Lot {batch.lotNumber}
            </p>
          </div>
          <StatusBadge status={batch.status} />
        </div>
        {warnings
          .filter((w) => w.level === "warn")
          .map((w) => (
            <p key={w.title} className="verify-warn">
              ⚠ {w.title}
              {w.detail ? `. ${w.detail}` : ""}
            </p>
          ))}
        <dl className="facts">
          <dt>Manufacturer</dt>
          <dd>{name(batch.manufacturer)}</dd>
          <dt>Registered</dt>
          <dd>{formatTimestamp(batch.createdAt)}</dd>
          <dt>Expiry date</dt>
          <dd>{formatDate(batch.expiryDate)}</dd>
          <dt>Current holder</dt>
          <dd>{name(batch.currentCustodian)}</dd>
          {batch.pendingCustodian !== ZERO && (
            <>
              <dt>On its way to</dt>
              <dd>{name(batch.pendingCustodian)}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="card">
        <h2>Regulator approval</h2>
        {batch.approved ? (
          <>
            <p>
              <span className="badge status-stored" data-testid="approval-badge">
                ✓ Approved
              </span>{" "}
              by {name(approvedBy)}
              {approval?.timestamp ? ` on ${formatDate(approval.timestamp)}` : ""}
            </p>
            <p className="muted small">
              Certificate hash: <code>{batch.certificateHash}</code>
            </p>
          </>
        ) : (
          <p>
            <span className="badge role-none" data-testid="approval-badge">
              Not approved
            </span>{" "}
            No regulator has approved this batch yet.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Temperature (safe range 2.0–8.0 °C)</h2>
        {!temp.reported ? (
          <p className="muted">No temperature reports yet.</p>
        ) : (
          <>
            <p>
              <span className={`badge ${temp.inRange ? "status-stored" : "status-recalled"}`}>
                {temp.inRange ? "In range" : "Out of range"}
              </span>{" "}
              Latest window: {formatTenthsC(temperature.minTenthsC)} to {formatTenthsC(temperature.maxTenthsC)},{" "}
              {Number(temperature.readingCount)} readings
            </p>
            <p className="muted small">
              {formatTimestamp(temperature.windowStart)} – {formatTimestamp(temperature.windowEnd)} ·{" "}
              {reportCount} report{reportCount === 1 ? "" : "s"} in total
            </p>
          </>
        )}
        {excursions.length > 0 && (
          <div className="verify-excursions">
            <strong>
              {excursions.length} excursion{excursions.length === 1 ? "" : "s"} outside 2–8 °C
            </strong>
            <ul>
              {excursions.map((e, i) => (
                <li key={i}>
                  {formatTenthsC(e.min)} to {formatTenthsC(e.max)}
                  {e.timestamp ? ` · ${formatTimestamp(e.timestamp)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {reports.length > 1 && (
          <details>
            <summary>Recent reports</summary>
            <ul className="plain">
              {reports.map((r, i) => (
                <li key={i}>
                  {formatTenthsC(r.min)} to {formatTenthsC(r.max)} ({r.count} readings)
                  {r.timestamp ? ` · ${formatTimestamp(r.timestamp)}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="card">
        <h2>Custody history</h2>
        <CustodyTimeline batchId={id} directory={directory ?? undefined} refreshKey={refreshKey} />
      </div>

      <div className="card">
        <h2>Other events</h2>
        {eventsError ? (
          <p className="muted">Event history unavailable right now ({eventsError}).</p>
        ) : (
          <ActivityList activity={activity} name={name} />
        )}
      </div>

      <p className="muted small verify-source">
        Read directly from the blockchain ({config.networkName}
        {config.explorer ? (
          <>
            ,{" "}
            <a href={`${config.explorer}/address/${config.address}`} target="_blank" rel="noreferrer">
              contract
            </a>
          </>
        ) : null}
        ). No account or wallet needed.{" "}
        <button type="button" className="link-button" onClick={onRefresh}>
          Refresh
        </button>
      </p>
    </>
  );
}

function ActivityList({ activity, name }) {
  // Temperature reports and excursions are listed in the temperature card.
  const shown = activity.filter((e) => e.kind !== "temperature" && e.kind !== "excursion");
  if (!shown.length) return <p className="muted">No approvals, storage or quarantine events yet.</p>;

  return (
    <ul className="plain activity">
      {shown.map((e, i) => (
        <li key={i} className={`activity-${e.kind}`}>
          {e.kind === "approved" && <>Approved by {name(e.actor)}</>}
          {e.kind === "status" && (
            <>
              {statusLabel(e.status)} by {name(e.actor)}
            </>
          )}
          {e.kind === "quarantined" && <>Quarantined{e.reason ? `: ${e.reason}` : ""}</>}
          {e.kind === "released" && <>Released from quarantine (back to {statusLabel(e.status)})</>}
          {e.kind === "recalled" && <>Recalled{e.reason ? `: ${e.reason}` : ""}</>}
          {e.timestamp ? <span className="muted"> · {formatTimestamp(e.timestamp)}</span> : null}
        </li>
      ))}
    </ul>
  );
}
