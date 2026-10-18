# phone – a phone number with a live transcript and a copilot

A real phone number that answers the call, **stays silent** and transcribes everything that is
said, live. On top of that sits a copilot: it recognizes the caller by their number, fetches the
client data through **MCP Toolbox** and shows the advisor suggested answers, facts and next
steps during the call.

```
Mobile ──PSTN──▶ free Vapi number ──▶ assistant (silent)
                                          │
                                          ├─ POST /llm    ← Vapi asks for a reply, gets an empty one
                                          └─ POST /vapi   ← transcript events, live
                                                   │
                                                   ├──▶ copilot: number ▶ client ▶ briefing ▶ suggestions
                                                   │         │
                                                   │         └──▶ MCP Toolbox ──▶ SQLite (case data)
                                                   │
                                                   └──▶ GET /events (SSE) ──▶ browser
```

Vapi does the transcription itself and sends finished sentences by webhook. The Vapi path
therefore **never touches audio**: no μ-law, no resampling, no streams. Node (22.18 or newer)
runs the TypeScript directly; the only runtime dependencies are the Anthropic SDK for the
copilot and `ws` for the bridge.

## What only you can do

1. **Create a Vapi account** at [vapi.ai](https://vapi.ai). No credit card, starting credit included.
2. **Claim a free number:** Dashboard → *Phone Numbers* → *Create a Phone Number* →
   **Free Vapi Number**, enter a US area code. Vapi's own telephony costs $0.00/min.
   If the account has no number yet, `npm run setup` claims one itself (area code from
   `VAPI_AREA_CODE`, default `858`).
3. **Get the API key:** Dashboard → *Settings* → *API Keys* → the **private** key.
4. **Tunnel tool**, so Vapi can reach the local service:
   `winget install --id Cloudflare.cloudflared` (open a new terminal afterwards).

> **The free number can only receive calls.** It cannot place outgoing calls. To put the
> advisor on the line with their own phone, use the bridge with SignalWire or Twilio – see
> *The bridge* below.

## Quick start

```bash
cd phone
cp .env.example .env          # fill in VAPI_API_KEY
npm install                   # once: Anthropic SDK and ws

npm run dev                   # terminal 1: service on http://localhost:3100
cloudflared tunnel --url http://localhost:3100   # terminal 2: prints an https URL
# put the https URL into .env as PUBLIC_URL
npm run setup                 # terminal 3: create the assistant and attach it to the number
```

At the end, `npm run setup` prints `☎ Jetzt anrufen: +1 …` ("call now").

**The tunnel URL changes every time cloudflared starts.** After every restart, update
`PUBLIC_URL` in `.env` and run `npm run setup` again – otherwise the assistant at Vapi still
points at the old tunnel and nothing arrives.

## Testing without a phone

```bash
npm run dev
npm run simulate
```

The simulator sends real Vapi payloads to `/vapi`: a conversation in growing fragments, exactly
the way Vapi delivers it. That lets you check the whole chain webhook → SSE → display **before a
call costs credit**. On demo day it tells you within seconds whether the telephony is stuck or
our own processing. It targets the Vapi service (`npm run dev`), not the bridge.

Both the Vapi service and the bridge also serve three pages that need no phone:

- `/sim` – a sandbox call. You type as client and as advisor in turn; the tools, the model and
  the dossier entry at the end are real.
- `/demo` – a recorded call with the test client TESTER-01 (see
  [fixtures/tester.json](fixtures/tester.json)), played back at reading pace next to everything
  the agent does. Needs no phone, no Toolbox and no model.
- `/?demo=1` – the advisor page fed from a built-in sample sequence instead of the live stream.

## What the demo looks like

Because the assistant stays silent, the line is a **listening line, not a speaking channel**:
the caller hears nothing back. The setup is therefore **one phone on speaker**:

1. The "client" dials the number, puts the phone on the table and turns the speaker on.
2. The advisor sits next to it at the laptop with the app.
3. Both speak into the same phone, and the transcript follows live.

With the bridge, client and advisor each talk on their own phone instead.

## The bridge

The bridge (`npm run bridge`) is for when the advisor should talk on the call. The client calls
a SignalWire or Twilio number, the provider connects them to the advisor's phone, and the audio
of both sides runs to ElevenLabs in parallel. Separate process, separate port, separate tunnel.

```
client ──PSTN──▶ number ──▶ POST /answer ──▶ <Dial> to the advisor's phone
                   │                          (both talk to each other)
                   └── <Start><Stream> ──▶ wss://…/media ──▶ ElevenLabs ──▶ /events
```

`/answer` returns a cXML/TwiML document that streams both audio tracks to `/media` and dials
`ADVISOR_NUMBER`. SignalWire and Twilio speak the same cXML/TwiML, so the code is the same for
both, and the bridge itself holds no provider credentials. Each track gets its own ElevenLabs
session, so the speaker is known from the track: inbound is the client, outbound the advisor.

```bash
npm run bridge                                   # terminal 1: bridge on http://localhost:3200
cloudflared tunnel --url http://localhost:3200   # terminal 2: put the URL into .env as BRIDGE_PUBLIC_URL
npm run signalwire                               # terminal 3: or npm run twilio
```

`npm run signalwire` and `npm run twilio` use the provider credentials from `.env` to buy a
number if the account has none yet (country from `SIGNALWIRE_NUMBER_COUNTRY` or
`TWILIO_NUMBER_COUNTRY`, default `US`) and set its voice webhook to `BRIDGE_PUBLIC_URL/answer`.
Like `npm run setup`, run them again after every new tunnel. On a Twilio trial the advisor's
number must be verified; `npm run twilio` starts the verification and waits for it.

## Configuration (`.env`)

Vapi path:

| Variable | Meaning |
| --- | --- |
| `VAPI_API_KEY` | Private key from the Vapi dashboard. |
| `PUBLIC_URL` | Public https URL of this service, no trailing slash. Comes from the tunnel. |
| `PORT` | Local port, default `3100`. |
| `LANGUAGE` | Language code for speech recognition (Deepgram on the Vapi path, ElevenLabs on the bridge), default `de`. |
| `GREETING` | Spoken when the call is picked up. `.env.example` sets `Die Leitung steht und wird mitgeschrieben.` ("the line is up and being transcribed"). Leave it empty so the assistant is silent from the first second. |
| `VAPI_PHONE_NUMBER` | Only needed if the account holds several numbers. Otherwise the first one is used. |
| `VAPI_AREA_CODE` | Area code for the free number `npm run setup` claims when the account has none, default `858`. |

Bridge:

| Variable | Meaning |
| --- | --- |
| `BRIDGE_PORT` | Local port of the bridge, default `3200`. |
| `BRIDGE_PUBLIC_URL` | Public https URL of the bridge (second tunnel), no trailing slash. |
| `ADVISOR_NUMBER` | The advisor's phone in E.164, e.g. `+41791234567`. On a trial it must be a verified number. |
| `ELEVENLABS_API_KEY` | Key from [elevenlabs.io](https://elevenlabs.io); transcribes both tracks of the call. |
| `SIGNALWIRE_SPACE`, `SIGNALWIRE_PROJECT_ID`, `SIGNALWIRE_API_TOKEN`, `SIGNALWIRE_NUMBER_COUNTRY` | Only for `npm run signalwire`. The space is the bare domain from the address bar after login. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER_COUNTRY` | Only for `npm run twilio`. |

Copilot:

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude for the copilot. Without it (and without `OPENAI_API_KEY`) the copilot runs in mock mode. |
| `MODEL`, `EFFORT`, `MAX_TOKENS` | Model, effort and token limit for the live hints; defaults in `.env.example`. |
| `MOCK_BRAIN` | `1` = no model calls, fixed answers from the tool data. |
| `BRAIN_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Optional: an OpenAI-compatible API instead of Claude. `BRAIN_PROVIDER=openai` forces it; otherwise it is used only when no Anthropic key is set. |
| `TOOLBOX_URL`, `TOOLBOX_TOOLSET` | Where MCP Toolbox runs and which toolset the copilot loads, default `http://127.0.0.1:5000` and `call_copilot`. |
| `UNRISK_DB`, `CLIENTS_JSON`, `REFERENCE_JSON` | The SQLite file and the case data that `npm run load-data` builds it from. `CLIENTS_JSON` takes several files, comma-separated. |
| `CALLERS_JSON` | Caller number → client mapping, default `./data/callers.json`. |
| `DEFAULT_CLIENT_REF` | Client preselected when the number is unknown (empty: the UI asks). |
| `DEFAULT_COUNTRY` | Default country code for converting numbers to E.164, default `+41`. |
| `SIM_FROM` | The number the `/sim` sandbox calls from, default `+41791234567`. |

## The copilot

During the call the advisor has a page open that reads along and helps. What it needed is
exactly what Vapi does **not** provide: who is calling, what this client holds, and what to
answer them right now.

**Client data through MCP Toolbox.** The case data (`../core-case/portfolio-data/`) is loaded
once into a local SQLite file. [MCP Toolbox](https://mcp-toolbox.dev) turns it into nine named,
read-only tools that the language model calls itself – from `find_client_by_phone` via
`get_saa_gap` to `get_recent_notes`. The advantage over hand-written queries: the tools can be
tested without a single line of application code, at `http://127.0.0.1:5000/ui` or directly in
Claude Code.

```bash
npm install             # once, pulls the Anthropic SDK and ws
npm run toolbox:get     # download the binary into bin/, once
npm run load-data       # build data/unrisk.db from the case data
npm run toolbox         # Toolbox on 127.0.0.1:5000 (own terminal)
```

**The same database also feeds the app.** Next to `call_copilot` sits the toolset `app_data`
with nine parameterless tools that return the raw objects instead of prepared views:
`app_clients` returns the client records, `app_portfolios` to `app_notes` the seven
collections that belong to them, and `app_reference` the whole `reference.json` from the
`reference_sets` table. `app/server/database.ts` assembles them into client records in the
shape of `clients.json` that the engine expects. They are separate toolsets because these tools
never belong in the language model's context: they return entire deliveries, and
`app_accounts` carries account names and IBANs.

**The copilot runs on both telephony paths.** Every transcript line arrives in
[src/live.ts](src/live.ts), whether through Vapi or through the bridge; that is where the
copilot hooks in. Another telephony path does not need to know about it, it simply writes into
`live.ts` like the others. In both cases the advisor page is at `/` and the plain telephony
page at `/pruefstand` ("test bench").

One difference remains and is visible: the bridge separates the speakers by audio track and so
really knows who is speaking. Vapi delivers everything as one role, because both speak into the
same phone; there [src/copilot/roles.ts](src/copilot/roles.ts) works out the role from the
content. If it stays unclear, the UI shows it as neutral and the copilot helps anyway.

Startup order for the demo:

```bash
npm run toolbox         # terminal 1: client data
npm run bridge          # terminal 2: bridge (or npm run dev for the Vapi path)
cloudflared tunnel --url http://localhost:3200    # terminal 3 (port 3100 for the Vapi path)
npm run twilio          # terminal 4: buy a number and set the webhook (or npm run signalwire; npm run setup for the Vapi path)
```

**The caller number has to be mapped.** The case data contains no phone numbers. So you create
`data/callers.json`; it is the only deliberately mocked part of the data chain:

```json
{ "+41791234567": "CASE-038" }
```

Then run `npm run load-data` again: the mapping is read into the database, not at call time.

`CASE-038` is a good demo client: currency concentration risk in USD and EUR, a strong
underweight in Swiss equities, plus notes on sustainable funds and on the benchmark comparison.
The matching conversation is in [fixtures/call-case-038.jsonl](fixtures/call-case-038.jsonl).

**What the copilot sticks to.** Every statement comes from a tool and names its source. If the
data does not support a statement, it says so instead of guessing. It gives no binding
investment advice and never names IBANs. Its output is German in Swiss spelling. At the end of
a call it appends a short summary to the client's free text (`append_call_summary`, toolset
`write`), so the next call's briefing sees it.

**Without a model and without credit:** `MOCK_BRAIN=1` in `.env` returns fixed, plausible
answers from the tool data. Together with `npm run simulate`, the whole chain can be shown at
any time – even on demo day without a network.

## Files

| File | Purpose |
| --- | --- |
| [src/server.ts](src/server.ts) | The routes of the Vapi service. `/vapi` takes the events, `/llm` answers empty, `/events` streams, `/` shows the advisor page; plus `/pruefstand`, `/sim`, `/demo` and `/api/ask`. |
| [src/bridge.ts](src/bridge.ts) | The bridge. `/answer` returns the cXML, `/media` takes the audio stream; serves the same pages as the Vapi service. |
| [src/bridge/cxml.ts](src/bridge/cxml.ts) | The answer document for SignalWire and Twilio: `<Start><Stream>` on both tracks, then `<Dial>` to the advisor. |
| [src/bridge/scribe.ts](src/bridge/scribe.ts) | One ElevenLabs realtime transcription session per audio track. |
| [src/bridge/mulaw.ts](src/bridge/mulaw.ts) | G.711 μ-law to 16-bit PCM. |
| [src/signalwire.ts](src/signalwire.ts), [src/twilio.ts](src/twilio.ts) | Buy a number and set its voice webhook (`npm run signalwire`, `npm run twilio`). |
| [src/live.ts](src/live.ts) | Running transcript and SSE fan-out. Interim lines replace each other instead of stacking up. |
| [src/assistant.ts](src/assistant.ts) | Creates or updates the assistant at Vapi and attaches it to the number. |
| [src/page.ts](src/page.ts) | The test bench page for the telephony alone. |
| [src/simulate.ts](src/simulate.ts) | A conversation without a phone. |
| [src/copilot/session.ts](src/copilot/session.ts) | The flow of a call from first ring to hang-up: look up the number, briefing, roles, hints, summary. |
| [src/copilot/brain.ts](src/copilot/brain.ts) | Briefing, live hints and follow-up questions from the model, with the mock mode. |
| [src/copilot/roles.ts](src/copilot/roles.ts) | Assigns client or advisor to each line from its content. |
| [src/copilot/events.ts](src/copilot/events.ts) | The event contract. All parts talk to each other only through it. |
| [src/copilot/types.ts](src/copilot/types.ts) | The interfaces between the building blocks, including the nine tool names. |
| [src/copilot/bus.ts](src/copilot/bus.ts) | Call state and fan-out to the browsers, replaying the history to late joiners. |
| [src/ui/](src/ui/) | The advisor page (`copilot.ts`), the sandbox (`sim.ts`) and the recorded demo (`demo.ts`). |
| [toolbox/schema.sql](toolbox/schema.sql) | The SQLite schema for `clients.json` and `reference.json`. |
| [toolbox/tools.yaml](toolbox/tools.yaml) | The source, the tools and the toolsets `call_copilot`, `app_data`, `dev` and `write`. |
| [scripts/load-data.ts](scripts/load-data.ts) | Builds `data/unrisk.db`, idempotent. |
| [fixtures/](fixtures/) | Recorded test calls (`call-case-038.jsonl`, `call-tester.jsonl`) and a test client (`tester.json`). |

## Why the assistant stays silent

Vapi is built for **talking** agents. To make one only listen, its language model does not
point at OpenAI but, through `model.provider: 'custom-llm'`, at `/llm` in this service – and
that answers every request with empty content. Side effect: the LLM cost drops to zero.

The answer has to come immediately; Vapi gives up after 7.5 seconds. So `/llm` answers without
any processing, streaming and non-streaming alike.

## Limits

- **Inbound only on the Vapi path.** The free Vapi number cannot place calls, and the warm
  transfer that could bring the advisor into a running call needs Twilio telephony underneath.
  To have the advisor on their own phone, use the bridge with SignalWire or Twilio (see
  *The bridge*): it does its own transcription through ElevenLabs and needs a second tunnel
  and API key.
- **No speaker separation on the Vapi path.** Both people speak into the same phone, so every
  line carries `role: "user"`. [src/copilot/roles.ts](src/copilot/roles.ts) assigns client and
  advisor from the content: heuristics first, a small Claude model only for unclear lines, and
  `unknown` if it stays unclear.
- **Credit.** Roughly $0.06/min (platform + Deepgram), telephony $0.00. Every test call counts,
  so use `npm run simulate` for everything that can be checked without a phone.

## Pitfalls

- **Nothing arrives:** the tunnel was restarted without re-running `npm run setup`. The
  assistant then still points at the old URL. Check `PUBLIC_URL` and run `npm run setup` again.
  For the bridge the same goes for `BRIDGE_PUBLIC_URL` and `npm run signalwire` /
  `npm run twilio`.
- **The assistant talks:** clear `GREETING` in `.env` and run `npm run setup` again.
- **The greeting sounds oddly stressed:** without a voice setting, Vapi uses a default voice.
  Pick a German voice in the dashboard or clear `GREETING`.
- **The call drops during a pause in speech:** raise `silenceTimeoutSeconds` in
  [src/assistant.ts](src/assistant.ts), then run `npm run setup`.
- **Bridge: the advisor's phone does not ring on a trial account:** the provider rejects the
  outbound leg unless `ADVISOR_NUMBER` is a verified number.
