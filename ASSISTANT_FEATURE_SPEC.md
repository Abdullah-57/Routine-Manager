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

---

## 9. Modern Siri-Grade UI Overhaul & True Background Assistant Specifications
*(Identical specification across `ASSISTANT_FEATURE_SPEC.md` and `IMPLEMENTATION_PLAN.md`)*

### Strict Non-Regression & Additive Architecture Invariant

> **CRITICAL ARCHITECTURAL RULE — ZERO CONFLICT WITH EXISTING IMPLEMENTATIONS:**  
> These two major modifications (Modern UI Overhaul and Background Siri-Like Assistant) are **strictly additive**. They build directly on top of the existing, working foundation and **must never break, replace, alter, or regress any currently functional feature**:
> 
> 1. **Existing User Input Methods Preserved 100%:**  
>    - The typed routine composer (`AiPlanComposer`) remains fully functional and accessible on the Home screen.
>    - The push-to-talk recording sheet (`VoiceRecordSheet`) remains fully functional with Whisper upload.
>    - The in-app voice assistant overlay (`AssistantOverlay`) continues to support tap-to-talk, multi-turn follow-ups, and spoken TTS feedback.
> 
> 2. **Existing Calendar & Timeline Retained 100%:**  
>    - The custom 24-hour Day Timeline (`DayTimeline`), 7-day compact bar (`DayStrip`), Month view (`MonthCalendar`), and 3-Day / Week view modes are completely preserved without alteration.
> 
> 3. **Existing Backend, Scheduling & Integrations Untouched:**  
>    - All backend routes (`/routines/parse`, `/routines/transcribe`, `/reminders`, auth endpoints) and MongoDB schemas remain unchanged.
>    - Local push notification scheduling (`local-reminders.ts`), exact alarms (`SCHEDULE_EXACT_ALARM`), pre-meeting Jitsi link generation, and remote push token registration continue to work seamlessly.
> 
> 4. **How the New Modifications Layer Additively:**  
>    - **UI Overhaul (Group A):** Modernizes visual presentation by upgrading the visual styling of existing components (`VoiceOrb`, `FloatingAssistantBubble`, card containers) and adding a daily routine completion ring using data already returned by `listReminders`. No existing controls, developer tools, or manual lists are deleted.
>    - **Background System Assistant (Group B):** Acts purely as an external hands-free system trigger. When "Hey Assistant" is detected in the background or via hardware gesture / Siri Shortcut, it simply opens the *existing* `AssistantOverlay` session. It does not replace the voice pipeline or tool loop.

### Architectural Overview & Zero-Cost Guarantee

> **100% Free & Zero-Credentials Guarantee:**  
> All integrations specified below utilize **100% free, open-source, and on-device native platform APIs**.  
> - **Zero** cloud API costs or ongoing subscriptions.
> - **Zero** personal information, company email domains, credit cards, or account registrations required.
> - **Zero** proprietary closed SDKs (e.g., no paid Porcupine console keys or cloud STT billing).
> - All background listening, voice recognition, system overlays, and visual effects execute directly on the device using native Android (`android.speech`, `android.app.Service`, `WindowManager`) and iOS (Siri Shortcuts, App Intents, native speech) capabilities.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               UNIFIED SYSTEM ARCHITECTURE: UI + TRUE SYSTEM ASSISTANT                  │
└────────────────────────────────────────────────────────────────────────────────────────┘

 [ USER ANYWHERE ON PHONE ]
         │
         ├── Spoken "Hey Assistant" (Android Background / Screen Off / In Other App)
         │       │
         │       ▼
         │   ┌──────────────────────────────────────────────────────────────┐
         │   │ Native Android Foreground Service (FOREGROUND_SERVICE_MIC)   │
         │   │ - Persistent Low-Key Notification                            │
         │   │ - On-Device Android SpeechRecognizer Continuous Engine       │
         │   │ - 100% Free, Zero-Network, Zero-Credentials VAD             │
         │   └──────────────────────────────┬───────────────────────────────┘
         │                                  │
         │                                  ▼
         │   ┌──────────────────────────────────────────────────────────────┐
         │   │ System Overlay Launcher / Assist Role (SYSTEM_ALERT_WINDOW) │
         │   │ - Floating Glowing Siri Orb draws OVER any active app        │
         │   │ - Audio chime + haptic feedback                              │
         │   └──────────────────────────────┬───────────────────────────────┘
         │                                  │
         ├── Hardware Trigger: Long-press Power button / Swipe up (Android Assist Role)
         │                                  │
         ├── Spoken "Hey Siri, Routine Assistant" (iOS Siri Shortcuts Gateway)
         │                                  │
         ▼                                  ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │                      MODERN SIRI-GRADE VISUAL INTERFACE                             │
 │                                                                                      │
 │  ┌────────────────────────────────────────────────────────────────────────────────┐  │
 │  │ 1. Floating Glowing Assistant Orb & Real-Time Fluid Audio Waveform             │  │
 │  │    - Multi-ring animated gradients (Reanimated 4) reactive to voice volume     │  │
 │  │    - State-driven pulsing: Idle -> Listening -> Thinking -> Answering          │  │
 │  │    - Dynamic Island style expandable pill & bottom sheet                      │  │
 │  └────────────────────────────────────────────────────────────────────────────────┘  │
 │                                                                                      │
 │  ┌────────────────────────────────────────────────────────────────────────────────┐  │
 │  │ 2. Glassmorphic Dashboard & Live Routine Progress Rings                        │  │
 │  │    - Contextual time greeting + daily completion ring ("4/6 completed")        │  │
 │  │    - Next upcoming activity hero card with frosted glass & action pills        │  │
 │  └────────────────────────────────────────────────────────────────────────────────┘  │
 │                                                                                      │
 │  ┌────────────────────────────────────────────────────────────────────────────────┐  │
 │  │ 3. Siri-Style Smart Assistant Feedback Sheet & Entity Chips                   │  │
 │  │    - Live interim transcription pill with typewriter animation                 │  │
 │  │    - Smart chips: [Time: 3 PM] [Title: Team Sync] [Meet: Jitsi Link]           │  │
 │  │    - Natural TTS voice confirmation + one-tap undo pill                       │  │
 │  └────────────────────────────────────────────────────────────────────────────────┘  │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

---

### AI Agent Skills Setup & Verification

The following project-specific AI agent skills are designated for implementing these atomic features. All skills are maintained directly within `.agents/skills/` at the project level:

| Agent Skill | Purpose in these Features | Location |
| :--- | :--- | :--- |
| `expo-overview` | Entry point & routing for all Expo/React Native tasks | `.agents/skills/expo-overview` |
| `expo-animation` | Building fluid spring animations, audio waveforms, gesture sheets, and orb pulsing with Reanimated | `.agents/skills/expo-animation` |
| `expo-native-ui` | Apple HIG / Material 3 native styling, semantic tokens, and system controls | `.agents/skills/expo-native-ui` |
| `expo-design-system`| Building reusable theme tokens, glassmorphic cards, typography hierarchy, and spacing | `.agents/skills/expo-design-system` |
| `expo-ui` | Universal native sheets, buttons, pickers, and grouped rows | `.agents/skills/expo-ui` |
| `expo-dev-client` | Compiling and configuring native Android/iOS code, permissions, and native foreground services | `.agents/skills/expo-dev-client` |
| `expo-module` | Authoring custom Kotlin/Swift native modules for Android foreground services and system overlays | `.agents/skills/expo-module` |
| `vercel-react-native-skills` | Best practices for performant rendering, 60fps animations, and background battery management | `.agents/skills/vercel-react-native-skills` |
| `expo-router` | Deep-linking schemes (`routine-manager://assistant`) and modal routes | `.agents/skills/expo-router` |
| `expo-data-fetching`| Handling offline caching, state synchronization, and background payload dispatch | `.agents/skills/expo-data-fetching` |

> **Skill Setup Command:**  
> If an agent skill is ever missing from the project-level directory, it can be installed immediately into `.agents/skills/` using the command:  
> ```bash
> npx skills add <skill-name> -o .agents/skills
> ```  
> Example: `npx skills add expo-module -o .agents/skills` or `npx skills add expo-animation -o .agents/skills`.

---

## Group A: Modern Siri-Grade UI & Visual System (Atomic Features)

### Feature 10.1: Floating Glowing Assistant Orb & Fluid Audio Waveform
**Goal:** Replace standard static buttons with an organic, multi-layered glowing assistant orb and fluid audio visualizer that dynamically pulses in response to user voice volume and assistant state.

- **Required Agent Skills:** `expo-overview`, `expo-animation`, `expo-native-ui`, `expo-design-system`, `vercel-react-native-skills`.
- **100% Free & Zero Credentials Guarantee:** Pure mathematical animations using `react-native-reanimated` worklets and native React Native vector primitives. No external visualizer SDKs or paid asset libraries.
- **Detailed Step-by-Step Implementation Instructions:**
  1. Create `mobile/src/components/assistant-orb.tsx`:
     - Implement multi-layered concentric circles with varying blur, opacity, and scale (`scale1`, `scale2`, `scale3`) driven by shared values in `react-native-reanimated`.
     - State machine drives color palettes:
       - *Idle*: Calm cyan-blue gradient with gentle breathing cycle (3000ms loop, scale 1.0 -> 1.05).
       - *Listening*: Vibrant purple-magenta-blue gradient that pulses dynamically in real-time to speech audio metering decibels (`metering` prop from `expo-speech-recognition`, mapped via `interpolate(metering, [-60, 0], [1.0, 1.45])`).
       - *Thinking/Processing*: Fast swirling dual-ring rotating continuous loop (`withRepeat(withTiming(360, { duration: 1200 }), -1)`).
       - *Speaking/Answering*: Rhythmic acoustic expansion synchronized with `expo-speech` playback intervals.
     - Add subtle particle / shimmer effects using radial gradient rings.
  2. Create `mobile/src/components/audio-waveform-bars.tsx`:
     - Render 5–7 vertical animated pill bars with varying phase delays (`delay = index * 80ms`).
     - Each bar height springs between 4px and 36px based on live microphone decibels.
  3. Integrate into `mobile/src/screens/home/index.tsx` and `mobile/src/components/assistant-overlay.tsx`:
     - Position the Assistant Orb centrally at the bottom of the Home screen as a floating action trigger.
     - On tap, trigger `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)` and expand smoothly into the full assistant sheet.
- **Acceptance Criteria & Test Steps:**
  1. Open the app to the Home screen.
  2. Verify the Assistant Orb is visible at the bottom with a smooth, breathing glow animation.
  3. Tap the orb: verify medium haptic feedback fires, and the orb smoothly expands into the listening state.
  4. Speak into the microphone: verify the orb rings and waveform bars expand and contract in direct response to your voice volume.
  5. Stop speaking: verify the orb switches to the thinking rotation spinner, then to answering mode when TTS plays.

---

### Feature 10.2: Modern Glassmorphic Dashboard & Live Routine Progress Rings
**Goal:** Transform the Home screen into a clean, modern Apple HIG / Material 3 dashboard featuring frosted-glass aesthetic cards, a contextual time greeting, and an interactive circular progress tracker for the day's routine.

- **Required Agent Skills:** `expo-overview`, `expo-design-system`, `expo-native-ui`, `expo-animation`, `vercel-react-native-skills`.
- **100% Free & Zero Credentials Guarantee:** 100% local React Native StyleSheet, linear gradients, and Reanimated SVG/layout tokens.
- **Detailed Step-by-Step Implementation Instructions:**
  1. Create `mobile/src/components/glass-card.tsx`:
     - Reusable container component with frosted glass aesthetic: translucent background (`rgba(255, 255, 255, 0.75)` on light mode, `rgba(30, 41, 59, 0.70)` on dark mode), 1px subtle light border (`rgba(255, 255, 255, 0.4)` / `rgba(255, 255, 255, 0.1)`), rounded corners (`borderRadius: 24`), and soft ambient shadow (`shadowOpacity: 0.08`, `shadowRadius: 16`).
  2. Create `mobile/src/components/daily-progress-ring.tsx`:
     - Circular progress meter using SVG or animated borders that calculates `completedCount / totalCount` for today's reminders/habits.
     - Displays completion percentage or fraction (e.g. "4 of 6 completed") in the center with smooth animated spring fill.
     - Subtext dynamically motivates: "On track", "All clear for today!", or "2 upcoming".
  3. Update `mobile/src/screens/home/index.tsx`:
     - **Header Section**: Contextual greeting based on device hour (`5..11 -> Good morning`, `12..16 -> Good afternoon`, `17..23 -> Good evening`) with the user's name and current date badge.
     - **Hero Progress Section**: Embed the `DailyProgressRing` inside a prominent `GlassCard` alongside quick status badges.
     - **Upcoming Focus Card**: Display the immediate next scheduled event with a color-coded vertical pill tag (`#2563EB` reminder, `#10B981` habit, `#8B5CF6` meeting), countdown timer (e.g., "In 25 minutes"), and direct quick-action buttons ("Mark Done", "Join Jitsi Meet").
- **Acceptance Criteria & Test Steps:**
  1. Launch the app in morning/afternoon hours and verify the greeting text dynamically reflects the time of day.
  2. Verify the `GlassCard` renders with subtle borders and shadows.
  3. Mark one routine as done: verify the `DailyProgressRing` smoothly animates its progress stroke forward and updates the count.
  4. Verify the "Next Up" hero card displays the upcoming task with the correct category color pill and relative time.

---

### Feature 10.3: Siri-Style Smart Assistant Feedback Sheet & Interactive Entity Chips
**Goal:** Deliver a modern voice assistant overlay that presents live speech recognition transcription, animated tool-calling status badges, and interactive entity chips (Time, Title, Meeting Link, Pre-alert) before confirming routine creation.

- **Required Agent Skills:** `expo-overview`, `expo-animation`, `expo-native-ui`, `expo-ui`, `vercel-react-native-skills`.
- **100% Free & Zero Credentials Guarantee:** 100% on-device React Native UI, native speech events, and local LLM tool response parsing.
- **Detailed Step-by-Step Implementation Instructions:**
  1. Update `mobile/src/components/assistant-overlay.tsx`:
     - Structure as a floating bottom sheet using `react-native-gesture-handler` with swipe-down-to-dismiss gesture and spring physics.
     - Display the `AssistantOrb` at the top of the sheet header in compact listening mode.
     - Add **Live Transcription Pill**: As `expo-speech-recognition` returns interim text, display words with dynamic opacity and typing effect so the user sees their words materialize in real-time.
  2. Create `mobile/src/components/entity-chips-preview.tsx`:
     - When the AI tool loop returns parsed reminders, render interactive visual pill chips for every parsed property before committing:
       - 🕒 `Time: 10:30 AM` (tappable to adjust time picker if needed).
       - 📝 `Title: Design Review with Team`.
       - 🔗 `Meeting: Jitsi Link Generated` (tappable to preview or copy).
       - 🔔 `Pre-alert: 15m & 1h prior`.
       - 👤 `Contact: Alex (alex@example.com)`.
  3. Action Confirmation Bar:
     - Render a sleek dual-button bar:
       - Confirm (filled gradient button with checkmark icon).
       - Undo / Edit (subtle frosted pill button).
     - Auto-dismiss countdown timer (5 seconds) with a subtle animated progress line, allowing hands-free auto-commit unless canceled.
- **Acceptance Criteria & Test Steps:**
  1. Open the voice assistant and speak: *"Schedule a team sync tomorrow at 3 PM with a Jitsi meeting link"*.
  2. Verify the live transcription displays interim words cleanly as you speak.
  3. Verify the parsed results populate as distinct interactive entity chips (`[Time: 3:00 PM]`, `[Title: Team sync]`, `[Meeting: Jitsi Link]`).
  4. Verify the TTS voice confirms aloud while the auto-commit progress timer smoothly fills.
  5. Tap "Undo" before the timer expires: verify the reminder creation is canceled with haptic feedback.

---

### Feature 10.4: Cohesive Global Theme, Fluid Micro-Interactions & Elevation Tokens
**Goal:** Establish an unified visual token architecture across typography, elevation, dark/light contrast, and fluid micro-interactions across all screens (Home, Calendar, History, Settings).

- **Required Agent Skills:** `expo-overview`, `expo-design-system`, `expo-native-ui`, `vercel-react-native-skills`.
- **100% Free & Zero Credentials Guarantee:** Pure TypeScript design token constants and React Native theme hooks.
- **Detailed Step-by-Step Implementation Instructions:**
  1. Create `mobile/src/theme/tokens.ts`:
     - Define typography scales: `display` (34px, bold), `title` (24px, bold), `headline` (18px, semibold), `body` (15px, regular), `caption` (12px, medium).
     - Define semantic color palettes:
       - Surface: frosted glass tints, pure card surfaces, backdrop blurs.
       - Routine categories: `task` (Deep Blue `#2563EB`), `habit` (Emerald `#10B981`), `meeting` (Violet `#8B5CF6`), `health` (Rose `#F43F5E`).
       - Accent gradients: Siri Aurora (`#00F2FE` -> `#4FACFE`), Sunset Flame (`#FA709A` -> `#FEE140`).
     - Define elevation and border-radius tokens (`sm: 8`, `md: 14`, `lg: 20`, `xl: 28`, `full: 9999`).
  2. Add micro-interaction hooks:
     - Button press scaling using `useAnimatedStyle` (`scale: withSpring(pressed ? 0.96 : 1.0)`).
     - Seamless theme toggle support (light/dark mode) that smoothly updates all navigation bars, cards, and text contrast without flicker.
  3. Polish `CalendarScreen` and `DayTimeline`:
     - Apply unified tokens to hour grid labels, "Now" red line pill, and event card elevation borders.
- **Acceptance Criteria & Test Steps:**
  1. Switch system appearance between Light and Dark mode.
  2. Verify all text remains sharp with high contrast ratios (>4.5:1).
  3. Tap buttons, cards, and tabs: verify slight elastic spring down-press feedback (scale 0.96) accompanied by subtle haptics.
  4. Verify the visual styling between Calendar, Home, and Assistant Overlay feels 100% coherent and modern.

---

## Group B: True Siri-Like Hands-Free System Assistant (Background & Closed App)

### Feature 11.1: Native Android Foreground Service & Continuous Wake-Word Engine
**Goal:** Enable continuous, zero-cost, hands-free "Hey Assistant" wake-word listening on Android even when the app is minimized, in the background, or when the phone screen is off/locked.

- **Required Agent Skills:** `expo-overview`, `expo-dev-client`, `expo-module`, `vercel-react-native-skills`.
- **100% Free & Zero Credentials Guarantee:** Built 100% on native Android OS platform APIs (`android.app.Service`, `android.speech.SpeechRecognizer`, `android.app.NotificationChannel`). Requires **zero** accounts, **zero** API keys, **zero** cloud billing, and uses offline on-device speech processing.
- **Detailed Step-by-Step Implementation Instructions:**
  1. Create Native Android Service in `mobile/android/app/src/main/java/com/routinemanager/app/AssistantForegroundService.kt`:
     - Inherit from `android.app.Service`.
     - In `onCreate()`, register a persistent notification channel with `IMPORTANCE_LOW` (non-intrusive, silent status bar presence).
     - Build persistent notification:
       - Title: *"Routine Assistant Active"*.
       - Text: *"Listening hands-free for 'Hey Assistant'..."*.
       - Small icon: notification icon.
       - Action buttons: "Pause Listening", "Open Assistant".
     - Call `startForeground(SERVICE_ID, notification, FOREGROUND_SERVICE_TYPE_MICROPHONE)`.
  2. On-Device Keyword Spotting Loop (`ContinuousSpeechRecognizer`):
     - Instantiate Android's built-in offline `SpeechRecognizer.createSpeechRecognizer(context)`.
     - Configure `Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)`:
       - `EXTRA_LANGUAGE_MODEL = LANGUAGE_MODEL_FREE_FORM`.
       - `EXTRA_PARTIAL_RESULTS = true`.
       - `EXTRA_PREFER_OFFLINE = true` (ensures 100% offline, zero network traffic).
     - In `onPartialResults(Bundle)`:
       - Extract partial text string list.
       - Match against wake phrases: `"hey assistant"`, `"ok assistant"`, `"assistant"`.
       - Upon match: trigger `onWakeWordDetected()` event!
     - In `onEndOfSpeech()` / `onError(int)`:
       - Automatically restart the recognizer loop with a 200ms debounce to maintain continuous listening without memory leaks.
  3. Battery Conservation & Voice Activity Detection (VAD):
     - Check RMS audio level in `onRmsChanged(float rmsdB)`. If ambient noise is below threshold for >30 seconds, drop recognition duty cycle to save battery.
  4. Expose React Native bridge module `AssistantBackgroundModule`:
     - Methods: `startBackgroundListener()`, `stopBackgroundListener()`, `isListening()`.
     - Event emitter: `onWakeWordTriggered`.
  5. Update `mobile/app.json`:
     - Ensure permissions are active:
       - `"android.permission.FOREGROUND_SERVICE"`
       - `"android.permission.FOREGROUND_SERVICE_MICROPHONE"`
       - `"android.permission.RECORD_AUDIO"`
       - `"android.permission.POST_NOTIFICATIONS"`
       - `"android.permission.RECEIVE_BOOT_COMPLETED"`
- **Acceptance Criteria & Test Steps:**
  1. Build and install Android dev client (`npx expo run:android`).
  2. Enable "Background Assistant" in app settings.
  3. Minimize the app or press the Home button to return to the Android home screen.
  4. Verify the persistent notification appears in the notification drawer: *"Routine Assistant Active - Listening hands-free for 'Hey Assistant'"*.
  5. While on the home screen or inside another app (e.g. Chrome), clearly speak: *"Hey Assistant"*.
  6. Verify the wake word is detected immediately, indicated by device haptic vibration and chime.

---

### Feature 11.2: System-Wide Overlay Launcher & Background Activity Wake-Up
**Goal:** When the wake word triggers from the background service, immediately display a floating Siri-style overlay over the active app (or launch the assistant into the foreground) so the user can speak commands without touching the phone.

- **Required Agent Skills:** `expo-overview`, `expo-dev-client`, `expo-module`, `vercel-react-native-skills`, `expo-router`.
- **100% Free & Zero Credentials Guarantee:** Built on standard Android `WindowManager` (`TYPE_APPLICATION_OVERLAY`) and high-priority Full-Screen PendingIntents. 100% free native OS capability.
- **Detailed Step-by-Step Implementation Instructions:**
  1. Configure `SYSTEM_ALERT_WINDOW` permission:
     - In `mobile/android/app/src/main/AndroidManifest.xml`:
       ```xml
       <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
       ```
     - Provide a helper in Settings: `checkOverlayPermission()` and `requestOverlayPermission()` that directs the user to Android's "Display over other apps" toggle.
  2. Create System Overlay View `AssistantFloatingView.kt`:
     - Using Android `WindowManager`:
       - Layout params: `TYPE_APPLICATION_OVERLAY`, `FLAG_NOT_TOUCH_MODAL | FLAG_LAYOUT_IN_SCREEN`, `PixelFormat.TRANSLUCENT`.
       - Gravity: `Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL`.
     - Inflate a sleek floating pill / glowing orb view directly onto the window manager over any running third-party app.
     - Displays live pulsing animation and recognized speech text.
  3. Fallback High-Priority Heads-Up Notification (if overlay permission not yet granted):
     - Fire a high-priority heads-up notification with a full-screen PendingIntent that immediately brings `MainActivity` to the foreground with route `/assistant?trigger=wake_word`.
  4. Audio Chime & Seamless Dictation Handoff:
     - Play a crisp native chime sound (`assistant_wake.wav` from Android `SoundPool`).
     - Fire medium haptic pulse.
     - Transition the audio stream directly to the existing speech parsing loop (`POST /routines/parse`) so the user can speak their routine seamlessly: *"Hey Assistant, remind me to pick up groceries at 6 PM"*.
- **Acceptance Criteria & Test Steps:**
  1. Grant "Display over other apps" permission in Android settings when prompted.
  2. Open any external app (such as YouTube or Settings) or stay on the home screen.
  3. Say *"Hey Assistant"*.
  4. Verify the floating assistant overlay appears smoothly at the bottom of the screen over the external app.
  5. Speak: *"Schedule a meeting with Sarah tomorrow at 10 AM"*.
  6. Verify the audio is captured, processed, confirmed by voice TTS, and the floating overlay dismisses smoothly.

---

### Feature 11.3: Android Default Digital Assistant Role (`AssistIntent`)
**Goal:** Register Routine Manager as a system-recognized Digital Assistant App on Android, enabling instant activation via hardware gestures (long-pressing the phone's Power button, long-pressing the Home pill, or swiping from the bottom screen corner).

- **Required Agent Skills:** `expo-overview`, `expo-dev-client`, `expo-module`, `vercel-react-native-skills`.
- **100% Free & Zero Credentials Guarantee:** Standard Android OS framework intent filter (`android.intent.action.ASSIST`). 100% free, zero external services.
- **Detailed Step-by-Step Implementation Instructions:**
  1. Add Assist Intent Filter to `AndroidManifest.xml` via Expo config plugin:
     ```xml
     <activity
         android:name=".MainActivity"
         android:exported="true"
         android:launchMode="singleTask">
         <intent-filter>
             <action android:name="android.intent.action.ASSIST" />
             <category android:name="android.intent.category.DEFAULT" />
         </intent-filter>
     </activity>
     ```
  2. Create Deep Link & Intent Handler in `mobile/src/hooks/use-system-assistant-intent.ts`:
     - Detect when app is launched via `android.intent.action.ASSIST` or deep-link `routine-manager://assistant?source=hardware_gesture`.
     - Automatically open the `AssistantOverlay` in active listening mode with instant haptic feedback.
  3. Create User Setup Guide in `mobile/src/screens/settings/assistant.tsx`:
     - Add a one-tap settings shortcut button: *"Set as Default Assistant"*.
     - Opens Android Settings: `startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS))`.
     - Displays visual instructions showing how to select "Routine Manager" as the device default assistant.
- **Acceptance Criteria & Test Steps:**
  1. Navigate to Settings -> Assistant in the app.
  2. Tap *"Set as Default Assistant"* and select "Routine Manager" in the Android system settings.
  3. Exit the app entirely.
  4. Long-press the phone's physical Power button (or swipe diagonally from the bottom corner on gesture navigation).
  5. Verify Routine Manager Assistant opens instantly in listening mode, ready to receive commands.

---

### Feature 11.4: iOS Siri Shortcuts & App Intents Gateway
**Goal:** Provide full Apple-compliant hands-free voice trigger capabilities for iOS devices via Siri Shortcuts and App Intents without violating Apple's background sandbox or App Store guidelines.

- **Required Agent Skills:** `expo-overview`, `expo-router`, `expo-dev-client`, `vercel-react-native-skills`.
- **100% Free & Zero Credentials Guarantee:** 100% native iOS Siri Shortcuts framework and custom URL scheme handling. No paid Apple developer services required for local development.
- **Detailed Step-by-Step Implementation Instructions:**
  1. Configure iOS URL Scheme and Info.plist in `mobile/app.json`:
     - Scheme: `"routine-manager"`.
     - Register `NSUserActivityTypes`: `["com.routinemanager.app.assistant"]`.
  2. Deep Link Route `mobile/app/assistant.tsx`:
     - Handle incoming deep links: `routine-manager://assistant?listen=true`.
     - When received, app immediately opens into full-screen Assistant overlay with microphone active and chime played.
  3. Siri Shortcuts Integration & Donation:
     - Create `mobile/src/services/siri-shortcuts.ts`:
       - Donate user shortcut: *"Routine Assistant"* and *"Schedule Routine"*.
       - Allows the user to say to Apple Siri: *"Hey Siri, Routine Assistant"* or *"Hey Siri, schedule routine"*.
     - Siri immediately executes the shortcut and opens Routine Manager directly into active voice listening mode.
  4. Action Button & Control Center Support:
     - Document and support assigning the iPhone 15 Pro / 16 Action Button or iOS 18 Control Center Quick Tile to trigger the shortcut with one press.
- **Acceptance Criteria & Test Steps:**
  1. Launch the app on an iOS device / simulator.
  2. Tap "Add to Siri" in Assistant Settings.
  3. Lock the phone or go to the iOS Home screen.
  4. Say: *"Hey Siri, Routine Assistant"*.
  5. Verify Apple Siri hands off execution, opening Routine Manager directly in voice listening mode with the Assistant Orb glowing.
  6. Speak your routine and verify it parses and schedules automatically.

---

## Master Checklist: Feature Sequence & Verification

| Code | Feature Title | Group | Status |
| :--- | :--- | :--- | :--- |
| **10.1** | Floating Glowing Assistant Orb & Fluid Audio Waveform | UI Overhaul | Ready to implement |
| **10.2** | Modern Glassmorphic Dashboard & Live Routine Progress Rings | UI Overhaul | Ready to implement |
| **10.3** | Siri-Style Smart Assistant Feedback Sheet & Entity Chips | UI Overhaul | Ready to implement |
| **10.4** | Cohesive Global Theme, Fluid Micro-Interactions & Elevation Tokens | UI Overhaul | Ready to implement |
| **11.1** | Native Android Foreground Service & Continuous Wake-Word Engine | True Assistant | Ready to implement |
| **11.2** | System-Wide Overlay Launcher & Background Activity Wake-Up | True Assistant | Ready to implement |
| **11.3** | Android Default Digital Assistant Role (`AssistIntent`) | True Assistant | Ready to implement |
| **11.4** | iOS Siri Shortcuts & App Intents Gateway | True Assistant | Ready to implement |
