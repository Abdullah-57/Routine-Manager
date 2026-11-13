# Routine Manager → Autonomous Voice Assistant: Feature Specification

> Goal: evolve the current reminder app (Expo SDK 58 mobile + Express/MongoDB backend, OpenAI Whisper transcription + LLM tool-calling parser, `expo-notifications` local alerts, custom calendar) into a **Siri-like autonomous assistant** — minimal UI interaction, everything driven by voice, with actions (contacts, meetings, calendar events, emails), smart pre-reminders, tappable rich notifications, and a Google Calendar-style view.

---

## 0. Current State (baseline from codebase audit)

| Capability | Status | Where |
|---|---|---|
| Email/password auth (JWT, SecureStore) | ✅ Done | `backend/src/routes/auth.ts`, `mobile/src/auth/` |
| Reminder CRUD (MongoDB) | ✅ Done | `backend/src/routes/reminders.ts`, `mobile/src/api/reminders.ts` |
| Typed input → AI parse | ✅ Done | `POST /routines/parse` → `openaiRoutine.ts` (`create/update/delete/list_reminders` tools) |
| Voice input (record → upload → Whisper → parse) | ✅ Done | `voice-record-sheet.tsx`, `whisper.ts` (one utterance per recording) |
| Local push notifications at reminder time | ✅ Done | `local-reminders.ts` (`expo-notifications`, exact alarms, resync on edit) |
| Remote push (test + device registration) | ✅ Done | `push.ts` → Expo Push API → FCM/APNs |
| Notification tap → reminder detail screen | ✅ Done | `use-notification-navigation.ts`, scheme `routine-manager` |
| Calendar month grid + day agenda list | ✅ Done | `month-calendar.tsx`, `screens/calendar` |
| Contacts / Google Calendar / Meet / email sending | ❌ None | — |
| Wake-word / always-listening activation | ❌ None | app requires opening the app and holding a record button |
| Pre-reminder alerts (T-1h, T-15m) | ❌ None | only the on-the-time alert |
| Server-side scheduled dispatch | ❌ None | all alerts are locally scheduled on device |
| Rich notification actions (Join meeting, etc.) | ❌ None | tap opens detail screen only |

---

## 1. Feature: Hands-Free Voice Activation ("Hey Assistant")

**User story:** *"I say 'Hey Assistant' without touching my phone, then speak my entire day's routine in one or more sentences, and everything gets scheduled — I never open the app."*

**Agent skills (load in the agent chat before implementing):** `expo-overview` (load first), `expo-dev-client` (required — wake-word engines and `expo-speech` are native modules that don't work in Expo Go), `vercel-react-native-skills`, `openai-docs`, `expo-data-fetching`, `expo-router`, `expo-animation`, `expo-native-ui`. *No dedicated agent skill exists for expo-speech-recognition / Vosk — follow their vendor docs.*

### 1.1 Wake-word detection (100% Free, Zero-Credential Engine)
**Agent skills:** `expo-dev-client` (required — custom native module), `vercel-react-native-skills` (native-module integration + battery-conscious background work), `expo-native-ui` (assistant settings UI). *(expo-speech-recognition / Vosk: vendor docs — no agent skill.)*

> **Zero-Cost & Zero-Account Guarantee:** Picovoice Porcupine now requires business/company email domains and proprietary cloud Console AccessKeys. To ensure the app can be built and run without any company email, credit card, or paid subscription, we use **100% free, open/native offline engines**.

- **Primary 100% Free Engine: `expo-speech-recognition` (Continuous On-Device Mode)**
  - **No company email, no credit card, no API key, no account sign-up needed.**
  - Uses the phone's native hardware speech recognition engine: Apple Speech (`SFSpeechRecognizer`) on iOS and Google Speech (`SpeechRecognizer`) on Android.
  - Configured with `requiresOnDeviceRecognition: true`, `continuous: true`, and `interimResults: true` for zero-latency, private, offline keyword spotting.
  - Detects "Hey Assistant" (or custom wake phrase) in the live interim stream → fires activation chime/haptic → smoothly transitions into routine dictation.
  - **0 MB bundle size penalty** (unlike bundled ML models).
- **Secondary 100% Free Engine: `react-native-vosk` (Open-Source Offline KWS)**
  - 100% open-source (Apache 2.0). Runs completely offline on-device with a lightweight English model (`vosk-model-small-en-us`, ~40MB).
  - Uses grammar/keyword mode with a strict JSON phrase list (e.g., `["hey assistant", "[unk]"]`). Zero network calls, zero accounts.
- **Picovoice Porcupine (Commercial Option — Optional / Deferred):**
  - Retained in documentation only as a commercial alternative if an enterprise/company email is acquired in the future.
- Wake word detection runs through a **foreground service (Android)** with a persistent low-key notification ("Listening for 'Hey Assistant'…") and **iOS background audio mode** (`audio` UIBackgroundMode) to keep the audio pipeline alive when backgrounded. Document iOS limitations honestly (Apple restricts true always-on mic; on iOS the practical pattern is: app foregrounded OR recent, plus "raise to listen"-style shortcuts).
- New user preference: **Assistant enabled? / wake phrase / wake sensitivity** in `app-preferences.tsx` + sidebar settings.

### 1.2 Post-wake conversation session
**Agent skills:** `openai-docs` (streaming STT APIs — Whisper streaming / `gpt-4o-transcribe`), `expo-data-fetching` (WebSocket client + live-transcript streaming states), `expo-dev-client` (`expo-speech` TTS is a native module).

> **100% Free Audio & TTS Stack:**
> - **Text-to-Speech (TTS):** Uses **`expo-speech`** — 100% free native operating system speech synthesis (Apple iOS AVSpeechSynthesizer & Android TextToSpeech). Requires **zero accounts, zero credit cards, zero API keys**, and has zero cloud latency.
> - **Speech-to-Text (STT):** Primary free option is on-device **`expo-speech-recognition`** streaming text directly into the tool loop (100% free, zero cost). Fallback is backend Whisper audio upload.

1. Wake detected → play a short activation chime / haptic → immediately open a **streaming STT session**.
2. **Streaming transcription** (replaces the current record-then-upload flow for assistant mode):
   - **100% Free Native Path:** `expo-speech-recognition` streams partial recognized text live to the UI and submits final text on silence.
   - **Backend Path:** Backend WebSocket endpoint (`/routines/stream`) accepting audio chunks piped to Whisper/transcription model.
3. **Endpoint detection**: when the user pauses (e.g., 1.2s silence) the backend commits the utterance and runs the existing `parseRoutineWithTools` pipeline — unchanged LLM logic, now fed streaming text.
4. **Voice-only confirmation loop (no screen touch):**
   - LLM parser returns a summary: *"I've set 4 reminders for today: Meeting with Alex at 5 PM, gym at 7 AM… Should I confirm?"*
   - Mobile uses **`expo-speech` (TTS)** to read the confirmation aloud; the assistant keeps listening for **"yes / confirm" / "no / change [X]"**.
   - "Change" re-enters the tool loop (`update_reminder`) exactly like typed edits do today.
5. Session auto-ends after a configurable idle timeout (e.g., 20s) with a soft chime.

### 1.3 Multi-utterance routines
**Agent skills:** `openai-docs`, `ai-sdk` (session context management + the tool loop).

- A session stays open until the user says a **closing phrase** ("that's all", "done") or the timeout hits — allowing *"Add a reminder to call mom at 9"* … *"also remind me to take meds at noon"* in one wake session, each utterance hitting the same `/routines/parse` tool loop.
- Session context (already-present upcoming reminders) stays warm across utterances so "move that one to 3" resolves correctly.

### 1.4 New screens/components (mobile)
**Agent skills:** `expo-router` (overlay presentation/routing), `expo-animation` (activation transitions, waveform, TTS indicator), `expo-native-ui` (native-feeling overlay/floating mic bubble); `expo-design-system` (optional — keep overlay consistent with app tokens).

- `AssistantOverlay` — a full-screen or floating activation state: waveform, live transcript, confirmation cards, TTS indicator. Can also live as a **floating mic bubble** over the Home screen.
- Background service boot handling: after device reboot (`RECEIVE_BOOT_COMPLETED` already granted), re-register the wake service on first app launch after boot.

---

## 2. Feature: Action-Aware Reminders ("Meetings that do things")

**User story:** *"Schedule a meeting with Alex at 5 PM" → the assistant looks up Alex's email from the user's Google contacts, generates a Google Meet link, sends Alex the link, and sets the meeting reminder in the app — all from one sentence.*

**Agent skills (load in the agent chat before implementing):** `expo-overview` (load first), `openai-docs`, `ai-sdk` (extending the LLM tool loop), `expo-data-fetching` (OAuth/token flow), `expo-router`, `expo-ui`, `vercel-react-native-skills`. *No agent skill exists for the Google People / Meet / Gmail APIs — follow Google Cloud docs.*

> **Design principle — 100% Free, Zero-Friction Action Providers:**
> All reminders and routines live **only in the app's own** calendar and reminder system (MongoDB + local notifications). For autonomous actions (finding contacts, generating meeting links, and sending invites), we provide **100% free options requiring NO company email and NO credit cards**:
> 1. **Meeting Link Generation (100% Free & Zero-Account):** **Jitsi Meet** (`https://meet.jit.si/<room-id>`) — Instant, open-source, encrypted HD video conference room with screen sharing. Requires **zero accounts, zero signups, zero credit cards, zero company emails**. (Google Meet API is supported as a secondary option with a standard personal `@gmail.com` account).
> 2. **Contact Lookup (100% Free & Zero-Account):** **Device Address Book (`expo-contacts`)** — queries local phone contacts where Alex's email already lives, or the in-app MongoDB **Contacts** collection. (Google People API is a secondary option with a personal `@gmail.com`).
> 3. **Sending Meeting Invites (100% Free):** **Native Mail Composer (`expo-mail-composer`)** — opens the user's default email client with Alex's email, subject, and meeting link prefilled (sends with 1 tap, zero server cost/setup). Alternatively, **Nodemailer via personal Gmail App Password** (free SMTP from any personal Google account). (Gmail API `gmail.send` is a secondary option).
> 4. **No Google Calendar Access:** The app never integrates or requires Google Calendar. All scheduling is internal.

### 2.1 Google account linking (prerequisite)
**Agent skills:** `expo-data-fetching` (OAuth sign-in flow + token exchange), `expo-router` (`/settings/connections` route), `expo-ui` (Connected Accounts screen).

- Add **Google OAuth sign-in / account linking** on top of the existing email/password auth:
  - Mobile: `expo-auth-session` + `expo-web-browser` Google provider flow (or `@react-native-google-signin/google-signin` on Android for better UX).
  - Backend: store Google tokens in a new `Integration` collection per user; refresh-token handling service.
  - Requested scopes: `gmail.send` (send meeting link emails), `contacts.readonly` or People API `contacts` (contact email lookup), `userinfo.email`. **No `calendar.*` scope** — no Google Calendar access is needed or requested.
  - New settings screen: **Connected Accounts** in the sidebar (`home-sidebar.tsx`) — connect/disconnect Google, show scopes granted.

### 2.2 New backend capabilities exposed to the LLM as tools
**Agent skills:** `openai-docs`, `ai-sdk` (tool-calling patterns for the new action tools). *(Google People / Meet / Gmail API calls: Google Cloud vendor docs — no agent skill.)*

Extend `backend/src/services/tools.ts` with action tools the parser can call (the LLM tool-loop already exists — this is additive):

| Tool | Behavior (with 100% Free Zero-Account Options) |
|---|---|
| `find_contact(name)` | Resolves a person name → email/phone via (a) **Device Address Book (`expo-contacts`)** [100% Free, zero account], (b) **In-App MongoDB Contacts collection** [100% Free], or (c) user's Google Contacts (People API, personal Gmail). Ambiguity → assistant asks aloud: *"Which Alex — alex@x.com or alex@y.com?"* |
| `create_meeting_link()` | **100% Free Primary: Jitsi Meet** (`https://meet.jit.si/RoutineApp-<slug>`) — Instant encrypted HD video room, zero sign-in, zero cost, no card/company email. **Secondary:** Google Meet REST API (`spaces.create`) via personal Google OAuth. |
| `send_email(to, subject, body)` | **100% Free Primary: Native Mail Composer (`expo-mail-composer`)** — opens prefilled email on device, 1-tap send. **Free Secondary: Nodemailer SMTP** using personal Gmail 16-char App Password. **Tertiary:** Gmail API `gmail.send`. |
| `create_reminder(...)` *(existing)* | Extended schema — see 2.3. The reminder (with its `meetLink`) is stored in the app's own reminder store only. |

### 2.3 Reminder schema extension
**Agent skills:** backend-only schema work — `openai-docs` + `ai-sdk` (keep tool arguments aligned with the extended schema); no Expo skill needed.

`backend/src/models/Reminder.ts` gains:

```ts
kind: "simple" | "meeting" | "call" | "custom"        // what the reminder is about
action: {                                              // optional attached action
  type: "meeting_link" | "email" | "call" | "none",
  status: "pending" | "done" | "failed",
  meetLink?: string,           // Google Meet link (generated via Meet API, stored on the app's reminder)
  attendees: [{ name, email, inviteSentAt }],
}
```

- **Flow for "Schedule a meeting with Alex at 5 PM":**
  1. Parser emits `create_reminder(kind: meeting, title: "Meeting with Alex", startAt 17:00)` + `find_contact("Alex")` + `create_meeting_link()` + `send_email(...)`.
  2. Backend orchestrates: resolve contact (email from Google) → generate Meet link (Meet API) → create the reminder **in the app's own reminder/calendar system** with `action.meetLink` → send Gmail invite with the link → reply to the user with a spoken confirmation summary.
  3. Failures degrade gracefully: no Google account → plain reminder; contact ambiguous → clarification prompt.
  4. Nothing is written to Google Calendar — the meeting exists only as an app reminder carrying a Meet link.

### 2.4 Contacts fallback (no Google account)
**Agent skills:** `expo-ui` (Contacts manager screen), `expo-router` (`/contacts` route), `expo-data-fetching` (contacts CRUD against the backend).

- Simple in-app **Contacts** manager (name + email/phone) stored per-user in Mongo; the `find_contact` tool checks it first. Optional: device address book read (`expo-contacts`) with explicit permission.

---

## 3. Feature: Smart Pre-Reminders (T-1h / T-15m style)

**User story:** *"My meeting is at 5 PM — nudge me at 4 PM and again 15 minutes before so I'm ready."*

**Agent skills (load in the agent chat before implementing):** `expo-overview` (load first), `vercel-react-native-skills` (local-reminders refactor), `openai-docs`, `ai-sdk` (prompt + tool changes), `expo-data-fetching` (server sync). *No dedicated agent skill exists for `expo-notifications` or node-cron — follow Expo Notifications docs + node-cron docs.*

> **100% Free Guarantee:** Multi-alert scheduling runs purely on-device via `expo-notifications` (exact Android alarms & iOS local alerts) with zero external service costs. The server-side dispatch runs on free `node-cron` inside the existing Node.js backend. Zero third-party scheduler subscriptions.

### 3.1 Lead-time model
**Agent skills:** `openai-docs`, `ai-sdk` (voice-settable defaults via prompt/tool design).

- Per-reminder **lead times** (array, e.g., `[60, 15]` minutes; also support absolute overrides like "remind me 30 minutes before").
- User-level **defaults** in preferences: e.g., simple reminders → no pre-alert; meetings → 60 + 15; calls → 15. Voice-settable: *"give me a heads-up 30 minutes before every meeting."*

### 3.2 Scheduling changes
**Agent skills:** `vercel-react-native-skills` (refactoring `local-reminders.ts` to N+1 schedules + AsyncStorage id-array map), `expo-data-fetching` (mobile ↔ server sync for the dispatch layer). *(Notifications + backend scheduler: Expo Notifications / node-cron docs — no agent skill.)*

- `mobile/src/notifications/local-reminders.ts`: schedule **N+1 local notifications** per reminder (main + each lead time), each with a distinct subtitle ("Heads-up: Meeting with Alex in 1 hour" / "Meeting with Alex — starts now").
- Extend the AsyncStorage notification-id map to track all ids per reminder so edit/delete cancels/reschedules the full set (current map holds one id — refactor to an array).
- **Reliability upgrade (recommended): server-side dispatch.**
  - Add a backend scheduler (node-cron or Mongo TTL + poller) that, at reminder time **and** lead times, pushes via the existing Expo Push path (`push.ts` → device tokens in `Device` collection).
  - Mobile app syncs scheduled reminders on launch/login; server pushes are the guaranteed layer when the app is killed/local schedule was lost. De-dup by notification id in `data`.
  - This turns "local-only alarms" into a hybrid local+server architecture — essential for an assistant app that must never miss.

### 3.3 Parser/prompt changes
**Agent skills:** `openai-docs`, `ai-sdk` (system-prompt changes + `update_reminder` tool extension).

- `openaiRoutine.ts` system prompt: extract pre-reminder intent ("remind me 15 min before", "don't remind me early") into the `leadTimes` field; new tool `update_reminder` handles changing lead times by voice.

---

## 4. Feature: Actionable, Deep-Linked Notifications

**User story:** *"At 4:55 PM my phone buzzes: 'Meeting with Alex — starts in 5 min.' I tap it and I'm in the Google Meet call. I never opened the app."*

**Agent skills (load in the agent chat before implementing):** `expo-overview` (load first), `expo-router` (deep-link routing), `expo-dev-client` (rich notification categories/actions need a dev build to test), `expo-data-fetching`, `expo-ui`, `vercel-react-native-skills`. *No dedicated agent skill exists for notification categories — follow Expo Notifications docs.*

> **100% Free Guarantee:** Action buttons ("Join Meeting", "Snooze", "Mark Done") use native `expo-notifications` categories (`setNotificationCategoryAsync`). Direct meeting launch uses React Native `Linking.openURL(meetLink)` — zero external SDKs, zero API cost, completely native.

### 4.1 Rich notification content
**Agent skills:** `expo-dev-client` (test on dev build), `vercel-react-native-skills` (payload/handler quality). *(Notification categories via `setNotificationCategoryAsync`: Expo Notifications docs — no agent skill.)*

- Main + pre-reminder notifications include:
  - Title: reminder title; body varies by lead time; category set by `kind` (meeting/call/simple).
  - `data`: `reminderId`, `kind`, `meetLink?`, `deepLink` (`routine-manager://reminder/<id>` — existing scheme), `joinUrl`.
- **Android**: notification **action buttons** — `Join meeting` (opens Meet URL directly), `Snooze 10 min`, `Mark done`. Implemented with `expo-notifications` category actions (`setNotificationCategoryAsync`).
- **iOS**: same actions via UNNotificationCategory; `Join meeting` opens the Meet URL.

### 4.2 Tap routing
**Agent skills:** `expo-router` (deep links + pre-meeting screen route), `expo-ui` (pre-meeting "Join now" screen), `expo-data-fetching` (screen data loading).

- Extend `mobile/src/notifications/use-notification-navigation.ts`:
  - `action === "join"` → `Linking.openURL(meetLink)` directly (app may not even come to foreground on Android if launched from the notification action).
  - Default tap with `meetLink` → a **pre-meeting screen** (`/reminder/[id]?action=join`) with a big "Join now" button + event details — one tap to meeting.
  - No meeting link → current behavior (detail screen).

### 4.3 Meeting-time smartness (optional phase 2)
**Agent skills:** backend-only — Google Meet API via Google Cloud vendor docs; no agent skill needed.

- Backend checks the Meet space's status (via Meet API) before the reminder fires and appends "Link is live" to the push payload.

---

## 5. Feature: Google Calendar-Style Calendar View

**Agent skills (load in the agent chat before implementing):** `expo-overview` (load first), `expo-ui`, `expo-router`, `expo-data-fetching`, `vercel-react-native-skills` (timeline scroll performance), `expo-animation`, `expo-native-ui`; `expo-design-system` (optional — kind/status color-coding with existing theme tokens).

> **100% Free Guarantee:** This is a **style/UX choice, not an integration** — the timeline hour-grid is built entirely with custom React Native UI components (`ScrollView`, positioned event blocks, red current-time indicator) rendering the app's own reminder data (MongoDB via existing `listReminders` API). No Google Calendar account, sync, or subscription is involved. 100% free.

Keep all current functionality (month grid, day agenda, month fetch via `monthRangeISO`, pull-to-refresh, status badges). Enhance the **day view** to behave like Google Calendar:

### 5.1 Day timeline (the big change)
**Agent skills:** `expo-ui` (event blocks, hour grid), `vercel-react-native-skills` (scroll/list performance of the timeline), `expo-animation` (red "now" line, block layout), `expo-data-fetching` (existing `listReminders` wiring).

- Replace the agenda `FlatList` with a **scrollable hour-grid timeline**: left gutter with hour labels (respecting `use24HourClock`), horizontal lines, and **positioned event blocks** proportional to duration (`startAt`–`endAt`; default 30-min block when no `endAt`).
- Current-time **red "now" line** with auto-scroll to it on open.
- Overlapping events render side-by-side columns (simple width-split algorithm).
- Event blocks: title, time range, kind icon (🎥 meeting, 📞 call, ⏰ simple), color-coded by kind/status; tap → reminder detail (unchanged).
- All-day / no-time reminders pinned to an **all-day strip** at the top.

### 5.2 Day navigation
**Agent skills:** `expo-router` (day navigation + month-picker affordance), `expo-animation` (swipe transitions), `vercel-react-native-skills`.

- Swipe left/right between days + a compact day-strip of 7 date chips above the timeline (Google-Calendar-style), keeping the existing month picker as the "go to date" affordance.
- Month view keeps `markedDates` dots but adds per-day count badges.

### 5.3 Optional polish
**Agent skills:** `expo-native-ui` (HIG-style polish), `expo-design-system` (optional — consistent empty-state styling), `expo-animation`.

- Week view toggle (3-day / week tabs) — same timeline component, parameterized.
- Empty state: "Nothing scheduled — say 'Hey Assistant'" with a tap-to-activate mic button.

---

## 6. Cross-Cutting: Data, API & Infrastructure Changes Summary

**Agent skills (whole section):** `expo-overview` (load first for any Expo work), `openai-docs` + `ai-sdk` (extended `/routines/parse` response & tool loop), `expo-dev-client` + `expo-upgrade` (new native modules/permissions require a dev build), `eas-update` (shipping the JS updates), `eas-app-stores` / `eas-workflows` (optional — new preview builds for P4). *Google People / Meet / Gmail services: Google Cloud vendor docs — no agent skill exists.*

### 6.1 Backend
- New route: `/assistant` (session state) and **WebSocket** `/routines/stream` for streaming STT.
- Extended `/routines/parse` response: includes created/updated reminder objects **with `kind`, `action`, `leadTimes`** + a natural-language confirmation sentence (for TTS).
- New services:
  - Meeting links: `jitsi.ts` (100% free instant Jitsi Meet link generation) + `meet.ts` (Google Meet REST API via OAuth).
  - Email sending: `mailer.ts` (100% free Nodemailer with personal Gmail App Password) + `gmail.ts` (Gmail API).
  - Contact lookup: `contacts.ts` (in-app MongoDB contacts) + `google-people.ts` (People API).
  - Scheduler: `scheduler.ts` (100% free `node-cron` server-side push dispatch).
  - **No Google Calendar service** — the app never reads from or writes to Google Calendar.
- New collections: `Integration` (Google tokens), `Contact` (fallback contacts), extended `Reminder` (kind/action/leadTimes), extended `AiSession` (tool-call audit already in place).
- New env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URIS` (optional if using Google account), `SMTP_USER`, `SMTP_PASS` (optional for free nodemailer; existing `OPENAI_*`, `MONGODB_URI`, `JWT_SECRET`, `EXPO_ACCESS_TOKEN` unchanged).

### 6.2 Mobile
- New packages: `expo-speech-recognition` (100% free on-device wake-word & streaming STT), `expo-speech` (100% free native TTS), `expo-contacts` (100% free native address book), `expo-mail-composer` (100% free native email intent), `expo-auth-session` (optional for Google linking).
- New screens/components: `AssistantOverlay`, `/settings/assistant` (wake word, lead-time defaults), `/settings/connections` (Google), `/contacts`, pre-meeting join screen, timeline day view component.
- New permissions & config: Android `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE`, background audio mode (iOS), `SCHEDULE_EXACT_ALARM` (already present), notification categories.

### 6.3 Voice-to-edit (already exists, confirm parity)
- "Move my meeting with Alex to 6 PM", "delete the gym reminder" — already works through the tool loop; assistant mode just makes it voice-in/voice-out with TTS confirmation.

---

## 7. Delivery Phases (suggested order)

| Phase | Scope | Why this order |
|---|---|---|
| **P1 — Foundation** | Reminder schema extension (`kind`, `action`, `leadTimes`) + pre-reminder scheduling + notification categories/actions + deep-link-to-meeting groundwork + server-side dispatch scheduler | No new external accounts needed; immediately makes reminders feel proactive |
| **P2 — Calendar UX** | Google Calendar-style day timeline + day navigation + all-day strip | Pure front-end, independent of P3/P4 |
| **P3 — Google-powered meeting actions** | OAuth linking (Gmail send + People/Contacts scopes only), Meet link generation, Gmail invites, action tools in the LLM tool loop | The "autonomous actions" core; needs Google Cloud project setup; no Google Calendar involvement |
| **P4 — Hands-free assistant** | Wake word, streaming STT session, TTS confirmation loop, assistant overlay, background service | Most complex/risky (permissions, battery, platform quirks); ships last but transforms the app |

**Agent skills by phase (load `expo-overview` first in every feature chat):**
P1 → `vercel-react-native-skills`, `openai-docs`, `ai-sdk`, `expo-data-fetching`, `expo-router`, `expo-dev-client`
P2 → `expo-ui`, `expo-router`, `expo-data-fetching`, `vercel-react-native-skills`, `expo-animation`, `expo-native-ui` (+ `expo-design-system` optional)
P3 → `openai-docs`, `ai-sdk`, `expo-data-fetching`, `expo-router`, `expo-ui`
P4 → `expo-dev-client`, `vercel-react-native-skills`, `openai-docs`, `expo-data-fetching`, `expo-router`, `expo-animation`, `expo-native-ui`
All of these are already installed in this repo — verify with `npx skills list`.

---

## 8. Risks & Considerations

- **iOS always-on mic is restricted** — background wake-word listening is limited on iOS; Android is the primary platform for full "Hey Assistant" behavior (foreground service). Communicate this in-app.
- **Battery** — continuous listening must use native on-device speech recognizer/VAD with a visible indicator and easy toggle-off.
- **Security** — Google refresh tokens in Mongo must be encrypted at rest (AES with a server key); least-privilege scopes; clear disconnect UI.
- **Notification reliability** — Android exact alarms + Doze, iOS provisional authorization; the server-push layer (P1) is the safety net.
- **Cost** — streaming Whisper + GPT calls per utterance; keep the session context window lean (existing upcoming-reminders injection already sized for this).
- **Privacy** — clear disclosure that a persistent mic listener exists; one-tap disable; indicator when active.
