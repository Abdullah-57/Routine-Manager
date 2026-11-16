import * as WebBrowser from "expo-web-browser";
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  getGoogleAuthUrl,
  getGoogleStatus,
  type GoogleIntegration,
} from "@/api/integrations";

// Ensure auth sessions complete correctly
WebBrowser.maybeCompleteAuthSession();

export interface StartGoogleOAuthResult {
  success: boolean;
  message?: string;
  integration?: GoogleIntegration | null;
}

export async function linkGoogleAccount(token: string): Promise<StartGoogleOAuthResult> {
  try {
    // 1. Request OAuth authorization URL from backend
    const { authUrl, redirectUri } = await getGoogleAuthUrl(token);

    // 2. Open auth session in browser (Chrome Custom Tab / ASWebAuthenticationSession)
    const result = await WebBrowser.openAuthSessionAsync(
      authUrl,
      "routine-manager://settings/connections",
    );

    if (result.type === "cancel" || result.type === "dismiss") {
      return {
        success: false,
        message: "Sign-in cancelled by user.",
      };
    }

    if (result.type === "success" && result.url) {
      const url = new URL(result.url);
      const status = url.searchParams.get("status");
      const message = url.searchParams.get("message") || undefined;

      if (status === "error") {
        return {
          success: false,
          message: message || "Google account connection failed.",
        };
      }
    }

    // 3. Verify status with backend
    const statusRes = await getGoogleStatus(token);
    if (statusRes.connected && statusRes.integration) {
      return {
        success: true,
        integration: statusRes.integration,
        message: `Successfully connected as ${statusRes.integration.email}`,
      };
    }

    return {
      success: false,
      message: "Could not confirm Google account connection.",
    };
  } catch (error) {
    return {
      success: false,
      message: (error as Error).message,
    };
  }
}

export async function unlinkGoogleAccount(token: string): Promise<{ success: boolean; message: string }> {
  try {
    const res = await disconnectGoogleAccount(token);
    return {
      success: res.ok,
      message: res.message || "Google account disconnected.",
    };
  } catch (error) {
    return {
      success: false,
      message: (error as Error).message,
    };
  }
}

export async function devConnectMockGoogle(
  token: string,
  email?: string,
): Promise<StartGoogleOAuthResult> {
  try {
    const res = await connectGoogleAccount(token, {
      mock: true,
      email: email || "alex.tester@gmail.com",
      displayName: "Alex Tester",
    });

    return {
      success: res.ok,
      integration: res.integration || null,
      message: res.message,
    };
  } catch (error) {
    return {
      success: false,
      message: (error as Error).message,
    };
  }
}
