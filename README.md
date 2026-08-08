# Cloud Compiler

A stateless, multi-language code execution backend that securely compiles and runs untrusted user code in the cloud. Designed for competitive programming workflows — no local toolchain setup required.

## Features

- **9 languages supported**: C, C++, Java 21, Python, JavaScript, TypeScript, Go, Rust, C#
- **Secure untrusted-code execution** with defense-in-depth resource limits:
  - Kernel-enforced 256 MB virtual-memory limit per process (`ulimit -v`)
  - Kernel-enforced 5 s CPU-time limit per process (`ulimit -t`)
  - 5 s wall-clock `SIGKILL` fail-safe for hung/blocked processes
- **Per-request isolation**: unique UUID temp directories, `cwd` confinement, and guaranteed cleanup on every code path
- **Abuse protection**: two-tier IP rate limiting (100 req/15 min global, 30 req/min on `/compile`) with RFC-standard `RateLimit-*` headers, 100 KB upload caps
- **Dependency installation**: API-key-protected `/install` endpoint (pip, npm, apt, cargo, go, dotnet) with command-injection sanitization
- **Request analytics**: non-blocking PostgreSQL logging with proxy-aware IP extraction and offline IP geolocation
- **Stateless by design**: horizontally scalable behind a load balancer with no sticky sessions

## Tech Stack

Node.js · Express · PostgreSQL (Neon, `pg.Pool`) · Docker · Linux · Multer · express-rate-limit · geoip-lite · PM2 · Microsoft Azure

## API

### `POST /compile`

Compiles and executes code. Multipart form data.

| Field | Type | Required | Description |
|---|---|---|---|
| `lang` | string | yes | One of: `c`, `cpp`, `python`, `java`, `javascript`, `typescript`, `go`, `rust`, `csharp` |
| `code` | file | yes | Source code file (max 100 KB) |
| `input` | file | no | Optional stdin input file (max 100 KB) |

**Success:**

```json
{
  "success": true,
  "output": "Hello World\n"
}
```

**User-code failure** (compile error, runtime error, timeout, etc. — HTTP 200, mirroring production judge APIs):

```json
{
  "success": false,
  "error": "main.c:3:1: error: expected declaration specifiers"
}
```

HTTP status codes are reserved for transport/API-level errors only: `400` (missing/bad fields, unsupported language, no public class in Java), `413` (file too large), `429` (rate limited), `403` (invalid API key on `/install`), `500` (internal).

### `POST /install`

Installs dependencies globally for a language. Requires `x-api-key` header.

```json
{
  "lang": "python",
  "dependencies": ["requests", "numpy"]
}
```

### `GET /health`

Executes a live hello-world to verify the runtime works end-to-end.

```json
{
  "status": "healthy",
  "output": "Hello World! The server is healthy."
}
```

## Security Model

- Resource exhaustion is the primary threat model for a code execution service; limits are enforced by the Linux kernel (not userspace), so they cannot be bypassed by the submitted program.
- Dependency names are whitelist-sanitized (`[a-zA-Z0-9\-_.@/]`) before reaching the shell, preventing command injection.
- `INSTALL_API_KEY` (env var) protects the only mutating endpoint.
- **Known boundary**: isolation is at the process/filesystem level (temp dir + `cwd` + ulimits). Programs can still read absolute paths and make network calls. For a public multi-tenant judge, this would need hardening (seccomp, user namespaces, network isolation, or per-submission containers/microVMs).

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL (or a Neon serverless instance)
- Linux (required for `ulimit`-based sandboxing) — or Docker

### Local Setup

```bash
# 1. Clone and install
git clone https://github.com/er-abhijeet/cloud-compiler.git
cd cloud-compiler
npm install

# 2. Configure environment
# Create a .env file (gitignored) with:
#   DATABASE_URI=<PostgreSQL connection string>
#   INSTALL_API_KEY=<secret for the /install endpoint>

# 3. Create the database schema
psql "$DATABASE_URI" -c "
CREATE TABLE IF NOT EXISTS request_logs (
    id SERIAL PRIMARY KEY,
    ip_address TEXT,
    country TEXT,
    request_type TEXT,
    language TEXT,
    file_size_bytes BIGINT,
    requested_url TEXT,
    endpoint TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);"

# 4. Start the server
npm start
```

### Docker

```bash
docker build -t cloud-compiler .
docker run -p 3000:3000 \
  -e DATABASE_URI=postgres://... \
  -e INSTALL_API_KEY=your-secret \
  cloud-compiler
```

> Note: the request logger is optional for local testing — if `DATABASE_URI` is not set, the server still runs and logs errors to the console instead of failing.

The image (Ubuntu 24.04) bakes in all 9 language toolchains — no per-request installs, zero cold start.

### Health Check

```bash
curl http://localhost:3000/health
```

## Project Structure

```
├── server.js                    # Express app: /compile, /install, /health, rate limiting, sandboxing
├── getCommand.js                # Per-language compile/run command generation
├── middleware/
│   └── requestLogger.js         # Non-blocking PostgreSQL analytics middleware
├── Dockerfile                   # Ubuntu 24.04 + all 9 toolchains
└── .env                         # Environment config (DATABASE_URI, INSTALL_API_KEY) — gitignored
```

## Roadmap

- Submission queue + bounded worker pool (backpressure, retries)
- Compilation caching keyed by source hash
- Integration/unit test suite and CI/CD
- Distributed rate limiting (Redis) and observability (metrics, structured logs)
- Stronger isolation for multi-tenant deployments (seccomp / nsjail / microVMs)

## License

ISC
