import RequireRole from "../components/RequireRole.jsx";

// Placeholder route from the V2 scaffold. A8 (Ancy) replaces this file with the real page.
export default function Admin() {
  return (
    <section>
      <h1>Admin</h1>
      <RequireRole roles={["ADMIN"]}>
        <p className="muted">Register and revoke participants. Coming in A8 (Ancy).</p>
      </RequireRole>
    </section>
  );
}
