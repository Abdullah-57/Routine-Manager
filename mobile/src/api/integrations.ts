import { apiFetch } from "./client";

export interface GoogleIntegration {
  provider: "google";
  email: string;
  displayName?: string;
  picture?: string;
  scopes: string[];
  status: "connected" | "revoked" | "expired";
  expiresAt?: string;
  connectedAt?: string;
}

export interface GoogleStatusResponse {
  ok: boolean;
  connected: boolean;
  isConfigured: boolean;
  integration: GoogleIntegration | null;
}

export interface GoogleAuthUrlResponse {
  ok: boolean;
  authUrl: string;
  redirectUri: string;
  scopes: string[];
}

export interface ConnectGooglePayload {
  code?: string;
  redirectUri?: string;
  mock?: boolean;
  email?: string;
  displayName?: string;
}

export interface ConnectGoogleResponse {
  ok: boolean;
  message: string;
  integration?: GoogleIntegration;
}

export interface DisconnectGoogleResponse {
  ok: boolean;
  message: string;
}

export async function getGoogleStatus(token: string): Promise<GoogleStatusResponse> {
  return apiFetch<GoogleStatusResponse>("/integrations/google/status", {
    token,
  });
}

export async function getGoogleAuthUrl(
  token: string,
  redirectUri?: string,
): Promise<GoogleAuthUrlResponse> {
  const query = redirectUri ? `?redirectUri=${encodeURIComponent(redirectUri)}` : "";
  return apiFetch<GoogleAuthUrlResponse>(`/integrations/google/auth-url${query}`, {
    token,
  });
}

export async function connectGoogleAccount(
  token: string,
  payload: ConnectGooglePayload,
): Promise<ConnectGoogleResponse> {
  return apiFetch<ConnectGoogleResponse>("/integrations/google/connect", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function disconnectGoogleAccount(
  token: string,
): Promise<DisconnectGoogleResponse> {
  return apiFetch<DisconnectGoogleResponse>("/integrations/google", {
    method: "DELETE",
    token,
  });
}
