# PLAN.md — Smart Email-to-Calendar Pipeline

## What This Is

A system that watches your Gmail inbox, uses a **free** LLM to parse every incoming email for actionable content, then:

1. **Sends you a summary** via iMessage or Telegram — what needs a response, what can wait
2. **Creates smart Google Calendar events** with full details: title, location, meeting links, description
3. **Sets intelligent notifications** that account for travel time from your current/expected location, prep time, and whether the meeting is online or in-person

The entire LLM layer is **free** — no Anthropic API required. Users configure one file and never touch the code.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Centralized Configuration — The One File](#2-centralized-configuration)
3. [Multi-Provider Free LLM Layer](#3-multi-provider-free-llm-layer)
4. [Gmail Watch & Email Ingestion](#4-gmail-watch--email-ingestion)
5. [LLM Email Parsing — The Prompt Engineering](#5-llm-email-parsing--the-prompt-engineering)
6. [Google Calendar Smart Event Creation](#6-google-calendar-smart-event-creation)
7. [Smart Notifications with Travel/Prep Awareness](#7-smart-notifications-with-travelprep-awareness)
8. [Messaging Output — iMessage & Telegram](#8-messaging-output--imessage--telegram)
9. [Day Planner / Route Optimizer (Bonus)](#9-day-planner--route-optimizer-bonus)
10. [iPhone Shortcut Integration (Bonus)](#10-iphone-shortcut-integration-bonus)
11. [Project Structure](#11-project-structure)
12. [Step-by-Step Build Order](#12-step-by-step-build-order)

---

## 1. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SMART CALENDAR PIPELINE                      │
│                                                                      │
│  ┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐ │
│  │  Gmail   │───▶│ Email Watcher│───▶│  LLM Parse  │───▶│ Router   │ │
│  │  Inbox   │    │ (Pub/Sub or  │    │ (Free tier)  │    │          │ │
│  │          │    │  polling)    │    │              │    │          │ │
│  └─────────┘    └──────────────┘    └─────────────┘    └────┬─────┘ │
│                                                             │       │
│                        ┌────────────────┬───────────────────┤       │
│                        ▼                ▼                   ▼       │
│              ┌──────────────┐  ┌──────────────┐   ┌──────────────┐ │
│              │ Google Cal   │  │  Telegram /   │   │  Auto-Clean  │ │
│              │ Smart Event  │  │  iMessage     │   │  Old Events  │ │
│              │ + Smart      │  │  Summary      │   │  from Email  │ │
│              │   Notifs     │  │              │    │              │ │
│              └──────┬───────┘  └──────────────┘   └──────────────┘ │
│                     │                                               │
│              ┌──────▼───────┐                                       │
│              │ Google Maps  │                                       │
│              │ Distance API │                                       │
│              │ (travel time)│                                       │
│              └──────────────┘                                       │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    config.env (ONE FILE)                      │   │
│  │  All API keys, all provider settings, all preferences        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Tech Stack:** Python 3.11+ (simplest for Gmail API, Google Calendar API, and HTTP calls). Could also be Node.js — all code examples below are in Python with Node.js alternatives noted.

---

## 2. Centralized Configuration

**Every single key, setting, and preference lives in ONE file: `config.env`**

The user opens this file, fills in their keys, and never touches anything else.

```env
# ╔══════════════════════════════════════════════════════════════╗
# ║              SMART CALENDAR — CONFIGURATION                  ║
# ║                                                              ║
# ║  Fill in the sections you need. You only need ONE LLM        ║
# ║  provider — pick whichever you have a key for.               ║
# ║                                                              ║
# ║  Get free keys:                                              ║
# ║    OpenRouter:  https://openrouter.ai/keys                   ║
# ║    Gemini:      https://aistudio.google.com/apikey            ║
# ║    Groq:        https://console.groq.com/keys                ║
# ║    Ollama:      Just run `ollama serve` (no key needed)       ║
# ╚══════════════════════════════════════════════════════════════╝

# ─── LLM PROVIDER (pick ONE, set it as active) ───────────────
ACTIVE_LLM_PROVIDER=gemini

# Google Gemini (Free: 15 requests/minute, 1500/day)
GEMINI_API_KEY=AIzaSy_YOUR_KEY_HERE
GEMINI_MODEL=gemini-2.0-flash

# OpenRouter (Free models available, need account)
OPENROUTER_API_KEY=
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct:free

# Groq (Free: 30 req/min on small models)
GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant

# Ollama (Free: runs locally, no key, must have ollama installed)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Together AI (Free trial credits)
TOGETHER_API_KEY=
TOGETHER_MODEL=meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo

# Mistral (Free tier)
MISTRAL_API_KEY=
MISTRAL_MODEL=mistral-small-latest

# HuggingFace Inference (Free, rate limited)
HUGGINGFACE_API_KEY=
HUGGINGFACE_MODEL=mistralai/Mistral-7B-Instruct-v0.3

# Custom OpenAI-compatible endpoint
CUSTOM_LLM_BASE_URL=
CUSTOM_LLM_API_KEY=
CUSTOM_LLM_MODEL=

# ─── GOOGLE SERVICES ─────────────────────────────────────────
# Path to your OAuth2 credentials JSON (download from Google Cloud Console)
# See Section 4 for setup instructions.
GOOGLE_CREDENTIALS_FILE=credentials.json
GOOGLE_TOKEN_FILE=token.json

# ─── GOOGLE MAPS (for travel time estimates) ─────────────────
# Get a key: https://console.cloud.google.com/apis/credentials
# Enable: Directions API, Distance Matrix API
GOOGLE_MAPS_API_KEY=AIzaSy_YOUR_MAPS_KEY_HERE

# ─── MESSAGING (pick one or both) ────────────────────────────

# Telegram Bot
# 1. Message @BotFather on Telegram, send /newbot
# 2. Copy the token it gives you
# 3. Message your bot, then visit:
#    https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
#    to find your chat_id
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# iMessage (macOS only — uses AppleScript, no key needed)
IMESSAGE_ENABLED=false
IMESSAGE_RECIPIENT=+1234567890

# ─── YOUR PREFERENCES ────────────────────────────────────────

# Your default/home location (used for travel time calculations)
DEFAULT_HOME_LOCATION=Champaign, IL
DEFAULT_HOME_LATITUDE=40.1164
DEFAULT_HOME_LONGITUDE=-88.2434

# How many minutes of "get ready" buffer before any meeting
PREP_TIME_MINUTES=15

# How many minutes buffer for online meetings
ONLINE_PREP_MINUTES=5

# Travel mode: driving, walking, bicycling, transit
DEFAULT_TRAVEL_MODE=driving

# Auto-archive emails about past events after this many hours
AUTO_CLEANUP_HOURS=24

# Only process emails from these labels (comma-separated, or "INBOX" for all)
GMAIL_LABELS=INBOX

# ─── ADVANCED ─────────────────────────────────────────────────
LLM_MAX_TOKENS=1024
LLM_TEMPERATURE=0.3
POLL_INTERVAL_SECONDS=60
LOG_LEVEL=INFO
```

### How the config is loaded (Python):

```python
# config.py — THE loader. Everything reads from here.
import os
from pathlib import Path
from dotenv import load_dotenv

# Load the ONE config file
load_dotenv(Path(__file__).parent / "config.env")

class Config:
    """Single source of truth for all configuration."""

    # ── LLM ──
    active_llm = os.getenv("ACTIVE_LLM_PROVIDER", "gemini")

    llm_providers = {
        "gemini": {
            "api_key": os.getenv("GEMINI_API_KEY", ""),
            "model": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
        },
        "openrouter": {
            "api_key": os.getenv("OPENROUTER_API_KEY", ""),
            "model": os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.1-8b-instruct:free"),
            "base_url": "https://openrouter.ai/api/v1",
        },
        "groq": {
            "api_key": os.getenv("GROQ_API_KEY", ""),
            "model": os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
            "base_url": "https://api.groq.com/openai/v1",
        },
        "ollama": {
            "api_key": "",
            "model": os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
            "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        },
        "together": {
            "api_key": os.getenv("TOGETHER_API_KEY", ""),
            "model": os.getenv("TOGETHER_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"),
            "base_url": "https://api.together.xyz/v1",
        },
        "mistral": {
            "api_key": os.getenv("MISTRAL_API_KEY", ""),
            "model": os.getenv("MISTRAL_MODEL", "mistral-small-latest"),
            "base_url": "https://api.mistral.ai/v1",
        },
        "huggingface": {
            "api_key": os.getenv("HUGGINGFACE_API_KEY", ""),
            "model": os.getenv("HUGGINGFACE_MODEL", "mistralai/Mistral-7B-Instruct-v0.3"),
            "base_url": "https://api-inference.huggingface.co/models",
        },
        "custom": {
            "api_key": os.getenv("CUSTOM_LLM_API_KEY", ""),
            "model": os.getenv("CUSTOM_LLM_MODEL", ""),
            "base_url": os.getenv("CUSTOM_LLM_BASE_URL", ""),
        },
    }

    # ── Google ──
    google_creds_file = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")
    google_token_file = os.getenv("GOOGLE_TOKEN_FILE", "token.json")
    google_maps_key = os.getenv("GOOGLE_MAPS_API_KEY", "")

    # ── Messaging ──
    telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    telegram_chat_id = os.getenv("TELEGRAM_CHAT_ID", "")
    imessage_enabled = os.getenv("IMESSAGE_ENABLED", "false").lower() == "true"
    imessage_recipient = os.getenv("IMESSAGE_RECIPIENT", "")

    # ── Preferences ──
    default_home_location = os.getenv("DEFAULT_HOME_LOCATION", "")
    default_home_lat = float(os.getenv("DEFAULT_HOME_LATITUDE", "0"))
    default_home_lng = float(os.getenv("DEFAULT_HOME_LONGITUDE", "0"))
    prep_time = int(os.getenv("PREP_TIME_MINUTES", "15"))
    online_prep = int(os.getenv("ONLINE_PREP_MINUTES", "5"))
    travel_mode = os.getenv("DEFAULT_TRAVEL_MODE", "driving")
    auto_cleanup_hours = int(os.getenv("AUTO_CLEANUP_HOURS", "24"))
    gmail_labels = os.getenv("GMAIL_LABELS", "INBOX").split(",")

    # ── Advanced ──
    max_tokens = int(os.getenv("LLM_MAX_TOKENS", "1024"))
    temperature = float(os.getenv("LLM_TEMPERATURE", "0.3"))
    poll_interval = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))

    @classmethod
    def get_active_llm(cls):
        """Return the config dict for the currently active LLM provider."""
        provider = cls.llm_providers.get(cls.active_llm)
        if not provider:
            raise ValueError(f"Unknown LLM provider: {cls.active_llm}")
        return {**provider, "provider_name": cls.active_llm}
```

---

## 3. Multi-Provider Free LLM Layer

### 3.1 Supported Providers & Free Tiers

| Provider | Free Tier | Rate Limit | Best For |
|---|---|---|---|
| **Gemini 2.0 Flash** | 15 RPM / 1,500 RPD free | Very generous | Best free option for this project |
| **OpenRouter** (free models) | Unlimited on `:free` models | Varies by model | Fallback, many model choices |
| **Groq** | 30 RPM on Llama 3.1 8B | Fast but limited | Speed-critical parsing |
| **Ollama** | Unlimited (local) | Your hardware | Privacy, offline use |
| **Together AI** | $1 free credit | Pay after trial | Good models |
| **Mistral** | Free tier on small models | Limited | European hosting |
| **HuggingFace** | Free (rate-limited) | ~10 RPM | Experimental models |

**Recommendation for this project:** Start with **Gemini 2.0 Flash**. It's free, fast, handles JSON output well, and 1,500 requests/day is more than enough for email parsing. Fall back to OpenRouter free models if you hit limits.

### 3.2 Unified LLM Client (Python)

```python
# llm_client.py
import httpx
import json
from config import Config

class LLMClient:
    """
    Unified LLM client. The rest of the app calls `llm.complete()`
    and never thinks about which provider is behind it.
    """

    def __init__(self):
        self.config = Config.get_active_llm()
        self.provider = self.config["provider_name"]

    async def complete(self, messages: list[dict], temperature: float = None,
                       max_tokens: int = None) -> str:
        """
        Send messages to the active LLM and return the response text.

        Args:
            messages: List of {"role": "system"|"user"|"assistant", "content": "..."}
            temperature: Override default temperature
            max_tokens: Override default max tokens

        Returns:
            The assistant's response as a string.
        """
        temp = temperature or Config.temperature
        tokens = max_tokens or Config.max_tokens

        if self.provider == "gemini":
            return await self._gemini(messages, temp, tokens)
        elif self.provider == "huggingface":
            return await self._huggingface(messages, temp, tokens)
        else:
            # OpenRouter, Groq, Together, Mistral, Ollama, Custom
            # all use OpenAI-compatible format
            return await self._openai_compatible(messages, temp, tokens)

    async def _openai_compatible(self, messages, temperature, max_tokens) -> str:
        """Works for: OpenRouter, Groq, Together, Mistral, Ollama, Custom."""
        headers = {"Content-Type": "application/json"}

        if self.config["api_key"]:
            headers["Authorization"] = f"Bearer {self.config['api_key']}"

        # OpenRouter wants attribution headers
        if self.provider == "openrouter":
            headers["HTTP-Referer"] = "https://smart-calendar.local"
            headers["X-Title"] = "Smart Calendar"

        body = {
            "model": self.config["model"],
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        # Ollama's OpenAI-compat endpoint is at /v1/chat/completions
        base = self.config["base_url"].rstrip("/")
        if self.provider == "ollama" and "/v1" not in base:
            base += "/v1"

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f"{base}/chat/completions",
                                     headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

        return data["choices"][0]["message"]["content"]

    async def _gemini(self, messages, temperature, max_tokens) -> str:
        """Google Gemini has its own REST format."""
        system_parts = [m["content"] for m in messages if m["role"] == "system"]
        chat_msgs = [m for m in messages if m["role"] != "system"]

        contents = []
        for m in chat_msgs:
            role = "model" if m["role"] == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": m["content"]}]})

        body = {
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            },
        }

        if system_parts:
            body["systemInstruction"] = {
                "parts": [{"text": "\n".join(system_parts)}]
            }

        url = (f"{self.config['base_url']}/models/{self.config['model']}"
               f":generateContent?key={self.config['api_key']}")

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()

        return data["candidates"][0]["content"]["parts"][0]["text"]

    async def _huggingface(self, messages, temperature, max_tokens) -> str:
        """HuggingFace Inference API."""
        # Flatten messages into a prompt string
        prompt = "\n".join(
            f"[{m['role'].title()}] {m['content']}" for m in messages
        ) + "\n[Assistant]"

        url = f"{self.config['base_url']}/{self.config['model']}"
        headers = {
            "Authorization": f"Bearer {self.config['api_key']}",
            "Content-Type": "application/json",
        }
        body = {
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": max_tokens,
                "temperature": temperature,
                "return_full_text": False,
            },
        }

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

        if isinstance(data, list):
            return data[0].get("generated_text", "")
        return data.get("generated_text", "")


# Singleton — import this everywhere
llm = LLMClient()
```

### 3.3 JSON Output Strategy

Most of our LLM calls need structured JSON back. Here's the pattern that works across all providers:

```python
async def parse_with_json(prompt: str, system: str) -> dict:
    """
    Call the LLM and parse JSON from the response.
    Works across all providers by using aggressive prompting.
    """
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]

    raw = await llm.complete(messages, temperature=0.1)

    # Strip markdown fences if the model wraps in ```json ... ```
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]  # remove first line
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    cleaned = cleaned.strip()

    return json.loads(cleaned)
```

---

## 4. Gmail Watch & Email Ingestion

### 4.1 Google Cloud Setup (One-Time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (e.g., "smart-calendar")
3. Enable these APIs:
   - Gmail API
   - Google Calendar API
   - Directions API (for travel time)
   - Distance Matrix API (for travel time)
4. Create OAuth 2.0 credentials:
   - Go to APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Desktop app**
   - Download the JSON → save as `credentials.json` in project root
5. First run will open a browser for OAuth consent — grant Gmail + Calendar access

### 4.2 Gmail Polling (Simplest Approach)

For a hackathon, **polling is simpler than Pub/Sub** and works great.

```python
# gmail_watcher.py
import asyncio
import base64
import email
from datetime import datetime
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from config import Config

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
]


def get_google_service(service_name, version):
    """Authenticate and return a Google API service client."""
    creds = None

    if Config.google_token_file and Path(Config.google_token_file).exists():
        creds = Credentials.from_authorized_user_file(Config.google_token_file, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                Config.google_creds_file, SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open(Config.google_token_file, "w") as f:
            f.write(creds.to_json())

    return build(service_name, version, credentials=creds)


class GmailWatcher:
    def __init__(self):
        self.service = get_google_service("gmail", "v1")
        self.seen_ids = set()  # Track processed emails

    def get_new_emails(self, max_results=10):
        """Fetch unread emails from the configured labels."""
        results = self.service.users().messages().list(
            userId="me",
            labelIds=Config.gmail_labels,
            q="is:unread",
            maxResults=max_results,
        ).execute()

        messages = results.get("messages", [])
        new_emails = []

        for msg_meta in messages:
            if msg_meta["id"] in self.seen_ids:
                continue

            self.seen_ids.add(msg_meta["id"])

            # Fetch full message
            msg = self.service.users().messages().get(
                userId="me", id=msg_meta["id"], format="full"
            ).execute()

            new_emails.append(self._parse_message(msg))

        return new_emails

    def _parse_message(self, msg):
        """Extract useful fields from a Gmail message."""
        headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}

        # Get body text
        body = ""
        payload = msg["payload"]
        if "parts" in payload:
            for part in payload["parts"]:
                if part["mimeType"] == "text/plain":
                    data = part["body"].get("data", "")
                    body = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                    break
            # Fallback to HTML if no plain text
            if not body:
                for part in payload["parts"]:
                    if part["mimeType"] == "text/html":
                        data = part["body"].get("data", "")
                        body = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                        break
        elif "body" in payload and payload["body"].get("data"):
            body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")

        return {
            "id": msg["id"],
            "from": headers.get("From", ""),
            "to": headers.get("To", ""),
            "subject": headers.get("Subject", ""),
            "date": headers.get("Date", ""),
            "body": body[:5000],  # Truncate very long emails
            "snippet": msg.get("snippet", ""),
        }
```

### 4.3 Alternative: Google Pub/Sub Push (Production)

For production, Gmail can push new emails to you via a webhook:

```python
# Set up a Pub/Sub topic and subscription, then call:
# gmail.users().watch(userId="me", body={
#     "topicName": "projects/my-project/topics/gmail-push",
#     "labelIds": ["INBOX"],
# }).execute()
#
# Then run a Flask/FastAPI server that receives the push notification
# and triggers the pipeline. This avoids polling entirely.
```

For the hackathon, polling every 60 seconds is perfectly fine.

---

## 5. LLM Email Parsing — The Prompt Engineering

This is the core intelligence. The LLM reads each email and extracts structured data.

### 5.1 The System Prompt

```python
EMAIL_PARSER_SYSTEM_PROMPT = """You are an email parsing assistant. You analyze emails and extract structured information.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no backticks.

For every email, determine:
1. Whether it contains an actionable event (meeting, appointment, deadline, etc.)
2. Whether it needs a response from the user
3. A brief human-readable summary

Return this exact JSON structure:

{
  "has_event": true/false,
  "needs_response": true/false,
  "urgency": "high" | "medium" | "low" | "none",
  "summary": "One-line human summary of the email",
  "event": {
    "title": "Meeting/event title",
    "date": "YYYY-MM-DD",
    "start_time": "HH:MM (24h format)",
    "end_time": "HH:MM (24h format, estimate 1hr if unknown)",
    "location": "Physical address OR null if online",
    "is_online": true/false,
    "meeting_link": "URL to Zoom/Meet/Teams or null",
    "description": "Brief description of what the event is about",
    "attendees": ["email1@example.com", "email2@example.com"],
    "organizer": "Name of who sent/organized this"
  },
  "action_items": ["List of things the user might need to do"],
  "can_wait": true/false
}

If has_event is false, set event to null.
If you're unsure about a field, use null rather than guessing.
Parse dates relative to today's date which will be provided.
For Zoom/Meet/Teams links, extract the full URL from the email body.
"""
```

### 5.2 The Parsing Function

```python
# email_parser.py
import json
from datetime import date
from llm_client import llm

EMAIL_PARSER_SYSTEM_PROMPT = """..."""  # (the full prompt from above)


async def parse_email(email_data: dict) -> dict:
    """
    Send an email through the LLM and get back structured data.

    Args:
        email_data: Dict with keys: from, to, subject, date, body, snippet

    Returns:
        Parsed dict with has_event, needs_response, summary, event, etc.
    """
    user_prompt = f"""Today's date: {date.today().isoformat()}

Analyze this email:

From: {email_data['from']}
Subject: {email_data['subject']}
Date: {email_data['date']}

Body:
{email_data['body'][:3000]}
"""
    # Use the JSON parsing helper
    messages = [
        {"role": "system", "content": EMAIL_PARSER_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    raw_response = await llm.complete(messages, temperature=0.1)

    # Clean and parse JSON
    cleaned = raw_response.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]

    try:
        parsed = json.loads(cleaned.strip())
    except json.JSONDecodeError:
        # Fallback: treat as non-actionable
        parsed = {
            "has_event": False,
            "needs_response": False,
            "urgency": "none",
            "summary": f"Email from {email_data['from']}: {email_data['subject']}",
            "event": None,
            "action_items": [],
            "can_wait": True,
            "parse_error": True,
        }

    return parsed
```

### 5.3 Example: What the LLM sees vs. what it returns

**Input email:**
```
From: professor.smith@illinois.edu
Subject: Office Hours Moved to Thursday
Date: Mon, 31 Mar 2025 14:22:00 -0500

Hi everyone,

Just a heads up — I'm moving my office hours this week to Thursday 2-3:30 PM
instead of the usual Wednesday slot. Same location, Siebel 2124.

If you need to discuss your final project, please try to come by.
Also, those who haven't submitted their midterm corrections, please
do so by Friday EOD.

Best,
Prof. Smith
```

**LLM output:**
```json
{
  "has_event": true,
  "needs_response": false,
  "urgency": "medium",
  "summary": "Prof. Smith moved office hours to Thursday 2-3:30 PM at Siebel 2124",
  "event": {
    "title": "Office Hours — Prof. Smith",
    "date": "2025-04-03",
    "start_time": "14:00",
    "end_time": "15:30",
    "location": "Siebel Center 2124, 201 N Goodwin Ave, Urbana, IL 61801",
    "is_online": false,
    "meeting_link": null,
    "description": "Prof. Smith's rescheduled office hours. Good time to discuss final project.",
    "attendees": [],
    "organizer": "Prof. Smith"
  },
  "action_items": [
    "Consider attending to discuss final project",
    "Submit midterm corrections by Friday EOD"
  ],
  "can_wait": false
}
```

---

## 6. Google Calendar Smart Event Creation

### 6.1 Creating Events via the Calendar API

```python
# calendar_manager.py
from datetime import datetime, timedelta
from gmail_watcher import get_google_service
from config import Config


class CalendarManager:
    def __init__(self):
        self.service = get_google_service("calendar", "v3")

    def create_smart_event(self, parsed_event: dict, travel_info: dict = None):
        """
        Create a Google Calendar event with full details.

        Args:
            parsed_event: The "event" dict from the LLM parser
            travel_info: Optional dict with travel_minutes, departure_time, etc.
        """
        if not parsed_event:
            return None

        start_dt = datetime.fromisoformat(
            f"{parsed_event['date']}T{parsed_event['start_time']}:00"
        )
        end_dt = datetime.fromisoformat(
            f"{parsed_event['date']}T{parsed_event['end_time']}:00"
        )

        # Build description with all context
        description_parts = []
        if parsed_event.get("description"):
            description_parts.append(parsed_event["description"])
        if parsed_event.get("meeting_link"):
            description_parts.append(f"\n🔗 Meeting Link: {parsed_event['meeting_link']}")
        if travel_info:
            description_parts.append(
                f"\n🚗 Travel: {travel_info['travel_minutes']} min from {travel_info['origin']}"
            )
            description_parts.append(
                f"🚪 Leave by: {travel_info['departure_time']}"
            )
        if parsed_event.get("organizer"):
            description_parts.append(f"\n📧 Organized by: {parsed_event['organizer']}")

        # Build the event body
        event_body = {
            "summary": parsed_event["title"],
            "description": "\n".join(description_parts),
            "start": {
                "dateTime": start_dt.isoformat(),
                "timeZone": "America/Chicago",  # Adjust to your timezone
            },
            "end": {
                "dateTime": end_dt.isoformat(),
                "timeZone": "America/Chicago",
            },
        }

        # Add location or conference link
        if parsed_event.get("location"):
            event_body["location"] = parsed_event["location"]

        if parsed_event.get("meeting_link"):
            # For Zoom/external links, add to description (already done above)
            # For Google Meet, you could use conferenceData
            pass

        # Add attendees if present
        if parsed_event.get("attendees"):
            event_body["attendees"] = [
                {"email": e} for e in parsed_event["attendees"]
            ]

        # ── SMART NOTIFICATIONS ──
        reminders = self._compute_smart_reminders(
            start_dt, parsed_event, travel_info
        )
        event_body["reminders"] = {
            "useDefault": False,
            "overrides": reminders,
        }

        # Create the event
        created = self.service.events().insert(
            calendarId="primary",
            body=event_body,
            conferenceDataVersion=1,
        ).execute()

        return created

    def _compute_smart_reminders(self, start_dt, parsed_event, travel_info):
        """
        Build notification list that accounts for travel + prep time.

        Example outputs:
          - Online meeting → [5 min before]
          - In-person, 20 min drive → [35 min before (20 travel + 15 prep)]
          - In-person, 45 min drive → [60 min before (45 travel + 15 prep), 90 min before (heads up)]
        """
        reminders = []

        if parsed_event.get("is_online"):
            # Online: just a prep-time reminder
            reminders.append({
                "method": "popup",
                "minutes": Config.online_prep,
            })
        else:
            # In-person: travel + prep
            travel_minutes = 0
            if travel_info and travel_info.get("travel_minutes"):
                travel_minutes = travel_info["travel_minutes"]

            leave_by_minutes = travel_minutes + Config.prep_time

            # "Time to leave" notification
            reminders.append({
                "method": "popup",
                "minutes": leave_by_minutes,
            })

            # Early heads-up (30 min before the "leave by" time)
            if leave_by_minutes > 20:
                reminders.append({
                    "method": "popup",
                    "minutes": leave_by_minutes + 30,
                })

        # Always add a 24-hour advance reminder
        reminders.append({"method": "popup", "minutes": 1440})

        return reminders
```

---

## 7. Smart Notifications with Travel/Prep Awareness

### 7.1 Google Maps Travel Time Estimation

```python
# travel_estimator.py
import httpx
from config import Config


class TravelEstimator:
    """Estimate travel time using Google Maps Distance Matrix API."""

    BASE_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"

    async def estimate(self, destination: str, departure_time: str = None,
                       origin: str = None) -> dict:
        """
        Estimate travel time from origin to destination.

        Args:
            destination: Address or place name
            departure_time: ISO datetime string (for traffic estimates)
            origin: Override default location. If None, uses config default.

        Returns:
            {
                "travel_minutes": 25,
                "travel_text": "25 mins",
                "distance_text": "12.3 mi",
                "origin": "Champaign, IL",
                "departure_time": "1:35 PM",  # when you should leave
            }
        """
        if not Config.google_maps_key:
            return self._fallback_estimate(destination)

        origin = origin or Config.default_home_location

        params = {
            "origins": origin,
            "destinations": destination,
            "mode": Config.travel_mode,
            "key": Config.google_maps_key,
        }

        if departure_time:
            # Google wants Unix timestamp for departure_time
            from datetime import datetime
            dt = datetime.fromisoformat(departure_time)
            params["departure_time"] = int(dt.timestamp())

        async with httpx.AsyncClient() as client:
            resp = await client.get(self.BASE_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        element = data["rows"][0]["elements"][0]

        if element["status"] != "OK":
            return self._fallback_estimate(destination)

        travel_seconds = element["duration"].get("value", 0)
        # Use duration_in_traffic if available (only with departure_time)
        if "duration_in_traffic" in element:
            travel_seconds = element["duration_in_traffic"]["value"]

        travel_minutes = round(travel_seconds / 60)

        # Calculate when to leave
        if departure_time:
            from datetime import datetime, timedelta
            event_start = datetime.fromisoformat(departure_time)
            leave_by = event_start - timedelta(minutes=travel_minutes + Config.prep_time)
            departure_str = leave_by.strftime("%-I:%M %p")
        else:
            departure_str = None

        return {
            "travel_minutes": travel_minutes,
            "travel_text": element["duration"]["text"],
            "distance_text": element["distance"]["text"],
            "origin": origin,
            "departure_time": departure_str,
        }

    def _fallback_estimate(self, destination):
        """If no Maps API key, return a rough estimate."""
        return {
            "travel_minutes": 15,  # Assume 15 min default
            "travel_text": "~15 mins (estimated)",
            "distance_text": "unknown",
            "origin": Config.default_home_location,
            "departure_time": None,
        }
```

### 7.2 Smart Notification Logic — The Full Decision Tree

```
Email arrives
  └─ LLM parses it
       └─ has_event == true?
            ├─ YES: is_online?
            │    ├─ YES (online meeting):
            │    │    ├─ Extract meeting link (Zoom/Meet/Teams)
            │    │    ├─ Notification: ONLINE_PREP_MINUTES before (default 5 min)
            │    │    └─ Create calendar event with link in description
            │    │
            │    └─ NO (in-person):
            │         ├─ Has location?
            │         │    ├─ YES:
            │         │    │    ├─ Call Google Maps Distance Matrix API
            │         │    │    ├─ Get travel time in minutes (with traffic)
            │         │    │    ├─ departure_time = event_start - travel - prep_time
            │         │    │    ├─ Notification 1: at departure_time ("Time to leave!")
            │         │    │    ├─ Notification 2: 30 min before departure ("Heads up")
            │         │    │    └─ Add travel info to event description
            │         │    │
            │         │    └─ NO location:
            │         │         ├─ Notification: PREP_TIME_MINUTES before (default 15)
            │         │         └─ Create event, note location is TBD
            │         │
            │         └─ Create calendar event with physical location
            │
            └─ NO event:
                 └─ Just send summary via Telegram/iMessage
```

---

## 8. Messaging Output — iMessage & Telegram

### 8.1 Telegram Bot

```python
# messenger.py
import httpx
from config import Config


class TelegramMessenger:
    """Send summaries via Telegram."""

    BASE_URL = "https://api.telegram.org"

    async def send(self, message: str):
        if not Config.telegram_token or not Config.telegram_chat_id:
            print("[Telegram] Not configured, skipping")
            return

        url = f"{self.BASE_URL}/bot{Config.telegram_token}/sendMessage"

        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json={
                "chat_id": Config.telegram_chat_id,
                "text": message,
                "parse_mode": "Markdown",
            })
            resp.raise_for_status()


class IMessageSender:
    """Send via iMessage using AppleScript (macOS only)."""

    async def send(self, message: str):
        if not Config.imessage_enabled:
            return

        import subprocess
        script = f'''
        tell application "Messages"
            set targetBuddy to "{Config.imessage_recipient}"
            set targetService to id of 1st account whose service type = iMessage
            set theMessage to "{message.replace('"', '\\"')}"
            send theMessage to participant targetBuddy of account id targetService
        end tell
        '''
        subprocess.run(["osascript", "-e", script], check=True)


async def send_summary(parsed_email: dict, event_created: bool = False):
    """
    Format and send a summary message to the user.

    Example output:
    ────────────────────────
    📬 *New Email*
    From: Prof. Smith
    Subject: Office Hours Moved

    📝 *Summary:* Office hours moved to Thursday 2-3:30 PM at Siebel 2124

    ⚡ *Urgency:* Medium
    📋 *Action Items:*
    • Consider attending to discuss final project
    • Submit midterm corrections by Friday EOD

    ✅ Calendar event created: "Office Hours — Prof. Smith"
    🚗 Leave by 1:20 PM (25 min drive + 15 min prep)
    ────────────────────────
    """
    lines = []
    lines.append("📬 *New Email*")
    lines.append(f"*Summary:* {parsed_email['summary']}")

    if parsed_email.get("urgency") and parsed_email["urgency"] != "none":
        emoji = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(
            parsed_email["urgency"], "⚪"
        )
        lines.append(f"{emoji} *Urgency:* {parsed_email['urgency'].title()}")

    if parsed_email.get("needs_response"):
        lines.append("💬 *Needs your response*")

    if parsed_email.get("action_items"):
        lines.append("📋 *Action Items:*")
        for item in parsed_email["action_items"]:
            lines.append(f"  • {item}")

    if event_created:
        event = parsed_email.get("event", {})
        lines.append(f"\n✅ Calendar event created: \"{event.get('title', 'Event')}\"")

    if parsed_email.get("can_wait"):
        lines.append("💤 _This can wait_")

    message = "\n".join(lines)

    # Send via configured channels
    telegram = TelegramMessenger()
    imessage = IMessageSender()

    await telegram.send(message)
    await imessage.send(message)
```

---

## 9. Day Planner / Route Optimizer (Bonus)

Your coworker's idea from the text conversation: "I need to go to the library, gym, then get my car washed — it finds the most optimal way."

```python
# day_planner.py
from llm_client import llm
from travel_estimator import TravelEstimator
from config import Config

DAY_PLANNER_SYSTEM = """You are a day planner. Given a list of tasks/errands and
the user's calendar events, produce an optimized schedule.

Consider:
- Proximity of locations (group nearby errands together)
- Time windows (some places close at certain times)
- Calendar conflicts (don't overlap with existing events)
- Travel time between stops

Respond with ONLY valid JSON:
{
  "schedule": [
    {
      "time": "9:00 AM",
      "activity": "Gym",
      "location": "ARC, 201 E Peabody Dr, Champaign, IL",
      "duration_minutes": 60,
      "notes": "Go here first since it's closest to your morning location"
    },
    ...
  ],
  "reasoning": "Brief explanation of why this order is optimal"
}
"""

async def plan_day(tasks: list[str], existing_events: list[dict]) -> dict:
    """
    Given a list of errands and existing calendar events,
    produce an optimized daily schedule.
    """
    prompt = f"""
My location: {Config.default_home_location}
Today's existing calendar events:
{json.dumps(existing_events, indent=2)}

Tasks I need to do today:
{chr(10).join(f"- {t}" for t in tasks)}

Create an optimized schedule that avoids conflicts and minimizes travel.
"""
    messages = [
        {"role": "system", "content": DAY_PLANNER_SYSTEM},
        {"role": "user", "content": prompt},
    ]

    raw = await llm.complete(messages, temperature=0.2)
    # ... parse JSON as before ...
```

---

## 10. iPhone Shortcut Integration (Bonus)

From the text conversation: using iOS Shortcuts to trigger the pipeline via a widget.

**How it works:**
1. Your Python server exposes a simple HTTP endpoint (e.g., via FastAPI)
2. An iOS Shortcut calls that endpoint
3. The Dynamic Island or notification shows the result

```python
# server.py (add this endpoint to your FastAPI app)
from fastapi import FastAPI

app = FastAPI()

@app.post("/shortcut/check-email")
async def shortcut_check():
    """Called by iOS Shortcut to manually trigger email check."""
    watcher = GmailWatcher()
    emails = watcher.get_new_emails()
    results = []
    for email_data in emails:
        parsed = await parse_email(email_data)
        results.append(parsed["summary"])
    return {"count": len(results), "summaries": results}

@app.post("/shortcut/plan-day")
async def shortcut_plan(tasks: list[str]):
    """Called by iOS Shortcut to plan the day."""
    # Fetch today's calendar events, then optimize
    ...
```

**iOS Shortcut setup:**
1. Open Shortcuts app → New Shortcut
2. Add "Get Contents of URL" action
3. URL: `http://YOUR_SERVER:8000/shortcut/check-email` (use Tailscale/ngrok for remote access)
4. Method: POST
5. Add "Show Result" action
6. Add to Home Screen as a widget

---

## 11. Project Structure

```
smart-calendar/
├── config.env                 ← THE ONE FILE users edit
├── credentials.json           ← Google OAuth (downloaded from Cloud Console)
├── token.json                 ← Auto-generated after first OAuth flow
│
├── config.py                  ← Loads config.env, exposes Config class
├── llm_client.py              ← Unified LLM client (all providers)
├── gmail_watcher.py           ← Gmail polling + email parsing
├── email_parser.py            ← LLM prompt + JSON extraction
├── calendar_manager.py        ← Google Calendar event creation
├── travel_estimator.py        ← Google Maps travel time
├── messenger.py               ← Telegram + iMessage output
├── day_planner.py             ← Bonus: route optimization
├── server.py                  ← Bonus: FastAPI for iOS Shortcuts
│
├── main.py                    ← The main loop (ties everything together)
├── requirements.txt           ← Python dependencies
└── README.md                  ← Setup instructions
```

---

## 12. Step-by-Step Build Order

This is the order you should build things for the hackathon:

### Phase 1: Foundation (30 min)
1. Create `config.env` with all the placeholder keys
2. Create `config.py` to load it
3. Create `llm_client.py` with at least the Gemini adapter
4. **Test:** Can you send a message to the LLM and get a response?

### Phase 2: Email Parsing (45 min)
5. Set up Google Cloud project, enable Gmail API, download credentials
6. Create `gmail_watcher.py` — fetch unread emails
7. Create `email_parser.py` — the LLM prompt + JSON extraction
8. **Test:** Feed a real email through the parser. Does the JSON look right?

### Phase 3: Calendar Events (30 min)
9. Enable Google Calendar API (same project)
10. Create `calendar_manager.py` — create events from parsed data
11. **Test:** Does a calendar event appear with the right title, time, location?

### Phase 4: Smart Notifications (20 min)
12. Create `travel_estimator.py` — Google Maps integration
13. Wire travel time into `calendar_manager._compute_smart_reminders()`
14. **Test:** Does the notification fire at the right time accounting for travel?

### Phase 5: Messaging (20 min)
15. Create Telegram bot via @BotFather
16. Create `messenger.py` — send formatted summaries
17. **Test:** Do you get a Telegram message when a new email arrives?

### Phase 6: Main Loop (15 min)
18. Create `main.py` — the polling loop that ties everything together
19. **Test:** Let it run. Send yourself a test email with a meeting invite. Watch it flow through.

### Phase 7: Bonus Features (if time permits)
20. Day planner / route optimizer
21. FastAPI server + iOS Shortcut
22. Auto-cleanup of past event emails

---

## Appendix A: The Main Loop

```python
# main.py
import asyncio
import logging
from config import Config
from gmail_watcher import GmailWatcher
from email_parser import parse_email
from calendar_manager import CalendarManager
from travel_estimator import TravelEstimator
from messenger import send_summary

logging.basicConfig(level=Config.log_level)
log = logging.getLogger("smart-calendar")


async def process_email(email_data, calendar, travel):
    """Process a single email through the full pipeline."""
    log.info(f"Processing: {email_data['subject']}")

    # Step 1: Parse with LLM
    parsed = await parse_email(email_data)
    log.info(f"  → has_event={parsed.get('has_event')}, "
             f"urgency={parsed.get('urgency')}")

    event_created = False

    # Step 2: Create calendar event if applicable
    if parsed.get("has_event") and parsed.get("event"):
        event = parsed["event"]

        # Step 2a: Get travel time if it's an in-person event with a location
        travel_info = None
        if not event.get("is_online") and event.get("location"):
            try:
                departure = f"{event['date']}T{event['start_time']}:00"
                travel_info = await travel.estimate(
                    destination=event["location"],
                    departure_time=departure,
                )
                log.info(f"  → Travel: {travel_info['travel_minutes']} min")
            except Exception as e:
                log.warning(f"  → Travel estimate failed: {e}")

        # Step 2b: Create the event
        try:
            created = calendar.create_smart_event(event, travel_info)
            event_created = True
            log.info(f"  → Calendar event created: {created.get('htmlLink')}")
        except Exception as e:
            log.error(f"  → Calendar creation failed: {e}")

    # Step 3: Send summary via messaging
    try:
        await send_summary(parsed, event_created)
        log.info("  → Summary sent")
    except Exception as e:
        log.error(f"  → Message send failed: {e}")


async def main():
    log.info("🚀 Smart Calendar starting...")
    log.info(f"   LLM Provider: {Config.active_llm}")
    log.info(f"   Polling every {Config.poll_interval}s")

    gmail = GmailWatcher()
    calendar = CalendarManager()
    travel = TravelEstimator()

    while True:
        try:
            new_emails = gmail.get_new_emails()

            if new_emails:
                log.info(f"📬 {len(new_emails)} new email(s)")

            for email_data in new_emails:
                await process_email(email_data, calendar, travel)

        except Exception as e:
            log.error(f"Error in main loop: {e}")

        await asyncio.sleep(Config.poll_interval)


if __name__ == "__main__":
    asyncio.run(main())
```

---

## Appendix B: requirements.txt

```
google-api-python-client>=2.100.0
google-auth-httplib2>=0.2.0
google-auth-oauthlib>=1.2.0
httpx>=0.27.0
python-dotenv>=1.0.0
fastapi>=0.110.0          # optional, for iOS Shortcut server
uvicorn>=0.29.0            # optional, for iOS Shortcut server
```

---

## Appendix C: Free Tier Quick Reference

| Service | How to Get Key | Free Limit | Link |
|---|---|---|---|
| Gemini API | Google AI Studio | 15 RPM / 1,500 RPD | https://aistudio.google.com/apikey |
| OpenRouter | Sign up | Unlimited on `:free` models | https://openrouter.ai/keys |
| Groq | Sign up | 30 RPM (Llama 8B) | https://console.groq.com/keys |
| Ollama | Install locally | Unlimited | https://ollama.com |
| Telegram Bot | Message @BotFather | Unlimited | https://t.me/BotFather |
| Google Maps | Cloud Console | $200/mo free credit | https://console.cloud.google.com |
| Gmail API | Cloud Console | Free with OAuth | https://console.cloud.google.com |
| Calendar API | Cloud Console | Free with OAuth | https://console.cloud.google.com |
