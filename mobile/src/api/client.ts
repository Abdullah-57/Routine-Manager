const BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getBaseUrl(): string {
  if (!BASE_URL) {
    throw new ApiError(
      "EXPO_PUBLIC_API_URL is not set. Add it to mobile/.env and restart Expo.",
      0,
      "CONFIG_ERROR",
    );
  }
  return BASE_URL;
}

type ApiFetchOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
  token?: string | null;
};

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers = {}, token, ...rest } = options;
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  const requestHeaders: Record<string, string> = {
    Accept: "application/json",
    // Android can cache GET responses; avoid stale /health successes after backend stops
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    ...headers,
  };

  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
  }

  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      ...rest,
      method: rest.method ?? (body === undefined ? "GET" : "POST"),
      cache: "no-store",
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "Network error — is the backend running and is EXPO_PUBLIC_API_URL reachable?",
      0,
      "NETWORK_ERROR",
    );
  }

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${response.status}`;

    throw new ApiError(message, response.status);
  }

  return data as T;
}

export type HealthResponse = {
  ok: boolean;
  service: string;
};

export function pingHealth() {
  // Cache-busting query so Android HTTP cache cannot reuse a prior 200
  return apiFetch<HealthResponse>(`/health?t=${Date.now()}`);
}
