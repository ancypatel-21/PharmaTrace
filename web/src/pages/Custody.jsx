import RequireRole from "../components/RequireRole.jsx";

// Placeholder route from the V2 scaffold. N5 (Nandana) replaces this file with the real page.
export default function Custody() {
  return (
    <section>
      <h1>Custody</h1>
      <RequireRole roles={["DISTRIBUTOR", "CARRIER", "PHARMACY"]}>
        <p className="muted">Batches you hold, send to the next hop, accept incoming transfers. Coming in N5 (Nandana).</p>
      </RequireRole>
    </section>
  );
}
