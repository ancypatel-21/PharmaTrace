import RequireRole from "../components/RequireRole.jsx";

// Placeholder route from the V2 scaffold. A8 (Ancy) replaces this file with the real page.
export default function Manufacturer() {
  return (
    <section>
      <h1>Manufacturer</h1>
      <RequireRole roles={["MANUFACTURER"]}>
        <p className="muted">Register a new batch and print its QR code. Coming in A8 (Ancy).</p>
      </RequireRole>
    </section>
  );
}
