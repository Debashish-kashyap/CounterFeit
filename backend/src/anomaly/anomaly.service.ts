import { Injectable } from "@nestjs/common";
import { Scan, User, UserRole } from "@prisma/client";

const REPEAT_SCAN_THRESHOLD = 3;
const MAX_TRAVEL_SPEED_KMH = 900;
const EARTH_RADIUS_KM = 6371;

export interface ScanLocation {
  lat: number | null;
  lng: number | null;
  createdAt: Date;
}

function haversineKm(
  first: Pick<ScanLocation, "lat" | "lng">,
  second: Pick<ScanLocation, "lat" | "lng">,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.lat! - first.lat!);
  const longitudeDelta = radians(second.lng! - first.lng!);
  const firstLatitude = radians(first.lat!);
  const secondLatitude = radians(second.lat!);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(value));
}

@Injectable()
export class AnomalyService {
  evaluatePackScan(
    scanCount: number,
    currentUser: Pick<User, "id" | "role">,
    currentLocation: Pick<Scan, "lat" | "lng" | "createdAt">,
    previousScans: Array<
      Pick<Scan, "scannedBy" | "lat" | "lng" | "createdAt">
    >,
  ): string[] {
    const reasons: string[] = [];

    if (scanCount > REPEAT_SCAN_THRESHOLD) {
      reasons.push(`pack scanned ${scanCount} times`);
    }

    const pharmacyScannedElsewhere = previousScans.some(
      (scan) =>
        scan.scannedBy !== currentUser.id &&
        currentUser.role === UserRole.PHARMACY,
    );
    if (pharmacyScannedElsewhere) {
      reasons.push("same pack scanned by another pharmacy");
    }

    if (currentLocation.lat !== null && currentLocation.lng !== null) {
      for (const previous of previousScans) {
        if (previous.lat === null || previous.lng === null) {
          continue;
        }

        const distanceKm = haversineKm(previous, currentLocation);
        const elapsedHours =
          (currentLocation.createdAt.getTime() -
            previous.createdAt.getTime()) /
          3_600_000;
        if (elapsedHours <= 0) {
          if (distanceKm > 1) {
            reasons.push("impossible travel between scan locations");
            break;
          }
          continue;
        }

        if (distanceKm / elapsedHours > MAX_TRAVEL_SPEED_KMH) {
          reasons.push("impossible travel between scan locations");
          break;
        }
      }
    }

    return reasons;
  }
}
