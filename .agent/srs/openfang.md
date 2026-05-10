# Talking to Demiurg via A2A

This guide is for developers writing a **remote client agent** (in any language / framework) that delegates big tasks to OpenFang's `demiurg` orchestrator hand running on someone else's machine. You communicate over plain HTTP using Google's [A2A protocol](https://github.com/google/A2A); you do **not** share a filesystem with the daemon, you do **not** edit the daemon's config, and you do **not** run any OpenFang code locally.

**What you receive from the operator running the daemon:**

- A base URL, e.g. `https://openfang.example.com:4200`.
- An API key (a shared secret string). The operator chooses how to deliver it; treat it like a password.
- Confirmation that the `demiurg` hand is activated on their daemon.

**What you do not need:**

- The OpenFang source code, SDK, or CLI.
- SSH or filesystem access to the daemon host.
- The daemon's `config.toml` or any environment variables of the daemon process.

If any of the three operator-provided items are missing, ask the operator — they cannot be self-served from this side.

---

## TL;DR

```
POST /a2a/tasks/send                                → returns task immediately as status=Working
GET  /a2a/tasks/{task_id}                           → poll until status=Completed | Failed | Cancelled
POST /a2a/tasks/{task_id}/cancel                    → optional, abort an in-flight task
GET  /api/a2a/tasks/{task_id}/artifacts/{artifact_id} → download a file artifact's raw bytes
```

The reply for a completed task contains:

- `messages[]` — conversation, last message has `role: "agent"` with the synthesized text.
- `artifacts[]` — **metadata only** for any files demiurg chose to return (id, name, mime, size, download URL). Files are NOT inline; you fetch each one with a separate authenticated GET.

---

## 1. What the operator must have done before you start

You cannot do any of these from a remote machine; they are the operator's responsibility. If your client returns 404 / 401 / wrong results, ask the operator to verify:

1. The daemon is running and reachable from your network at the URL they gave you.
2. The `demiurg` hand is **activated** on that daemon. (If it isn't, `POST /a2a/tasks/send` silently falls back to whichever agent the daemon registered first — you may get unrelated results.)
3. The daemon has an API key configured **and** they have shared it with you out-of-band.

You can sanity-check #1 from your side without authentication using the public agent card endpoint:

```bash
curl -s https://openfang.example.com:4200/.well-known/agent.json | jq .
```

A 200 response with an `AgentCard` JSON body means the daemon is up and accepting public reads. A 404 / connection error means the URL is wrong or the daemon is down — escalate to the operator.

You can also list the agents registered on the daemon (this endpoint is public for read):

```bash
curl -s https://openfang.example.com:4200/api/agents | jq '.[] | {id,name,state}'
```

If no entry has a name containing `demiurg`, the operator hasn't activated it yet.

---

## 2. Authentication

You authenticate to the remote daemon with the API key the operator gave you. You **do not** configure anything on the daemon side from your machine — that is the operator's job.

### 2.1 Which calls need the token

| Endpoint                                          | Method | Token required from a remote client? |
| ------------------------------------------------- | ------ | ------------------------------------ |
| `/a2a/tasks/send`                                 | POST   | **Yes**                              |
| `/a2a/tasks/{id}` (polling)                       | GET    | No — always public                   |
| `/a2a/tasks/{id}/cancel`                          | POST   | **Yes**                              |
| `/.well-known/agent.json`, `/a2a/agents`          | GET    | No — always public                   |
| `/api/a2a/tasks/{tid}/artifacts/{aid}` (download) | GET    | **Yes**                              |

Polling is intentionally public so that long polls on flaky networks don't get repeatedly rejected over an expired or rotated token. Submitting, cancelling, and downloading artifact bytes are write/read-protected paths and do require the token.

> A note for completeness: the daemon also exempts requests originating from `127.0.0.1`/`::1` (loopback) from auth entirely. That exemption is **not relevant to you** — your client is on a different host, so loopback never applies to your traffic. Treat every write call as auth-required.

### 2.2 Sending the token

Two equivalent header forms; the daemon accepts either. Pick one and stick with it.

```
Authorization: Bearer <api_key>
X-API-Key: <api_key>
```

Examples (replace `$OPENFANG_API_KEY` and `$OPENFANG_BASE_URL` with whatever your environment provides):

```bash
curl -X POST "$OPENFANG_BASE_URL/a2a/tasks/send" \
  -H "Authorization: Bearer $OPENFANG_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```

Python:

```python
import os
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {os.environ['OPENFANG_API_KEY']}",
}
```

TypeScript:

```ts
const HEADERS = {
  'content-type': 'application/json',
  authorization: `Bearer ${process.env.OPENFANG_API_KEY}`,
};
```

Reuse the same headers object for every request. Polling does not strictly need the token, but sending it is harmless and keeps your client code simpler.

### 2.3 What the server returns on auth failure

| Status | Body (truncated)                                              | What it means for you                                                                                                                                   |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`  | `{"error":"Missing Authorization: Bearer <api_key> header"}`  | You forgot to send the token, or sent only `X-API-Key` while the daemon expects something else. Re-check the header.                                    |
| `401`  | `{"error":"Invalid API key"}`                                 | The token does not match what the daemon has configured. Ask the operator to confirm the current key. They may have rotated it.                         |
| `403`  | `{"error":"API key required for non-loopback requests. ..."}` | The daemon has **no key configured at all** and is not in `ALLOW_NO_AUTH` mode. This is an operator misconfiguration; you cannot fix it from your side. |
| `404`  | `{"error":"No agents available"}`                             | Auth passed, but the daemon has no agents registered. Operator must activate `demiurg` (or any agent).                                                  |

### 2.4 Operational tips for the client side

- **Storage**: read the key from an environment variable (`OPENFANG_API_KEY`) or your platform's secrets manager. Never commit it, never log it, never embed it in browser-side JavaScript.
- **Browser clients**: if your end-user runs in a browser, the key must live behind your own backend. The browser talks to your backend, your backend talks to OpenFang with the key.
- **Rotation**: when the operator rotates the key, every in-flight write call from your side will start returning `401`. Catch `401` and refresh the key from your secrets store; do not silently retry the same key in a loop.
- **TLS**: insist on `https://` to the operator. The token is a bearer credential — sent over plaintext HTTP, anyone on the path can replay it. If they only offer plain HTTP, push back, or require an SSH/VPN tunnel.

---

## 3. Submitting a task

### Endpoint

```
POST /a2a/tasks/send
Content-Type: application/json
```

### Request body (JSON-RPC 2.0 envelope, A2A `tasks/send`)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tasks/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Research the fastest Rust async HTTP client in 2026" }]
    },
    "sessionId": "optional-conversation-id"
  }
}
```

- `params.message.parts[]` — supports `text`, `file` (base64), or `data` (structured JSON). Demiurg currently consumes only the first `text` part; pass attachments via separate channels.
- `params.sessionId` — optional, used to correlate multiple tasks within one logical conversation.

### Response

Returns **immediately** (well under a second) with the task in `Working` state:

```json
{
  "id": "1c5e0b6e-…-…-…-c4f3",
  "sessionId": "…",
  "status": "working",
  "messages": [{ "role": "user", "parts": [{ "type": "text", "text": "Research …" }] }],
  "artifacts": []
}
```

Capture `id` — that's your task identifier for polling. The response **never contains a finished result** on this endpoint; you must poll.

### Status field forms

The status field is parsed leniently and may appear in either form:

- bare string: `"working"` / `"completed"` / `"failed"` / `"cancelled"` / `"submitted"` / `"inputRequired"`
- object: `{ "state": "completed", "message": null }`

Always read `status.state` first, then fall back to treating `status` as a string.

---

## 4. Polling for completion

### Endpoint

```
GET /a2a/tasks/{task_id}
```

### Polling pattern

- **Interval**: start at 2s, exponential back-off to 15s. Demiurg tasks vary from seconds (cached classifier) to many minutes (deep research).
- **Timeout**: choose based on the work — 5–10 min for transforms, 30+ min for deep research.
- **Status transitions**: `Working → Completed | Failed | Cancelled`. There is no streaming progress in v1.

### Response (Completed)

```json
{
  "id": "1c5e0b6e-…",
  "sessionId": "…",
  "status": "completed",
  "messages": [
    { "role": "user", "parts": [{ "type": "text", "text": "Research …" }] },
    { "role": "agent", "parts": [{ "type": "text", "text": "Tokio leads p99 latency …" }] }
  ],
  "artifacts": [
    {
      "id": "f0e1d2c3-4b5a-6978-8a9b-0c1d2e3f4a5b",
      "name": "report.md",
      "lastChunk": true,
      "parts": [
        {
          "type": "fileRef",
          "name": "report.md",
          "mimeType": "text/markdown",
          "url": "/api/a2a/tasks/1c5e0b6e-…/artifacts/f0e1d2c3-4b5a-6978-8a9b-0c1d2e3f4a5b",
          "size": 12345
        }
      ]
    }
  ]
}
```

The agent's final text is `messages[messages.length - 1].parts[0].text`. Files are listed as **references** under `artifacts[]` — no bytes inline. Each entry has a UUID `id`, a human `name`, a `mimeType`, a `size` in bytes, and a `url` you GET (with the same Bearer token) to download the file. See § 6 for the download flow.

### Response (Failed)

```json
{
  "id": "1c5e0b6e-…",
  "status": "failed",
  "messages": [
    { "role": "user", "parts": [{ "type": "text", "text": "…" }] },
    { "role": "agent", "parts": [{ "type": "text", "text": "Error: …" }] }
  ],
  "artifacts": []
}
```

Demiurg encodes specific failure classes as prefixes inside the error text (see § 7).

---

## 5. Cancelling

```
POST /a2a/tasks/{task_id}/cancel
```

Marks the task `Cancelled` in the store. Note: in v1 this only updates the task record — the underlying agent loop may still run to completion in the background. Treat cancel as a "stop polling" signal, not as a kill switch.

---

## 6. Artifact handling

**Files travel out-of-band — the completed task JSON carries metadata only, not bytes.** When demiurg produces a file (a research report, a generated document, a screenshot, etc.) the daemon stores it on disk and emits a reference in `artifacts[]`. Your client picks which files it actually wants and downloads each one with a separate authenticated GET. The completion poll stays a tiny constant size regardless of payload.

Each entry in `artifacts[]` looks like this:

```json
{
  "id": "f0e1d2c3-4b5a-6978-8a9b-0c1d2e3f4a5b",
  "name": "report.md",
  "lastChunk": true,
  "parts": [
    {
      "type": "fileRef",
      "name": "report.md",
      "mimeType": "text/markdown",
      "url": "/api/a2a/tasks/1c5e0b6e-…/artifacts/f0e1d2c3-…",
      "size": 12345
    }
  ]
}
```

To fetch the bytes:

```
GET <OPENFANG_BASE_URL><parts[].url>
Authorization: Bearer <api_key>
```

The response body is the raw file. Headers:

- `Content-Type` — same as `mimeType`.
- `Content-Length` — same as `size`.
- `Content-Disposition: attachment; filename="<name>"`.

**Python**

```python
import os, urllib.request
BASE = os.environ["OPENFANG_BASE_URL"]
HEADERS = {"Authorization": f"Bearer {os.environ['OPENFANG_API_KEY']}"}

def save_artifacts(task, dest_dir="."):
    saved = []
    for art in task.get("artifacts") or []:
        for part in art.get("parts") or []:
            if part.get("type") == "fileRef" and part.get("url"):
                req = urllib.request.Request(BASE + part["url"], headers=HEADERS)
                with urllib.request.urlopen(req) as resp:
                    path = f"{dest_dir}/{part['name']}"
                    with open(path, "wb") as f:
                        f.write(resp.read())
                saved.append(path)
    return saved
```

**JavaScript (Node 18+)**

```js
import { writeFile } from 'node:fs/promises';
const BASE = process.env.OPENFANG_BASE_URL;
const HEADERS = { authorization: `Bearer ${process.env.OPENFANG_API_KEY}` };

async function saveArtifacts(task, dir = '.') {
  const out = [];
  for (const art of task.artifacts ?? []) {
    for (const p of art.parts ?? []) {
      if (p.type === 'fileRef' && p.url && p.name) {
        const r = await fetch(BASE + p.url, { headers: HEADERS });
        if (!r.ok) throw new Error(`download failed: ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const path = `${dir}/${p.name}`;
        await writeFile(path, buf);
        out.push(path);
      }
    }
  }
  return out;
}
```

**Lifetime**: the download URL works only while the parent task is still in the daemon's task store. Once the task evicts (FIFO at capacity, on the operator's daemon) the URL returns 404. Download artifacts you care about promptly after polling finds `Completed`.

**Skipping downloads**: nothing forces you to download every artifact. Inspect `name`, `mimeType`, and `size` first; download only what you actually need. The `size` field is in bytes and lets you check available disk space before fetching.

Other part types you may still see in some messages: `text` (inline string content) and `data` (structured JSON). The legacy `file` type with inline `data` is no longer emitted by the daemon for outbound artifacts; if you encounter it, it's from an external system the daemon is forwarding. Skip part types your client doesn't understand.

---

## 7. End-to-end examples

All examples assume two environment variables on your machine:

- `OPENFANG_BASE_URL` — e.g. `https://openfang.example.com:4200`
- `OPENFANG_API_KEY` — the shared secret the operator gave you

### 7.1 curl (works in any shell)

```bash
: "${OPENFANG_BASE_URL:?set OPENFANG_BASE_URL}"
: "${OPENFANG_API_KEY:?set OPENFANG_API_KEY}"

TASK=$(curl -s -X POST "$OPENFANG_BASE_URL/a2a/tasks/send" \
  -H "Authorization: Bearer $OPENFANG_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tasks/send",
    "params":{"message":{"role":"user","parts":[{"type":"text","text":"Summarize https://example.com/article"}]}}
  }')
TASK_ID=$(echo "$TASK" | jq -r '.id')
echo "Submitted: $TASK_ID"

# Polling does not require auth, but sending the header is harmless and
# keeps your code uniform across endpoints.
while :; do
  STATE=$(curl -s "$OPENFANG_BASE_URL/a2a/tasks/$TASK_ID" \
    | jq -r '.status.state // .status')
  echo "state=$STATE"
  case "$STATE" in
    completed|failed|cancelled) break ;;
  esac
  sleep 5
done

curl -s "$OPENFANG_BASE_URL/a2a/tasks/$TASK_ID" | jq '.messages[-1].parts[0].text'
```

### 7.2 Python (zero dependencies — stdlib only)

```python
import json, os, time
from urllib.request import urlopen, Request

BASE = os.environ["OPENFANG_BASE_URL"]
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {os.environ['OPENFANG_API_KEY']}",
}

def post_json(path, body):
    req = Request(BASE + path, data=json.dumps(body).encode(),
                  headers=HEADERS, method="POST")
    return json.loads(urlopen(req).read())

def get_json(path):
    req = Request(BASE + path, headers=HEADERS, method="GET")
    return json.loads(urlopen(req).read())

def state_of(task):
    s = task.get("status")
    return s["state"] if isinstance(s, dict) else s

def submit(text, session_id=None):
    return post_json("/a2a/tasks/send", {
        "jsonrpc": "2.0", "id": 1, "method": "tasks/send",
        "params": {
            "message": {"role": "user", "parts": [{"type": "text", "text": text}]},
            "sessionId": session_id,
        },
    })

def wait(task_id, timeout_s=1800, initial=2.0, max_interval=15.0):
    deadline = time.monotonic() + timeout_s
    interval = initial
    while time.monotonic() < deadline:
        task = get_json(f"/a2a/tasks/{task_id}")
        st = state_of(task)
        if st in ("completed", "failed", "cancelled"):
            return task
        time.sleep(interval)
        interval = min(interval * 1.5, max_interval)
    raise TimeoutError(f"task {task_id} did not finish in {timeout_s}s")

def save_artifacts(task, dest_dir="."):
    """Download every fileRef artifact to dest_dir. Returns saved paths."""
    saved = []
    for art in task.get("artifacts") or []:
        for part in art.get("parts") or []:
            if part.get("type") == "fileRef" and part.get("url"):
                req = Request(BASE + part["url"], headers=HEADERS, method="GET")
                with urlopen(req) as resp:
                    path = f"{dest_dir}/{part['name']}"
                    with open(path, "wb") as f:
                        f.write(resp.read())
                saved.append(path)
    return saved

def text_reply(task):
    msgs = task.get("messages") or []
    if not msgs:
        return ""
    parts = msgs[-1].get("parts") or []
    return next((p["text"] for p in parts if p.get("type") == "text"), "")

# Usage
submitted = submit("Research the fastest Rust async HTTP client in 2026")
task = wait(submitted["id"])
print("=== reply ===")
print(text_reply(task))
print("files:", save_artifacts(task))
```

### 7.3 TypeScript (Node 18+)

```ts
const BASE = process.env.OPENFANG_BASE_URL!;
const HEADERS = {
  'content-type': 'application/json',
  authorization: `Bearer ${process.env.OPENFANG_API_KEY}`,
};

type StatusKind = 'submitted' | 'working' | 'inputRequired' | 'completed' | 'cancelled' | 'failed';

type A2aTask = {
  id: string;
  status: StatusKind | { state: StatusKind; message?: unknown };
  messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>;
  artifacts: Array<{
    id?: string;
    name?: string;
    parts: Array<{
      type: string;
      name?: string;
      mimeType?: string;
      url?: string;
      size?: number;
    }>;
  }>;
};

const stateOf = (t: A2aTask): StatusKind =>
  typeof t.status === 'string' ? t.status : t.status.state;

async function submit(text: string, sessionId?: string): Promise<A2aTask> {
  const r = await fetch(`${BASE}/a2a/tasks/send`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tasks/send',
      params: {
        message: { role: 'user', parts: [{ type: 'text', text }] },
        sessionId,
      },
    }),
  });
  if (!r.ok) throw new Error(`submit failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function waitFor(id: string, timeoutMs = 30 * 60_000): Promise<A2aTask> {
  const deadline = Date.now() + timeoutMs;
  let interval = 2_000;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/a2a/tasks/${id}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`poll failed: ${r.status}`);
    const task: A2aTask = await r.json();
    const s = stateOf(task);
    if (s === 'completed' || s === 'failed' || s === 'cancelled') return task;
    await new Promise((res) => setTimeout(res, interval));
    interval = Math.min(interval * 1.5, 15_000);
  }
  throw new Error(`task ${id} timed out`);
}

function textReply(t: A2aTask): string {
  const m = t.messages.at(-1);
  return m?.parts.find((p) => p.type === 'text')?.text ?? '';
}

async function saveArtifacts(t: A2aTask, dir = '.'): Promise<string[]> {
  const { writeFile } = await import('node:fs/promises');
  const out: string[] = [];
  for (const art of t.artifacts ?? []) {
    for (const p of art.parts ?? []) {
      if (p.type === 'fileRef' && p.url && p.name) {
        const r = await fetch(BASE + p.url, { headers: HEADERS });
        if (!r.ok) throw new Error(`download failed: ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        const path = `${dir}/${p.name}`;
        await writeFile(path, buf);
        out.push(path);
      }
    }
  }
  return out;
}

const sub = await submit('Research the fastest Rust async HTTP client in 2026');
const done = await waitFor(sub.id);
console.log(textReply(done));
console.log(await saveArtifacts(done));
```

---

## 8. Failure modes the caller will see

When `status` (or `status.state`) is `failed`, the agent's reply text starts with one of these prefixes (set by demiurg's prompt contract). All of these indicate a daemon-side condition that **you cannot fix from your client** — surface them to the operator running the daemon.

| Prefix             | Meaning                                                                                         | Your action                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `INFRA_ERROR:`     | LLM provider key missing, model unreachable, an agent failed to boot on the daemon.             | Forward verbatim to operator. Stop retrying; the same call will keep failing.                   |
| `PARTIAL:`         | Demiurg hit its per-task budget cap. Body contains the best partial synthesis it could produce. | Use what's in the body. Optionally resubmit with a narrower scope.                              |
| `CIRCUIT_BREAKER:` | Three consecutive subagent failures. Body lists the last three errors.                          | Forward to operator (likely a specialist hand is broken). Don't retry until they confirm a fix. |
| `Error: <text>`    | Generic kernel-level failure during dispatch.                                                   | Inspect the message; safe to retry idempotent tasks once.                                       |

Generic HTTP responses you may see:

| Status | Cause                                                                                                                                                                                            | Your action                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `401`  | Missing or wrong token (see § 2.3).                                                                                                                                                              | Refresh key from your secret store; if still wrong, ask operator.                |
| `403`  | Daemon misconfigured (no key set and not in allow-no-auth).                                                                                                                                      | Operator-only fix.                                                               |
| `404`  | On `tasks/send` — `No agents available`; operator must activate `demiurg`. On the artifact download URL — the parent task was evicted from the daemon's task store, or the artifact id is wrong. | Submit again to get a fresh task; download artifacts promptly after `Completed`. |
| `5xx`  | Transient daemon failure during insert.                                                                                                                                                          | Retry with exponential back-off.                                                 |

---

## 9. Best practices

- **Idempotency**: tasks are not deduplicated. Resubmitting the same prompt creates a new `task_id`. If you need exactly-once semantics, dedupe on your side using a request hash before submitting.
- **Session reuse**: pass a stable `sessionId` across related calls so demiurg can correlate context.
- **Polling cadence**: 2s → 15s exponential back-off is a good default. Don't poll faster than every 2s — you'll just hit the cache.
- **Polling timeout**: set a hard ceiling (10–30 minutes is typical). A task that hasn't completed by then almost certainly never will, and the daemon's own task store will eventually evict it.
- **Selective downloads**: artifacts are by-reference. Inspect `name` / `mimeType` / `size` first and download only what you need. Do not re-download an artifact you already saved locally — its bytes never change once `Completed` is set.
- **Download promptly**: artifact URLs only resolve while the parent task lives in the daemon's task store. Once the task evicts (FIFO at capacity), the URL returns 404. Save what you care about right after polling reports `Completed`.
- **Cancellation hygiene**: call `cancel` when your user closes the request. In v1 it only stops you polling — the agent may still finish in the background — but it keeps your client clean.
- **Network failures vs task failures**: distinguish them. A `ConnectionError` or `5xx` means _the daemon didn't get your call_; safe to retry. A `failed` task body means _the daemon ran the task and it failed_; do not retry blindly.

---

## 10. Quick checklist when something goes wrong

Run these from your client machine — none of them need access to the daemon host:

1. `GET $OPENFANG_BASE_URL/.well-known/agent.json` returns 200? — the daemon is reachable.
2. `GET $OPENFANG_BASE_URL/api/agents` shows an entry whose name contains `demiurg` and `state` is something live (e.g. `Running`)? — auto-routing will pick demiurg.
3. After submitting, `GET /a2a/tasks/{id}` returns the task at all? — the daemon stored it. If you get 404 it has either evicted (very old) or you're hitting the wrong daemon.
4. `messages[-1].role == "agent"`? — the dispatch finished. If only the user message is present, keep polling.
5. `artifacts` empty when you expected files? — demiurg's reply did not contain `<artifact path="..." mime="..."/>` markers, or the markers pointed at paths outside the agent's workspace and were silently dropped on the daemon side. Inspect `messages[-1].parts[0].text` for the raw reply; if you need different behaviour, ask the operator to update demiurg's prompt or settings.
6. Artifact download returns 404? — verify the parent task is still present in step 3. Tasks evict from the store under capacity pressure; once evicted, all artifact URLs for that task return 404. If the task still exists, double-check the artifact `id` in the URL matches one of the `artifacts[].id` values in the task JSON.
7. Artifact download returns 401? — same auth as `tasks/send`. Send `Authorization: Bearer <api_key>` (or `X-API-Key`) on the GET; polling-without-auth does not extend to the download endpoint.

If all checks pass and you still get wrong results, capture the full task JSON (id + status + messages + artifacts) and send it to the operator — that's enough for them to debug daemon-side without needing your client logs.

---

## 11. Out of scope (v1)

- **Streaming** — A2A `tasks/sendSubscribe` is not implemented. Use polling.
- **Push notifications** — `pushNotifications: false` in the agent card. Polling only.
- **External A2A delegation** — demiurg currently routes to OpenFang-local hands and agents only. Cross-vendor A2A peers are not dispatch targets.
- **Multi-part user input** — only the first `text` part of `params.message.parts[]` is consumed today.

For the underlying daemon-side mechanics (auto-route logic, async dispatch, artifact marker contract), see — on the operator's side — `crates/openfang-api/src/routes.rs` (`a2a_send_task`) and `crates/openfang-hands/bundled/demiurg/SKILL.md`. As a remote client developer you do not need to read those, but the operator will reference them when debugging your reports.
