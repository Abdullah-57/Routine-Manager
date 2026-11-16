import { getValidGoogleAccessToken } from "./googleAuth";

export interface SendEmailResult {
  success: boolean;
  method: "gmail_api" | "composer_draft";
  to: string;
  subject: string;
  body: string;
  messageId?: string;
  message: string;
}

function toBase64Url(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendEmailMessage(
  userId: string,
  to: string,
  subject: string,
  body: string,
): Promise<SendEmailResult> {
  const cleanTo = to.trim();
  const cleanSubject = subject.trim();
  const cleanBody = body.trim();

  // 1. Attempt Gmail API if Google account is connected
  try {
    const google = await getValidGoogleAccessToken(userId);
    if (google?.accessToken) {
      const fromHeader = google.email ? `From: ${google.email}\r\n` : "";
      const rawEmail =
        `${fromHeader}To: ${cleanTo}\r\n` +
        `Subject: ${cleanSubject}\r\n` +
        `Content-Type: text/plain; charset="UTF-8"\r\n` +
        `Content-Transfer-Encoding: 7bit\r\n\r\n` +
        `${cleanBody}`;

      const encodedMessage = toBase64Url(rawEmail);

      const res = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${google.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: encodedMessage }),
        },
      );

      if (res.ok) {
        const data = (await res.json()) as { id?: string };
        return {
          success: true,
          method: "gmail_api",
          to: cleanTo,
          subject: cleanSubject,
          body: cleanBody,
          messageId: data.id,
          message: `Email invite successfully sent to ${cleanTo} from ${google.email || "your Gmail account"}.`,
        };
      } else {
        const errText = await res.text();
        console.warn(`[Email] Gmail API send returned ${res.status}: ${errText}`);
      }
    }
  } catch (err) {
    console.warn("[Email] Gmail API dispatch exception, falling back to composer draft:", err);
  }

  // 2. Graceful fallback draft (Native Mail Composer / In-App)
  return {
    success: true,
    method: "composer_draft",
    to: cleanTo,
    subject: cleanSubject,
    body: cleanBody,
    message: `Email invitation prepared for ${cleanTo} with meeting link.`,
  };
}
