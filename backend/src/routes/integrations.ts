import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middleware/auth";
import { Integration } from "../models/Integration";
import {
  buildGoogleAuthUrl,
  exchangeGoogleAuthCode,
  getGoogleOAuthCredentials,
  getGoogleStatus,
  GOOGLE_SCOPES,
  revokeGoogleIntegration,
  saveGoogleIntegration,
  verifyOAuthState,
} from "../services/googleAuth";

export const integrationsRouter = Router();

function getCallbackUri(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const host = req.get("host") || "localhost:4000";
  const protocol = req.protocol === "https" ? "https" : "http";
  return `${protocol}://${host}/integrations/google/callback`;
}

// 1. List all integrations / status
integrationsRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const google = await getGoogleStatus(userId);

    return res.status(200).json({
      ok: true,
      integrations: {
        google,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: (error as Error).message,
    });
  }
});

// 2. Get Google OAuth initiation URL
integrationsRouter.get("/google/auth-url", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { isConfigured } = getGoogleOAuthCredentials();

    if (!isConfigured) {
      return res.status(400).json({
        ok: false,
        error: "GOOGLE_NOT_CONFIGURED",
        message:
          "Google OAuth is not configured on the server. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.",
      });
    }

    const redirectUri =
      typeof req.query.redirectUri === "string" && req.query.redirectUri.trim()
        ? req.query.redirectUri.trim()
        : getCallbackUri(req);

    const authUrl = buildGoogleAuthUrl(userId, redirectUri);

    return res.status(200).json({
      ok: true,
      authUrl,
      redirectUri,
      scopes: GOOGLE_SCOPES,
    });
  } catch (error) {
    return res.status(500).json({
      error: (error as Error).message,
    });
  }
});

// 2b. Direct Web Browser Connector (allows connecting Google from any browser on PC)
integrationsRouter.get("/google/web-connect", async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";

  if (token) {
    try {
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const payload = jwt.verify(token, secret) as { sub: string };
        const redirectUri = getCallbackUri(req);
        const authUrl = buildGoogleAuthUrl(payload.sub, redirectUri);
        return res.redirect(authUrl);
      }
    } catch {
      // Invalid token, fall through to login screen
    }
  }

  return res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Connect Google Account | Routine Manager</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #0F172A;
            color: #F8FAFC;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
          }
          .card {
            background: #1E293B;
            border: 1px solid #334155;
            border-radius: 16px;
            padding: 32px 28px;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
          }
          h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px; text-align: center; }
          p { font-size: 13px; color: #94A3B8; margin: 0 0 24px; text-align: center; line-height: 1.5; }
          .field { margin-bottom: 16px; }
          label { display: block; font-size: 12px; font-weight: 600; color: #CBD5E1; margin-bottom: 6px; }
          input {
            width: 100%;
            box-sizing: border-box;
            background: #0F172A;
            border: 1px solid #475569;
            border-radius: 8px;
            padding: 10px 12px;
            color: #F8FAFC;
            font-size: 14px;
          }
          input:focus { outline: none; border-color: #2563EB; }
          .btn {
            width: 100%;
            background: #2563EB;
            color: #FFFFFF;
            font-weight: 600;
            font-size: 15px;
            border: none;
            padding: 12px;
            border-radius: 8px;
            cursor: pointer;
            margin-top: 8px;
            transition: background 0.2s;
          }
          .btn:hover { background: #1D4ED8; }
          .err { color: #EF4444; font-size: 13px; margin-top: 12px; text-align: center; display: none; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Link Google Account</h1>
          <p>Sign in with your Routine Manager account to link your Google account for voice assistant actions.</p>
          <div class="field">
            <label>Routine Manager Email</label>
            <input type="email" id="email" placeholder="you@example.com" />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" id="password" placeholder="••••••••" />
          </div>
          <button class="btn" id="submitBtn" onclick="loginAndConnect()">Sign In & Connect with Google →</button>
          <div class="err" id="errMsg"></div>
        </div>
        <script>
          async function loginAndConnect() {
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const errDiv = document.getElementById('errMsg');
            const btn = document.getElementById('submitBtn');
            errDiv.style.display = 'none';

            if (!email || !password) {
              errDiv.innerText = 'Please enter your email and password.';
              errDiv.style.display = 'block';
              return;
            }

            btn.disabled = true;
            btn.innerText = 'Signing in...';

            try {
              const res = await fetch('/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
              });
              const data = await res.json();
              if (!res.ok) {
                throw new Error(data.error || 'Login failed');
              }
              window.location.href = '/integrations/google/web-connect?token=' + encodeURIComponent(data.token);
            } catch (err) {
              errDiv.innerText = err.message;
              errDiv.style.display = 'block';
              btn.disabled = false;
              btn.innerText = 'Sign In & Connect with Google →';
            }
          }
        </script>
      </body>
    </html>
  `);
});

// 3. Google OAuth Callback (receives redirect from Google)
integrationsRouter.get("/google/callback", async (req: Request, res: Response) => {
  const { code, state, error: googleError } = req.query;

  const renderRedirectHtml = (status: "success" | "error", message: string, email?: string) => {
    const deepLink = `routine-manager://settings/connections?status=${status}&message=${encodeURIComponent(message)}${email ? `&email=${encodeURIComponent(email)}` : ""}`;
    const title = status === "success" ? "Google Account Connected" : "Connection Failed";
    const accentColor = status === "success" ? "#16A34A" : "#DC2626";

    return res.status(status === "success" ? 200 : 400).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${title}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background-color: #0F172A;
              color: #F8FAFC;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
              box-sizing: border-box;
            }
            .card {
              background: #1E293B;
              border: 1px solid #334155;
              border-radius: 16px;
              padding: 32px 24px;
              max-width: 420px;
              width: 100%;
              text-align: center;
              box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
            }
            .badge {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 56px;
              height: 56px;
              border-radius: 50%;
              background: ${status === "success" ? "#14532D" : "#7F1D1D"};
              color: ${accentColor};
              font-size: 28px;
              margin-bottom: 16px;
            }
            h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
            p { font-size: 14px; color: #94A3B8; margin: 0 0 24px; line-height: 1.5; }
            .btn {
              display: inline-block;
              background: #2563EB;
              color: #FFFFFF;
              font-weight: 600;
              font-size: 15px;
              text-decoration: none;
              padding: 12px 24px;
              border-radius: 10px;
              transition: background 0.2s;
            }
            .btn:hover { background: #1D4ED8; }
          </style>
          <script>
            // Attempt auto deep-link back to the app
            window.location.href = "${deepLink}";
          </script>
        </head>
        <body>
          <div class="card">
            <div class="badge">${status === "success" ? "✓" : "✗"}</div>
            <h1>${title}</h1>
            <p>${message}</p>
            <a class="btn" href="${deepLink}">Return to Routine Manager</a>
          </div>
        </body>
      </html>
    `);
  };

  if (googleError) {
    return renderRedirectHtml(
      "error",
      `Google authorization declined: ${googleError}`,
    );
  }

  if (typeof code !== "string" || typeof state !== "string") {
    return renderRedirectHtml("error", "Missing required code or state parameter.");
  }

  try {
    const userId = verifyOAuthState(state);
    const redirectUri = getCallbackUri(req);
    const { tokens, profile } = await exchangeGoogleAuthCode(code, redirectUri);
    await saveGoogleIntegration(userId, tokens, profile);

    return renderRedirectHtml(
      "success",
      `Successfully connected Google account (${profile.email}). You can now return to Routine Manager.`,
      profile.email,
    );
  } catch (error) {
    // If the browser preloaded or refreshed the callback URL with the already-redeemed single-use code,
    // verify if the integration was already saved successfully!
    try {
      if (typeof state === "string") {
        const userId = verifyOAuthState(state);
        const existing = await Integration.findOne({ userId, provider: "google", status: "connected" });
        if (existing) {
          return renderRedirectHtml(
            "success",
            `Successfully connected Google account (${existing.email}). You can now return to Routine Manager.`,
            existing.email,
          );
        }
      }
    } catch {
      // Continue to error rendering
    }

    console.error("[GoogleCallback] Error:", error);
    return renderRedirectHtml(
      "error",
      `Failed to complete Google connection: ${(error as Error).message}`,
    );
  }
});

// 4. Direct Connect or Developer Mock Connect
integrationsRouter.post("/google/connect", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { code, redirectUri, mock, email, displayName, tokens } = req.body;

    // Case A: Mock / Dev connection for testing without Google Cloud setup
    if (mock) {
      const mockEmail = typeof email === "string" && email.trim() ? email.trim() : req.user!.email;
      const mockName = typeof displayName === "string" && displayName.trim() ? displayName.trim() : "Google User";

      const mockTokens = {
        access_token: `mock_access_token_${Date.now()}`,
        refresh_token: `mock_refresh_token_${Date.now()}`,
        expires_in: 3600,
        scope: GOOGLE_SCOPES.join(" "),
      };

      const mockProfile = {
        email: mockEmail,
        name: mockName,
      };

      const saved = await saveGoogleIntegration(userId, mockTokens, mockProfile);
      return res.status(200).json({
        ok: true,
        message: "Google account connected (Development Test Mode).",
        integration: {
          provider: saved.provider,
          email: saved.email,
          displayName: saved.displayName,
          scopes: saved.scopes,
          status: saved.status,
          expiresAt: saved.expiresAt,
        },
      });
    }

    // Case B: Direct tokens supplied
    if (tokens && tokens.access_token && email) {
      const saved = await saveGoogleIntegration(
        userId,
        tokens,
        { email, name: displayName || "" },
      );
      return res.status(200).json({
        ok: true,
        message: "Google account connected successfully.",
        integration: {
          provider: saved.provider,
          email: saved.email,
          displayName: saved.displayName,
          scopes: saved.scopes,
          status: saved.status,
          expiresAt: saved.expiresAt,
        },
      });
    }

    // Case C: Authorization code supplied from client
    if (typeof code === "string" && code.trim()) {
      const callbackUri = typeof redirectUri === "string" && redirectUri.trim() ? redirectUri.trim() : getCallbackUri(req);
      const { tokens: exchangedTokens, profile } = await exchangeGoogleAuthCode(code, callbackUri);
      const saved = await saveGoogleIntegration(userId, exchangedTokens, profile);

      return res.status(200).json({
        ok: true,
        message: "Google account connected successfully.",
        integration: {
          provider: saved.provider,
          email: saved.email,
          displayName: saved.displayName,
          scopes: saved.scopes,
          status: saved.status,
          expiresAt: saved.expiresAt,
        },
      });
    }

    return res.status(400).json({
      error: "Provide either authorization code, tokens, or mock: true",
    });
  } catch (error) {
    return res.status(500).json({
      error: (error as Error).message,
    });
  }
});

// 5. Disconnect / Revoke Google Integration
integrationsRouter.delete("/google", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const removed = await revokeGoogleIntegration(userId);

    return res.status(200).json({
      ok: true,
      message: removed ? "Google account disconnected." : "No active Google connection found.",
    });
  } catch (error) {
    return res.status(500).json({
      error: (error as Error).message,
    });
  }
});

// 6. Fast Status Check for Google Integration
integrationsRouter.get("/google/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const status = await getGoogleStatus(userId);
    return res.status(200).json({
      ok: true,
      ...status,
    });
  } catch (error) {
    return res.status(500).json({
      error: (error as Error).message,
    });
  }
});
