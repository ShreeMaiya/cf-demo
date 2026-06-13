# Cloudflare Proof of Concepts

A full-stack proof of concept built with HTML, CSS, JavaScript, Pages Functions,
and multiple Cloudflare platform services. The app combines CRUD todos,
queue-backed analytics, a Durable Object counter, workflow-driven auto-delete,
and room-based RealtimeKit calls.

## Features

- Add, complete, and delete todos
- Optional auto-delete for todos created with a delay
- Persistent todo storage in Cloudflare D1
- Queue-backed analytics activity tracking
- App configuration stored in Cloudflare KV
- Isolated persistent counter with a Durable Object
- RealtimeKit room creation and join flow with audio, video, and chat

## Services Demonstrated

- Cloudflare Pages and Pages Functions
- D1 for todos and analytics events
- KV for app-wide section visibility
- Queues for asynchronous analytics ingestion
- Durable Objects for counter state
- Workflows for delayed todo deletion
- RealtimeKit for meeting setup and token minting
- Service bindings between the Pages app and auxiliary Workers

## Automated Deployment

This project uses a GitHub Actions script for automated deployment. It creates
the Cloudflare resources, applies the D1 schema, deploys the Workers and Pages
project, and sets up the required bindings.

1. Push this repository to GitHub. 
2. Open **Settings > Secrets and variables > Actions** in the GitHub repository.
3. Add these repository secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`

You can find `CLOUDFLARE_ACCOUNT_ID` in the Cloudflare dashboard for your
account. It is shown in the account overview or account settings area.

Create `CLOUDFLARE_API_TOKEN` in the Cloudflare dashboard under
**My Profile > API Tokens > Create Token**.

The token must have edit/write permissions for:

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

## API Routes

- `/api/todos`
  - `GET`: list todos
  - `POST`: create a todo and optionally trigger workflow auto-delete
  - `PUT`: update completion state
  - `DELETE`: delete by query param `id`
- `/api/analytics`
  - `GET`: aggregate event counts and recent queue-ingested events
- `/api/config`
  - `GET`: read app section visibility config from KV
  - `POST`: update app section visibility config in KV
- `/api/counter`
  - Proxies `GET`, `POST`, `PUT`, and `DELETE` to the Durable Object
- `/api/realtime-call`
  - `POST` with `action: create_call` to create a room
  - `POST` with `action: join_call` to mint a participant auth token

## Todo Flow

1. Frontend sends CRUD requests to `/api/todos`.
2. `functions/api/todos.js` reads and writes todos in D1.
3. On create, update, or delete, an analytics event is sent to
   `ANALYTICS_QUEUE`.
4. If `delaySeconds > 0`, todo creation also triggers `TODO_WORKFLOW_SERVICE`
   for scheduled auto-delete.

## Analytics Flow

1. A todo mutation succeeds in `functions/api/todos.js`.
2. The API publishes an event to `cf-analytics-queue`.
3. The consumer worker in `analytics-consumer/src/index.js` writes the event
   into D1.
4. `functions/api/analytics.js` reads the aggregated activity data for the
   dashboard.
5. The frontend polls `/api/analytics` and shows the queue-backed activity
   stream.

## Config Flow

1. The Config section in the frontend reads and updates `/api/config`.
2. `functions/api/config.js` stores the section visibility settings in
   `CONFIG_KV`.
3. The UI applies the saved config to show or hide the Todos, Analytics,
   Counter, and Call sections.

## Auto-Delete Workflow Flow

1. A todo is created with a non-zero delay from the frontend.
2. `functions/api/todos.js` calls the `TODO_WORKFLOW_SERVICE` service binding.
3. The `todo-workflow` worker waits for the requested duration.
4. The workflow deletes the todo from D1.
5. The workflow publishes a `todo.auto_deleted` event to the analytics queue.
6. The analytics consumer writes the event to D1 for the dashboard.

## Counter Flow

1. The frontend calls `/api/counter` for read, increment, and reset actions.
2. `functions/api/counter.js` forwards those requests to the `COUNTER`
   Durable Object binding.
3. The `counter-worker` project owns the `Counter` Durable Object class and
   persists the counter value in its own storage.
4. The todo data path stays in D1 and the counter stays isolated in Durable
   Object storage.

## Realtime Call Flow

1. In the Call section, users click **Create Call** or paste a room code and
   click **Join Call**.
2. The frontend calls `functions/api/realtime-call.js`.
3. The API creates a RealtimeKit meeting or mints a participant token for the
   requested room.
4. The frontend initializes RealtimeKit with that token and mounts a focused
   meeting layout.
5. Audio, video, participants, and chat stay inside the same call room.

## Database Schema

`schema.sql` creates:

- `todos`: persistent todo records
- `todo_analytics_events`: queue-ingested activity records
- indexes used by the analytics dashboard

Key columns:

- `todos.id`: unique identifier
- `todos.title`: required todo text
- `todos.completed`: completion flag
- `todos.created_at`: creation timestamp
- `todo_analytics_events.event_id`: unique queue event ID for idempotent writes
- `todo_analytics_events.event_type`: event name such as `todo.created`
- `todo_analytics_events.todo_id`: related todo ID
- `todo_analytics_events.payload`: JSON snapshot of the event body
- `todo_analytics_events.occurred_at`: timestamp generated by the producer

All statements use `IF NOT EXISTS`, so the deployment can safely apply the
schema on every run.

## Project Layout

```text
.
|-- .github/
|   |-- scripts/
|   |   |-- build-pages.js
|   |   `-- setup-cloudflare.js
|   `-- workflows/
|       `-- deploy.yml
|-- analytics-consumer/
|   `-- src/index.js
|-- counter-worker/
|   `-- src/index.js
|-- functions/
|   `-- api/
|       |-- analytics.js
|       |-- config.js
|       |-- counter.js
|       |-- realtime-call.js
|       `-- todos.js
|-- index.html
|-- package-lock.json
|-- package.json
|-- schema.sql
|-- script.js
|-- style.css
`-- todo-workflow/
   `-- src/index.js
```

## Resources

- [Cloudflare Pages Documentation](https://developers.cloudflare.com/pages/)
- [Pages Functions](https://developers.cloudflare.com/pages/platform/functions/)
- [Workers & Pages](https://developers.cloudflare.com/workers-and-pages/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Cloudflare RealtimeKit](https://developers.cloudflare.com/realtime/realtimekit/)
