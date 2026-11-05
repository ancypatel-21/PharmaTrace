import { useParams } from "react-router-dom";
import BatchLookup from "../components/BatchLookup.jsx";

// Public verify page: no wallet needed. V2 provides the route and lookup; V3 adds the batch
// details, approval badge, custody timeline and temperature summaries (see docs/ui-data.md).
export default function Verify() {
  const { id } = useParams();

  return (
    <section>
      <h1>Verify a batch</h1>
      <BatchLookup key={id} initial={id ?? ""} />
      {id && <p className="muted">Batch #{id}: details coming in V3.</p>}
    </section>
  );
}
