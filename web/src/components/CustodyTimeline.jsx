import { useEffect, useState } from "react";
import StatusBadge from "./StatusBadge.jsx";
import { buildTimeline, custodyErrorMessage, loadParticipantsSafely, participantName } from "../lib/custody.js";
import { formatTimestamp, shortAddress } from "../lib/format.js";
import { getReadContract } from "../lib/providers.js";

/**
 * Custody timeline for one batch (N6): registration, every accepted handoff from
 * getCustodyHistory (oldest first), then a pending handoff if one is waiting. Participant
 * names come from ParticipantRegistered events. Read-only, no wallet needed, so the public
 * verify page (V3) can embed it as well as the custody page.
 *
 *   <CustodyTimeline batchId={id} />
 *
 * Optional props: `directory` (an already loaded participant directory, to skip reloading it)
 * and `refreshKey` (change it to reload after a transaction).
 */
export default function CustodyTimeline({ batchId, directory: givenDirectory, refreshKey = 0 }) {
  // `forBatch` records which batch the loaded state belongs to, so a new batchId shows
  // "Loading" instead of the previous batch's history. A refresh of the same batch keeps the
  // old entries on screen until the new ones arrive.
  const [state, setState] = useState({ forBatch: null });
  const key = String(batchId);

  useEffect(() => {
    const contract = getReadContract();
    if (!contract) {
      setState({ forBatch: key, error: "No contract deployed yet." });
      return undefined;
    }

    let cancelled = false;
    (async () => {
      if (!(await contract.batchExists(batchId))) return { notFound: true };
      const [batch, history, directory] = await Promise.all([
        contract.getBatch(batchId),
        contract.getCustodyHistory(batchId),
        givenDirectory ?? loadParticipantsSafely(contract).then((p) => p.directory),
      ]);
      return { entries: buildTimeline(batch, history), directory };
    })()
      .then((loaded) => !cancelled && setState({ forBatch: key, ...loaded }))
      .catch((err) => !cancelled && setState({ forBatch: key, error: custodyErrorMessage(err) }));

    return () => {
      cancelled = true;
    };
  }, [batchId, key, givenDirectory, refreshKey]);

  if (state.forBatch !== key) return <p className="muted">Loading custody history…</p>;
  if (state.error) return <p className="muted">Custody history unavailable: {state.error}</p>;
  if (state.notFound) return <p className="muted">No batch has ID {key}.</p>;

  const name = (address) => (
    <strong title={address}>{participantName(state.directory, address) ?? shortAddress(address)}</strong>
  );

  return (
    <ol className="custody-timeline" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {state.entries.map((entry, i) => (
        <li
          key={i}
          style={{
            borderLeft: `3px ${entry.kind === "pending" ? "dashed" : "solid"} var(--border)`,
            padding: "4px 0 10px 12px",
          }}
        >
          <div>
            {entry.kind === "registered" && <>Registered by {name(entry.to)}</>}
            {entry.kind === "handoff" && (
              <>
                {name(entry.from)} → {name(entry.to)}
              </>
            )}
            {entry.kind === "pending" && (
              <>
                Sent by {name(entry.from)} to {name(entry.to)}, waiting to be accepted
              </>
            )}{" "}
            {entry.kind !== "pending" && <StatusBadge status={entry.status} />}
          </div>
          {entry.timestamp !== undefined && (
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              {formatTimestamp(entry.timestamp)}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
