# Smart Calendar Pipeline

Watches your Gmail, parses emails with a **free** LLM, creates Google Calendar events with smart travel-aware notifications, and sends you a Telegram/iMessage summary.

The production path is strict by design: no fake travel estimates, no parse fallbacks, and no stdout-only notification shortcut. If a dependency is missing or an API response is unusable, the pipeline fails visibly instead of inventing data.

## Quick Start

### 1. Install dependencies (requires [uv](https://docs.astral.sh/uv/))

```bash
cd smart-calendar
uv sync
```

### 2. Configure

Open `config.env` and fill in **at minimum**:
- `GEMINI_API_KEY` (or any other LLM provider key) — [get free key](https://aistudio.google.com/apikey)
- `GOOGLE_CREDENTIALS_FILE` — download from Google Cloud Console (see Step 3)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — or set `IMESSAGE_ENABLED=true`
- `MY_DEFAULT_LOCATION` — your home/default address for travel time calculations
- `GOOGLE_MAPS_API_KEY` — required for in-person events with travel-aware reminders

Optional but recommended:
- `STATE_DIR` — writable directory for runtime state such as processed Gmail IDs and live location. Defaults to `smart-calendar/.state` for local/self-hosted runs.
- `OPENROUTER_SITE_URL` — only if you use OpenRouter and want attribution headers on requests.

### 3. Google Cloud setup (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → Create a project
2. Enable these APIs: **Gmail API**, **Google Calendar API**, **Distance Matrix API**
3. Go to APIs & Services → Credentials → Create Credentials → **OAuth 2.0 Client ID**
   - Application type: **Desktop app**
   - Download the JSON → save as `credentials.json` in this folder
4. First run will open a browser for OAuth consent — grant Gmail + Calendar access

### 4. Run locally

```bash
uv run python main.py
```

The pipeline polls for unread emails every 60 seconds (configurable via `POLL_INTERVAL_SECONDS`).

Messages are only marked as processed after the summary is delivered. Calendar writes are idempotent, so retries do not create duplicate events for the same Gmail message.

---

## Deploy to Vercel

Vercel runs the FastAPI server with a cron job that replaces the polling loop.

The core Gmail → parse → Calendar → summary flow works well on Vercel. The live-location endpoint is different: Vercel does not provide durable local filesystem storage, so `/api/location` should only be considered production-safe there if you add a persistent backing store. If you do not need live GPS updates, set `MY_DEFAULT_LOCATION` and the core pipeline remains fine.

### Preparing the Google OAuth token for Vercel

Vercel's serverless functions can't run a browser OAuth flow. You need to generate the token locally first, then store it as an environment variable.

1. Run the app locally at least once so `token.json` is created.
2. Base64-encode both secret files:

```bash
# Encode the token
python -c "import base64; print(base64.b64encode(open('token.json','rb').read()).decode())"

# Encode the credentials
python -c "import base64; print(base64.b64encode(open('credentials.json','rb').read()).decode())"
```

3. In Vercel → your project → Settings → Environment Variables, add:
   - `GOOGLE_TOKEN_JSON` = the base64 token string
   - `GOOGLE_CREDENTIALS_JSON` = the base64 credentials string
   - All the other keys from `config.env` (GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, etc.)
   - `CRON_SECRET` = a random secret string (keeps the `/api/process` endpoint private)
   - `MY_DEFAULT_LOCATION` and `GOOGLE_MAPS_API_KEY` if you want travel-aware reminders in production

### Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel deploy --prod
```

The `vercel.json` cron job calls `/api/process` every minute automatically.

> **Note:** Vercel Cron Jobs require the **Pro plan** ($20/mo). On the free Hobby plan,
> you can still trigger the pipeline manually via `POST /api/process`.

### iOS Shortcuts

#### Share your live location (so travel time uses where you actually are)

Create a Shortcut that runs **automatically whenever your location changes significantly**
(set it as an automation trigger):

1. Add **"Get Current Location"** action
2. Add **"Get Address from Location"** → pass the result from step 1
3. Add **"Get Contents of URL"**:
   - URL: `http://YOUR_SERVER:8000/api/location`
   - Method: POST
   - Request Body: JSON
   - Fields:
     - `lat` → Current Location.**Latitude**
     - `lng` → Current Location.**Longitude**
     - `address` → Street from step 2

Set this as a **Location automation** in the Shortcuts app (Automation tab → New → Arrives/Leaves → set a radius). It runs silently in the background and keeps the server's origin updated.

You can verify it's working: `curl http://localhost:8000/api/location`

For Vercel deployments, do not rely on this endpoint unless you have added persistent storage for the location state. Local/self-hosted deployments are the safest option for live-location-aware reminders.

#### Manual email check widget

1. New Shortcut → Add "Get Contents of URL"
2. URL: `http://YOUR_SERVER:8000/api/process`
3. Method: POST
4. Add "Show Result" action
5. Add to Home Screen or Dynamic Island

---

## Architecture

```
Gmail Inbox
    │
    ▼
GmailWatcher (polling / cron)
    │  unread emails
    ▼
email_parser.py  ──►  LLM (Gemini / Groq / Ollama / …)
    │  structured JSON
    ▼
pipeline.py
    ├──► TravelEstimator  ──►  Google Maps Distance Matrix API
    ├──► CalendarManager  ──►  Google Calendar API
    └──► messenger.py     ──►  Telegram Bot  /  iMessage
```

## Project Structure

```
smart-calendar/
├── config.env              ← THE ONE FILE you edit
├── config.py               ← Config loader (reads config.env)
├── errors.py               ← Domain-specific exceptions
├── google_auth.py          ← OAuth helper (local + Vercel env var modes)
├── llm_client.py           ← Unified LLM client (7 providers)
├── gmail_watcher.py        ← Gmail polling
├── email_parser.py         ← LLM prompt + JSON extraction
├── calendar_manager.py     ← Google Calendar event creation
├── travel_estimator.py     ← Google Maps travel time
├── messenger.py            ← Telegram + iMessage output
├── pipeline.py             ← Core logic (shared by main.py and server.py)
├── day_planner.py          ← Bonus: errand route optimizer
├── server.py               ← FastAPI (Vercel + iOS Shortcuts)
├── state_store.py          ← Runtime state paths
├── .state/                 ← Runtime state (processed Gmail IDs, live location)
├── main.py                 ← Local polling loop
├── vercel.json             ← Vercel cron + routing config
└── pyproject.toml          ← uv / pip dependencies
```

## Verification

```bash
uv run pytest
```

## Free LLM Providers

| Provider | Free Tier | Setup |
|---|---|---|
| **Gemini 2.0 Flash** | 1,500 req/day | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **OpenRouter** | Unlimited (`:free` models) | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Groq** | 30 req/min (Llama 8B) | [console.groq.com/keys](https://console.groq.com/keys) |
| **Ollama** | Unlimited (local) | `ollama serve` |

Set `ACTIVE_LLM_PROVIDER` in `config.env` to switch providers.
