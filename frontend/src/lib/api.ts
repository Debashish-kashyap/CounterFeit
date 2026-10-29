export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

export type UserRole = "MANUFACTURER" | "PHARMACY" | "REGULATOR";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  locationName: string | null;
  lat: number | null;
  lng: number | null;
};

export async function apiRequest<T>(
  path: string,
  token?: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body) headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE}`);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? (body as { message: unknown }).message
        : `Request failed (${response.status})`;
    const error = new Error(
      Array.isArray(message) ? message.join(", ") : String(message),
    );
    Object.assign(error, { status: response.status });
    throw error;
  }

  return body as T;
}