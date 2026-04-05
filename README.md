# Sunday

Sunday is a personal assistant with two connected parts:

- a Python backend that watches Gmail, parses events, writes to Google Calendar, estimates travel, and sends reminders
- an Expo app that lets you record voice notes, view alert history, and edit a safe subset of `config.env`

The current mobile flow is:

1. tap the center dot to start recording
2. tap again to stop
3. the phone uploads audio to your Mac backend
4. the Mac transcribes it with a local Whisper model
5. the Mac generates a short title with a local text model
6. the app adds the result to the Alerts page

## Table of Contents

1. [How It Works](#how-it-works)
2. [Project Layout](#project-layout)
3. [What You Need](#what-you-need)
4. [Setup From Scratch](#setup-from-scratch)
5. [Local Models](#local-models)
6. [Configuration Guide](#configuration-guide)
7. [Running Sunday](#running-sunday)
8. [Expo App](#expo-app)
9. [Recording and Transcription](#recording-and-transcription)
10. [Settings Page](#settings-page)
11. [API Endpoints](#api-endpoints)
12. [Troubleshooting](#troubleshooting)
13. [Development](#development)
14. [To-Do](#to-do)

## How It Works

Sunday currently has two major workflows.

### Email to Calendar

```text
new Gmail email
  -> LLM parsing
  -> event cleanup and inference
  -> venue matching + travel estimate
  -> Google Calendar write
  -> reminder text now
  -> leave-now text later
```

Key behavior:

- Sunday only processes emails that arrive after the worker starts
- Sunday writes managed events into one configurable calendar
- Sunday still reads your other calendars for context and travel inference
- vague places like chain restaurants are resolved toward your likely local origin when possible

### Voice Notes in the App

```text
record on phone
  -> upload audio to Mac backend
  -> local Whisper transcription on Mac
  -> local title generation on Mac
  -> alerts list entry in app
```

Key behavior:

- ultra-short accidental taps are ignored before upload
- the newest voice-note entries appear at the top of Alerts
- pending transcriptions show a loading row immediately
- alerts can be swiped left to reveal a delete action

## Project Layout

Main directories:

- [backend](/Users/aryan/Desktop/sunday/backend)
  - Python engine, API, transcription, title generation, Gmail/calendar logic
- [sunday-app](/Users/aryan/Desktop/sunday/sunday-app)
  - Expo app
- [tests](/Users/aryan/Desktop/sunday/tests)
  - backend test suite
- [models](/Users/aryan/Desktop/sunday/models)
  - local model files, ignored by git

Useful entrypoints:

- [main.py](/Users/aryan/Desktop/sunday/main.py)
  - starts the local Gmail polling worker
- [server.py](/Users/aryan/Desktop/sunday/server.py)
  - FastAPI app entrypoint
- [backend/server.py](/Users/aryan/Desktop/sunday/backend/server.py)
  - real API implementation
- [sunday-app/App.tsx](/Users/aryan/Desktop/sunday/sunday-app/App.tsx)
  - mobile app shell and tab navigation

## What You Need

Before setup, make sure you have:

- Python 3.10+
- [`uv`](https://docs.astral.sh/uv/)
- Node.js 18+
- Expo Go on your iPhone
- a Google account
- one LLM API key for email parsing
- one outbound messaging channel
  - Telegram is easiest
  - iMessage works on macOS only
- a Google Cloud project with:
  - Gmail API
  - Google Calendar API
  - Geocoding API
  - Distance Matrix API
  - Places API
- a Google Maps API key
- `ffmpeg` installed locally

For local voice-note transcription and title generation, you also need local model files:

- Whisper model:
  - `models/transcription/ggml-large-v3-turbo-q5_0.bin`
- text title model:
  - `models/text/qwen2.5-0.5b-instruct/`

Those model files are intentionally ignored by git.

## Setup From Scratch

### 1. Clone the repo

```bash
git clone https://github.com/aryan-cs/sunday.git
cd sunday
```

### 2. Install Python dependencies

```bash
uv sync --extra dev
```

### 3. Install Expo app dependencies

```bash
cd sunday-app
npm install
cd ..
```

### 4. Create your local config file

```bash
cp config.env.example config.env
```

### 5. Configure Google OAuth for Gmail and Calendar

In Google Cloud:

1. create a project
2. configure the OAuth consent screen
3. add your own account as a test user
4. enable:
   - Gmail API
   - Google Calendar API
5. create a `Desktop app` OAuth client
6. download the JSON and save it as:
   - [credentials.json](/Users/aryan/Desktop/sunday/credentials.json)

Sunday will create [token.json](/Users/aryan/Desktop/sunday/token.json) on first successful auth.

### 6. Configure Google Maps

Enable these APIs in the same Google Cloud project:

- Geocoding API
- Distance Matrix API
- Places API

Then create an API key and put it into:

```env
GOOGLE_MAPS_API_KEY=your_key_here
```

### 7. Configure an LLM provider

The easiest option is Gemini:

```env
ACTIVE_LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash
```

### 8. Configure messaging

Telegram example:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

iMessage example:

```env
IMESSAGE_ENABLED=true
IMESSAGE_RECIPIENT=+12175551234
TEXT_EMAIL_LINKS=true
```

### 9. Create the Expo app env file

```bash
cp sunday-app/.env.example sunday-app/.env
```

Then edit [sunday-app/.env](/Users/aryan/Desktop/sunday/sunday-app/.env):

```env
EXPO_PUBLIC_API_BASE_URL=http://YOUR_MAC_IP:8000
EXPO_PUBLIC_API_TOKEN=
```

If you set `CRON_SECRET` in [config.env](/Users/aryan/Desktop/sunday/config.env), then `EXPO_PUBLIC_API_TOKEN` must match it.

### 10. Put the local models in place

Default transcription model:

- [models/transcription/ggml-large-v3-turbo-q5_0.bin](/Users/aryan/Desktop/sunday/models/transcription/ggml-large-v3-turbo-q5_0.bin)

Default title model:

- [models/text/qwen2.5-0.5b-instruct](/Users/aryan/Desktop/sunday/models/text/qwen2.5-0.5b-instruct)

To download the default title model:

```bash
mkdir -p models/text/qwen2.5-0.5b-instruct
uv run hf download Qwen/Qwen2.5-0.5B-Instruct --local-dir models/text/qwen2.5-0.5b-instruct
```

## Local Models

The repo does not ship model binaries or weight folders. They stay local in:

- [models/transcription](/Users/aryan/Desktop/sunday/models/transcription)
- [models/text](/Users/aryan/Desktop/sunday/models/text)

`models/` is ignored by git on purpose.

The Settings page only shows models that are fully present on disk:

- transcription models are discovered from `.bin` files in the transcription/audio model folders
- summarization models are discovered from local Transformers model folders that include both config files and real weights

### Recommended model choices

For transcription:

- Best quality on a reasonably strong Mac:
  - `ggml-large-v3-turbo-q5_0`
- Best default balance for most local setups:
  - `ggml-small.en-q5_1`
- Faster / lighter:
  - `ggml-base.en-q5_1`
- Lightest option when you care most about speed:
  - `ggml-tiny.en-q5_1`

For title generation / summarization:

- Best overall current recommendation:
  - `qwen2.5-0.5b-instruct`
- Faster and lighter:
  - `smollm2-360m-instruct`
- Smallest local option:
  - `smollm2-135m-instruct`

### Suggested pairings

- Strongest local quality:
  - `ggml-large-v3-turbo-q5_0` + `qwen2.5-0.5b-instruct`
- Good everyday local default:
  - `ggml-small.en-q5_1` + `qwen2.5-0.5b-instruct`
- Faster / lighter self-hosted dev setup:
  - `ggml-base.en-q5_1` + `smollm2-360m-instruct`
- Lowest-resource local setup:
  - `ggml-tiny.en-q5_1` + `smollm2-135m-instruct`

### Download examples

Download a few transcription models:

```bash
cd /Users/aryan/Desktop/sunday
uv run python - <<'PY'
from huggingface_hub import hf_hub_download

for filename in [
    "ggml-tiny.en-q5_1.bin",
    "ggml-base.en-q5_1.bin",
    "ggml-small.en-q5_1.bin",
]:
    hf_hub_download(
        repo_id="ggerganov/whisper.cpp",
        filename=filename,
        local_dir="models/transcription",
    )
PY
```

Download a few summarization models:

```bash
cd /Users/aryan/Desktop/sunday
uv run python - <<'PY'
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="Qwen/Qwen2.5-0.5B-Instruct",
    local_dir="models/text/qwen2.5-0.5b-instruct",
)
snapshot_download(
    repo_id="HuggingFaceTB/SmolLM2-360M-Instruct",
    local_dir="models/text/smollm2-360m-instruct",
)
snapshot_download(
    repo_id="HuggingFaceTB/SmolLM2-135M-Instruct",
    local_dir="models/text/smollm2-135m-instruct",
)
PY
```

### Point Sunday at a specific model

Update [config.env](/Users/aryan/Desktop/sunday/config.env):

```env
TRANSCRIPTION_MODEL_PATH=models/transcription/ggml-small.en-q5_1.bin
TRANSCRIPT_TITLE_MODEL_PATH=models/text/qwen2.5-0.5b-instruct
```

Then restart the backend:

```bash
cd /Users/aryan/Desktop/sunday
uv run uvicorn server:app --host 0.0.0.0 --port 8000
```

## Configuration Guide

Important non-secret config values:

- `TARGET_CALENDAR_ID`
  - which calendar Sunday writes its managed events into
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
  - one of:
    - `driving`
    - `walking`
    - `bicycling`
    - `transit`
- `PREP_TIME_MINUTES`
- `ONLINE_PREP_MINUTES`
- `POLL_INTERVAL_SECONDS`
- `MAX_EMAILS_PER_CYCLE`
- `TIMEZONE`
- `TEXT_EMAIL_LINKS`

Transcription-related config:

- `TRANSCRIPTION_MODEL_PATH`
  - Whisper model path
- `TRANSCRIPTION_LANGUAGE`
- `TRANSCRIPTION_THREADS`
- `TRANSCRIPT_TITLE_MODEL_PATH`
  - local text-model folder used for title generation
- `TRANSCRIPT_TITLE_DEVICE`
  - usually `auto`
- `TRANSCRIPT_TITLE_MAX_NEW_TOKENS`

## Running Sunday

Usually you run two backend processes during local development:

1. the API server
2. the Gmail polling worker

### Start the API server

```bash
cd /Users/aryan/Desktop/sunday
uv run uvicorn server:app --host 0.0.0.0 --port 8000
```

### Start the email worker

In a second terminal:

```bash
cd /Users/aryan/Desktop/sunday
uv run python main.py
```

On first run:

- Google OAuth should open in the browser
- after approval, [token.json](/Users/aryan/Desktop/sunday/token.json) will be created

### Useful backend commands

Run tests:

```bash
cd /Users/aryan/Desktop/sunday
uv run --extra dev pytest -q
```

Reset Google OAuth locally:

```bash
cd /Users/aryan/Desktop/sunday
rm -f token.json
uv run python main.py
```

## Expo App

### Start the app

```bash
cd /Users/aryan/Desktop/sunday/sunday-app
npm run start
```

That uses Expo tunnel mode by default, which is the most reliable local setup for Expo Go.

Then:

1. scan the QR code with your iPhone camera
2. open it in Expo Go

### Current app tabs

- Settings
  - editable safe config values from `config.env`
- Record
  - tap the center dot to start or stop recording
- Alerts
  - newest-first voice-note history
  - swipe left to reveal delete

### Expo app verification

```bash
cd /Users/aryan/Desktop/sunday/sunday-app
npx tsc --noEmit
```

## Recording and Transcription

Recording currently works like this:

1. tap the center dot
2. app records audio on the phone
3. tap again to stop
4. ultra-short near-empty recordings are ignored
5. app uploads the audio file to `POST /api/transcribe`
6. backend transcribes with local Whisper
7. backend generates a short title with a local text model
8. app inserts or updates an Alerts entry

Current backend response for transcription includes:

- `text`
- `summary`

The Expo terminal logs both values during development.

## Settings Page

The Settings page can now read and write a safe subset of [config.env](/Users/aryan/Desktop/sunday/config.env) through the backend.

Current behavior:

- values load from `GET /api/settings`
- saves go to `PUT /api/settings`
- the backend writes them back into `config.env`
- runtime config is updated immediately for normal non-secret settings
- validation warnings and errors are returned after save

Intentional limitation:

- secrets are not editable in the app
- API keys, tokens, OAuth files, and similar sensitive values stay local and manual

The `Models` subsection in the app is discovery-based:

- it lists local transcription models the backend can actually see
- it lists local summarization models that appear fully downloaded
- because model binaries are not committed, your options depend on what you have downloaded locally

## API Endpoints

Current local API endpoints:

- `GET /health`
- `GET /api/status`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/process`
- `POST /api/plan-day`
- `GET /api/events`
- `POST /api/location`
- `POST /api/register-push-token`
- `POST /api/transcribe`

## Troubleshooting

### Expo Go opens but the app cannot reach the backend

Check:

- [sunday-app/.env](/Users/aryan/Desktop/sunday/sunday-app/.env) has the correct Mac IP
- backend is running with `--host 0.0.0.0`
- phone and Mac can reach each other

### Expo Go gets stuck on "Opening project..."

Use tunnel mode:

```bash
cd /Users/aryan/Desktop/sunday/sunday-app
npm run start
```

### Recording works but transcription fails

Check:

- backend is running
- `ffmpeg` is installed
- the Whisper model exists at `TRANSCRIPTION_MODEL_PATH`

### Title generation falls back to simple summaries

Check:

- the selected text model exists at `TRANSCRIPT_TITLE_MODEL_PATH`
- the backend was restarted after model/config changes

### Sunday does nothing with old unread emails

That is expected.

Sunday intentionally ignores the backlog that already existed before the worker started.

### Calendar events are written to the wrong calendar

Check:

- `TARGET_CALENDAR_ID`
- or update it from the Settings page

## Development

Recommended checks before pushing:

```bash
cd /Users/aryan/Desktop/sunday
uv run --extra dev pytest -q
```

```bash
cd /Users/aryan/Desktop/sunday/sunday-app
npx tsc --noEmit
```

Important local-only files:

- [config.env](/Users/aryan/Desktop/sunday/config.env)
- [credentials.json](/Users/aryan/Desktop/sunday/credentials.json)
- [token.json](/Users/aryan/Desktop/sunday/token.json)
- [models](/Users/aryan/Desktop/sunday/models)

These should not be pushed.

## To-Do

- [ ] Expand the Settings page with more config groups and nicer grouped controls
- [ ] Show full transcript details when tapping an alert entry
- [ ] Add richer actions on alert rows beyond delete
- [ ] Emoji-first reminder formatting in the messaging layer
- [ ] Optional phone-location support that feels invisible and production-safe
- [ ] Better voice-note post-processing beyond short generated titles
