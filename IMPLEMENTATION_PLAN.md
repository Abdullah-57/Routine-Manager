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
11. [Phased implementation (atomic features)](#11-phased-implementation-atomic-features) — Phase 2+ includes per-feature **Agent skills**
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
- Teach all of the concepts used while implementing and also what is being done in each code file that is added or edited, explain exactly what changes are being made and why, teach the concepts and the reasons as to why the code is being written the way it is (user is new to mobile). Basically whatever you are doing, teach me everything you are doing in simple words.
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

On **PowerShell (Windows)**, do **not** use bash-style `curl ... -d "{\"email\":...}"` — PowerShell mangles the escaped quotes and the API gets invalid JSON. Use these **single-line** `Invoke-RestMethod` commands (hashtable keys separated by `;`):

```powershell
# Run ONE command at a time (press Enter after each line)

# 1) Signup (409 is OK if this email already exists — continue with login)
$signup = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/signup -ContentType 'application/json' -Body (@{ email = 'you@test.com'; password = 'Password1!'; timezone = 'Asia/Karachi' } | ConvertTo-Json); $signup

# 2) Login
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType 'application/json' -Body (@{ email = 'you@test.com'; password = 'Password1!' } | ConvertTo-Json); $login

# 3) Me
Invoke-RestMethod -Method Get -Uri http://localhost:4000/auth/me -Headers @{ Authorization = "Bearer $($login.token)" }

# 4) Bad password → expect 401
try { Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType 'application/json' -Body (@{ email = 'you@test.com'; password = 'WrongPass1!' } | ConvertTo-Json) } catch { $_.Exception.Response.StatusCode.value__ }
```

If you prefer `curl.exe`, pass JSON with **single-quoted** `-d` (no backslash escapes):

```powershell
curl.exe -X POST http://localhost:4000/auth/signup -H "Content-Type: application/json" -d '{"email":"you@test.com","password":"Password1!","timezone":"Asia/Karachi"}'
curl.exe -X POST http://localhost:4000/auth/login -H "Content-Type: application/json" -d '{"email":"you@test.com","password":"Password1!"}'
curl.exe http://localhost:4000/auth/me -H "Authorization: Bearer <TOKEN>"
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

**Test (API) — PowerShell, one command at a time:**

```powershell
# Login as user A
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType 'application/json' -Body (@{ email = 'you@test.com'; password = 'Password1!' } | ConvertTo-Json); $token = $login.token

# Create reminder for tomorrow 07:00 (+03:00 example — adjust offset to your timezone)
$created = Invoke-RestMethod -Method Post -Uri http://localhost:4000/reminders -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body (@{ title = 'Gym'; startAt = '2026-11-11T07:00:00+03:00'; timezone = 'Asia/Karachi' } | ConvertTo-Json); $created; $id = $created.reminder.id

# List for that day — expect 1 item
# Note: use %2B for '+' in querystrings (raw '+' becomes a space in URLs)
Invoke-RestMethod -Method Get -Uri 'http://localhost:4000/reminders?from=2026-11-11T00:00:00%2B03:00&to=2026-11-11T23:59:59%2B03:00' -Headers @{ Authorization = "Bearer $token" }

# Patch title
Invoke-RestMethod -Method Patch -Uri "http://localhost:4000/reminders/$id" -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body (@{ title = 'Morning Gym' } | ConvertTo-Json)

# Delete
Invoke-RestMethod -Method Delete -Uri "http://localhost:4000/reminders/$id" -Headers @{ Authorization = "Bearer $token" }

# List again — expect 0 items
Invoke-RestMethod -Method Get -Uri 'http://localhost:4000/reminders?from=2026-11-11T00:00:00%2B03:00&to=2026-11-11T23:59:59%2B03:00' -Headers @{ Authorization = "Bearer $token" }

# Isolation: create again, then GET with a different user's token → 404
$created2 = Invoke-RestMethod -Method Post -Uri http://localhost:4000/reminders -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body (@{ title = 'Private'; startAt = '2026-11-11T07:00:00+03:00'; timezone = 'Asia/Karachi' } | ConvertTo-Json); $id2 = $created2.reminder.id

$loginB = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/signup -ContentType 'application/json' -Body (@{ email = 'other14@test.com'; password = 'Password1!' } | ConvertTo-Json); try { Invoke-RestMethod -Method Get -Uri "http://localhost:4000/reminders/$id2" -Headers @{ Authorization = "Bearer $($loginB.token)" } } catch { $_.Exception.Response.StatusCode.value__ }
```

**DONE when:** CRUD + isolation verified via API.

---

### Phase 2 — Mobile shell

> **Agent skills (Phase 2+):** For every feature below, the agent should load the listed project skills before implementing. Skills are already installed in this repo (`npx skills list`). Always also follow `.cursor/rules/routine-manager.mdc` and this plan.

| Feature | Primary agent skills to use |
|---|---|
| 2.1 Expo scaffold + Router | `expo-overview`, `expo-project-structure`, `expo-router`, `vercel-react-native-skills` |
| 2.2 API client + env | `expo-data-fetching`, `vercel-react-native-skills` |
| 2.3 Auth + SecureStore | `expo-router`, `expo-ui`, `expo-data-fetching`, `vercel-react-native-skills` |
| 3.1 OpenAI tools (backend) | `openai-docs`, `ai-sdk` |
| 3.2 Plan-my-day text UI | `expo-ui`, `expo-data-fetching`, `vercel-react-native-skills` |
| 4.1 Calendar agenda UI | `expo-ui`, `expo-router`, `expo-data-fetching`, `vercel-react-native-skills` |
| 4.2 Reminder detail edit/delete | `expo-router`, `expo-ui`, `expo-data-fetching` |
| 5.1 Whisper backend | `openai-docs` |
| 5.2 Mic recorder UI | `expo-ui`, `expo-data-fetching`, `expo-dev-client` (if Expo Go blocks audio), `vercel-react-native-skills` |
| 6.1 Local notifications | `expo-router`, `expo-dev-client` (if Expo Go is insufficient), `vercel-react-native-skills` |
| 6.1b Development build | `expo-dev-client` |
| 6.2 Push token register | `expo-dev-client`, `expo-data-fetching` |
| 6.3 Remote push (optional) | `expo-dev-client` + Expo Push API docs *(no dedicated push skill installed)* |
| 7.1 NL update/delete UI | `openai-docs`, `ai-sdk`, `expo-ui`, `expo-data-fetching` |
| 8.1 Render Free deploy | *(no Expo skill — follow this plan + Render docs)* |
| 8.2 EAS Update preview | `eas-update`, `eas-update-insights` (optional) |
| 8.3 Android preview APK | `eas-app-stores`, `eas-workflows` (optional), `expo-dev-client` |
| 9.1 Hardening UX | `expo-ui`, `vercel-react-native-skills`, `expo-animation` (optional polish) |
| 9.2 Demo script E2E | `eas-update` (confirm preview channel), `eas-app-stores` (if using preview APK) |

#### Feature 2.1 — Expo app scaffold + Expo Router

**Goal:** Mobile project runs in Expo Go.

**Agent skills:** `expo-overview`, `expo-project-structure`, `expo-router`, `vercel-react-native-skills`

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

**Agent skills:** `expo-data-fetching`, `vercel-react-native-skills`

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

**Agent skills:** `expo-router`, `expo-ui`, `expo-data-fetching`, `vercel-react-native-skills`

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

**Agent skills:** `openai-docs`, `ai-sdk` (tool-calling patterns; we still use the official `openai` SDK)

**Implement:**

1. Official `openai` SDK.
2. `services/tools.ts` implements `create_reminders`, `update_reminder`, `delete_reminder`, `list_reminders` calling reminder service.
3. `services/openaiRoutine.ts` runs tool loop with system prompt + timezone/today context.
4. `POST /routines/parse` body: `{ text: string, timezone?: string }` → runs loop → returns `{ assistantMessage, transcript, created, updated, deleted }`.
5. Persist `AiSession` optionally.

**Expect:** Natural language creates DB reminders.

**Test (API) — PowerShell (Windows):**

Run **one command per line** (do not paste comments and commands onto a single line; `#` comments out everything after it).

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:4000/auth/login -ContentType 'application/json' -Body (@{ email = 'test1@gmail.com'; password = '12345678' } | ConvertTo-Json)
```

```powershell
$token = $login.token
```

```powershell
Write-Output $token
```

```powershell
$body = @{ text = 'Tomorrow gym at 7am, team standup at 10:30am, lunch at 1pm'; timezone = 'Asia/Karachi' } | ConvertTo-Json
```

```powershell
$result = Invoke-RestMethod -Method Post -Uri http://localhost:4000/routines/parse -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
```

```powershell
$result | ConvertTo-Json -Depth 6
```

```powershell
Write-Output "created_count=$($result.created.Count)"
```

Optional second phrasing (same `$token`):

```powershell
$body2 = @{ text = 'Plan for today: deep work from 9 to 11, call mom at 5pm, stretch at 8pm'; timezone = 'Asia/Karachi' } | ConvertTo-Json
```

```powershell
$result2 = Invoke-RestMethod -Method Post -Uri http://localhost:4000/routines/parse -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body2
```

```powershell
Write-Output "created_count=$($result2.created.Count)"
```

Then list reminders to confirm times (± timezone):

```powershell
$from = [Uri]::EscapeDataString('2020-01-01T00:00:00+05:00'); $to = [Uri]::EscapeDataString('2030-01-01T00:00:00+05:00'); Invoke-RestMethod -Uri "http://localhost:4000/reminders?from=$from&to=$to" -Headers @{ Authorization = "Bearer $token" } | ConvertTo-Json -Depth 6
```

**Note:** Expo Go login does **not** set `$token` in PowerShell — always login/signup in the terminal first. Prefer `Invoke-RestMethod` over bash-style `curl` on Windows.

**DONE when:** At least 2 different phrasings parse into correct reminders.

---

#### Feature 3.2 — Mobile “Plan my day” text composer

**Goal:** Type routine → AI creates reminders → show confirmation.

**Agent skills:** `expo-ui`, `expo-data-fetching`, `vercel-react-native-skills`

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

**Agent skills:** `expo-ui`, `expo-router`, `expo-data-fetching`, `vercel-react-native-skills` (list performance)

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

**Agent skills:** `expo-router`, `expo-ui`, `expo-data-fetching`

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

**Agent skills:** `openai-docs` (audio transcription / Whisper)

**Implement:**

1. Extend `POST /routines/parse` to accept `multipart/form-data` with `audio` file **or** add `POST /routines/transcribe` then reuse parse.
2. Use OpenAI Audio Transcriptions with current recommended model `gpt-transcribe` (override via `OPENAI_TRANSCRIBE_MODEL`; `whisper-1` still works until ~2027 shutdown).
3. Feed transcript into existing tool loop (`inputType: "audio"`).
4. Return `transcript` so UI can show what was heard. Also expose `POST /routines/transcribe` for audio-only debugging.

**Expect:** Uploading a short m4a/wav creates reminders.

**Test (API):**

1. Record a short voice note on PC saying “Meeting at 3pm and gym at 6pm”.
2. `curl -F audio=@file.m4a -F timezone=Asia/Karachi -H "Authorization: Bearer ..." http://localhost:4000/routines/parse`
3. Transcript roughly correct; reminders created.

**DONE when:** Audio upload path works via curl.

---

#### Feature 5.2 — Mobile mic recorder UI

**Goal:** Speak routine inside the app.

**Agent skills:** `expo-ui`, `expo-data-fetching`, `vercel-react-native-skills`; add `expo-dev-client` if Expo Go cannot access mic/native audio cleanly

**Implement:**

1. Use Expo audio recording API (`expo-audio` on SDK 58).
2. Mic button: press to record / press to stop (Home: **Record voice plan** → **Stop & plan from voice**).
3. Request microphone permissions on first record (`expo-audio` plugin in `app.json` for iOS mic string + Android `RECORD_AUDIO`).
4. Upload audio to `/routines/parse` (multipart via `parseRoutineAudio`).
5. Show transcript in the text box after voice parse (user can edit + Submit again); MVP auto-parses on stop.

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

**Agent skills:** `expo-router` (notification → screen navigation), `vercel-react-native-skills`; use `expo-dev-client` if Expo Go notification limits block testing. *(No dedicated notifications skill in the installed set — follow Expo Notifications docs + this plan.)*

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

**Agent skills:** `expo-dev-client`

**Implement:**

1. `npx expo install expo-dev-client`
2. `eas build --profile development --platform android`
3. Install APK on phone; use `npx expo start --dev-client`.

**DONE when:** Same tests as 6.1 pass on dev client.

---

#### Feature 6.2 — Register Expo push token with backend

**Goal:** Server knows how to reach the device later.

**Agent skills:** `expo-dev-client`, `expo-data-fetching` *(push token APIs — Expo Notifications docs; no dedicated push skill installed)*

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

**Agent skills:** `expo-dev-client` (for device testing). Backend push sender has no dedicated skill — follow Expo Push API docs + this plan.

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

**Agent skills:** `openai-docs`, `ai-sdk`, `expo-ui`, `expo-data-fetching`

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

### Phase 7b - Assistant-Mode Enhancements (feature specification)

> This section is a verbatim copy of `ASSISTANT_FEATURE_SPEC.md` (repo root), inserted between Phase 7 and Phase 8. That file remains the canonical standalone copy; this copy is included so the plan is self-contained. It covers the enhancements that turn the app from a reminder app into an autonomous assistant: hands-free voice activation, action-aware reminders (Google contacts + Meet links only, no Google Calendar integration), smart pre-reminders, actionable deep-linked notifications, and a Google Calendar-style day view.

**Agent skills per Phase 7b feature** (all already installed in this repo — `npx skills list`; load `expo-overview` first in every feature chat; inline `**Agent skills:**` lines are also present in the spec copy below):

| Feature (spec §) | Primary agent skills to use |
|---|---|
| 1 — Hands-free voice activation | `expo-dev-client` (required — wake-word + `expo-speech` native modules), `vercel-react-native-skills`, `openai-docs` (streaming STT), `expo-data-fetching`, `expo-router`, `expo-animation`, `expo-native-ui` *(expo-speech-recognition / Vosk: vendor docs)* |
| 1.1 Wake-word detection | `expo-dev-client`, `vercel-react-native-skills`, `expo-native-ui` |
| 1.2 Post-wake session | `openai-docs`, `expo-data-fetching`, `expo-dev-client` |
| 1.3 Multi-utterance routines | `openai-docs`, `ai-sdk` |
| 1.4 AssistantOverlay | `expo-router`, `expo-animation`, `expo-native-ui` (+ `expo-design-system` optional) |
| 2 — Action-aware reminders | `openai-docs`, `ai-sdk`, `expo-data-fetching`, `expo-router`, `expo-ui`, `vercel-react-native-skills` *(Google People/Meet/Gmail: vendor docs)* |
| 2.1 Google account linking | `expo-data-fetching`, `expo-router`, `expo-ui` |
| 2.2 Action tools for LLM | `openai-docs`, `ai-sdk` |
| 2.3 Reminder schema extension | `openai-docs`, `ai-sdk` (backend-only) |
| 2.4 Contacts fallback | `expo-ui`, `expo-router`, `expo-data-fetching` |
| 3 — Smart pre-reminders | `vercel-react-native-skills`, `openai-docs`, `ai-sdk`, `expo-data-fetching` *(notifications + cron: Expo/node-cron docs)* |
| 3.1 Lead-time model | `openai-docs`, `ai-sdk` |
| 3.2 Scheduling changes | `vercel-react-native-skills`, `expo-data-fetching` |
| 3.3 Parser/prompt changes | `openai-docs`, `ai-sdk` |
| 4 — Actionable notifications | `expo-router`, `expo-dev-client`, `expo-data-fetching`, `expo-ui`, `vercel-react-native-skills` *(categories: Expo Notifications docs)* |
| 4.1 Rich notification content | `expo-dev-client`, `vercel-react-native-skills` |
| 4.2 Tap routing | `expo-router`, `expo-ui`, `expo-data-fetching` |
| 4.3 Meeting-time smartness | *(backend-only — Google Meet API vendor docs)* |
| 5 — Calendar-style view | `expo-ui`, `expo-router`, `expo-data-fetching`, `vercel-react-native-skills`, `expo-animation`, `expo-native-ui` (+ `expo-design-system` optional) |
| 5.1 Day timeline | `expo-ui`, `vercel-react-native-skills`, `expo-animation`, `expo-data-fetching` |
| 5.2 Day navigation | `expo-router`, `expo-animation`, `vercel-react-native-skills` |
| 5.3 Optional polish | `expo-native-ui`, `expo-design-system` (optional), `expo-animation` |
| 6 — Cross-cutting changes | `expo-overview`, `openai-docs`, `ai-sdk`, `expo-dev-client`, `expo-upgrade`, `eas-update` (+ `eas-app-stores` / `eas-workflows` optional) |

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

### Phase 8 — Deployments (Vercel-like mobile workflow)

#### Feature 8.1 — Deploy backend to Render Free

**Goal:** API on a public HTTPS URL (phone doesn’t need LAN), using Render’s free web service.

**Agent skills:** *(none required — not an Expo feature; follow this plan + Render docs)*. Optionally keep `expo-data-fetching` in mind when updating the mobile API base URL afterward.

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

**Agent skills:** `eas-update`; optionally `eas-update-insights`

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

**Agent skills:** `eas-app-stores`, `expo-dev-client`; optionally `eas-workflows`

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

**Agent skills:** `expo-ui`, `vercel-react-native-skills`; optionally `expo-animation` for subtle polish

**Implement:** Friendly empties on calendar; disable double-submit; offline message.

**Test:** Airplane mode → graceful error; retry works.

**DONE when:** No white-screen crashes on common errors.

---

#### Feature 9.2 — End-to-end demo script freeze

**Agent skills:** `eas-update` (verify preview channel); `eas-app-stores` if demoing from a preview APK

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
- [x] 0.4 Accounts/tooling verified
- [x] 1.1 Backend health
- [x] 1.2 Mongo + User model
- [x] 1.3 Auth JWT
- [x] 1.4 Reminder CRUD
- [x] 2.1 Expo shell
- [x] 2.2 API client ping
- [x] 2.3 Auth UI + SecureStore
- [x] 3.1 OpenAI tools backend
- [x] 3.2 Text composer UI
- [x] 4.1 Calendar UI
- [x] 4.2 Detail edit/delete
- [x] 5.1 Whisper backend
- [x] 5.2 Mic UI
- [x] 6.1 Local notifications
- [x] 6.1b Dev build (if needed)
- [x] 6.2 Push token register
- [x] 6.3 Remote push (optional)
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
