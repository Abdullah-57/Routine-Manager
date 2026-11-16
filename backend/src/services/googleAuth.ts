import jwt from "jsonwebtoken";
import { Integration, type IntegrationDocument } from "../models/Integration";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface GoogleProfile {
  id?: string;
  email: string;
  name?: string;
  picture?: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is missing from environment");
  }
  return secret;
}

export function getGoogleOAuthCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  return {
    clientId,
    clientSecret,
    isConfigured: Boolean(clientId && clientSecret),
  };
}

export function createOAuthState(userId: string): string {
  return jwt.sign(
    { sub: userId, type: "google_oauth", nonce: Math.random().toString(36).slice(2) },
    getJwtSecret(),
    { expiresIn: "15m" },
  );
}

export function verifyOAuthState(state: string): string {
  try {
    const payload = jwt.verify(state, getJwtSecret()) as {
      sub: string;
      type: string;
    };
    if (payload.type !== "google_oauth" || !payload.sub) {
      throw new Error("Invalid state payload");
    }
    return payload.sub;
  } catch (error) {
    throw new Error(`Invalid or expired OAuth state: ${(error as Error).message}`);
  }
}

export function buildGoogleAuthUrl(userId: string, redirectUri: string): string {
  const { clientId, isConfigured } = getGoogleOAuthCredentials();
  if (!isConfigured) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured in backend/.env",
    );
  }

  const state = createOAuthState(userId);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleAuthCode(
  code: string,
  redirectUri: string,
): Promise<{ tokens: GoogleTokens; profile: GoogleProfile }> {
  const { clientId, clientSecret, isConfigured } = getGoogleOAuthCredentials();
  if (!isConfigured) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured in backend/.env",
    );
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${errText}`);
  }

  const tokens = (await tokenRes.json()) as GoogleTokens;

  // Retrieve user profile
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  });

  if (!profileRes.ok) {
    const errText = await profileRes.text();
    throw new Error(`Failed to fetch Google profile (${profileRes.status}): ${errText}`);
  }

  const profile = (await profileRes.json()) as GoogleProfile;
  return { tokens, profile };
}

export async function saveGoogleIntegration(
  userId: string,
  tokens: GoogleTokens,
  profile: GoogleProfile,
): Promise<IntegrationDocument> {
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
  const scopes = tokens.scope ? tokens.scope.split(" ") : GOOGLE_SCOPES;

  // Preserve existing refresh token if Google didn't return a new one on re-auth
  let refreshToken = tokens.refresh_token || "";
  if (!refreshToken) {
    const existing = await Integration.findOne({ userId, provider: "google" });
    if (existing?.refreshToken) {
      refreshToken = existing.refreshToken;
    }
  }

  const updated = await Integration.findOneAndUpdate(
    { userId, provider: "google" },
    {
      userId,
      provider: "google",
      email: profile.email,
      displayName: profile.name || "",
      picture: profile.picture || "",
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt,
      scopes,
      status: "connected",
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  return updated as unknown as IntegrationDocument;
}

export async function getValidGoogleAccessToken(userId: string): Promise<{
  accessToken: string;
  email: string;
  displayName: string;
  scopes: string[];
} | null> {
  const integration = await Integration.findOne({
    userId,
    provider: "google",
    status: "connected",
  });

  if (!integration) {
    return null;
  }

  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes safety buffer
  const isExpiringSoon = integration.expiresAt.getTime() - now < bufferMs;

  if (!isExpiringSoon) {
    return {
      accessToken: integration.accessToken,
      email: integration.email,
      displayName: integration.displayName || "",
      scopes: integration.scopes || [],
    };
  }

  // Needs refresh
  if (!integration.refreshToken) {
    console.warn(`[GoogleAuth] Integration for user ${userId} has expired and lacks a refresh token.`);
    return null;
  }

  const { clientId, clientSecret, isConfigured } = getGoogleOAuthCredentials();
  if (!isConfigured) {
    console.warn("[GoogleAuth] Cannot refresh token: Google OAuth credentials not configured.");
    return null;
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: integration.refreshToken,
      grant_type: "refresh_token",
    });

    const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!refreshRes.ok) {
      const errText = await refreshRes.text();
      console.error(`[GoogleAuth] Token refresh failed (${refreshRes.status}): ${errText}`);
      if (refreshRes.status === 400 || refreshRes.status === 401) {
        integration.status = "expired";
        await integration.save();
      }
      return null;
    }

    const refreshed = (await refreshRes.json()) as GoogleTokens;
    integration.accessToken = refreshed.access_token;
    integration.expiresAt = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000);
    if (refreshed.refresh_token) {
      integration.refreshToken = refreshed.refresh_token;
    }
    await integration.save();

    return {
      accessToken: integration.accessToken,
      email: integration.email,
      displayName: integration.displayName || "",
      scopes: integration.scopes || [],
    };
  } catch (error) {
    console.error("[GoogleAuth] Exception during token refresh:", error);
    return null;
  }
}

export async function revokeGoogleIntegration(userId: string): Promise<boolean> {
  const integration = await Integration.findOne({ userId, provider: "google" });
  if (!integration) {
    return false;
  }

  // Attempt Google revocation endpoint (best effort)
  const tokenToRevoke = integration.refreshToken || integration.accessToken;
  if (tokenToRevoke) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch (e) {
      console.warn("[GoogleAuth] Token revocation with Google failed (ignorable):", e);
    }
  }

  await Integration.deleteOne({ _id: integration._id });
  return true;
}

export async function getGoogleStatus(userId: string) {
  const integration = await Integration.findOne({
    userId,
    provider: "google",
  });

  if (!integration || integration.status === "revoked") {
    return {
      connected: false,
      isConfigured: getGoogleOAuthCredentials().isConfigured,
      integration: null,
    };
  }

  return {
    connected: integration.status === "connected",
    isConfigured: getGoogleOAuthCredentials().isConfigured,
    integration: {
      provider: integration.provider,
      email: integration.email,
      displayName: integration.displayName,
      picture: integration.picture,
      scopes: integration.scopes,
      status: integration.status,
      expiresAt: integration.expiresAt,
      connectedAt: (integration as unknown as { createdAt?: Date }).createdAt,
    },
  };
}
