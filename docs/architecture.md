# Architecture

The detailed walkthrough behind the [README](../README.md): the overview diagram first, then five diagrams from the big picture down to a single call. Solid arrows carry data; dotted arrows are optional model steps. Every model step has a fallback that works without a key, so the app never goes blank.

![From Ping to Pitch architecture: inputs feed a pure engine, the model layer only phrases its findings, and a confirmed call note loops back into memory](architecture.svg)

## The short version

```mermaid
flowchart LR
  A["📂 Client data<br/>portfolio, wishes, notes"] --> C["🧮 Engine checks everything<br/>what is wrong, what fits,<br/>what changed"]
  B["📰 Today's news<br/>about what the client holds"] --> C
  C --> D["✍️ AI writes it up<br/>a 60-second briefing<br/>in plain words"]
  D --> E["🖥️ Advisor's screen<br/>ready when the phone rings"]
  E --> F["📞 The call<br/>AI listens and helps"]
  F --> G["📝 Call note<br/>advisor confirms with one tap"]
  G -->|"remembered for next time"| C
```

The engine does the maths, the AI only puts it into words. If the data does not say it, the screen does not show it.

## 1 · The big picture

```mermaid
flowchart LR
  IN[("<b>Inputs</b><br/>clients.json · reference.json<br/>uploaded client files · ex-custody PDF<br/>web news · voice")]
  SRV["<b>API server</b> · app/server<br/>routes inside the Vite server<br/>API keys never reach the browser"]
  ENG["<b>Engine</b> · app/engine<br/>pure, deterministic, tested<br/>checks → Finding[]"]
  LLM["<b>Model layer</b><br/>OpenAI or Apertus (Swiss)<br/>phrases, judges, listens<br/>example mode without a key"]
  UI["<b>UI</b> · app/src<br/>client list · workspace ·<br/>chat · call · after-call note"]
  MEM[("<b>Memory</b><br/>confirmed call notes")]

  IN --> SRV
  SRV <--> ENG
  SRV -.-> LLM
  SRV <--> UI
  UI -->|"one-tap confirm"| MEM
  MEM --> ENG

  classDef pure fill:#f3f9f1,stroke:#5a9a4a,color:#1f3a18
  classDef model fill:#fff7e8,stroke:#d9a03f,color:#4a3510
  classDef store fill:#eef4fd,stroke:#3f7fd9,color:#1f3858
  class ENG pure
  class LLM model
  class IN,MEM store
```

**The engine computes, the model phrases.** No number reaches the screen unless deterministic code produced it. Every statement is a `fact`, an `interpretation` or an `action` and names its source. If the data does not support an answer, the tool says so. No client names, IBANs or account numbers go to a model, a log or a commit.

## 2 · The briefing: from data to the 60-second talk track

```mermaid
flowchart LR
  subgraph DATA["Where a client comes from"]
    direction TB
    CJ[("clients.json<br/>47 clients")]
    DB["database.ts<br/>SQLite via MCP Toolbox,<br/>case files as fallback"]
    UP["POST /api/clients/upload<br/>3 unseen files at the live demo"]
    PDF["POST /api/import/pdf<br/>statement from another bank"]
    IMP["import/<br/>text → positions → virtual portfolio<br/>isExCustody: true · IBANs dropped<br/>unknown lines: model, numbers verified"]
    CJ --> DB
    PDF --> IMP
  end

  subgraph ENGINE["Engine · app/engine · pure: no clock, no network"]
    direction TB
    REF[("reference.json<br/>securities · fund breakdowns ·<br/>rules · profiles · SAA bands")]
    READ["data.ts<br/>null-safe reader<br/>join on SecurityId<br/>fund look-through"]
    CTX["ctx<br/>now · peers.ts · memory ·<br/>wishes (model-classified notes)"]
    CHK["checks/ · one file each<br/><b>portfolio.*</b> performance, allocation vs SAA,<br/>concentration, risk, violations, proposals,<br/>maturities, liquidity, ex-custody<br/><b>contradiction.* wish.*</b> notes vs holdings<br/><b>context.*</b> stale notes, plans, peers, history<br/><b>profile.*</b> traits, persona, tone, call reason<br/><b>memory.*</b> open promises from the last call"]
    FIX["fix.ts<br/>smallest fix as a draft proposal,<br/>every check runs again on it"]
    FIND{{"Finding[]<br/>fact · interpretation · action<br/>raw numbers + evidence"}}
    REF --> READ --> CHK
    CTX --> CHK
    CHK <--> FIX
    CHK --> FIND
  end

  subgraph TIERS["GET /api/briefing/:ref?tier=…"]
    direction TB
    T1["<b>instant</b> · under a second<br/>cards.ts: facts, flags, contradiction + fix,<br/>stale notes, profile · insights.ts ranks them"]
    T2["<b>fast</b> · a few seconds<br/>briefing.ts: open with · must mention ·<br/>ask · don't bring up"]
    T3["<b>slow</b> · news agent<br/>news.hit findings + news call reason"]
    CHECK["number check<br/>each line cites finding ids;<br/>a figure not in them is dropped"]
    T2 -.-> CHECK
  end

  subgraph SCREEN["Workspace · app/src/workspace"]
    direction TB
    CARD["client card<br/>assets big, scrolls with the brief"]
    TILES["brief tiles in speaking order<br/>reading-time bar"]
    GRAPHS["graph column<br/>agent picks + pinned items<br/>click a chart to enlarge"]
    AGENT["screen agent · POST /api/agent<br/>picks order, focus and charts<br/>from the catalogue, adds no figures"]
    AGENT -.-> TILES
    AGENT -.-> GRAPHS
  end

  DB --> READ
  UP --> READ
  IMP --> READ
  FIND --> T1
  FIND --> T2
  FIND --> T3
  T1 --> CARD
  T1 --> TILES
  CHECK --> TILES
  T3 --> TILES

  classDef pure fill:#f3f9f1,stroke:#5a9a4a,color:#1f3a18
  classDef model fill:#fff7e8,stroke:#d9a03f,color:#4a3510
  classDef store fill:#eef4fd,stroke:#3f7fd9,color:#1f3858
  class READ,CTX,CHK,FIX,FIND pure
  class T2,CHECK,AGENT model
  class CJ,REF store
```

## 3 · News: inbound call reason and the outbound "call today" list

```mermaid
flowchart LR
  HOLD["holdings.ts<br/>8 biggest holdings per client<br/>'Namen-Aktie Nestle SA' → 'Nestle'<br/>fund → theme ('S&P 500')"]
  WEB(["Bing News RSS<br/>free, no key, de-CH<br/>only security names leave the server"])
  CAND["candidates<br/>must name the holding · last 3 days ·<br/>no price pages · max 4 per holding"]
  JUDGE["judge · fast model<br/>relevant? importance 0–3?<br/>risk or opportunity? one line in de + en<br/>no key: keyword rules"]
  SNAP[("news-snapshot.json<br/>offline fallback")]
  WATCH["watcher<br/>server start + every 10 min<br/>all clients"]

  subgraph OUT["Outputs"]
    direction TB
    IN1["GET /api/news/:ref · inbound<br/>refetch this client now, model gets 4 s<br/>→ news items + call reason"]
    IN2["GET /api/outbound · who to call today<br/>score = importance × exposure (full at 5%)<br/>+ engine risk findings · one story per holding<br/>opportunity dropped if a wish contradicts it"]
    IN3["GET /api/news-agent<br/>live feed for the workspace news tile<br/>Google News · Bing · Yahoo"]
  end

  subgraph UIN["UI"]
    direction TB
    RING["ringing banner<br/>likely call reasons"]
    LIST["client list<br/>'Heute anrufen' with reasons"]
    FEED["news tile in the brief"]
  end

  WATCH --> HOLD
  HOLD --> WEB --> CAND --> JUDGE
  WEB -. network down .-> SNAP --> CAND
  JUDGE --> IN1 --> RING
  JUDGE --> IN2 --> LIST
  IN3 --> FEED

  classDef model fill:#fff7e8,stroke:#d9a03f,color:#4a3510
  classDef store fill:#eef4fd,stroke:#3f7fd9,color:#1f3858
  class JUDGE model
  class SNAP store
```

## 4 · The chat: ask the data, pin the answer, ask for more

```mermaid
flowchart LR
  Q["advisor asks<br/>'Warum ist die Liquidität zu hoch?'"]
  ROUTE{"model with<br/>function calling?"}
  FC["OpenAI picks tools"]
  KW["keyword routing<br/>(Apertus, or no key: /api/chat/data)"]
  TOOLS["chat-tools.ts · deterministic<br/>holdings incl. look-through · transactions ·<br/>value history · cash and accounts<br/>no names, IBANs or portfolio numbers"]
  PHRASE["model phrases the tool results<br/>in the advisor's language, with sources"]
  GUARD["number check<br/>every figure must be in<br/>the data or a tool result"]
  ANS["answer in the chat panel<br/>text · sources · graph"]
  PIN["Anheften<br/>→ card 'Aus dem Chat'<br/>in the graph column"]
  MORE["Genauer · Warum? · Für den Kunden<br/>or 'Mehr' on a pinned card<br/>→ new question naming the original"]

  Q --> ROUTE
  ROUTE -->|yes| FC --> TOOLS
  ROUTE -->|no| KW --> TOOLS
  TOOLS --> PHRASE --> GUARD --> ANS
  GUARD -. fails .-> KW
  ANS --> PIN
  ANS --> MORE --> Q
  PIN --> MORE

  classDef pure fill:#f3f9f1,stroke:#5a9a4a,color:#1f3a18
  classDef model fill:#fff7e8,stroke:#d9a03f,color:#4a3510
  class TOOLS,GUARD pure
  class FC,PHRASE model
```

## 5 · One call, from ring to memory

```mermaid
sequenceDiagram
  autonumber
  actor Client
  participant UI as Advisor screen (app/src)
  participant API as API server (app/server)
  participant Eng as Engine (app/engine)
  participant News as News agent (server/market)
  participant AI as Model (OpenAI / Apertus)

  Note over News: runs at server start and every 10 min for all clients:<br/>search each holding, judge new articles, rank "who to call today"
  Client->>UI: phone rings (internet call via /api/call/* or the Vapi number)
  UI->>API: GET /api/briefing/:ref?tier=instant
  API->>Eng: run(client, ctx = reference, now, peers, wishes, memory)
  Eng-->>API: Finding[] with numbers and evidence
  API-->>UI: cards + findings (under a second): client card, flags, call reasons
  par while the advisor says hello
    UI->>API: tier=fast
    API->>AI: findings only (no names): write the 60-second talk track
    AI-->>API: lines citing finding ids
    API-->>UI: talk track (numbers checked against the findings)
  and
    UI->>API: tier=slow and GET /api/news/:ref
    API->>News: refetch this client's holdings now (under 1 s)
    News->>AI: judge only articles it has not seen (max 4 s)
    News-->>UI: news hits with exposure in %, news call reason
  end
  loop during the call
    Client->>UI: speech
    UI->>API: POST /api/transcribe, then /api/analyse
    API->>AI: new transcript segments + client context
    API-->>UI: speaker roles, answer hint, next step, tiles and charts to show
    UI->>API: advisor asks in the chat: POST /api/chat
    API->>Eng: chat tools compute the figures
    API-->>UI: answer with sources (pin it, or ask for more)
  end
  Client->>UI: hangs up
  UI->>API: POST /api/calls/:ref/summary (transcript)
  API->>AI: draft what was proposed, the reaction, the promises
  API-->>UI: draft note (not stored yet)
  UI->>API: advisor edits, then POST /api/calls/:ref/confirm
  API->>API: memory store keeps the confirmed note
  Note over Eng: next briefing: memory.* surfaces open promises,<br/>rejected ideas land in "don't bring up"
```

Connecting a piece means registering it: checks (`app/engine/checks/`), briefing sections (`instant | fast | slow`) and cards (`app/src/cards/registry.tsx`) are each a registry. Details and the v0 contracts are in [PLAN.md](../PLAN.md#3-architecture).
