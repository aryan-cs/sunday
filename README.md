# Smart Calendar Pipeline

Turn Gmail into a travel-aware calendar assistant.

This project:
- watches unread Gmail messages
- parses them with a real LLM into structured event/action data
- creates Google Calendar events
- computes travel-aware reminders with Google Maps
- sends summaries through Telegram or iMessage

The production path is strict by design. If parsing, messaging, or travel estimation fails, the app fails visibly instead of inventing fallback data.

## What You Need

Before you start, make sure you have:
- Python 3.10+
- [`uv`](https://docs.astral.sh/uv/)
- A Google account for Gmail and Calendar
- One LLM provider key
  - easiest: Gemini
- A Google Maps API key if you want in-person travel reminders
- One messaging output
  - Telegram is easiest
  - iMessage works on macOS only

## Project Layout

Everything now lives in the repository root:

```text
.
├── README.md
├── PLAN.md
├── config.env.example
├── pyproject.toml
├── main.py
├── server.py
├── config.py
├── gmail_watcher.py
├── email_parser.py
├── llm_client.py
├── calendar_manager.py
├── travel_estimator.py
├── messenger.py
├── pipeline.py
├── tests/
└── ...
```

## Setup From Zero

### 1. Clone the repo

```bash
git clone https://github.com/aryan-cs/sunday.git
cd sunday
```

### 2. Install dependencies

```bash
uv sync
```

### 3. Create your local config file

```bash
cp config.env.example config.env
```

Then open `config.env` and fill in the values you actually need.

Minimum working local setup:
- `ACTIVE_LLM_PROVIDER`
- one matching LLM API key
- `GOOGLE_CREDENTIALS_FILE`
- `GOOGLE_MAPS_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `MY_DEFAULT_LOCATION`

If you use iMessage instead of Telegram:
- set `IMESSAGE_ENABLED=true`
- set `IMESSAGE_RECIPIENT`
- leave Telegram fields blank if you want

## Google Setup

### 4. Create a Google Cloud project

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create a project.
2. Enable:
   - Gmail API
   - Google Calendar API
   - Distance Matrix API
3. Go to `APIs & Services -> Credentials`.
4. Create an OAuth client ID.
5. Choose `Desktop app`.
6. Download the credentials JSON.
7. Save it in the repo root as `credentials.json`.

That filename must match `GOOGLE_CREDENTIALS_FILE` in `config.env`.

### 5. Get a Google Maps key

Still in Google Cloud:

1. Create an API key.
2. Make sure the key can access Distance Matrix API.
3. Put it into `GOOGLE_MAPS_API_KEY` in `config.env`.

Without this key, in-person travel reminders will fail instead of guessing fake travel times.

## LLM Setup

### 6. Pick an LLM provider

Recommended easiest path:
- Gemini

Steps:
1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Create an API key.
3. Set:
   - `ACTIVE_LLM_PROVIDER=gemini`
   - `GEMINI_API_KEY=...`

Other providers are supported too:
- OpenRouter
- Groq
- Ollama
- Together
- Mistral
- Hugging Face
- Custom OpenAI-compatible endpoint

Only configure the provider you actually plan to use.

## Messaging Setup

### 7. Set up Telegram

This is the easiest production-friendly option.

1. Open Telegram.
2. Message [@BotFather](https://t.me/BotFather).
3. Create a bot with `/newbot`.
4. Copy the bot token into `TELEGRAM_BOT_TOKEN`.
5. Send your bot a message once.
6. Visit:

```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

7. Find your `chat.id`.
8. Put that value into `TELEGRAM_CHAT_ID`.

The pipeline now has a real delivery channel.

### 8. Optional: use iMessage instead

iMessage only works on macOS and uses AppleScript.

Set:
- `IMESSAGE_ENABLED=true`
- `IMESSAGE_RECIPIENT=...`

If iMessage is enabled but not correctly configured, delivery fails visibly.

## First Run

### 9. Start the app locally

```bash
uv run python main.py
```

On first run:
- a browser window should open
- Google OAuth consent should appear
- after you approve it, `token.json` will be created in the repo root

That token is used for Gmail and Calendar access.

### 10. Send yourself a real test email

Use something obvious, for example:
- a meeting with a date and time
- a Zoom/Meet link
- a real physical address

Then watch the logs.

Expected flow:
1. unread Gmail message is fetched
2. LLM parses it into structured JSON
3. Calendar event is created if details are complete enough
4. Telegram or iMessage summary is delivered
5. the Gmail message is marked processed only after delivery succeeds

## Useful Commands

Run the local polling worker:

```bash
uv run python main.py
```

Run the API server:

```bash
uv run uvicorn server:app --reload --port 8000
```

Run tests:

```bash
uv run pytest
```

## Optional API Endpoints

If you run the FastAPI server, you get:
- `GET /health`
- `GET /api/status`
- `POST /api/process`
- `GET /api/location`
- `POST /api/location`
- `POST /api/plan-day`

### Live location updates

You can send location from an iPhone Shortcut to `POST /api/location`.

This improves travel estimates by using your real current location instead of `MY_DEFAULT_LOCATION`.

## Optional Vercel Deployment

You can deploy the API server to Vercel for cron-driven processing.

### 11. Prepare Google auth for Vercel

Vercel cannot run the local browser OAuth flow.

Run locally first so `token.json` exists, then encode both files:

```bash
python -c "import base64; print(base64.b64encode(open('token.json','rb').read()).decode())"
python -c "import base64; print(base64.b64encode(open('credentials.json','rb').read()).decode())"
```

In Vercel environment variables, set:
- `GOOGLE_TOKEN_JSON`
- `GOOGLE_CREDENTIALS_JSON`
- your LLM key
- your Telegram or iMessage settings
- `MY_DEFAULT_LOCATION`
- `GOOGLE_MAPS_API_KEY`
- `CRON_SECRET`

### 12. Deploy

```bash
vercel deploy --prod
```

`vercel.json` is already in the repo root.

Important note:
- the core cron pipeline works fine on Vercel
- live location persistence is not durable there unless you add external storage

## Troubleshooting

### The app says config is invalid

Check:
- `config.env` exists in the repo root
- your chosen LLM key is set
- `credentials.json` exists
- Telegram or iMessage is configured

### In-person events are failing

Check:
- `GOOGLE_MAPS_API_KEY` is set
- Distance Matrix API is enabled
- the parsed event has a real location

### Gmail/Calendar auth is failing

Check:
- `credentials.json` is a Desktop OAuth client
- you completed the browser OAuth flow
- `token.json` exists

If needed, delete `token.json` and rerun:

```bash
rm -f token.json
uv run python main.py
```

### No messages are being sent

Check:
- Telegram bot token is valid
- Telegram chat ID is correct
- or iMessage is enabled on macOS with a valid recipient

There is no stdout delivery fallback anymore.

## Development Notes

- Secrets stay local in `config.env`, `credentials.json`, and `token.json`
- local runtime state goes in `.state/`
- tests live in `tests/`
- the project is meant to be run from the repo root

## Verification

Before pushing changes:

```bash
uv run pytest
uv run python -m compileall .
```
