# Sunday

Sunday is a personal AI assistant that watches your Gmail, manages your calendar, transcribes voice notes, and sends you intelligent summaries via iMessage or Telegram — all powered by your choice of LLM.

## What It Does

- **Email → Calendar** — watches Gmail in real time, parses events with AI, writes to Google Calendar, estimates travel time, and sends you a concise summary
- **Voice Notes** — tap the dot to record, Sunday transcribes and summarizes it instantly
- **AI Insights** — optional agent mode delivers deeper insights via iMessage/Telegram using web search
- **Smart Filtering** — ignores promotions, newsletters, and automated emails
- **OpenClaw** — optional integration with a local AI agent for autonomous task handling

## Table of Contents

1. [How It Works](#how-it-works)
2. [Project Layout](#project-layout)
3. [Quick Start — Demo (No Setup)](#quick-start--demo-no-setup)
4. [Deployment](#deployment)
   - [Backend → Railway](#backend--railway)
   - [Frontend → Vercel](#frontend--vercel)
5. [Expo Go (Local Dev)](#expo-go-local-dev)
6. [Tailscale (Remote Access)](#tailscale-remote-access)
7. [OpenClaw Integration](#openclaw-integration)
8. [Local Setup From Scratch](#local-setup-from-scratch)
9. [LLM Providers](#llm-providers)
10. [Messaging Channels](#messaging-channels)
11. [Agent Mode](#agent-mode)
12. [Configuration Guide](#configuration-guide)
13. [API Endpoints](#api-endpoints)
14. [Troubleshooting](#troubleshooting)

---

## How It Works

### Email → Calendar

```
Gmail inbox
  → AI parses email (event, urgency, action items)
  → Travel time estimated via Google Maps
  → Event written to Google Calendar
  → Summary sent to iMessage / Telegram
  → (optional) OpenClaw or built-in AI adds deeper insights
```

### Voice Notes

```
Record on phone / browser
  → Audio uploaded to backend
  → Groq Whisper API transcribes it
  → AI generates a short title
  → Entry appears in Alerts tab
```

---

## Project Layout

```
sunday/
├── backend/          Python backend (Gmail, LLM, calendar, transcription)
├── sunday-app/       Expo app (iOS, Android, Web)
├── models/           Local model files (ignored by git)
├── config.env        Your local config (ignored by git)
├── config.env.example  Template
├── Procfile          Railway deployment
└── vercel.json       Legacy Vercel config (root)

sunday-app/
├── src/
│   ├── screens/      Settings, Today, Home (record), Alerts, Auth
│   ├── lib/          API client, auth, recorder, transcription
│   └── stubs/        Web platform stubs (react-native-maps)
├── vercel.json       Vercel deployment config for Expo Web
└── metro.config.js   Metro bundler config (web stubs)
```

---

## Quick Start — Demo (No Setup)

The fastest way to try Sunday is the hosted web app. No account, no API keys.

1. Open the Vercel URL (set by whoever deployed it)
2. Click **Try Demo →**
3. Browse the pre-populated Alerts, Today schedule, and Settings

---

## Deployment

### Backend → Railway

1. Fork this repo to your GitHub account
2. Go to **railway.app** → **New Project** → **Deploy from GitHub repo** → select your fork
3. Railway detects the `Procfile` automatically
4. Go to **Variables** and add:

```
GROQ_API_KEY          = gsk_...          # from console.groq.com (free)
ACTIVE_LLM_PROVIDER   = groq
GROQ_MODEL            = llama-3.1-8b-instant
JWT_SECRET            = <random 32+ char string>
AGENT_MODE            = off
```

5. **Settings → Networking → Generate Domain** — copy your Railway URL

> **Transcription** uses Groq's Whisper API automatically when `GROQ_API_KEY` is set — no model files needed on the server.

**Optional — real Gmail sign-in:**

To let users connect their own Gmail:

1. In Google Cloud Console → **Credentials** → change your OAuth client type to **Web application**
2. Add `https://your-app.railway.app/auth/google/callback` as an Authorized redirect URI
3. Download the new `credentials.json`, base64-encode it:
   ```bash
   python3 -c "import base64; print(base64.b64encode(open('credentials.json','rb').read()).decode())"
   ```
4. Add to Railway: `GOOGLE_CREDENTIALS_JSON = <base64 output>`

---

### Frontend → Vercel

1. Go to **vercel.com** → **Add New Project** → import your fork
2. Set **Root Directory** to `sunday-app`
3. Add environment variable:
   ```
   EXPO_PUBLIC_API_BASE_URL = https://your-app.railway.app
   ```
4. Click **Deploy**

Judges/users visit your Vercel URL — no install needed.

---

## Expo Go (Local Dev)

Expo Go lets anyone on your local network try the app instantly — no TestFlight, no build.

### Setup

```bash
cd sunday-app
cp .env.example .env
# Edit .env — set EXPO_PUBLIC_API_BASE_URL to your Mac's local IP:
# EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000
npm install
npm run start
```

Scan the QR code with the **Expo Go** app (iOS App Store / Google Play).

### Tunnel mode (if QR code doesn't connect)

```bash
npm run start -- --tunnel
```

This routes traffic through Expo's servers so the phone doesn't need to be on the same network.

### Finding your Mac's IP

```bash
ipconfig getifaddr en0   # Wi-Fi
ipconfig getifaddr en1   # Ethernet
```

### Limitations in Expo Go

| Feature | Expo Go | Deployed build |
|---|---|---|
| Core app (record, alerts, settings) | ✅ | ✅ |
| iMessage / Telegram notifications | ✅ (backend sends) | ✅ |
| Voice recording | ✅ | ✅ |
| Home screen widgets | ❌ | ✅ |
| Push notifications | ❌ | ✅ |
| Background processing | ❌ | ✅ |

---

## Tailscale (Remote Access)

Tailscale lets the backend (on your Mac) be reachable from anywhere — useful for OpenClaw and for accessing Sunday when you're not on the same Wi-Fi.

### Setup

1. Install Tailscale on your Mac: **tailscale.com/download**
2. Sign in and enable Tailscale
3. Get your Mac's Tailscale IP:
   ```bash
   tailscale ip -4
   ```
4. Use that IP in `EXPO_PUBLIC_API_BASE_URL`:
   ```
   EXPO_PUBLIC_API_BASE_URL=http://100.x.y.z:8000
   ```

Now Expo Go can reach your backend from any network — phone data, different Wi-Fi, anywhere.

### Use with OpenClaw

If you're running OpenClaw on your Mac and want the Railway backend to send it webhooks:

1. Enable Tailscale in OpenClaw config:
   ```json
   "tailscale": { "mode": "on" }
   ```
2. OpenClaw gets a Tailscale URL like `https://your-mac.tailnet.ts.net:18789`
3. Set in Railway variables:
   ```
   OPENCLAW_BASE_URL  = https://your-mac.tailnet.ts.net:18789
   OPENCLAW_TOKEN     = your-openclaw-token
   OPENCLAW_ENABLED   = true
   AGENT_MODE         = openclaw
   ```

---

## OpenClaw Integration

OpenClaw is an optional local AI agent that runs on your Mac. When enabled, Sunday sends it action items from emails and voice notes for autonomous handling.

### How it works

```
Email processed by Sunday
  → action items extracted
  → POST /hooks/wake sent to OpenClaw
  → OpenClaw agent runs with your LLM
  → responds via iMessage
```

### Setup

1. Install OpenClaw: **openclaw.ai**
2. Set up your preferred LLM (needs Anthropic or OpenAI key in OpenClaw)
3. Enable the iMessage channel in OpenClaw and restrict to your number:
   ```json
   "dmPolicy": "allowlist",
   "allowFrom": ["+1xxxxxxxxxx"]
   ```
4. Enable Tailscale in OpenClaw for remote access
5. In `config.env` (local) or Railway variables:
   ```
   AGENT_MODE         = openclaw
   OPENCLAW_ENABLED   = true
   OPENCLAW_BASE_URL  = https://your-mac.tailnet.ts.net:18789
   OPENCLAW_TOKEN     = your-hook-token
   ```

### Agent mode options

| Mode | What happens |
|---|---|
| `off` | No AI insights, just summaries |
| `builtin` | Sunday's own LLM + DuckDuckGo web search, sends insight via iMessage/Telegram |
| `openclaw` | Sends action items to your local OpenClaw agent |

---

## Local Setup From Scratch

### Requirements

- Python 3.10+
- Node.js 18+
- `uv` package manager (`pip install uv`)
- Google Cloud project with Gmail API, Calendar API, Maps APIs enabled
- One LLM API key (Groq recommended — free tier)

### Steps

```bash
# 1. Clone
git clone https://github.com/aryan-cs/sunday.git
cd sunday

# 2. Python deps
uv sync --extra dev

# 3. App deps
cd sunday-app && npm install && cd ..

# 4. Config
cp config.env.example config.env
# Edit config.env with your keys

# 5. Google OAuth
# Download credentials.json from Google Cloud Console
# Run backend once to trigger browser OAuth flow

# 6. Start backend
uv run uvicorn backend.server:app --host 0.0.0.0 --port 8000

# 7. Start app
cd sunday-app && npm run start
```

### Local config minimum

```env
ACTIVE_LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.1-8b-instant

GOOGLE_CREDENTIALS_FILE=credentials.json
GOOGLE_TOKEN_FILE=token.json

IMESSAGE_ENABLED=true
IMESSAGE_RECIPIENT=+1xxxxxxxxxx
# or use Telegram:
# TELEGRAM_BOT_TOKEN=...
# TELEGRAM_CHAT_ID=...

DEFAULT_HOME_LOCATION=Your City, State
TIMEZONE=America/Chicago
```

---

## LLM Providers

Sunday supports any of these — set `ACTIVE_LLM_PROVIDER` to one:

| Provider | Key env var | Free tier |
|---|---|---|
| `groq` | `GROQ_API_KEY` | ✅ Generous |
| `gemini` | `GEMINI_API_KEY` | ✅ 1500 req/day |
| `openrouter` | `OPENROUTER_API_KEY` | ✅ Free models |
| `openai` | `OPENAI_API_KEY` | ❌ Paid |
| `anthropic` | `ANTHROPIC_API_KEY` | ❌ Paid |
| `ollama` | — | ✅ Self-hosted |
| `mistral` | `MISTRAL_API_KEY` | ✅ Free tier |
| `cerebras` | `CEREBRAS_API_KEY` | ✅ Free tier |
| `together` | `TOGETHER_API_KEY` | ✅ Free credits |

**Recommended for deployment:** Groq — fast, free tier, and also handles transcription via Whisper API.

---

## Messaging Channels

### iMessage (macOS only)

```env
IMESSAGE_ENABLED=true
IMESSAGE_RECIPIENT=+1xxxxxxxxxx
TEXT_EMAIL_LINKS=true
```

Requires `imsg` CLI:
```bash
brew install steipete/tap/imsg
```
Grant Terminal Full Disk Access in System Settings → Privacy & Security.

### Telegram

1. Message `@BotFather` on Telegram → `/newbot`
2. Copy the token
3. Message your bot once, then get your chat ID from `api.telegram.org/bot<token>/getUpdates`

```env
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
```

---

## Agent Mode

Controls what Sunday does after processing an email or voice note.

```env
AGENT_MODE=off       # just send the summary (default)
AGENT_MODE=builtin   # Sunday calls the LLM with web search, sends insight
AGENT_MODE=openclaw  # push to your local OpenClaw agent
```

`builtin` works with any configured LLM provider — no OpenClaw needed.

---

## Configuration Guide

Full list of settings — all editable in `config.env` or via the app Settings screen.

| Key | Description |
|---|---|
| `ACTIVE_LLM_PROVIDER` | Which LLM to use |
| `TARGET_CALENDAR_ID` | Calendar Sunday writes events to (`primary` = default) |
| `DEFAULT_HOME_LOCATION` | Used for travel estimates |
| `WORK_DAYS` | Comma-separated: `mon,tue,wed,thu,fri` |
| `WORKDAY_START_TIME` | HH:MM 24h format |
| `WORKDAY_END_TIME` | HH:MM 24h format |
| `TRAVEL_TYPE` | `driving`, `walking`, `bicycling`, `transit` |
| `PREP_TIME_MINUTES` | Buffer before in-person events |
| `ONLINE_PREP_MINUTES` | Buffer before online events |
| `GMAIL_LABELS` | Labels to watch: `CATEGORY_PRIMARY`, `INBOX`, custom labels |
| `POLL_INTERVAL_SECONDS` | How often to check Gmail |
| `MAX_EMAILS_PER_CYCLE` | Max emails processed per poll |
| `AGENT_MODE` | `off`, `builtin`, `openclaw` |
| `AUTO_CLEANUP_HOURS` | Delete managed events older than N hours |
| `TIMEZONE` | e.g. `America/Chicago` |
| `LLM_MAX_TOKENS` | Max tokens per LLM call |
| `LLM_TEMPERATURE` | LLM temperature (0.0–1.0) |
| `LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/signup` | Create account |
| POST | `/auth/login` | Log in |
| POST | `/auth/demo` | Demo login (no account needed) |
| GET | `/auth/google` | Start Google OAuth web flow |
| GET | `/auth/google/callback` | Google OAuth callback |

### App
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/status` | Config status |
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/events` | Upcoming calendar events with travel |
| POST | `/api/transcribe` | Upload audio for transcription |
| POST | `/api/plan-day` | Generate day plan |
| POST | `/api/location` | Update phone location |
| POST | `/api/process` | Manually trigger email processing |

---

## Troubleshooting

### App can't reach backend in Expo Go

- Check `EXPO_PUBLIC_API_BASE_URL` is your Mac's IP (not localhost)
- Backend must be running with `--host 0.0.0.0`
- Phone and Mac must be on the same Wi-Fi — or use Tailscale

### Transcription fails on Railway

- Make sure `GROQ_API_KEY` is set in Railway variables
- Groq Whisper API handles transcription in the cloud — no local model needed

### OpenClaw not receiving webhooks

- Make sure Tailscale is running on your Mac
- Check `OPENCLAW_BASE_URL` points to your Tailscale IP/hostname
- Verify `OPENCLAW_TOKEN` matches the token in `~/.openclaw/openclaw.json`
- Check OpenClaw gateway is running: `openclaw start`

### "Something went wrong" in iMessage from OpenClaw

- OpenClaw's `claude-cli` model requires an active Claude Code session
- Switch to a direct API model: `openclaw config set agents.defaults.model.primary "anthropic/claude-3-5-haiku-latest"`
- Or set `AGENT_MODE=builtin` in your config to bypass OpenClaw entirely

### Google OAuth fails on deployed backend

- Make sure your OAuth client type is **Web application** (not Desktop app)
- Add `https://your-railway-url/auth/google/callback` to Authorized redirect URIs
- Set `GOOGLE_CREDENTIALS_JSON` in Railway (base64-encoded credentials.json)

### Sunday processes promotional emails

- Set `GMAIL_LABELS=CATEGORY_PRIMARY` to watch only the Primary inbox tab
- The LLM prompt filters marketing emails but `CATEGORY_PRIMARY` is the strongest filter
