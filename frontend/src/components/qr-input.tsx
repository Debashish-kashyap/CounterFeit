"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import { Camera, ImageUp, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function QrInput({ onScan }: { onScan: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    let disposed = false;
    let controls: { stop: () => void } | undefined;
    const reader = new BrowserQRCodeReader();
    setCameraBusy(true);
    setError("");

    void reader
      .decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (result, _decodeError, activeControls) => {
          if (!result) return;
          onScan(result.getText());
          activeControls.stop();
          setCameraOpen(false);
        },
      )
      .then((activeControls) => {
        controls = activeControls;
        if (disposed) controls.stop();
        else setCameraBusy(false);
      })
      .catch(() => {
        if (!disposed) {
          setError("Camera unavailable. Paste the QR content or upload a clear image instead.");
          setCameraBusy(false);
        }
      });

    return () => {
      disposed = true;
      controls?.stop();
    };
  }, [cameraOpen, onScan]);

  async function decodeImage(file: File | undefined) {
    if (!file) return;
    setError("");
    setCameraBusy(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const result = await new BrowserQRCodeReader().decodeFromImageElement(image);
      onScan(result.getText());
    } catch {
      setError("No readable QR code found. Try a sharper image or paste the QR content.");
    } finally {
      URL.revokeObjectURL(objectUrl);
      setCameraBusy(false);
    }
  }

  return (
    <div className="qr-input">
      <div className="qr-input-actions">
        <button className="button button-quiet" type="button" onClick={() => setCameraOpen((open) => !open)}>
          {cameraOpen ? <X size={16} /> : <Camera size={16} />}
          {cameraOpen ? "Close camera" : "Use camera"}
        </button>
        <label className="button button-quiet qr-upload-button">
          {cameraBusy && !cameraOpen ? <LoaderCircle className="spin" size={16} /> : <ImageUp size={16} />}
          Upload QR image
          <input type="file" accept="image/*" capture="environment" onChange={(event) => void decodeImage(event.target.files?.[0])} disabled={cameraBusy} />
        </label>
      </div>
      {cameraOpen && <div className="camera-frame"><video ref={videoRef} autoPlay muted playsInline /><span>{cameraBusy ? "Starting camera…" : "Point the camera at a signed QR code"}</span></div>}
      {error && <p className="qr-input-error">{error}</p>}
    </div>
  );
}