import { useState } from "react";
import { useNavigate } from "react-router-dom";

/** Batch ID input that opens /verify/:id. */
export default function BatchLookup({ initial = "" }) {
  const [value, setValue] = useState(initial);
  const navigate = useNavigate();
  const valid = /^[1-9]\d*$/.test(value.trim());

  const onSubmit = (e) => {
    e.preventDefault();
    if (valid) navigate(`/verify/${value.trim()}`);
  };

  return (
    <form className="lookup" onSubmit={onSubmit}>
      <label htmlFor="batch-id">Batch ID</label>
      <input
        id="batch-id"
        inputMode="numeric"
        placeholder="e.g. 1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn" disabled={!valid}>
        Verify
      </button>
    </form>
  );
}
