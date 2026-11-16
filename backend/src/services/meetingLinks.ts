import { getValidGoogleAccessToken } from "./googleAuth";

export interface MeetingLinkResult {
  provider: "google_meet" | "jitsi";
  meetLink: string;
  topic?: string;
}

export function createJitsiMeetingLink(topic?: string): MeetingLinkResult {
  const sanitizedTopic = (topic || "Meeting")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 20);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const timestamp = Date.now().toString().slice(-4);
  const roomName = `RoutineApp-${sanitizedTopic || "Session"}-${timestamp}-${randomSuffix}`;
  const meetLink = `https://meet.jit.si/${roomName}`;

  return {
    provider: "jitsi",
    meetLink,
    topic,
  };
}

export async function createGoogleMeetLink(
  userId: string,
  topic?: string,
): Promise<MeetingLinkResult> {
  const google = await getValidGoogleAccessToken(userId);
  if (!google?.accessToken) {
    // Graceful fallback to Jitsi if Google is not connected
    return createJitsiMeetingLink(topic);
  }

  try {
    // Attempt Google Meet REST API v2
    const res = await fetch("https://meet.googleapis.com/v2/spaces", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${google.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        config: {
          accessType: "OPEN",
        },
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { meetingUri?: string };
      if (data.meetingUri) {
        return {
          provider: "google_meet",
          meetLink: data.meetingUri,
          topic,
        };
      }
    }
  } catch (error) {
    console.warn("[MeetingLinks] Google Meet API attempt failed, falling back to Jitsi:", error);
  }

  // Graceful fallback to 100% free Jitsi Meet
  return createJitsiMeetingLink(topic);
}

export async function generateMeetingLink(
  userId: string,
  topic?: string,
): Promise<MeetingLinkResult> {
  return createGoogleMeetLink(userId, topic);
}
