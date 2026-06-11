# Intelligent Resume Assistant — Build Guide

A phased, step-by-step plan to build the agentic AI resume assistant. The plan is
deliberately ordered so that **after each phase you have something demoable and
committable**. Build the "good enough" version first (Phases 0–1), then layer on the
agentic intelligence (Phase 2), polish (Phase 3), and the WebRTC bonus last (Phase 4).

---

## 0. Strategy first (read before coding)

The rubric tells you exactly where the points are:

| Area | Weight | Where most people lose points |
|------|--------|-------------------------------|
| Functionality | 25% | — (a working chat is the *easy* 25%) |
| Agentic Design | 25% | tool-vs-LLM routing, memory, guardrails — usually hand-waved |
| Code Quality | 15% | no separation of concerns; one giant file |
| Reliability | 15% | hallucinating instead of saying "Not mentioned in resume" |
| UX / Real-time | 10% | clunky chat; no loading/error states |
| Bonus (WebRTC) | 10% | — (you chose to attempt this) |

**Three principles that should drive every decision:**

1. **Provenance is the whole game.** Every answer must know whether it came from the
   *resume text* (`source: "resume"`) or from the *model's reasoning*
   (`source: "inference"`). This is an architecture requirement, not a formatting one —
   it means you store extracted resume data as **structured fields** and ground answers
   against them, instead of dumping the raw resume into the prompt and hoping.
2. **The mandatory output schema is free points — wire it in on day one.** A raw LLM
   string must never reach the client. Everything passes through a Pydantic model.
3. **"Avoid overengineering" is an instruction, not a suggestion.** Clean modules beat
   clever infrastructure. The README is graded, so your *reasoning about trade-offs* is
   part of the deliverable.

---

## 1. Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | **Python 3.11+, FastAPI, Uvicorn** | Async, tiny boilerplate, perfect for AI glue; keeps parsing + LLM + WebRTC all in Python |
| LLM (now) | **Groq** via its OpenAI-compatible SDK | Free, fast, supports JSON mode |
| LLM (later) | **Claude (Anthropic SDK)** | Swapped in via a single provider file; Groq code stays, Claude code is stubbed/commented |
| PDF parsing | **pdfplumber** (fallback: PyMuPDF/`fitz`) | Reliable text + layout extraction without native deps |
| Validation | **Pydantic v2** | Enforces the mandatory output schema; auto-validates LLM JSON |
| Memory (MVP) | **In-process dict keyed by `session_id`** | Zero infra; good enough for a demo |
| Memory (later) | **Redis** | Only if you want persistence across restarts |
| Frontend | **React + Vite + TypeScript + Tailwind** | Fast dev loop; TS mirrors your Pydantic schema on the client |
| WebRTC (server) | **aiortc** | Python WebRTC; integrates with FastAPI for signaling |
| WebRTC (client) | **Browser `RTCPeerConnection`** | No library needed |
| Deploy | **Backend → Render; Frontend → Vercel/Netlify** | Free tiers; or just record a walkthrough |

> ⚠️ **Model IDs go stale.** Don't hard-code a Groq model name from memory — check the
> current list in the Groq console/docs and confirm it supports JSON mode before relying
> on it.

**Why separate frontend + backend (the "you recommend" answer):**
- It *demonstrates* the "clean separation of concerns" the rubric explicitly rewards.
- Your AI logic, PDF parsing, and `aiortc` voice server all want to be in Python — a
  Next.js full-stack app would force that into Node/serverless and fight you.
- Trade-off to note in the README: two deployables + CORS config is slightly more setup
  than a single app. Worth it here.

---

## 2. Architecture Overview

```
┌─────────────────────────┐         ┌──────────────────────────────────────┐
│   React (Vite + TS)      │         │            FastAPI backend            │
│                          │  HTTP   │                                        │
│  ResumeUpload ───────────┼────────▶│  /upload   → extract → LLM structure   │
│  ChatPanel    ───────────┼────────▶│  /chat     → Agent (router)            │
│  VoicePanel   ───────────┼────────▶│  /webrtc/offer (Phase 4)               │
│                          │         │                                        │
│                          │◀────────┤  AssistantResponse (validated JSON)    │
└─────────────────────────┘         └───────────────┬──────────────────────┘
                                                     │
                          ┌──────────────────────────┼───────────────────────┐
                          ▼                          ▼                         ▼
                   ┌────────────┐            ┌───────────────┐         ┌──────────────┐
                   │  Memory    │            │  Agent Router │         │  LLM provider │
                   │ (per-      │            │ tool vs LLM   │         │  Groq now /   │
                   │  session)  │            └──────┬────────┘         │  Claude later │
                   └────────────┘                   │                  └──────────────┘
                                    ┌───────────────┼────────────────┐
                                    ▼               ▼                ▼
                            resume_parser    skill_matcher    keyword_extractor
                            (PDF→struct)     (set math →      (deterministic)
                                              high conf)
```

**Request flow for a chat message:**
1. Client sends `{session_id, query}`.
2. Backend loads that session's `ResumeData` + history from memory.
3. **Router decides:** does this need a deterministic tool, or open-ended LLM reasoning?
4. Tool runs (→ usually `source: resume`, high confidence) **or** LLM runs with a strict
   grounded prompt (→ often `source: inference`).
5. Output is parsed into the `AssistantResponse` Pydantic model. If validation fails,
   you retry/repair — the client never sees malformed data.
6. Turn is appended to history.

---

## 3. Repository Structure

```
resume-assistant/
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app, routes, CORS
│   │   ├── config.py           # env loading (API keys, model id)
│   │   ├── schemas.py          # Pydantic: ResumeData, AssistantResponse
│   │   ├── llm/
│   │   │   ├── provider.py     # Groq active; Claude commented stub
│   │   │   └── prompts.py      # system role + templates
│   │   ├── tools/
│   │   │   ├── resume_parser.py
│   │   │   ├── skill_matcher.py
│   │   │   └── keyword_extractor.py
│   │   ├── agent/
│   │   │   ├── router.py       # tool-vs-LLM decision
│   │   │   └── memory.py       # per-session store
│   │   ├── services/
│   │   │   └── extract.py      # PDF/text → raw text → structured
│   │   └── webrtc/
│   │       └── signaling.py    # aiortc (Phase 4)
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ResumeUpload.tsx
│   │   │   ├── ChatPanel.tsx
│   │   │   └── VoicePanel.tsx  # Phase 4
│   │   └── lib/
│   │       ├── api.ts
│   │       └── webrtc.ts       # Phase 4
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

---

## 4. Phased Build Plan

### Phase 0 — Setup (~0.5h)
- [ ] `git init`, create the repo skeleton above, add `.gitignore` (Python, Node, `.env`).
- [ ] `backend/.env.example` with `GROQ_API_KEY=`, `MODEL_ID=`, (later) `ANTHROPIC_API_KEY=`.
- [ ] Backend venv + `pip install fastapi uvicorn pydantic python-dotenv groq pdfplumber`.
- [ ] Frontend `npm create vite@latest` (react-ts) + Tailwind.
- [ ] Get a trivial `/health` endpoint returning `{"ok": true}` and the React app talking
      to it through CORS. **Commit.** (You always want a working baseline.)

### Phase 1 — MVP, the "good enough" version (~3–4h)

Goal: upload a resume, ask a question, get a **schema-valid** answer with basic guardrails.

- [ ] **Define the schemas first** (`schemas.py`):

  ```python
  from pydantic import BaseModel, Field
  from typing import Literal

  class Experience(BaseModel):
      company: str
      title: str
      duration: str | None = None
      highlights: list[str] = []

  class ResumeData(BaseModel):
      name: str | None = None
      skills: list[str] = []
      experience: list[Experience] = []
      education: list[str] = []
      raw_text: str

  class AssistantResponse(BaseModel):
      answer: str
      confidence: float = Field(ge=0, le=1)
      source: Literal["resume", "inference"]
      missing_data: list[str] = []
  ```

- [ ] **LLM provider** (`llm/provider.py`) — Groq active, Claude stubbed exactly as you asked:

  ```python
  import os
  from groq import Groq

  _groq = Groq(api_key=os.environ["GROQ_API_KEY"])
  MODEL = os.environ.get("MODEL_ID", "llama-3.3-70b-versatile")  # verify current id!

  def chat_json(messages: list[dict], temperature: float = 0.2) -> str:
      """Returns a JSON string. Caller parses into a Pydantic model."""
      resp = _groq.chat.completions.create(
          model=MODEL,
          messages=messages,
          temperature=temperature,
          response_format={"type": "json_object"},
      )
      return resp.choices[0].message.content

  # ── Claude swap-in (uncomment later, comment out the Groq block above) ──────────
  # from anthropic import Anthropic
  # _claude = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
  # def chat_json(messages: list[dict], temperature: float = 0.2) -> str:
  #     system = next((m["content"] for m in messages if m["role"] == "system"), "")
  #     convo  = [m for m in messages if m["role"] != "system"]
  #     resp = _claude.messages.create(
  #         model="claude-sonnet-4-5",        # verify current id
  #         system=system, messages=convo,
  #         max_tokens=1024, temperature=temperature,
  #     )
  #     return resp.content[0].text
  ```

  Keeping a single `chat_json(messages)` signature is what makes the swap a one-file change.

- [ ] **Extraction** (`services/extract.py`): pdfplumber → `raw_text`; then **one LLM pass**
      that returns JSON conforming to `ResumeData`. Validate with `ResumeData.model_validate_json(...)`.
      Accept `.txt` directly. Store the result in memory under `session_id`.
- [ ] **System role + guardrails** (`llm/prompts.py`): a strict hiring-assistant prompt that:
  - only uses the supplied structured resume data,
  - must output **only** the `AssistantResponse` JSON,
  - must set `source: "resume"` only when the claim is supported by the resume, else
    `"inference"`,
  - must add any unknown field to `missing_data` and say *"Not mentioned in resume."*
- [ ] **`/upload` and `/chat` endpoints** in `main.py`. `/chat` builds the message list
      (system + resume context + last N turns + query), calls `chat_json`, validates into
      `AssistantResponse`, appends to history, returns it.
- [ ] **Minimal React UI**: `ResumeUpload` (file picker + status) and `ChatPanel`
      (messages + input + loading/error states). Render `confidence`, `source`, and
      `missing_data` visibly — it shows you took the schema seriously.
- [ ] **Definition of done:** upload a PDF, ask "What are the candidate's skills?" and
      "What's their GPA?" → first answers from resume, second returns *"Not mentioned in
      resume"* with `missing_data: ["GPA"]`. **Commit + tag `v0.1-mvp`.**

### Phase 2 — Agentic intelligence layer (~2–3h) ← the 25% differentiator

- [ ] **Tools** (`tools/`), each a plain function with typed in/out:
  - `resume_parser` — already built in Phase 1; expose it as a callable tool.
  - `skill_matcher(resume_skills, target_skills)` — **deterministic set math**: returns
    matched, missing, and a coverage score. Because it's deterministic, its answers are
    `source: "resume"` with **high confidence** (e.g. 0.95).
  - `keyword_extractor(raw_text)` — pull notable keywords/tech terms (simple frequency or
    a small curated dictionary; no heavy NLP needed).
- [ ] **Router** (`agent/router.py`) — the part that proves "the system decides when to use
      tools vs the LLM." Start rule-based; it's clean and explainable:

  ```python
  def route(query: str) -> str:
      q = query.lower()
      if any(k in q for k in ("match", "fit for", "suitable for", "required skills")):
          return "skill_matcher"
      if any(k in q for k in ("keywords", "ats", "extract terms")):
          return "keyword_extractor"
      return "llm_qa"          # open-ended → LLM
  ```

  Note the design rule in your README: **deterministic questions → tools → high-confidence
  `resume` answers; open-ended questions (summarize, evaluate) → LLM → `inference`.** That
  single sentence is the heart of your agentic design.
- [ ] **Memory** (`agent/memory.py`): per session, keep `ResumeData`, the conversation
      history, and a lightweight `last_intent`. Cap history length to control token use.
- [ ] **Confidence policy:** tools set it explicitly; for LLM answers, ask the model to
      self-rate but **clamp** it (e.g. inference answers max out at 0.7) so confidence
      stays honest.
- [ ] **Hardened guardrails:** after the LLM returns, if it claims `source: "resume"` but
      the cited skill/field isn't in `ResumeData`, downgrade to `inference` or add to
      `missing_data`. A tiny grounding check goes a long way on the Reliability score.
- [ ] **Commit + tag `v0.2-agentic`.**

### Phase 3 — Reliability & polish (~1.5h)
- [ ] Edge cases: empty/garbled PDF, scanned image PDF (no text layer → tell the user),
      no resume uploaded yet, oversized file.
- [ ] A few `pytest` tests: schema always validates; missing field → `missing_data`
      populated; `skill_matcher` math is correct.
- [ ] UX: loading spinners, error toasts, disable input until a resume is uploaded.
- [ ] **README** (graded — see §7) and **deploy** (Render + Vercel) or record a walkthrough.
- [ ] **Commit + tag `v0.3-stable`.** *This is your safe submission point.*

### Phase 4 — Bonus: WebRTC voice (~2–3h, only after v0.3 is committed)

Honest scoping (put this in the README): **with STT and TTS banned, voice cannot
semantically drive the resume Q&A.** So this feature is judged as a *real-time transport*
exercise — exactly what the "Focus areas" list says (real-time communication, stability,
reconnection, low-latency audio). Don't pretend it's a talking assistant.

A clean, defensible design:
- **Audio**: client `getUserMedia` → `RTCPeerConnection` → server (`aiortc`). Prove the
  low-latency pipe by **looping the track back** to the client and/or showing a live audio
  level meter. That demonstrates bidirectional real-time audio without STT/TTS.
- **Signaling**: FastAPI `POST /webrtc/offer` accepts the SDP offer, `aiortc` produces the
  answer. Keep it stateless and simple.
- **Lifecycle/reconnection** (where the marks are): handle `iceconnectionstatechange`,
  show connection status in `VoicePanel`, auto-retry the offer on disconnect with backoff.
- Optional nicety: run the existing **text chat over an `RTCDataChannel`** so the audio
  channel proves the real-time link while structured Q&A still works.
- **Commit + tag `v0.4-voice`.**

---

## 5. Time budget vs the 6–10h estimate

| Phase | Hours | Running total |
|-------|-------|---------------|
| 0 Setup | 0.5 | 0.5 |
| 1 MVP | 3–4 | ~4 |
| 2 Agentic | 2–3 | ~6.5 |
| 3 Polish + README + deploy | 1.5 | ~8 |
| 4 WebRTC bonus | 2–3 | ~10–11 |

**Reality check:** including the bonus puts you at the top of (or just past) the 10-hour
estimate. That's fine *if* you treat Phase 4 as gated — only start it once `v0.3-stable`
is committed and deployable. That way a time crunch costs you the bonus, never the core.

---

## 6. README checklist (it's graded)

- One-paragraph what-it-does + a screenshot/GIF.
- **Setup**: env vars (`GROQ_API_KEY`, `MODEL_ID`), backend run, frontend run.
- **Architecture overview**: the diagram from §2 + the request-flow steps.
- **Design decisions & trade-offs** (call these out explicitly):
  - Groq now, Claude later behind a one-file provider abstraction.
  - Separate FE/BE for separation of concerns (cost: CORS + two deploys).
  - Tools-vs-LLM routing rule and how it maps to `source`/`confidence`.
  - Guardrail strategy (Pydantic validation + grounding check + "Not mentioned").
  - In-memory session store (cost: no persistence across restarts).
  - WebRTC scope note (no STT/TTS → transport demo).
- **Known limitations / what I'd do next.** (Shows engineering maturity.)

---

## 7. Pitfalls that cost points

- Letting a raw model string reach the client — always validate into `AssistantResponse`.
- LLM returning prose around its JSON — use JSON mode + a strict "output only JSON" prompt
  + a parse-or-repair retry.
- Over-trusting model confidence — clamp it; deterministic tools are your high-confidence
  source of truth.
- One 800-line `main.py` — keep the module boundaries in §3.
- Starting WebRTC before the core is committed — gate it behind `v0.3-stable`.
- Hard-coding a stale model id — verify against current Groq/Anthropic docs.

---

## 8. Suggested commit/tag milestones

`v0.1-mvp` → `v0.2-agentic` → `v0.3-stable` (safe submission) → `v0.4-voice` (bonus).
Each tag is a working, demoable state.
