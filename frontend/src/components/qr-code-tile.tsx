"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCodeTile({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 176,
      color: { dark: "#0b0f14", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (active) setImage(dataUrl);
      })
      .catch(() => {
        if (active) setError("QR image could not be generated");
      });
    return () => {
      active = false;
    };
  }, [value]);

  return (
    <article className="qr-tile">
      {image ? <img src={image} alt={`QR code for ${label}`} width={176} height={176} /> : <div className="qr-placeholder">{error || "Generating QR"}</div>}
      <b>{label}</b>
      <code title={value}>{value.length > 38 ? `${value.slice(0, 18)}...${value.slice(-12)}` : value}</code>
    </article>
  );
}