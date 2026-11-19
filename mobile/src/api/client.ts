import Constants from "expo-constants";

const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");

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

export function getBaseUrl(): string {
  // In development with Metro, extract the PC host IP so phone always connects to the backend
  if (__DEV__ && Constants.expoConfig?.hostUri) {
    const metroHost = Constants.expoConfig.hostUri.split(":")[0];
    if (metroHost && metroHost !== "localhost" && metroHost !== "127.0.0.1") {
      // If ENV_BASE_URL is missing or uses a local IP, use Metro's active host
      if (
        !ENV_BASE_URL ||
        /^(http:\/\/(?:192\.168\.|10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)\d+)/.test(
          ENV_BASE_URL,
        )
      ) {
        return `http://${metroHost}:4000`;
      }
    }
  }

  if (ENV_BASE_URL) {
    return ENV_BASE_URL;
  }

  // Fallback to PC Wi-Fi IP so standalone builds connect to local backend without failing
  return "http://192.168.100.38:4000";
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

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== "UTC") {
      requestHeaders["X-Timezone"] = tz;
    }
  } catch {
    // Ignore if not supported
  }

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
    // Most common cause: airplane mode / no Wi-Fi. Phrase it so a non-technical
    // user knows exactly what to do — every screen surfaces this message.
    throw new ApiError(
      "You seem to be offline. Check your internet connection and try again.",
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

/**
 * Multipart upload (e.g. audio). Do NOT set Content-Type — fetch/RN sets the
 * multipart boundary automatically when body is FormData.
 */
export async function apiUploadForm<T>(
  path: string,
  formData: FormData,
  options: { token?: string | null; method?: string } = {},
): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "POST",
      cache: "no-store",
      headers,
      body: formData,
    });
  } catch {
    // Same friendly offline wording as apiFetch so voice and text paths match.
    throw new ApiError(
      "You seem to be offline. Check your internet connection and try again.",
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
