import RequireRole from "../components/RequireRole.jsx";

// Placeholder route from the V2 scaffold. S6 (Shreyanshi) replaces this file with the real page.
export default function Regulator() {
  return (
    <section>
      <h1>Regulator</h1>
      <RequireRole roles={["REGULATOR"]}>
        <p className="muted">Approve, quarantine, release and recall batches. Coming in S6 (Shreyanshi).</p>
      </RequireRole>
    </section>
  );
}
