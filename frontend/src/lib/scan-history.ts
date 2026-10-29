export type ScanHistoryItem = {
  id: string;
  targetType: "PACK" | "CASE";
  code: string;
  result: "GENUINE" | "SUSPICIOUS" | "EXPIRED" | "UNKNOWN";
  reason: string | null;
  createdAt: string;
  batchName: string | null;
};

export const SCAN_HISTORY_KEY = "counterfeit-pharmacy-scan-history";

export function getScanHistory(): ScanHistoryItem[] {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(SCAN_HISTORY_KEY) ?? "[]",
    );
    return Array.isArray(stored) ? (stored as ScanHistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function addScanHistoryItem(item: ScanHistoryItem): void {
  try {
    window.localStorage.setItem(
      SCAN_HISTORY_KEY,
      JSON.stringify([item, ...getScanHistory()].slice(0, 100)),
    );
  } catch {
    // Scanning still succeeds if this device cannot retain local history.
  }
}

export function clearScanHistory(): void {
  window.localStorage.removeItem(SCAN_HISTORY_KEY);
}