# Cloudflare Services Demo

A full-stack demo built with HTML, CSS, JavaScript, Pages Functions, and several
Cloudflare platform services.

## Services Demonstrated

- Cloudflare Pages and Pages Functions
- D1 database for todos and analytics
- Workers KV for application configuration
- Queues for asynchronous analytics events
- Durable Objects for an isolated persistent counter
- Workflows for delayed todo deletion
- RealtimeKit for room-based audio, video, and chat
- Service bindings between Pages and Workers

## Automated Deployment

No Cloudflare dashboard resource setup is required. The GitHub Actions workflow
creates or reuses every named resource, generates account-specific Wrangler
configuration, applies the D1 schema, deploys all Workers, configures bindings,
stores the RealtimeKit token as a Pages secret, and deploys the Pages project.

1. Push this repository to GitHub. Its configured default branch is used as
   the Cloudflare Pages production branch.
2. Open **Settings > Secrets and variables > Actions** in the GitHub repository.
3. Add these repository secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
4. Push to the repository's default branch, or manually run **Provision and
   deploy Cloudflare demo** from a selected branch in the Actions tab. Pushes
   to non-default branches are skipped so they cannot overwrite shared Workers.

The API token must be scoped to the target account and include edit/write
permissions for:

- Workers Scripts
- Cloudflare Pages
- D1
- Workers KV Storage
- Queues
- Workflows
- Realtime / Realtime Admin

The workflow manages these resources by name:

| Service | Resource name |
| --- | --- |
| Pages | `cf-pages` |
| D1 | `cf-db` |
| KV | `cf-config` |
| Queue | `cf-analytics-queue` |
| Durable Object Worker | `cf-counter` |
| Queue consumer Worker | `cf-analytics-consumer` |
| Workflow Worker | `cf-todo-workflow` |
| RealtimeKit app | `cf-realtime` |

Provisioning is idempotent. Existing D1, KV, Queue, Pages, and RealtimeKit
resources with these exact names are reused on later deployments.

## Deployment Flow

1. Build only `index.html`, `script.js`, and `style.css` into `dist/`.
2. Create or find D1, KV, Queue, RealtimeKit, and Pages resources.
3. Generate Wrangler configuration containing the returned resource IDs.
4. Apply `schema.sql` to the remote D1 database.
5. Deploy the Durable Object Worker.
6. Deploy the analytics Queue consumer with its D1 binding.
7. Deploy the Workflow Worker with D1, Queue, and Workflow bindings.
8. Store the GitHub API token as the server-side Pages secret
   `REALTIMEKIT_API_TOKEN`.
9. Deploy Pages Functions with D1, KV, Queue, Durable Object, and service
   bindings.

Generated configuration is written to `.cloudflare/generated/` and is ignored
by Git because it contains account-specific resource identifiers.

## Local Checks

Install dependencies and validate the generated configuration without calling
Cloudflare:

```bash
npm ci
npm run build
npm run check:deploy
```

For local development, use Wrangler after supplying local bindings and secrets
appropriate for your Cloudflare account.

## API Routes

- `/api/todos`: todo CRUD, Queue publishing, and Workflow triggering
- `/api/analytics`: analytics dashboard data from D1
- `/api/config`: global section visibility stored in KV
- `/api/counter`: proxy to the Durable Object counter
- `/api/realtime-call`: create and join RealtimeKit meetings

## Project Layout

```text
.
|-- .github/
|   |-- scripts/
|   |   |-- build-pages.js
|   |   `-- setup-cloudflare.js
|   `-- workflows/deploy.yml
|-- analytics-consumer/
|-- counter-worker/
|-- functions/api/
|-- todo-workflow/
|-- index.html
|-- package.json
|-- package-lock.json
|-- schema.sql
|-- script.js
`-- style.css
```

## Database Schema

`schema.sql` creates:

- `todos`: persistent todo records
- `todo_analytics_events`: Queue-ingested activity records
- indexes used by the analytics dashboard

All statements use `IF NOT EXISTS`, so the deployment can safely apply the
schema on every run.
