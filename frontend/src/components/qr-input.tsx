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
    const cameraOptions = [
      { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      { audio: false, video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      { audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
      { audio: false, video: true },
    ];

    async function startCamera() {
      setCameraBusy(true);
      setError("");

      for (const constraints of cameraOptions) {
        try {
          const currentControls = await reader.decodeFromConstraints(
            constraints,
            videoRef.current!,
            (result, _decodeError, activeControls) => {
              if (!result) return;
              onScan(result.getText());
              activeControls.stop();
              setCameraOpen(false);
            },
          );

          controls = currentControls;
          if (disposed) {
            controls.stop();
            return;
          }

          setCameraBusy(false);
          return;
        } catch {
          // Try the next available camera option until one works.
        }
      }

      if (!disposed) {
        setError("Camera unavailable. Paste the QR content or upload a clear image instead.");
        setCameraBusy(false);
      }
    }

    void startCamera();

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