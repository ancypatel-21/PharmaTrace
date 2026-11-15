import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { isLocalOnlyUrl, verifyUrl } from "../lib/qr.js";

/**
 * QR code for one batch (V4). Scanning it opens the public verify page, /verify/:id, so a
 * pharmacist or patient can check the batch without a wallet.
 *
 *   <BatchQR batchId={id} productName="Insulin 10ml" lotNumber="LOT-001" />
 *
 * `size` sets the QR size in pixels (default 160). Download saves a print-ready SVG label.
 */
export default function BatchQR({ batchId, productName, lotNumber, size = 160 }) {
  const url = verifyUrl(batchId);
  const svgWrap = useRef(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard needs https or localhost; the link is shown below to copy by hand.
    }
  };

  const download = () => {
    const svg = svgWrap.current?.querySelector("svg");
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `pharmatrace-batch-${batchId}.svg`;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <figure className="batch-qr" data-testid="batch-qr">
      <div ref={svgWrap} className="batch-qr-code">
        <QRCodeSVG
          value={url}
          size={size}
          level="M"
          marginSize={2}
          title={`Verify batch #${batchId}`}
          bgColor="#ffffff"
          fgColor="#000000"
        />
      </div>
      <figcaption>
        <strong>Batch #{String(batchId)}</strong>
        {productName && <div>{productName}</div>}
        {lotNumber && <div className="muted small">Lot {lotNumber}</div>}
        <a href={url} target="_blank" rel="noreferrer" className="small batch-qr-link" data-testid="qr-url">
          {url}
        </a>
        <div className="batch-qr-actions">
          <button type="button" className="link-button small" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="link-button small" onClick={download}>
            Download QR
          </button>
        </div>
        {isLocalOnlyUrl(url) && (
          <p className="muted small batch-qr-hint">
            This link uses <code>localhost</code>, so a phone can't open it. Open the app from
            the Network address Vite prints (or set <code>VITE_PUBLIC_URL</code>) to scan it
            with a phone.
          </p>
        )}
      </figcaption>
    </figure>
  );
}
