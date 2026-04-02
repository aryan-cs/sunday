# Smart Calendar Pipeline

Turn Gmail into a travel-aware calendar assistant.

This project:
- watches unread Gmail messages
- parses them with a real LLM into structured event/action data
- creates Google Calendar events
- computes travel-aware reminders with Google Maps
- sends summaries through Telegram or iMessage

Important behavior:
- the app ignores unread emails that were already sitting in the inbox when it starts
- it only processes emails that arrive after the watcher is already running

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
- `DEFAULT_HOME_LOCATION`

Optional but recommended if you want smarter weekday travel inference:
- `DEFAULT_WORK_LOCATION`
- `WORK_DAYS`
- `WORKDAY_START_TIME`
- `WORKDAY_END_TIME`
- `TARGET_CALENDAR_ID` if you want Sunday to write into a dedicated Google Calendar instead of `primary`

Recommended local defaults for Gemini or another free-tier provider:
- `MAX_EMAILS_PER_CYCLE=3`
- `LLM_RETRY_ATTEMPTS=4`
- `LLM_RETRY_BASE_SECONDS=5`

Those settings help avoid blowing through rate limits on first startup when you already have unread mail in your inbox.

If you use iMessage instead of Telegram:
- set `IMESSAGE_ENABLED=true`
- set `IMESSAGE_RECIPIENT`
- leave Telegram fields blank if you want

## Google Setup

### 4. Create a Google Cloud project

Everything in this section is done in [Google Cloud Console](https://console.cloud.google.com/).

#### 4.1 Create the project

1. Create a new Google Cloud project for this app.
2. Make sure you stay in that same project for every step below.

#### 4.2 Configure the OAuth consent screen

This app reads Gmail, marks processed Gmail messages, and writes to Google Calendar, so you need a real OAuth app, not just an API key.

1. Go to `Google Auth Platform`.
   If your console still shows the older layout, use `APIs & Services -> OAuth consent screen`.
2. Create the app configuration if Google asks you to.
3. Fill in the basics:
   - app name: anything you want, like `Sunday`
   - support email: your Google account
   - developer contact email: your Google account
4. Choose `External` audience.
5. Leave the app in `Testing` while you are developing locally.
6. Add your own Google account under `Test users`.

If you skip the test-user step, Google OAuth will fail with an `access_denied` or "app has not completed the Google verification process" screen.

#### 4.3 Enable the Google Workspace APIs this app uses

Go to `APIs & Services -> Library` and enable:
- `Gmail API`
- `Google Calendar API`

This app requests these OAuth scopes when you sign in:
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/calendar`

#### 4.4 Create the Desktop OAuth client

1. Go to `APIs & Services -> Credentials`.
2. Click `Create Credentials -> OAuth client ID`.
3. Application type: `Desktop app`
4. Name it anything you want.
5. Download the JSON file.
6. Save that file in the repo root as `credentials.json`.

That filename must match `GOOGLE_CREDENTIALS_FILE` in `config.env`.

Important:
- use a `Desktop app` client, not `Web application`
- if you create a new OAuth client later, replace `credentials.json`
- if OAuth starts behaving strangely after rotating credentials, delete `token.json` and sign in again

### 5. Get a Google Maps key

The app uses Google Maps separately from Gmail and Calendar. It needs this for travel time and exact address lookups.

#### 5.1 Turn on billing for the project

Google Maps Platform APIs require billing on the project. If billing is missing, the API key may exist but requests can still fail.

#### 5.2 Enable the Maps APIs this app uses

Go to `APIs & Services -> Library` and enable:
- `Distance Matrix API`
- `Geocoding API`
- `Places API`

#### 5.3 Create the API key

1. Go to `APIs & Services -> Credentials`.
2. Click `Create Credentials -> API key`.
3. Copy the key into `GOOGLE_MAPS_API_KEY` in `config.env`.

#### 5.4 Set key restrictions correctly

Open that API key and configure:

1. `API restrictions`
   - restrict the key to:
     - `Distance Matrix API`
     - `Geocoding API`
     - `Places API`
2. `Application restrictions`
   - for local development, `None` is the easiest way to confirm the key works
   - for a real server deployment, use a server-safe restriction like `IP addresses`
   - do not use `HTTP referrers`, `Android`, or `iOS` restrictions for this backend key

If travel time works but venue lookup or address lookup fails with `REQUEST_DENIED`, the most common cause is that the key is allowed to call `Distance Matrix API` but not `Geocoding API` and `Places API`.

Without this key, in-person travel reminders, exact address lookups, and robust business-name matching will fail instead of guessing fake travel times or addresses.

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
- Cerebras
- Ollama
- Together
- Mistral
- Hugging Face
- Custom OpenAI-compatible endpoint

Only configure the provider you actually plan to use.

### Cerebras setup

If Gemini is rate-limiting you, Cerebras is a good fast fallback for this app.

1. Create an API key in Cerebras Cloud.
2. In `config.env`, set:
   - `ACTIVE_LLM_PROVIDER=cerebras`
   - `CEREBRAS_API_KEY=...`
   - `CEREBRAS_MODEL=llama3.1-8b`
3. If you are on the free tier, optionally set `LLM_REQUESTS_PER_MINUTE=25` to stay a bit under Cerebras's published 30 RPM free-tier limit.

Example:

```env
ACTIVE_LLM_PROVIDER=cerebras
CEREBRAS_API_KEY=your_key_here
CEREBRAS_MODEL=llama3.1-8b
LLM_REQUESTS_PER_MINUTE=25
```

The app talks to Cerebras through its OpenAI-compatible `/v1/chat/completions` API, so no extra code or SDK install is needed once those env vars are set.

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

What `IMESSAGE_RECIPIENT` should be:
- the exact phone number or email address you would type into the "To:" field in the Messages app
- usually one of these:
  - your own iPhone number, like `+12175551234`
  - your Apple ID/iMessage email, like `name@icloud.com`
  - another person's iMessage-enabled phone number or Apple ID email

Examples:
- `IMESSAGE_RECIPIENT=+12175551234`
- `IMESSAGE_RECIPIENT=name@icloud.com`

If you want the bot to message you, use your own iMessage-reachable address.

How to find the correct value:
1. Open the `Messages` app on your Mac.
2. Start a new message.
3. In the `To:` field, type the address you normally use to message yourself or the target person.
4. Use that exact value in `IMESSAGE_RECIPIENT`.

If you are not sure whether to use your phone number or email:
1. On your iPhone, open `Settings -> Apps -> Messages -> Send & Receive`.
2. Look under `You Can Receive iMessages To And Reply From`.
3. Use one of those checked phone numbers or email addresses.

Prerequisites for iMessage to work:
- you must be on macOS
- you must be signed into the `Messages` app
- iMessage must already work manually from that Mac

Set:
- `IMESSAGE_ENABLED=true`
- `IMESSAGE_RECIPIENT=<phone number or email from above>`
- `TEXT_EMAIL_LINKS=true` if you want the original Gmail thread link sent as a follow-up text

If iMessage is enabled but not correctly configured, delivery fails visibly.

Quick test:
1. Open `Messages` on your Mac and manually send a message to the same phone number or email.
2. If that works, use the same value in `IMESSAGE_RECIPIENT`.
3. If manual sending does not work, the app will not work either.

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

The default polling interval is now `10` seconds, so new test emails should usually be picked up quickly.

If you start the app with 500 unread emails already in your inbox, it will not try to process that whole backlog.

## Useful Commands

Run the local polling worker:

```bash
uv run python main.py
```

If you hit LLM `429 Too Many Requests` errors:
- wait a minute and rerun
- keep `MAX_EMAILS_PER_CYCLE` low, such as `1` to `3`
- or switch to another provider in `config.env`

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
- `POST /api/plan-day`

### Travel Origin Inference

Travel time is inferred without live phone location.

For in-person events, the app chooses the most likely departure point in this order:
1. the latest scheduled calendar event location before the new event
2. otherwise `DEFAULT_WORK_LOCATION` during configured work hours
3. otherwise `DEFAULT_HOME_LOCATION`

To enable work-aware travel inference, set these in `config.env`:
- `DEFAULT_WORK_LOCATION`
- `DEFAULT_WORK_LATITUDE`
- `DEFAULT_WORK_LONGITUDE`
- `WORK_DAYS`
- `WORKDAY_START_TIME`
- `WORKDAY_END_TIME`

Example:

```env
DEFAULT_HOME_LOCATION=Champaign, IL
DEFAULT_WORK_LOCATION=Siebel Center for Computer Science, Urbana, IL
WORK_DAYS=mon,tue,wed,thu,fri
WORKDAY_START_TIME=09:00
WORKDAY_END_TIME=17:00
```

### Sunday Write Calendar

By default, Sunday writes managed events into your primary Google Calendar.

If you want Sunday-created events to live in a dedicated calendar instead:
1. Create a Google Calendar such as `Sunday`
2. Copy its calendar ID from Google Calendar settings
3. Set `TARGET_CALENDAR_ID` in `config.env`

Example:

```env
TARGET_CALENDAR_ID=primary
```

Important note:
- Sunday still reads across your visible calendars for context, conflict detection, and travel-origin inference
- `TARGET_CALENDAR_ID` only changes where Sunday writes and deduplicates its own managed events

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
- `DEFAULT_HOME_LOCATION`
- `DEFAULT_WORK_LOCATION` if you want work-aware travel origins
- `TARGET_CALENDAR_ID` if Sunday should write to a non-primary calendar
- `GOOGLE_MAPS_API_KEY`
- `CRON_SECRET`

### 12. Deploy

```bash
vercel deploy --prod
```

`vercel.json` is already in the repo root.

Important note:
- the core cron pipeline works fine on Vercel

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
