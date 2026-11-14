import { useCallback, useEffect, useState } from "react";
import { isAddress } from "ethers";
import RequireRole from "../components/RequireRole.jsx";
import RoleBadge from "../components/RoleBadge.jsx";
import { useWallet } from "../context/WalletContext.jsx";
import { PARTICIPANT_ROLE_KEYS, adminErrorMessage, loadParticipantsSafely } from "../lib/admin.js";
import { shortAddress } from "../lib/format.js";
import { getReadContract } from "../lib/providers.js";
import { ROLES, ROLE_LABELS } from "../lib/roles.js";

// Admin participant registration: register and revoke the six participant roles. The contract
// enforces every rule (admin only, no duplicate role, no unknown role, no zero address); this
// page only shows a readable error when one of those checks fails.
export default function Admin() {
  return (
    <section>
      <h1>Admin</h1>
      <RequireRole roles={["ADMIN"]}>
        <AdminActions />
      </RequireRole>
    </section>
  );
}

function AdminActions() {
  const { config, getWriteContract } = useWallet();
  const [directory, setDirectory] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (config.mock) return undefined;
    let cancelled = false;
    loadParticipantsSafely(getReadContract()).then(({ directory: loaded, error }) => {
      if (cancelled) return;
      setDirectory(loaded);
      setLoadError(error);
    });
    return () => {
      cancelled = true;
    };
  }, [config.mock, refreshKey]);

  // Sends one transaction, waits for it to be mined, then reloads the participant list.
  const run = useCallback(
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
        setResult({ ok: false, text: `${label}: ${adminErrorMessage(err)}` });
      } finally {
        setBusy(null);
      }
    },
    [getWriteContract],
  );

  if (config.mock) {
    return (
      <div className="notice">
        <p>No contract is deployed yet, so there is nothing to register.</p>
        <p className="muted">
          Once <code>scripts/export-abi.js</code> exports a deployment, this page registers and
          revokes participants for the six roles.
        </p>
      </div>
    );
  }

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
        <h2>Register a participant</h2>
        <RegisterForm busy={busy} run={run} />
      </section>

      <section className="card">
        <h2>Registered participants</h2>
        {loadError && (
          <p className="muted">Participant list couldn't be loaded ({loadError}).</p>
        )}
        {!directory ? (
          <p className="muted">Loading…</p>
        ) : directory.size === 0 ? (
          <p className="muted">No participants registered yet.</p>
        ) : (
          [...directory.values()].map((participant) => (
            <ParticipantRow
              key={participant.address}
              participant={participant}
              busy={busy}
              run={run}
            />
          ))
        )}
      </section>
    </>
  );
}

function RegisterForm({ busy, run }) {
  const [address, setAddress] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [name, setName] = useState("");
  const disabled = busy !== null;
  const canSubmit = isAddress(address.trim()) && roleKey && name.trim().length > 0;

  return (
    <form
      className="lookup"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmedAddress = address.trim();
        const trimmedName = name.trim();
        run(
          "register",
          `Register ${trimmedName || shortAddress(trimmedAddress)} as ${ROLE_LABELS[roleKey]}`,
          (c) => c.registerParticipant(trimmedAddress, ROLES[roleKey], trimmedName)
        );
      }}
    >
      <label htmlFor="admin-address">Address</label>
      <input
        id="admin-address"
        placeholder="0x…"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        style={{ width: "26rem", maxWidth: "100%" }}
      />
      <label htmlFor="admin-role">Role</label>
      <select
        id="admin-role"
        value={roleKey}
        onChange={(e) => setRoleKey(e.target.value)}
        style={{ font: "inherit", padding: "8px 10px", borderRadius: 6 }}
      >
        <option value="">Choose a role…</option>
        {PARTICIPANT_ROLE_KEYS.map((key) => (
          <option key={key} value={key}>
            {ROLE_LABELS[key]}
          </option>
        ))}
      </select>
      <label htmlFor="admin-name">Display name</label>
      <input
        id="admin-name"
        placeholder="e.g. Acme Pharma"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ width: "16rem", maxWidth: "100%" }}
      />
      <button type="submit" className="btn" disabled={disabled || !canSubmit}>
        {busy === "register" ? "Registering…" : "Register"}
      </button>
    </form>
  );
}

function ParticipantRow({ participant, busy, run }) {
  const disabled = busy !== null;
  const label = participant.name || shortAddress(participant.address);
  const key = `revoke-${participant.address}`;

  return (
    <article className="card" style={{ marginBottom: 12 }} data-testid={`participant-${participant.address}`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <strong>{label}</strong>
        {participant.roles.map((r) => (
          <RoleBadge key={r} role={r} />
        ))}
      </div>
      <p className="muted" style={{ margin: "4px 0 8px" }}>
        {participant.address}
      </p>
      {participant.roles.length === 0 ? (
        <p className="muted">Already revoked.</p>
      ) : (
        <button
          type="button"
          className="btn btn-warn"
          disabled={disabled}
          onClick={() => run(key, `Revoke ${label}`, (c) => c.revokeParticipant(participant.address))}
        >
          {busy === key ? "Revoking…" : "Revoke all roles"}
        </button>
      )}
    </article>
  );
}
