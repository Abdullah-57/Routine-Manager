# Routine Manager App — Complete Implementation Plan

> **Purpose of this document:** This is the single source of truth for building the Routine Manager mobile app (Expo React Native + Node.js + MongoDB + OpenAI). Every atomic feature is specified so an agent (or you) can implement it end-to-end without further elaboration.
>
> **Hard gate rule:** Do **not** start Feature N+1 until Feature N is implemented **and** verified working as described in that feature’s “Test through UI / acceptance” section. If something fails, fix it before moving on.
>
> **Out of scope for now:** App Store / Play Store publishing, Apple Developer account enrollment, and TestFlight submission. Those are deferred until after the app works via Expo Go / development builds / EAS Update.

---

## Table of contents

1. [Project overview & teaching notes](#1-project-overview--teaching-notes)
2. [User stories (system requirements)](#2-user-stories-system-requirements)
3. [Recommended stack & why](#3-recommended-stack--why)
4. [Architecture diagram](#4-architecture-diagram)
5. [MongoDB schemas](#5-mongodb-schemas)
6. [OpenAI tool-calling design](#6-openai-tool-calling-design)
7. [GitHub repository setup](#7-github-repository-setup)
8. [Cursor agent skills setup](#8-cursor-agent-skills-setup)
9. [Environment & accounts checklist](#9-environment--accounts-checklist)
10. [Monorepo project structure](#10-monorepo-project-structure)
11. [Phased implementation (atomic features)](#11-phased-implementation-atomic-features)
12. [Testing & preview deployment strategy](#12-testing--preview-deployment-strategy)
13. [Friday deadline reality check](#13-friday-deadline-reality-check)
14. [Glossary for first-time mobile developers](#14-glossary-for-first-time-mobile-developers)

---

## 1. Project overview & teaching notes

### What you are building

A mobile app where, in the morning, you describe your day’s routine (by **typing** or **speaking**). The app:

1. Converts speech → text (when speaking).
2. Sends the text to your backend.
3. The backend calls OpenAI with **tools** (function calling) so the model can create / update / delete reminders.
4. Reminders appear on a **custom in-app calendar**.
5. You receive **push / scheduled notifications** on the phone when each routine item is due.

### How mobile development differs from web (important)

| Web concept | Mobile equivalent |
|---|---|
| Next.js / React Router | **Expo Router** (file-based routes in `app/`) |
| Vercel preview deploy | **EAS Update** (OTA JS bundle) + **EAS Build** (native binary) |
| Browser DevTools | Expo Dev Tools + React Native DevTools |
| `localhost` in browser | Phone/emulator must reach your PC via LAN IP or a tunnel (ngrok / Expo tunnel) |
| CSS | StyleSheet / NativeWind (optional). No DOM. |
| Deploy once, everyone gets it | Two layers: **native binary** (rebuild when native modules change) + **JS update** (EAS Update can ship JS-only changes fast) |

### Expo Go vs Development Build vs Production (critical)

- **Expo Go:** Prebuilt app from the store. Fastest way to see UI. Great for early screens, calendar, text flow.
- **Limitation:** Recent Expo SDKs removed/restricted **remote push** in Expo Go (especially Android). Native modules like `expo-speech-recognition` **do not work** in Expo Go.
- **Development build (`expo-dev-client`):** Your own custom Expo Go that includes the native modules you need (notifications, speech, etc.).
- **EAS Update:** Like “deploy JS to Vercel” for an already-installed binary — push JS/asset updates without rebuilding native code.

**Decision for this project (recommended):**

1. Use **OpenAI Whisper** for speech-to-text (record audio in app → send to backend → Whisper → text). This works in Expo Go with `expo-audio` / recording APIs and uses Dawood’s OpenAI key.
2. Use **local scheduled notifications** early (`expo-notifications` schedule APIs) so you can demo reminders without full push infra.
3. Add **Expo Push Tokens + remote push** once backend is live; test on a **development build** (Android first, since you have no Apple device).
4. Keep the app **iOS-compatible** in code (`ios` + `android` platforms, proper permissions in `app.json`) so publishing later is possible when an Apple account exists.

### No Apple ID / no iPhone — what that means

- You can fully develop and test on **Android** (emulator or physical phone) this week.
- iOS-compatible code still runs later on Mac + Apple Developer account + TestFlight.
- You **cannot** personally run an iOS Simulator without a Mac, and you **cannot** submit to the App Store without an Apple Developer Program membership (~$99/year) and an Apple ID.
- For Friday: treat “done” as **Android working + backend deployed + EAS Update preview + iOS-ready codebase**, not App Store live.

---

## 2. User stories (system requirements)

### Epic A — Capture routine

- **US-A1:** As a user, I can open the app in the morning and type my routine in natural language (e.g. “Gym at 7am, standup at 10, lunch at 1pm, deep work 2–5”).
- **US-A2:** As a user, I can tap a microphone, speak my routine, and see the transcribed text before confirming.
- **US-A3:** As a user, I can edit the transcribed/typed text before the AI creates reminders.
- **US-A4:** As a user, after confirmation, the AI parses my routine into discrete timed reminders.

### Epic B — Calendar

- **US-B1:** As a user, I can view my reminders on a custom in-app calendar (day / week views minimum).
- **US-B2:** As a user, I can tap a reminder to see details (title, time, notes, status).
- **US-B3:** As a user, I can see today’s routine highlighted when I open the app.

### Epic C — Manage reminders via AI tools

- **US-C1:** As a user, I can ask the app to **create** reminders (tool: `create_reminders`).
- **US-C2:** As a user, I can ask the app to **update** reminders (tool: `update_reminder`).
- **US-C3:** As a user, I can ask the app to **delete** reminders (tool: `delete_reminder`).
- **US-C4:** As a user, I can manually edit/delete a reminder from the calendar UI (which calls the same backend APIs the tools use).

### Epic D — Notifications

- **US-D1:** As a user, I receive a notification at each reminder’s scheduled time.
- **US-D2:** As a user, tapping a notification opens the relevant reminder / today’s calendar.
- **US-D3:** As a user, if I update/delete a reminder, related notifications are rescheduled or cancelled.

### Epic E — Account & sync

- **US-E1:** As a user, I can sign up / log in so my routines sync to the cloud (MongoDB).
- **US-E2:** As a user, my Expo push token is registered so the server can notify my device.
- **US-E3:** As a user, my timezone is stored so “7am” means 7am in *my* timezone.

### Epic F — Quality / delivery

- **US-F1:** As a developer, I can run the mobile app against a local or deployed API.
- **US-F2:** As a developer, I can publish JS preview updates via EAS Update without App Store review.
- **US-F3:** The codebase remains iOS-compatible for later App Store publishing.

### Non-functional requirements

- OpenAI API key lives **only on the backend** (never embedded in the mobile app).
- Secrets in `.env` / hosting env vars; never committed.
- API responses and tool calls logged enough to debug parsing mistakes.
- Target Expo SDK current stable (use whatever `create-expo-app` scaffolds; pin versions consistently).
- Friday delivery excludes App Store submission.

---

## 3. Recommended stack & why

| Layer | Choice | Why |
|---|---|---|
| Mobile framework | **Expo (React Native) + Expo Router** | Closest DX to Next.js; managed native modules; EAS Build/Update |
| Language | **TypeScript** (mobile + backend) | Safer tool schemas, fewer runtime bugs under deadline |
| UI | Expo Router layouts + React Native StyleSheet (NativeWind optional) | Keep simple for first mobile project |
| Speech → text | **expo-av / expo-audio recording + OpenAI Whisper on backend** | Works with Expo Go; uses existing OpenAI key; accurate |
| Calendar UI | Custom calendar (e.g. `react-native-calendars` or hand-rolled day agenda) | Requirement: custom in-app calendar |
| Notifications | `expo-notifications` | Local schedule + Expo Push Service |
| Backend | **Node.js + Express** | Familiar web skills; easy OpenAI SDK use |
| DB | **MongoDB Atlas + Mongoose** | Required; free tier fine for MVP |
| Auth | JWT + email/password (bcrypt) | Simple, no third-party dependency for MVP |
| AI | OpenAI Chat Completions **with tools** | Create/update/delete reminders |
| Backend host | **Render Free** (primary) | Free Express-friendly Node host; sleeps after ~15 min idle (~1 min cold start). Alternatives: Railway (tiny free credit), Koyeb, Google Cloud Run. Avoid Vercel for this Express API unless rewritten as serverless. |
| Mobile preview | **Expo Go → Dev Build → EAS Update** | Vercel-like JS previews for mobile |
| Monorepo | Single GitHub repo: `/mobile` + `/backend` | One place for sole developer |

### Explicitly deferred

- On-device `expo-speech-recognition` (requires dev build; optional Phase 2+)
- Apple Sign In / App Store Connect
- Multi-device complex sync conflicts
- Recurring complex RRULE calendars (keep MVP to single-day or simple daily repeats)

---

## 4. Architecture diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER'S PHONE                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Expo App (mobile/)                            │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │  │
│  │  │ Home / Chat │  │  Calendar    │  │ Reminder Detail / Edit   │ │  │
│  │  │ text+mic    │  │  day/week    │  │                          │ │  │
│  │  └──────┬──────┘  └──────┬───────┘  └────────────┬─────────────┘ │  │
│  │         │                │                       │               │  │
│  │         └────────────────┼───────────────────────┘               │  │
│  │                          ▼                                       │  │
│  │                 API Client (fetch + JWT)                         │  │
│  │                          │                                       │  │
│  │         ┌────────────────┼────────────────┐                      │  │
│  │         ▼                ▼                ▼                      │  │
│  │  expo-notifications  audio recorder   SecureStore (token)        │  │
│  └─────────┬────────────────┬────────────────┬──────────────────────┘  │
└────────────┼────────────────┼────────────────┼─────────────────────────┘
             │                │                │
             │ push token     │ audio/text     │ REST
             ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Backend API (backend/) — Node/Express               │
│                                                                         │
│  /auth/*          signup, login, JWT                                    │
│  /devices/*       register Expo push token + timezone                   │
│  /routines/parse  text|audio → Whisper? → OpenAI tools → DB             │
│  /reminders/*     CRUD (same handlers used by tool executors)           │
│  /notifications/* optional: send Expo push                              │
│                                                                         │
│  ┌──────────────────┐   ┌─────────────────┐   ┌──────────────────────┐ │
│  │ OpenAI SDK       │   │ Tool executors  │   │ Expo Push API        │ │
│  │ chat + Whisper   │──▶│ create/update/  │──▶│ (optional remote)    │ │
│  │                  │   │ delete reminder │   │                      │ │
│  └──────────────────┘   └────────┬────────┘   └──────────────────────┘ │
│                                  ▼                                      │
│                         MongoDB Atlas                                   │
│              users | devices | reminders | ai_sessions                  │
└─────────────────────────────────────────────────────────────────────────┘

Notification paths (MVP):
  A) Local: after AI creates reminders, mobile schedules local notifications
  B) Remote: backend sends Expo push at due time (cron/worker) — Phase later
```

### Data flow — “morning routine by voice”

```text
1. User holds mic → app records audio file
2. POST /routines/parse (multipart: audio + timezone)
3. Backend: Whisper → transcript text
4. Backend: Chat Completions with tools [{create_reminders}, ...]
5. Model calls create_reminders with structured items
6. Backend executes tool → inserts Reminder docs
7. Response returns transcript + created reminders
8. App shows confirmation + refreshes calendar
9. App schedules local notifications for each reminder time
```

---

## 5. MongoDB schemas

### 5.1 `User`

```js
{
  _id: ObjectId,
  email: String,              // unique, lowercase
  passwordHash: String,       // bcrypt
  displayName: String,
  timezone: String,           // e.g. "Asia/Karachi" — IANA
  createdAt: Date,
  updatedAt: Date
}
```

Indexes: `email` unique.

### 5.2 `Device`

```js
{
  _id: ObjectId,
  userId: ObjectId,           // ref User
  expoPushToken: String,      // ExponentPushToken[...]
  platform: String,           // "ios" | "android"
  deviceName: String,
  lastSeenAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

Indexes: `{ userId: 1 }`, `{ expoPushToken: 1 }` unique sparse.

### 5.3 `Reminder`

```js
{
  _id: ObjectId,
  userId: ObjectId,
  title: String,              // "Gym"
  notes: String,              // optional
  startAt: Date,              // UTC instant
  endAt: Date,                // optional
  timezone: String,           // timezone used when created
  status: String,             // "scheduled" | "completed" | "cancelled"
  source: String,             // "ai" | "manual"
  localNotificationId: String,// optional client-side id for cancel/reschedule
  createdAt: Date,
  updatedAt: Date
}
```

Indexes: `{ userId: 1, startAt: 1 }`, `{ userId: 1, status: 1 }`.

### 5.4 `AiSession` (optional but recommended for debugging)

```js
{
  _id: ObjectId,
  userId: ObjectId,
  inputType: String,          // "text" | "audio"
  rawTranscript: String,
  model: String,
  toolCalls: [
    {
      name: String,
      arguments: Object,
      result: Object
    }
  ],
  assistantMessage: String,
  createdAt: Date
}
```

---

## 6. OpenAI tool-calling design

### System prompt (conceptual)

> You are a routine planning assistant. Convert the user’s natural-language daily plan into concrete reminders. Use tools to create, update, or delete reminders. Interpret relative times using the user’s timezone and today’s date. Prefer fewer, clear reminders over noisy duplicates. Ask for clarification via normal message only if time is genuinely ambiguous and cannot be reasonably inferred.

### Tools

#### `create_reminders`

```json
{
  "name": "create_reminders",
  "description": "Create one or more reminders for the user",
  "parameters": {
    "type": "object",
    "properties": {
      "reminders": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "title": { "type": "string" },
            "notes": { "type": "string" },
            "startAtISO": { "type": "string", "description": "ISO-8601 datetime with offset" },
            "endAtISO": { "type": "string" }
          },
          "required": ["title", "startAtISO"]
        }
      }
    },
    "required": ["reminders"]
  }
}
```

#### `update_reminder`

```json
{
  "name": "update_reminder",
  "description": "Update an existing reminder by id",
  "parameters": {
    "type": "object",
    "properties": {
      "reminderId": { "type": "string" },
      "title": { "type": "string" },
      "notes": { "type": "string" },
      "startAtISO": { "type": "string" },
      "endAtISO": { "type": "string" },
      "status": { "type": "string", "enum": ["scheduled", "completed", "cancelled"] }
    },
    "required": ["reminderId"]
  }
}
```

#### `delete_reminder`

```json
{
  "name": "delete_reminder",
  "description": "Delete a reminder by id",
  "parameters": {
    "type": "object",
    "properties": {
      "reminderId": { "type": "string" }
    },
    "required": ["reminderId"]
  }
}
```

#### `list_reminders` (helper for the model)

```json
{
  "name": "list_reminders",
  "description": "List the user's reminders for a date range so you can update/delete the correct ones",
  "parameters": {
    "type": "object",
    "properties": {
      "fromISO": { "type": "string" },
      "toISO": { "type": "string" }
    },
    "required": ["fromISO", "toISO"]
  }
}
```

### Tool loop (backend)

1. Call Chat Completions with `tools`, `tool_choice: "auto"`, user message + context (today’s date, timezone, existing reminder summary).
2. If `tool_calls` present → execute each against Mongoose services → append `tool` role messages → call model again.
3. Stop when model returns a normal assistant message (no tool calls) or max 3 loops.
4. Return `{ transcript, assistantMessage, remindersAffected }` to the client.

**Security:** Tools always run scoped to `req.user.id`. Never trust client-supplied `userId` inside tool args.

---

## 7. GitHub repository setup

### Is a GitHub repo suitable?

**Yes — strongly recommended.** You are a sole developer under a deadline; GitHub gives you:

- Version history / rollback
- Backup if the laptop fails
- Place to store Issues matching atomic features
- CI later (lint/typecheck)
- Collaboration if Dawood or others review

Private repo is fine for MVP (OpenAI key must never be committed regardless).

### Steps to create and connect the repo

Run these from `c:\Users\Admin\OneDrive\Desktop\routine-manager-app` after this plan file exists.

#### 7.1 Prerequisites

1. Install [Git](https://git-scm.com/) if needed (`git --version`).
2. Install [GitHub CLI](https://cli.github.com/) (`gh --version`) **or** use github.com UI.
3. Sign in: `gh auth login`.

#### 7.2 Initialize local git

```bash
cd "c:\Users\Admin\OneDrive\Desktop\routine-manager-app"
git init
```

Create `.gitignore` (will also be done in Feature 0.2):

```gitignore
node_modules/
.env
.env.*
!.env.example
dist/
build/
.expo/
mobile/android/
mobile/ios/
coverage/
*.log
.DS_Store
eas-credentials/
```

#### 7.3 First commit

```bash
git add .
git commit -m "docs: add implementation plan for routine manager app"
```

#### 7.4 Create private GitHub repo and push

```bash
gh repo create routine-manager-app --private --source=. --remote=origin --push
```

If `gh` is unavailable:

1. Create empty private repo on github.com named `routine-manager-app` (do **not** add README remotely if local already has files).
2. Then:

```bash
git remote add origin https://github.com/<YOUR_USERNAME>/routine-manager-app.git
git branch -M main
git push -u origin main
```

#### 7.5 Branching strategy (simple for sole developer)

- `main` — always deployable / working
- `feature/<feature-id-short-name>` — one atomic feature at a time
- Merge to `main` only after that feature’s acceptance tests pass

Example: `feature/0.3-backend-scaffold`

#### 7.6 Protect secrets

- Put `OPENAI_API_KEY`, `MONGODB_URI`, `JWT_SECRET` in `.env` locally and in host dashboard.
- Commit only `.env.example` with empty placeholders.
- If a key is ever committed: **rotate it immediately** on OpenAI/Mongo dashboards.

---

## 8. Cursor agent skills setup

Install these **before** coding features. They teach Cursor how to write better Expo/RN/AI code.

### Project vs global (`-g`)

- **Default (no `-g`) = project-level** — installs into this repo only. **Use this.**
- **`-g` = global / user-level** — available in every project on your machine. Skip it unless you want these skills everywhere.

Always run the commands from the project root: `c:\Users\Admin\OneDrive\Desktop\routine-manager-app`. Keep `-y` only to skip confirmation prompts (it is not “global”).

### Recommended installs (verified popularity)

Run in PowerShell **from the project root**:

```bash
# 1) React Native + Expo performance & patterns (high signal, Vercel)
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-native-skills -y

# 2) OpenAI docs helper (official)
npx skills add https://github.com/openai/skills --skill openai-docs -y

# 3) Vercel AI SDK patterns (useful mental model for tool calling even if we use openai SDK directly)
npx skills add https://github.com/vercel/ai --skill ai-sdk -y

# 4) Official Expo skills (project-relevant subset — NOT expo-skill-feedback; that name no longer exists)
npx skills add https://github.com/expo/skills --skill expo-overview -y
npx skills add https://github.com/expo/skills --skill expo-project-structure -y
npx skills add https://github.com/expo/skills --skill expo-router -y
npx skills add https://github.com/expo/skills --skill expo-ui -y
npx skills add https://github.com/expo/skills --skill expo-data-fetching -y
npx skills add https://github.com/expo/skills --skill expo-dev-client -y
npx skills add https://github.com/expo/skills --skill eas-update -y
```

**Optional later (not required for MVP):** `eas-app-stores`, `eas-workflows`, `expo-native-ui`, `expo-design-system`, `expo-animation`.

**Tip:** Install several Expo skills in one shot with:

```bash
npx skills add https://github.com/expo/skills --skill expo-overview --skill expo-project-structure --skill expo-router --skill expo-ui --skill expo-data-fetching --skill expo-dev-client --skill eas-update -y
```

Verify with `npx skills list` (project skills). Use `npx skills list -g` only if you want to see global ones.

### Skills to skip / use cautiously

| Skill | Why caution |
|---|---|
| `designed-by-ai/skills@design-mobile-apps` | Popular install count, but oriented around sleek.design API — not needed for this MVP |
| Random low-install “expo” clones | Prefer official / Vercel sources |

### Also create a project Cursor rule (Feature 0.1)

File: `.cursor/rules/routine-manager.mdc` (or `AGENTS.md`) containing:

- Follow `IMPLEMENTATION_PLAN.md` feature order strictly.
- Never start next feature until current acceptance tests pass.
- Never put OpenAI keys in the mobile app.
- Prefer Expo docs patterns; use Expo Router file-based routing.
- Teach briefly while implementing (user is new to mobile).
- Android-first testing; keep iOS permissions/config ready.

### How you will use skills day-to-day

When starting a feature chat, say:

> Implement Feature X.Y from IMPLEMENTATION_PLAN.md exactly. Do not proceed past its acceptance criteria. Teach me the mobile-specific concepts as you go.

---

## 9. Environment & accounts checklist

Complete before Feature 0.3.

| Account / tool | Required this week? | Notes |
|---|---|---|
| Node.js 20+ LTS | Yes | `node -v` |
| npm or pnpm | Yes | |
| Git + GitHub | Yes | |
| MongoDB Atlas free cluster | Yes | Get connection string |
| OpenAI API key (from Dawood) | Yes | Billing enabled on the org |
| Expo account | Yes | https://expo.dev — needed for EAS |
| Android Studio + emulator **or** physical Android phone | Yes | Primary test device |
| ngrok or similar | Recommended | Expose local API to phone |
| Render (free web service) | Yes for “live” API | Primary backend host — like Vercel for this Express API; expect cold starts after idle |
| Apple ID / Mac / Developer Program | No (deferred) | Needed only for App Store |

### Environment variables

**backend/.env**

```env
PORT=4000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=long-random-string
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
CORS_ORIGIN=*
EXPO_ACCESS_TOKEN=          # optional, for push receipts later
```

**mobile/.env** (Expo public only — no secrets)

```env
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:4000
```

On Android emulator, `http://10.0.2.2:4000` maps to host localhost. On physical device, use your PC’s LAN IP (`ipconfig`).

---

## 10. Monorepo project structure

Target tree after scaffolding:

```text
routine-manager-app/
├── IMPLEMENTATION_PLAN.md          ← this file
├── README.md
├── .gitignore
├── .cursor/rules/routine-manager.mdc
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── src/
│   │   ├── index.ts
│   │   ├── config/env.ts
│   │   ├── db/connect.ts
│   │   ├── models/{User,Device,Reminder,AiSession}.ts
│   │   ├── middleware/auth.ts
│   │   ├── routes/{auth,devices,reminders,routines}.ts
│   │   ├── services/{openai,tools,reminders,whisper,push}.ts
│   │   └── utils/{time,errors}.ts
│   └── tests/ (optional smoke)
└── mobile/
    ├── package.json
    ├── app.json / app.config.ts
    ├── eas.json
    ├── app/
    │   ├── _layout.tsx
    │   ├── index.tsx
    │   ├── (auth)/login.tsx
    │   ├── (auth)/signup.tsx
    │   ├── (app)/_layout.tsx
    │   ├── (app)/index.tsx          # today + capture routine
    │   ├── (app)/calendar.tsx
    │   └── (app)/reminder/[id].tsx
    ├── src/
    │   ├── api/client.ts
    │   ├── auth/AuthContext.tsx
    │   ├── components/...
    │   ├── hooks/{useReminders,useVoiceRecorder,useNotifications}.ts
    │   └── lib/{notifications,dates}.ts
    └── assets/
```

---

## 11. Phased implementation (atomic features)

### Global rule for every feature

1. Read the entire IMPLEMENTATION_PLAN.md file to know exactlty what to do and have context of everything.
2. Implement backend + frontend pieces listed (if both apply).
3. Run the listed tests.
4. Mark the feature **DONE** in this file’s checklist (or GitHub Issue).
5. Do not stage, commit or push the changes on a feature branch / merge to `main` on github yourself, the user will do that himself.
6. **Only then** open the next feature.

---

### Phase 0 — Foundations

#### Feature 0.1 — Cursor rule + plan gate

**Goal:** Encode the “don’t skip ahead” workflow into Cursor.

**Implement:**

1. Create `.cursor/rules/routine-manager.mdc` with:
   - Follow `IMPLEMENTATION_PLAN.md` order.
   - One atomic feature at a time; stop at acceptance criteria.
   - No secrets in client; teach mobile concepts briefly.
2. Create empty `README.md` pointing to this plan.

**Expect:** Future agent chats respect feature gating.

**Test:**

1. Start a new Cursor chat: “What feature should we implement next?”
2. Expect answer: Feature 0.2 (or the first unchecked feature), not a random later feature.

**DONE when:** Rule file exists and agent references the plan order.

---

#### Feature 0.2 — GitHub repo + .gitignore

**Goal:** Version control ready; secrets ignored.

**Implement:**

1. Add root `.gitignore` (see §7.2).
2. `git init` if needed; initial commit of plan + gitignore.
3. Create private GitHub repo; push `main` (see §7).

**Expect:** `git status` clean; remote `origin` set; `.env` would be ignored if created.

**Test:**

1. Create a dummy `.env` with `OPENAI_API_KEY=test`.
2. Run `git status` — `.env` must **not** appear.
3. Open GitHub repo in browser — plan file visible.

**DONE when:** Private repo exists and `.env` is ignored.

---

#### Feature 0.3 — Install Cursor skills

**Goal:** Skills available for Expo/RN/OpenAI work.

**Implement:** Run the install commands in §8.

**Expect:** `npx skills list` shows `vercel-react-native-skills`, `openai-docs`, `ai-sdk`, plus Expo skills such as `expo-overview`, `expo-router`, `eas-update` (not `expo-skill-feedback` — that skill was removed from the Expo repo).

**Test:** Ask Cursor: “What does the vercel-react-native-skills guidance say about lists?” — should answer from the skill. Also confirm `npx skills list` includes `expo-router`.

**DONE when:** Skills installed and loadable.

---

#### Feature 0.4 — Accounts & tooling verification

**Goal:** Local machine can run Node, Expo, Mongo, OpenAI.

**Implement (manual checklist — no app code yet):**

1. Install Node 20+.
2. Create MongoDB Atlas cluster; whitelist IP (or `0.0.0.0/0` for MVP carefully); copy URI.
3. Verify OpenAI key with a tiny curl/chat call from a scratch script (delete after).
4. Create Expo account; install `eas-cli` globally: `npm i -g eas-cli`.
5. Install Android Studio emulator **or** enable USB debugging on phone + Expo Go from Play Store.

**Expect:** You can state: Atlas URI works, OpenAI key works, Expo login works, Android device/emulator ready.

**Test:**

1. `node -v` ≥ 20.
2. Mongo connection smoke (mongosh or small script).
3. `npx expo --version` works.
4. Expo Go opens on device.

**DONE when:** All four checks pass. Do not scaffold apps until this is green.

---

### Phase 1 — Backend core

#### Feature 1.1 — Backend scaffold + health endpoint

**Goal:** Express+TS server boots and responds.

**Implement:**

1. Create `backend/` with `package.json`, TypeScript, `tsx` or `ts-node-dev`, Express, cors, dotenv, zod.
2. `src/index.ts` listens on `PORT`.
3. `GET /health` → `{ ok: true, service: "routine-manager-api" }`.
4. `.env.example` with placeholders.
5. Scripts: `"dev": "tsx watch src/index.ts"`.

**Expect:** `npm run dev` prints listening; browser/curl hits health.

**Test:**

```bash
cd backend
npm run dev
curl http://localhost:4000/health
```

Expect JSON `ok: true`.

**DONE when:** Health returns 200 locally.

---

#### Feature 1.2 — MongoDB connection + User model

**Goal:** Persist users in Atlas.

**Implement:**

1. `mongoose` connect on startup; fail fast if URI missing.
2. Create `User` model per §5.1.
3. On successful connect, log `MongoDB connected`.

**Expect:** Server starts only with valid `MONGODB_URI`.

**Test:**

1. Start with wrong URI → process errors clearly.
2. Start with correct URI → “MongoDB connected”.
3. In Atlas UI, `users` collection appears after first write in next feature (connection alone is enough for now).

**DONE when:** Server connects to Atlas reliably.

---

#### Feature 1.3 — Auth: signup / login / JWT middleware

**Goal:** Secure user identity for all later routes.

**Implement:**

1. `POST /auth/signup` `{ email, password, displayName?, timezone? }` → create user, return `{ token, user }`.
2. `POST /auth/login` `{ email, password }` → `{ token, user }`.
3. `GET /auth/me` with `Authorization: Bearer <token>` → current user.
4. bcrypt hash passwords; JWT expires in 30d (MVP).
5. Auth middleware attaches `req.user`.

**Expect:** Can create account, login, hit `/me`.

**Test (API):**

```bash
curl -X POST http://localhost:4000/auth/signup -H "Content-Type: application/json" -d "{\"email\":\"you@test.com\",\"password\":\"Password1!\",\"timezone\":\"Asia/Karachi\"}"
curl -X POST http://localhost:4000/auth/login -H "Content-Type: application/json" -d "{\"email\":\"you@test.com\",\"password\":\"Password1!\"}"
curl http://localhost:4000/auth/me -H "Authorization: Bearer <TOKEN>"
```

**UI N/A** until mobile auth screens.

**DONE when:** All three endpoints work; bad password returns 401.

---

#### Feature 1.4 — Reminder CRUD API

**Goal:** Canonical reminder persistence used by UI and AI tools.

**Implement:**

1. `Reminder` model §5.3.
2. Routes (all auth-required):
   - `GET /reminders?from=&to=`
   - `GET /reminders/:id`
   - `POST /reminders`
   - `PATCH /reminders/:id`
   - `DELETE /reminders/:id`
3. Always filter by `userId` from JWT.
4. Validate dates with zod.

**Expect:** Authenticated CRUD works; user A cannot read user B’s reminders.

**Test (API):**

1. Create reminder for tomorrow 7:00 in your timezone (send ISO).
2. List with from/to covering that day — see 1 item.
3. Patch title; delete; list empty.
4. With second user token, cannot GET first user’s id (404).

**DONE when:** CRUD + isolation verified via curl/Postman.

---

### Phase 2 — Mobile shell

#### Feature 2.1 — Expo app scaffold + Expo Router

**Goal:** Mobile project runs in Expo Go.

**Implement:**

1. In repo root: `npx create-expo-app@latest mobile -t tabs` **or** blank with Expo Router template (`npx create-expo-app@latest mobile --template tabs` / official router template). Prefer **TypeScript + Expo Router**.
2. Clean starter screens to placeholders: Home, Calendar.
3. Set `app.json` name/slug `routine-manager`, `ios` + `android` platforms, scheme.
4. Ensure app starts: `npx expo start`.

**Teaching note:** Expo Go loads your JS bundle. Shake device → developer menu.

**Expect:** App opens on Android emulator/phone via Expo Go QR / LAN.

**Test through UI:**

1. `cd mobile && npx expo start`
2. Scan QR with Expo Go (same Wi‑Fi) or press `a` for Android emulator.
3. See Home + Calendar tabs.
4. Hot reload: edit a Text string → device updates.

**DONE when:** Expo Go shows the shell tabs reliably.

---

#### Feature 2.2 — API client + env wiring

**Goal:** Mobile can call backend health.

**Implement:**

1. `EXPO_PUBLIC_API_URL` in `mobile/.env`.
2. `src/api/client.ts` with `apiFetch(path, options)` attaching JSON headers.
3. Temporary Home screen button “Ping API” calling `/health` and showing result.

**Expect:** Phone reaches PC backend.

**Test through UI:**

1. Start backend.
2. Set API URL correctly (LAN IP or `10.0.2.2` for emulator).
3. Tap Ping API → alert/text shows `ok: true`.
4. Stop backend → see friendly error.

**Troubleshooting:** Windows firewall may block Node; allow private network. Phone and PC must share Wi‑Fi (not guest isolation).

**DONE when:** Ping succeeds from device.

---

#### Feature 2.3 — Auth screens + SecureStore session

**Goal:** Sign up / log in from the phone; stay logged in.

**Implement:**

1. Install `expo-secure-store`.
2. `AuthContext`: load token on boot; login/signup/logout; provide `user`.
3. Screens: Signup, Login.
4. Root layout: if no token → auth stack; else → app tabs.
5. Call `/auth/me` on boot to validate token.

**Expect:** Fresh install → signup → lands on Home; kill app → still logged in; logout → login screen.

**Test through UI:**

1. Sign up with new email.
2. Kill Expo Go / reload — still authenticated.
3. Logout → login with same credentials.
4. Wrong password → error message (not crash).

**DONE when:** Full auth loop works on device.

---

### Phase 3 — AI routine capture (text)

#### Feature 3.1 — OpenAI client + tool executors (backend)

**Goal:** Backend can run tool loop without mobile.

**Implement:**

1. Official `openai` SDK.
2. `services/tools.ts` implements `create_reminders`, `update_reminder`, `delete_reminder`, `list_reminders` calling reminder service.
3. `services/openaiRoutine.ts` runs tool loop with system prompt + timezone/today context.
4. `POST /routines/parse` body: `{ text: string, timezone?: string }` → runs loop → returns `{ assistantMessage, transcript, created, updated, deleted }`.
5. Persist `AiSession` optionally.

**Expect:** Natural language creates DB reminders.

**Test (API):**

```bash
curl -X POST http://localhost:4000/routines/parse \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Tomorrow gym at 7am, team standup at 10:30am, lunch at 1pm\",\"timezone\":\"Asia/Karachi\"}"
```

Then `GET /reminders?from=&to=` → 3 reminders with correct times (± timezone).

**DONE when:** At least 2 different phrasings parse into correct reminders.

---

#### Feature 3.2 — Mobile “Plan my day” text composer

**Goal:** Type routine → AI creates reminders → show confirmation.

**Implement:**

1. Home screen: multiline TextInput, Submit button, loading state.
2. On success: show assistant message + list of created titles/times.
3. Invalidate/refetch reminders cache/state.
4. Handle errors (quota, network).

**Expect:** Typing a plan creates calendar data (next feature shows calendar; for now show list on Home).

**Test through UI:**

1. Login.
2. Enter: “Today: deep work 9–11, call mom at 5pm, stretch at 8pm”.
3. Submit → loading → success message.
4. See 3 items listed on Home.
5. Submit nonsense empty → validation error.

**DONE when:** Text path creates reminders visible in app list.

---

### Phase 4 — Custom in-app calendar

#### Feature 4.1 — Calendar day agenda UI

**Goal:** Custom calendar showing reminders (not device OS calendar).

**Implement:**

1. Add Calendar tab using `react-native-calendars` Agenda/ExpandableCalendar **or** a simple custom day list with date picker.
2. Fetch `GET /reminders?from&to` for selected day.
3. Marked dates for days that have reminders.
4. Tap item → detail route `reminder/[id]`.

**Expect:** Created reminders appear on correct day/time.

**Test through UI:**

1. Create reminders via Home for today and tomorrow.
2. Open Calendar → today shows today’s items sorted by time.
3. Switch to tomorrow → see tomorrow’s items.
4. Days with items show a dot/mark.

**DONE when:** Calendar reflects API data after pull-to-refresh.

---

#### Feature 4.2 — Reminder detail + manual edit/delete

**Goal:** Non-AI management path.

**Implement:**

1. Detail screen: title, time, notes, status.
2. Edit form → `PATCH`.
3. Delete button → confirm → `DELETE` → navigate back.
4. Calendar refreshes.

**Expect:** Manual edits persist.

**Test through UI:**

1. Open a reminder → change title → save → calendar shows new title.
2. Delete → item gone from calendar and Home.

**DONE when:** Manual edit/delete works end-to-end.

---

### Phase 5 — Voice input (Whisper)

#### Feature 5.1 — Backend Whisper transcription endpoint path

**Goal:** Audio → text via OpenAI.

**Implement:**

1. Extend `POST /routines/parse` to accept `multipart/form-data` with `audio` file **or** add `POST /routines/transcribe` then reuse parse.
2. Use OpenAI Whisper (`whisper-1` or current audio transcription model).
3. Feed transcript into existing tool loop.
4. Return `transcript` so UI can show what was heard.

**Expect:** Uploading a short m4a/wav creates reminders.

**Test (API):**

1. Record a short voice note on PC saying “Meeting at 3pm and gym at 6pm”.
2. `curl -F audio=@file.m4a -F timezone=Asia/Karachi -H "Authorization: Bearer ..." http://localhost:4000/routines/parse`
3. Transcript roughly correct; reminders created.

**DONE when:** Audio upload path works via curl.

---

#### Feature 5.2 — Mobile mic recorder UI

**Goal:** Speak routine inside the app.

**Implement:**

1. Use Expo audio recording API (`expo-audio` or `expo-av` depending on SDK).
2. Mic button: press to record / press to stop (or hold-to-talk — pick one and keep simple).
3. Request microphone permissions (iOS `Info.plist` / Android permissions via `app.json` plugins).
4. Upload audio to `/routines/parse`.
5. Show transcript in the text box for user edit → Confirm optional second step (recommended UX: show transcript, user taps Confirm to parse **or** parse immediately then allow undo).

**Recommended UX for MVP:** Record → auto-transcribe+parse → show results; “Undo” deletes created reminders from that session if needed (optional stretch).

**Expect:** Speaking creates the same outcomes as typing.

**Test through UI:**

1. Grant mic permission.
2. Record: “Lunch at 1 and walk at 6 tonight”.
3. See transcript + created reminders.
4. Verify calendar.
5. Deny permission path shows guidance (doesn’t crash).

**DONE when:** Voice path works on Android device/emulator with mic.

---

### Phase 6 — Notifications

#### Feature 6.1 — Local notification scheduling on device

**Goal:** Phone alerts at reminder times without remote push yet.

**Implement:**

1. Install `expo-notifications`; configure plugin in `app.json`.
2. Ask notification permission on first Home visit.
3. After reminders created/updated, schedule local notifications at `startAt`.
4. On delete/update, cancel previous notification ids (store mapping in AsyncStorage or reminder field synced from client).
5. Foreground handler so alerts appear while app open.
6. Response listener → navigate to reminder/calendar.

**Teaching note:** Local notifications are scheduled by the OS from the app. They work even if backend is down. Remote push needs server + token.

**Expect:** Creating a reminder 2 minutes from now fires a notification.

**Test through UI:**

1. Create reminder titled “Test ping” for 2 minutes ahead (type exact time).
2. Background the app.
3. Within ~2 minutes, notification appears.
4. Tap notification → app opens to calendar/detail.
5. Delete reminder → notification does not fire (schedule another short test to verify cancel).

**DONE when:** Schedule + tap + cancel paths verified on Android.

> **Note:** Depending on Expo SDK + Expo Go limitations, if local notifications misbehave in Expo Go, create a **development build** (Feature 6.1b) before continuing.

#### Feature 6.1b — Development build (only if Expo Go blocks notifications/mic)

**Implement:**

1. `npx expo install expo-dev-client`
2. `eas build --profile development --platform android`
3. Install APK on phone; use `npx expo start --dev-client`.

**DONE when:** Same tests as 6.1 pass on dev client.

---

#### Feature 6.2 — Register Expo push token with backend

**Goal:** Server knows how to reach the device later.

**Implement:**

1. `Device` model + `POST /devices/register` `{ expoPushToken, platform }`.
2. Mobile: get Expo push token (`Notifications.getExpoPushTokenAsync` with `projectId` from EAS).
3. Call register after login + permission grant.
4. Store in Mongo.

**Expect:** Atlas shows device doc for user.

**Test:**

1. Login on device.
2. Allow notifications.
3. Check Mongo `devices` collection for token.
4. `GET` helper or Atlas UI confirmation.

**DONE when:** Token stored and updates on re-login.

---

#### Feature 6.3 — Remote push sender (backend) — optional for Friday if time

**Goal:** Backend can send a push via Expo Push API.

**Implement:**

1. Service `sendExpoPush(tokens, title, body, data)`.
2. `POST /notifications/test` (auth) sends a test push to current user’s devices.
3. Optional: simple node-cron every minute checks due reminders in a 1-minute window and pushes (mark `notifiedAt` to avoid dupes). Prefer local notifications for reliability under deadline; remote push is enhancement.

**Test through UI:**

1. Hit test endpoint or in-app “Send test push” button.
2. Receive notification on device.

**DONE when:** Test push received on Android (dev build if required).

---

### Phase 7 — AI update/delete via natural language

#### Feature 7.1 — Conversational manage screen

**Goal:** “Move gym to 8am” / “Cancel lunch” works via tools.

**Implement:**

1. Reuse `/routines/parse` with existing reminders context (`list_reminders` tool).
2. Home composer placeholder text explains create **and** manage.
3. After response, refresh calendar; reschedule local notifications for changed items.

**Expect:** Updates/deletes reflect in DB + UI + notifications.

**Test through UI:**

1. Create “Gym at 7am”.
2. Send “Move gym to 8am”.
3. Calendar shows 8:00; old 7:00 notification cancelled; new one scheduled.
4. Send “Delete gym”.
5. Reminder gone.

**DONE when:** Create/update/delete all work from natural language.

---

### Phase 8 — Deployments (Vercel-like mobile workflow)

#### Feature 8.1 — Deploy backend to Render Free

**Goal:** API on a public HTTPS URL (phone doesn’t need LAN), using Render’s free web service.

**Why Render Free:** Closest free equivalent to “deploy backend like Vercel” for a normal Express server. No rewrite to serverless required. Catch: free instances **spin down after ~15 minutes** without traffic and take ~1 minute to wake on the next request (first mobile call after idle may be slow — that is expected).

**Implement (Render Free):**

1. Push `backend/` to GitHub (already on `main` by this phase).
2. Sign up at [render.com](https://render.com) with GitHub; create a **Web Service** from this repo.
3. Configure:
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build` (or install-only if running via `tsx`)
   - **Start Command:** `npm start` (e.g. `node dist/index.js`)
   - **Instance type:** Free
4. Set environment variables in Render dashboard to match `backend/.env.example`:
   - `MONGODB_URI`, `JWT_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `PORT` (Render often injects `PORT` — read `process.env.PORT`)
5. Deploy; copy the public URL (`https://….onrender.com`).
6. Update mobile `EXPO_PUBLIC_API_URL` to that HTTPS URL.
7. MongoDB Atlas **Network Access:** allow Render (easiest MVP: `0.0.0.0/0`) so the free instance can connect.

**Alternatives (only if Render is blocked for you):**

- Railway — trial / ~$1 monthly free credit (not unlimited free)
- Koyeb — one free web service (may require card hold)
- Google Cloud Run — strong free quota; needs billing account + container
- Do **not** use Vercel Hobby for this Express app unless you deliberately rewrite it as serverless functions

**Expect:** `GET https://<your-service>.onrender.com/health` returns `ok: true` (first hit after idle may take ~30–60s). Mobile login against this URL works.

**Test through UI:**

1. Point app to the Render URL.
2. Hit `/health` twice — second should be fast if service is awake.
3. Signup/login on phone over cellular data (not just Wi‑Fi).
4. Create a reminder → appears in Atlas.
5. Wait ~20 minutes idle, then create another reminder — accept the cold-start delay once.

**DONE when:** Full text routine flow works against the Render Free URL.

---

#### Feature 8.2 — EAS project + Update preview channel

**Goal:** Ship JS updates like Vercel preview deployments.

**Implement:**

1. `cd mobile && eas login && eas init`
2. Configure `eas.json` profiles: `development`, `preview`, `production`.
3. Enable EAS Update; set `updates.url` / runtime version policy in app config.
4. Publish: `eas update --branch preview --message "feature-x"`.
5. Document: teammates/open Expo Go or preview build opens `preview` channel.

**Teaching note:**

- **EAS Update** = JS/assets only (like frontend deploy).
- **EAS Build** = new native binary when you add native modules/permissions plugins.

**Expect:** After `eas update`, reload app shows changes without rebuilding APK (same runtime version).

**Test:**

1. Change a visible string on Home.
2. `eas update --branch preview`.
3. Force close / reopen app (or reload) → new string appears.
4. Confirm on Android.

**DONE when:** OTA update visibly lands on device.

---

#### Feature 8.3 — Android preview APK (internal distribution)

**Goal:** Installable build without Play Store (closest to “staging deploy”).

**Implement:**

1. `eas build --profile preview --platform android`
2. Install APK from Expo dashboard link on phone.
3. Point to production API; verify full flow including notifications.

**Expect:** Standalone app icon (not Expo Go) runs the product.

**Test through UI:** End-to-end morning routine: voice + text + calendar + notification in 2 minutes.

**DONE when:** Preview APK passes E2E checklist below.

---

### Phase 9 — Hardening before Friday demo

#### Feature 9.1 — Empty states, errors, loading

**Implement:** Friendly empties on calendar; disable double-submit; offline message.

**Test:** Airplane mode → graceful error; retry works.

**DONE when:** No white-screen crashes on common errors.

---

#### Feature 9.2 — End-to-end demo script freeze

**Implement:** Write `DEMO_SCRIPT.md` with exact phrases and times for the Friday demo.

**E2E checklist:**

1. Install preview app / open Expo Go channel.
2. Sign up fresh user.
3. Allow mic + notifications.
4. Type a 3-item routine → calendar correct.
5. Speak a 2-item routine → transcript + calendar.
6. “Move X to Y” → updates.
7. “Delete Z” → removed.
8. 2-minute notification fires.
9. Backend health public URL OK.

**DONE when:** You can run the demo script twice without failure.

---

## 12. Testing & preview deployment strategy

Think in three layers (web analogies):

| Layer | Web analogy | Tool |
|---|---|---|
| Local JS refresh | `next dev` | Expo Go / Dev Client + Metro |
| Shared staging API | Vercel preview API | **Render Free** public URL (`*.onrender.com`) |
| Shared staging app JS | Vercel Preview | **EAS Update** branch `preview` |
| Installable staging binary | Internal build | **EAS Build** preview APK |
| Store release | Production deploy | Deferred (App Store / Play) |

### Daily developer loop

1. Terminal A: `cd backend && npm run dev`
2. Terminal B: `cd mobile && npx expo start`
3. Implement one feature; run its acceptance tests; commit; only then next feature.

### When to leave Expo Go

Leave Expo Go when you need reliable push notifications or any custom native module. Until then, Whisper + local notifications + Expo Go is the fastest learning path.

---

## 13. Friday deadline reality check

Assuming work starts from an empty folder mid-week:

### Must-have for Friday demo (P0)

- Auth
- Text → OpenAI tools → reminders in Mongo
- Custom calendar view
- Voice via Whisper
- Local notifications
- Backend deployed
- Android runnable (Expo Go or preview APK)

### Stretch (P1)

- Remote push cron
- EAS Update channel polished
- AI update/delete NL
- Dev client build

### Explicitly not Friday (P2)

- App Store Connect / TestFlight
- Play Store listing
- Apple Sign In
- Perfect iOS device QA (no iPhone available)

**iOS compatibility still required in code:** correct `app.json` permissions (`NSMicrophoneUsageDescription`, `UIBackgroundModes` if needed, notification usage strings), no Android-only APIs without iOS fallbacks.

---

## 14. Glossary for first-time mobile developers

- **Expo:** Toolchain + libraries on top of React Native (like a batteries-included framework).
- **Expo Router:** File-based navigation (like Next.js App Router).
- **Metro:** JS bundler for React Native (like webpack/turbopack for mobile).
- **Expo Go:** Client app that runs your project during development.
- **Dev Client:** Your custom Expo Go with extra native code.
- **EAS Build:** Cloud builders that produce APK/AAB/IPA.
- **EAS Update:** Over-the-air JS updates to existing builds.
- **Push token:** Address of a device for remote notifications.
- **Local notification:** Scheduled by the app on-device.
- **Tool calling / function calling:** LLM returns structured function requests your server executes.
- **Whisper:** OpenAI speech-to-text model.

---

## Master checklist (tick as you go)

- [x] 0.1 Cursor rule + gate
- [x] 0.2 GitHub + gitignore
- [x] 0.3 Skills installed
- [ ] 0.4 Accounts/tooling verified
- [ ] 1.1 Backend health
- [ ] 1.2 Mongo + User model
- [ ] 1.3 Auth JWT
- [ ] 1.4 Reminder CRUD
- [ ] 2.1 Expo shell
- [ ] 2.2 API client ping
- [ ] 2.3 Auth UI + SecureStore
- [ ] 3.1 OpenAI tools backend
- [ ] 3.2 Text composer UI
- [ ] 4.1 Calendar UI
- [ ] 4.2 Detail edit/delete
- [ ] 5.1 Whisper backend
- [ ] 5.2 Mic UI
- [ ] 6.1 Local notifications
- [ ] 6.1b Dev build (if needed)
- [ ] 6.2 Push token register
- [ ] 6.3 Remote push (optional)
- [ ] 7.1 NL update/delete
- [ ] 8.1 Backend deploy (Render Free)
- [ ] 8.2 EAS Update
- [ ] 8.3 Android preview APK
- [ ] 9.1 Hardening
- [ ] 9.2 Demo script E2E

---

## How we will work in this Cursor chat from here

1. You confirm this plan (or request adjustments).
2. We execute **Feature 0.1** next — nothing else.
3. After acceptance tests pass, you say “Feature 0.1 done — continue” (or ask questions).
4. We proceed feature-by-feature with teaching notes each step.

**Do not skip features.** Speed comes from finishing small vertical slices cleanly, not from scaffolding everything unfinished at once.
