# Sunday

Sunday is a Gmail-to-calendar assistant that watches new emails, turns them into structured events, figures out travel and timing, writes those events to Google Calendar, and sends you reminder texts.

It is intentionally strict in production:
- it only processes emails that arrive after the worker starts
- it fails visibly instead of inventing fake data
- it writes Sunday-managed events into one configurable calendar while still reading your other calendars for context

## Table of Contents

1. [How It Works](#how-it-works)
2. [What You Need](#what-you-need)
3. [Setup From Scratch](#setup-from-scratch)
4. [Configuration Guide](#configuration-guide)
5. [Running Sunday](#running-sunday)
6. [Expo App (Local Development)](#expo-app-local-development)
7. [How Travel and Calendar Writing Work](#how-travel-and-calendar-writing-work)
8. [Optional API and Deployment](#optional-api-and-deployment)
9. [Troubleshooting](#troubleshooting)
10. [Development](#development)
11. [To-Do](#to-do)

## How It Works

At a high level, Sunday does this:

1. Poll Gmail for brand-new incoming messages.
2. Parse each email with an LLM into structured event and action data.
3. Infer missing details when reasonable, like event title, likely duration, and cleaner capitalization.
4. Resolve vague venues into real places when possible, then estimate travel time with Google Maps.
5. Decide where you are most likely leaving from using calendar context plus your configured home and work locations.
6. Create or deduplicate a Google Calendar event.
7. Send you a casual text summary right away.
8. Send a separate leave-now text when it is actually time to head out.

Important behavior:
- Sunday ignores the unread backlog that already existed when it started.
- Sunday only processes emails that arrive after startup.
- Sunday writes its own managed events into one target calendar, but it still reads your other calendars for context and travel inference.

Core flow:

```text
new Gmail email
  -> LLM parsing
  -> event inference + cleanup
  -> venue resolution + travel estimate
  -> Google Calendar event creation
  -> summary text
  -> leave-now text later
```

## What You Need

Before setup, make sure you have:

- Python 3.10+
- [`uv`](https://docs.astral.sh/uv/)
- A Google account
- One LLM API key
- One messaging channel
  - Telegram is the easiest
  - iMessage works on macOS only
- A Google Cloud project with:
  - Gmail API
  - Google Calendar API
  - Distance Matrix API
  - Geocoding API
  - Places API
- A Google Maps API key

## Setup From Scratch

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

You will fill this in over the next few sections.

### 4. Create a Google Cloud project

Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project for Sunday.

Use that same project for every Google-related step below.

### 5. Configure Google OAuth for Gmail and Calendar

Sunday uses OAuth for Gmail and Calendar access. This is separate from the Maps API key.

#### 5.1 Configure the consent screen

In Google Cloud:

1. Open `Google Auth Platform`.
   If your console still shows the older layout, use `APIs & Services -> OAuth consent screen`.
2. Create the app configuration if prompted.
3. Set:
   - app name: `Sunday` or whatever you want
   - support email: your email
   - developer contact email: your email
4. Choose `External`.
5. Leave the app in `Testing`.
6. Add your own Google account under `Test users`.

If you skip the test-user step, OAuth will fail with an `access_denied` or “app has not completed the Google verification process” error.

#### 5.2 Enable the Workspace APIs

In `APIs & Services -> Library`, enable:

- `Gmail API`
- `Google Calendar API`

Sunday requests these scopes:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/calendar`

#### 5.3 Create the OAuth client

1. Go to `APIs & Services -> Credentials`
2. Click `Create Credentials -> OAuth client ID`
3. Choose `Desktop app`
4. Download the JSON file
5. Save it in the repo root as `credentials.json`

That filename must match:

```env
GOOGLE_CREDENTIALS_FILE=credentials.json
```

Notes:
- Use `Desktop app`, not `Web application`.
- If you rotate OAuth credentials, replace `credentials.json`.
- If Google auth gets into a weird state later, deleting `token.json` and re-running usually resets it cleanly.

### 6. Enable Google Maps APIs and create the Maps key

Sunday uses Maps for travel estimates, address resolution, and better matching of vague business names.

#### 6.1 Enable billing

Google Maps Platform requires billing on the project.

#### 6.2 Enable the Maps APIs Sunday uses

In `APIs & Services -> Library`, enable:

- `Distance Matrix API`
- `Geocoding API`
- `Places API`

#### 6.3 Create the Maps API key

1. Go to `APIs & Services -> Credentials`
2. Click `Create Credentials -> API key`
3. Copy the key into:

```env
GOOGLE_MAPS_API_KEY=your_key_here
```

#### 6.4 Set restrictions correctly

Open that API key and configure:

1. `API restrictions`
   - allow:
     - `Distance Matrix API`
     - `Geocoding API`
     - `Places API`
2. `Application restrictions`
   - local development: `None` is easiest while testing
   - real backend deployment: use something server-safe like `IP addresses`
   - do not use `HTTP referrers`, `Android`, or `iOS` restrictions for this backend key

If travel time works but address or venue lookup fails with `REQUEST_DENIED`, the usual issue is that only some of the Maps APIs were allowed on the key.

### 7. Set up your LLM provider

Sunday supports multiple providers, but you only need one.

Supported providers:

- Gemini
- Cerebras
- OpenRouter
- Groq
- Ollama
- Together
- Mistral
- Hugging Face
- Custom OpenAI-compatible endpoint

#### Easiest option: Gemini

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create an API key
3. Put it in `config.env`:

```env
ACTIVE_LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash
```

#### Common fallback: Cerebras

If Gemini is rate-limiting you, Cerebras is a good alternative.

```env
ACTIVE_LLM_PROVIDER=cerebras
CEREBRAS_API_KEY=your_key_here
CEREBRAS_MODEL=llama3.1-8b
LLM_REQUESTS_PER_MINUTE=25
```

### 8. Set up messaging

Sunday needs one real outbound messaging channel.

#### Option A: Telegram

This is the easiest production-friendly option.

1. Open Telegram
2. Message [@BotFather](https://t.me/BotFather)
3. Run `/newbot`
4. Copy the bot token into:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
```

5. Send your bot a message once
6. Visit:

```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

7. Find your `chat.id`
8. Put it in:

```env
TELEGRAM_CHAT_ID=your_chat_id
```

#### Option B: iMessage

iMessage works only on macOS and uses AppleScript.

Set:

```env
IMESSAGE_ENABLED=true
IMESSAGE_RECIPIENT=+12175551234
TEXT_EMAIL_LINKS=true
```

`IMESSAGE_RECIPIENT` should be the exact phone number or email address you would manually type into the Messages app.

Examples:
- `+12175551234`
- `name@icloud.com`

To find the right value:

1. Open `Messages` on your Mac
2. Start a new message
3. In the `To:` field, type the address you normally use
4. Use that exact value in `IMESSAGE_RECIPIENT`

If you are unsure whether your phone number or email is iMessage-enabled:

1. On iPhone, open `Settings -> Apps -> Messages -> Send & Receive`
2. Look under `You Can Receive iMessages To And Reply From`
3. Use one of those checked values

### 9. Fill in `config.env`

At minimum, a practical local config usually needs:

```env
ACTIVE_LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash

GOOGLE_CREDENTIALS_FILE=credentials.json
GOOGLE_TOKEN_FILE=token.json
GOOGLE_MAPS_API_KEY=your_maps_key_here
TARGET_CALENDAR_ID=primary

TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

DEFAULT_HOME_LOCATION=Champaign, IL
DEFAULT_HOME_LATITUDE=40.1164
DEFAULT_HOME_LONGITUDE=-88.2434
DEFAULT_WORK_LOCATION=
DEFAULT_WORK_LATITUDE=
DEFAULT_WORK_LONGITUDE=
WORK_DAYS=mon,tue,wed,thu,fri
WORKDAY_START_TIME=09:00
WORKDAY_END_TIME=17:00

PREP_TIME_MINUTES=15
ONLINE_PREP_MINUTES=5
TRAVEL_TYPE=driving
POLL_INTERVAL_SECONDS=10
MAX_EMAILS_PER_CYCLE=3
LLM_RETRY_ATTEMPTS=4
LLM_RETRY_BASE_SECONDS=5
TIMEZONE=America/Chicago
LOG_LEVEL=INFO
```

## Configuration Guide

This is what the most important settings do.

### Core Google settings

- `GOOGLE_CREDENTIALS_FILE`
  - local OAuth client JSON file
- `GOOGLE_TOKEN_FILE`
  - stored OAuth token after first successful login
- `GOOGLE_MAPS_API_KEY`
  - used for travel estimates, address resolution, and venue matching
- `TARGET_CALENDAR_ID`
  - where Sunday writes Sunday-managed events
  - default: `primary`

### Calendar behavior

- Sunday still reads across your visible calendars for context.
- `TARGET_CALENDAR_ID` changes only where Sunday writes and deduplicates its own events.

If you want a dedicated calendar:

1. Create a Google Calendar named something like `Sunday`
2. Copy its calendar ID from Google Calendar settings
3. Put that value into:

```env
TARGET_CALENDAR_ID=your_calendar_id_here
```

### Travel and location settings

- `DEFAULT_HOME_LOCATION`
- `DEFAULT_HOME_LATITUDE`
- `DEFAULT_HOME_LONGITUDE`
- `DEFAULT_WORK_LOCATION`
- `DEFAULT_WORK_LATITUDE`
- `DEFAULT_WORK_LONGITUDE`
- `WORK_DAYS`
- `WORKDAY_START_TIME`
- `WORKDAY_END_TIME`
- `TRAVEL_TYPE`

Allowed `TRAVEL_TYPE` values:
- `driving`
- `walking`
- `bicycling`
- `transit`

### Messaging settings

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `IMESSAGE_ENABLED`
- `IMESSAGE_RECIPIENT`
- `TEXT_EMAIL_LINKS`

### LLM tuning settings

- `MAX_EMAILS_PER_CYCLE`
- `LLM_REQUESTS_PER_MINUTE`
- `LLM_RETRY_ATTEMPTS`
- `LLM_RETRY_BASE_SECONDS`

Good conservative defaults:

```env
MAX_EMAILS_PER_CYCLE=3
LLM_RETRY_ATTEMPTS=4
LLM_RETRY_BASE_SECONDS=5
```

## Running Sunday

### 1. Start the worker

```bash
uv run python main.py
```

On first run:

- a browser window should open
- Google OAuth should appear
- after approval, `token.json` will be created in the repo root

### 2. Send a real test email

Send yourself a fresh email after the worker is already running.

Good test examples:
- `Meet me at the Illini Union today at 3:00 PM`
- `Dinner at Chili's tonight at 9`
- `Zoom tomorrow at 10 AM: https://...`

Expected flow:

1. Sunday sees the new Gmail message
2. the LLM parses it into structured data
3. Sunday infers missing pieces when reasonable
4. Google Calendar event gets created
5. you get a casual summary message
6. later, you get a separate leave-now message if applicable

### Useful commands

Run the worker:

```bash
uv run python main.py
```

Run the FastAPI server:

```bash
uv run uvicorn server:app --reload --port 8000
```

Run tests:

```bash
uv run pytest
```

Reset Google OAuth locally:

```bash
rm -f token.json
uv run python main.py
```

## Expo App (Local Development)

Sunday includes a React Native app (`sunday-app/`) built with Expo Go. It shows today's upcoming events, live travel times by car, bus, and walking, and leave countdowns. It adapts to dark mode automatically.

Important note:
- the Expo app should usually be started in `tunnel` mode, not plain LAN mode
- tunnel mode is much more reliable when Expo Go hangs on `Opening project...` or times out fetching the JS bundle

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Expo Go](https://expo.dev/go) installed on your iPhone (from the App Store)
- Your Mac and iPhone on the same Wi-Fi network
- The Sunday backend running on your Mac

### 1. Install app dependencies

```bash
cd sunday-app
npm install
```

### 2. Find your Mac's local IP address

```bash
ipconfig getifaddr en0
```

This returns something like `192.168.0.231`. You need this so the app can reach the backend running on your Mac.

### 3. Create the app environment file

```bash
cp .env.example .env
```

Edit `.env`:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.231:8000
EXPO_PUBLIC_API_TOKEN=your_cron_secret_here
```

- Replace the IP with what you got in step 2.
- `EXPO_PUBLIC_API_TOKEN` must match the `CRON_SECRET` value in your `config.env`. Leave both blank if you have not set a secret.

### 4. Start the Sunday backend

In a terminal at the repo root, run uvicorn bound to all interfaces so your phone can reach it:

```bash
uv run uvicorn server:app --host 0.0.0.0 --port 8000
```

Do not use `--reload` together with `--host 0.0.0.0` in production; it is fine for local dev.

### 5. Start the Expo dev server

In a separate terminal inside `sunday-app/`:

```bash
npm run start
```

A QR code will appear in the terminal.

That script uses Expo `tunnel` mode by default.

If you specifically want LAN mode later, use:

```bash
npm run start:lan
```

### 6. Open the app on your iPhone

1. Open the camera app and point it at the QR code.
2. Tap the Expo Go banner that appears.
3. The app will bundle and launch.

The dashboard shows:
- Today's date and the last-updated time
- Each upcoming event with title, time, and location
- Travel pills showing drive / transit / walk times
- A leave-by countdown that turns urgent (red) when under 30 minutes away

### Live location

The app sends your phone's GPS coordinates to the backend every time you move more than 50 metres. The backend uses this as the travel origin instead of your configured home or work address.

### Push notifications

Push notifications are not supported in Expo Go. They require a standalone build. The app silently skips notification setup when running inside Expo Go.

### Troubleshooting

**Network request failed**

- Make sure your Mac IP in `.env` is correct and matches `ipconfig getifaddr en0`.
- Make sure uvicorn was started with `--host 0.0.0.0`, not the default `127.0.0.1`.
- Both devices must be on the same Wi-Fi network.

**Events not showing**

- Check that the Sunday worker (`uv run python main.py`) is running and has processed at least one email.
- The `/api/events` endpoint only returns events from today onward.

**QR code not scanning**

- Try pressing `w` in the Expo terminal to open a browser preview, which confirms the server is up.
- Restart Expo with `npm run start:clear`.

**Expo Go says "Opening project..." forever or times out**

- Use `npm run start` so Expo starts in `tunnel` mode.
- Make sure Expo Go is allowed to use Local Network on your iPhone.
- If you previously started Expo in LAN mode, stop it fully and restart in tunnel mode.
- The app backend URL in `sunday-app/.env` must still be real. Do not leave placeholder values like `http://192.168.x.x:8000`.

## How Travel and Calendar Writing Work

### Travel origin inference

For in-person events, Sunday chooses the most likely departure point in this order:

1. the latest scheduled calendar event location before the new event
2. otherwise `DEFAULT_WORK_LOCATION` during configured work hours
3. otherwise `DEFAULT_HOME_LOCATION`

### Write calendar behavior

Sunday writes its managed events only to `TARGET_CALENDAR_ID`.

It still reads across your other calendars for:
- context
- conflict detection
- travel-origin inference
- leave alerts

### Reminder behavior

Sunday sends two kinds of outbound messages:

- an immediate summary when the email is processed
- a separate leave-now alert when it is actually time to go

For casual events like lunch or dinner, Sunday avoids overly aggressive day-before reminders.

## Optional API and Deployment

### FastAPI endpoints

If you run the server, you get:

- `GET /health`
- `GET /api/status`
- `POST /api/process`
- `POST /api/plan-day`

### Optional Vercel deployment

If you want to deploy the API server to Vercel:

1. run locally first so `token.json` exists
2. base64-encode both auth files:

```bash
python -c "import base64; print(base64.b64encode(open('token.json','rb').read()).decode())"
python -c "import base64; print(base64.b64encode(open('credentials.json','rb').read()).decode())"
```

3. Set these Vercel environment variables:

- `GOOGLE_TOKEN_JSON`
- `GOOGLE_CREDENTIALS_JSON`
- your LLM key
- your Telegram or iMessage settings
- `DEFAULT_HOME_LOCATION`
- `DEFAULT_WORK_LOCATION`
- `TARGET_CALENDAR_ID`
- `GOOGLE_MAPS_API_KEY`
- `CRON_SECRET`

Deploy:

```bash
vercel deploy --prod
```

`vercel.json` already lives in the repo root.

## Troubleshooting

### Google OAuth is blocked

Check:

- your app is in `Testing`
- your Google account is added under `Test users`
- `credentials.json` is a `Desktop app` OAuth client

### Travel says `REQUEST_DENIED`

Check:

- billing is enabled on the Google Cloud project
- `GOOGLE_MAPS_API_KEY` is set
- `Distance Matrix API`, `Geocoding API`, and `Places API` are all enabled
- your Maps key restrictions allow those APIs

### Sunday is not sending any texts

Check:

- Telegram bot token is valid and `TELEGRAM_CHAT_ID` is correct
- or iMessage is properly working from the same Mac
- `IMESSAGE_RECIPIENT` is exactly the address you can manually message

### Sunday is creating events in the wrong calendar

Check:

- `TARGET_CALENDAR_ID` in `config.env`
- that the calendar ID is the real Google Calendar ID, not just the display name

### In-person venue matching is bad

Check:

- `Places API` is enabled
- `Geocoding API` is enabled
- your home/work locations are configured correctly

### The app does nothing on old unread emails

That is expected.

Sunday intentionally ignores the unread backlog that already existed before startup.

## Development

Project notes:

- secrets stay local in `config.env`, `credentials.json`, and `token.json`
- runtime state goes in `.state/`
- tests live in `tests/`
- the repo is intended to be run from the project root

Recommended verification before pushing:

```bash
uv run pytest
uv run python -m py_compile $(rg --files -g '*.py')
```

## To-Do

- [ ] Emoji-first message formatting so reminders can use icons instead of labels like `location`, `time`, and `leave by`
- [ ] Optional phone-location ping support that feels invisible and production-safe
- [ ] Better reply-based workflows so a future version could react to user responses, not just send outbound reminders
- [ ] Richer calendar repair/update tools for old Sunday-managed events after formatting or reminder-policy changes
