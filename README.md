# Ava &middot; Voice Health Check-in

A web app where a user has a live voice conversation with an AI agent ("Ava") that conducts a
short health-screening intake call, then generates a structured summary a clinician could glance
at before a visit.

Built for the technical assessment: React + Vite frontend, Node.js (Express + `ws`) backend,
WebSocket transport, OpenAI for STT / LLM / TTS.

## What it does

- **Start Call / End Call** — a live call over a WebSocket connection, push-to-talk style: hold
  the talk button to speak your turn, release to send it.
- **Adaptive conversation** — the LLM asks name, main concern, duration, severity, and related
  symptoms one at a time, asks a follow-up when an answer is vague, and never re-asks something
  already answered (conversation history + a structured field tracker are kept server-side per
  call).
- **English or Hindi** — pick a language on the landing screen for the greeting; after that the
  model mirrors whatever language the caller actually speaks in, and will follow a mid-call
  switch.
- **Structured report** — once the call ends, a second LLM pass turns the transcript into a
  clinical-style summary: main concern, symptoms, duration, severity, anything flagged for
  follow-up, and a completeness indicator (`complete` / `partial` / `minimal`) so a one-exchange
  call renders a graceful, honest report instead of garbage.
- **Failure handling** — silence/near-empty clips get a "didn't catch that, try again" prompt
  without ever hitting the LLM; STT/LLM/TTS failures fall back to a spoken (or text-only, if TTS
  is also down) recovery message instead of killing the call; a failed turn is not left dangling
  in conversation history.
- **Barge-in** — pressing the talk button immediately stops any AI audio that's still playing.

## Stack / APIs used

- **Frontend**: React 18 + Vite, plain CSS (no UI framework).
- **Backend**: Node.js, Express (health check only), `ws` for the WebSocket call channel.
- **STT**: OpenAI `whisper-1` (`audio.transcriptions`).
- **LLM**: OpenAI `gpt-4o-mini`, used with forced tool-calling so every turn returns both a
  spoken reply *and* structured field updates in one call (see [Architecture](#architecture)).
- **TTS**: OpenAI TTS (`tts-1`, `alloy` voice by default), mp3 output.

All three are swappable via env vars (`STT_MODEL`, `LLM_MODEL`, `TTS_MODEL`, `TTS_VOICE`) — any
OpenAI-compatible values work without touching code.

## Project layout

```
health-screening-app/
  server/   Node/Express + WebSocket backend, OpenAI calls, conversation state
  client/   React/Vite frontend, call UI, push-to-talk recording
```

## Setup

### 1. Backend

```bash
cd server
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY=sk-...
npm start
```

Runs on `http://localhost:8787`, WebSocket call endpoint at `ws://localhost:8787/call`,
health check at `GET /health`.

### 2. Frontend

In a second terminal:

```bash
cd client
npm install
cp .env.example .env   # only needed if your backend isn't on localhost:8787
npm run dev
```

Open the printed local URL (default `http://localhost:5173`), allow microphone access, pick a
language, and hit **Start call**.

### Requirements

- Node.js 18+
- An OpenAI API key with access to Whisper, chat completions, and TTS
  (`OPENAI_API_KEY` in `server/.env`)
- A browser that supports `MediaRecorder` and `getUserMedia` (Chrome/Edge/Firefox desktop;
  recent mobile Safari/Chrome also work but weren't the primary target)

No API key, database, or other external service is required beyond OpenAI.

## Architecture

```
Browser (React)                    Node backend                        OpenAI
────────────────                   ─────────────                       ──────
hold-to-talk  ──MediaRecorder──▶  base64 audio ──WS──▶  /call handler
                                                          │
                                                          ├─ transcribeAudio() ───▶ Whisper
                                                          │
                                              (skip LLM if transcript is empty —
                                               send a "didn't catch that" prompt)
                                                          │
                                          CallSession.history + fields  ◀── merged from
                                                          │                  tool-call args
                                                          ├─ runConversationTurn() ─▶ gpt-4o-mini
                                                          │   (forced tool call: spoken_reply +
                                                          │    updated_fields + screening_complete)
                                                          │
                                                          ├─ synthesizeSpeech() ───▶ TTS
                                                          │
◀── assistant_reply {text, audio, fields} ──WS───────────┘
play audio, append to transcript

...on End Call...
                                                          ├─ generateReport() ─────▶ gpt-4o-mini
                                                          │   (forced tool call over full transcript
                                                          │    + live-accumulated fields)
◀── report {...} ──WS─────────────────────────────────────┘
render report screen
```

**Why one LLM call per turn instead of a multi-agent pipeline:** the conversation LLM call is
forced (via `tool_choice`) to return a single JSON object containing both the next spoken line
*and* whatever new structured fields it just learned. That keeps turn-taking, state tracking, and
question-asking in one consistent model call instead of splitting "decide what to ask" and
"extract entities" into two calls that could disagree with each other. `CallSession` then merges
those field updates turn over turn, so by the time the call ends there's already a live snapshot
of what's known — the final report call uses that snapshot *plus* the raw transcript as a
cross-check, and falls back to the live snapshot alone if the report-generation call itself fails.

**Why WebSockets instead of one-shot upload:** the call is a single persistent connection per
browser tab (`/call`). Each turn is a small JSON message in either direction (`user_audio` →
`assistant_reply`), so state (conversation history, collected fields) lives server-side for the
lifetime of the connection rather than being reconstructed from scratch each request. This is the
"push-to-talk over a real-time-oriented transport" shape the assessment calls out as acceptable —
not a single end-of-call file upload.

**Audio framing:** audio is base64-encoded inside the JSON WebSocket messages rather than sent as
separate binary frames. Simpler to reason about and debug for a project this size, at the cost of
~33% payload overhead — see "What I'd improve" below.

## What I'd improve with more time

- **True streaming duplex audio** instead of push-to-talk: stream mic audio continuously to a
  streaming STT endpoint (e.g. Whisper streaming / Deepgram) and start TTS playback on partial
  LLM output, instead of waiting for a full recorded clip each turn.
- **Binary WebSocket frames** for audio instead of base64-in-JSON, to cut payload size and
  latency.
- **Reconnect/resume**: if the WebSocket drops mid-call, reconnect and resume the same
  `CallSession` (currently a dropped connection ends the call).
- **Real audio-level barge-in detection** (VAD) instead of only cutting the AI off when the user
  presses the talk button — true full-duplex would let the user interrupt just by speaking.
- **Persisting calls**: right now `CallSession` lives only in memory for the socket's lifetime;
  a real product would persist transcripts/reports per user.
- **Better silence/noise handling**: currently a very small audio buffer is treated as silence;
  a proper VAD or STT-confidence check would catch noisy-but-non-empty clips too.
- **Automated tests** around `CallSession.mergeFields` and the report fallback path — hand-tested
  during development, not covered by an automated suite yet.
