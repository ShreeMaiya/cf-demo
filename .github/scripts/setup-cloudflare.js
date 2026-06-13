import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const DRY_RUN = process.argv.includes("--dry-run");
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || (DRY_RUN ? "00000000000000000000000000000000" : "");
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || (DRY_RUN ? "dry-run-token" : "");
const PRODUCTION_BRANCH =
  process.env.CLOUDFLARE_PAGES_PRODUCTION_BRANCH || (DRY_RUN ? "production" : "");
const DEPLOY_BRANCH = process.env.CLOUDFLARE_PAGES_DEPLOY_BRANCH || PRODUCTION_BRANCH;
const API_BASE = "https://api.cloudflare.com/client/v4";
const COMPATIBILITY_DATE = "2026-06-13";

const names = {
  database: "cf-db",
  kv: "cf-config",
  queue: "cf-analytics-queue",
  counterWorker: "cf-counter",
  analyticsWorker: "cf-analytics-consumer",
  workflowWorker: "cf-todo-workflow",
  pagesProject: "cf-pages",
  realtimeApp: "cf-realtime"
};

if (!ACCOUNT_ID || !API_TOKEN || !PRODUCTION_BRANCH || !DEPLOY_BRANCH) {
  throw new Error(
    "Cloudflare credentials and Pages production/deployment branch names are required."
  );
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

async function cloudflare(path, options = {}) {
  const response = await fetch(`${API_BASE}/accounts/${ACCOUNT_ID}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json"
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  if (options.allowNotFound && response.status === 404) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  const success = payload?.success !== false && response.ok;

  if (!success) {
    const details =
      payload?.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      payload?.messages?.map((message) => message.message || message).filter(Boolean).join("; ") ||
      `${response.status} ${response.statusText}`;
    throw new Error(`Cloudflare API ${options.method || "GET"} ${path} failed: ${details}`);
  }

  return payload;
}

async function ensureD1() {
  const payload = await cloudflare("/d1/database?per_page=100");
  const existing = payload.result?.find((database) => database.name === names.database);
  if (existing) {
    console.log(`Reusing D1 database ${names.database}.`);
    return existing;
  }

  console.log(`Creating D1 database ${names.database}.`);
  return (await cloudflare("/d1/database", {
    method: "POST",
    body: { name: names.database }
  })).result;
}

async function ensureKv() {
  const payload = await cloudflare("/storage/kv/namespaces?per_page=1000");
  const existing = payload.result?.find((namespace) => namespace.title === names.kv);
  if (existing) {
    console.log(`Reusing KV namespace ${names.kv}.`);
    return existing;
  }

  console.log(`Creating KV namespace ${names.kv}.`);
  return (await cloudflare("/storage/kv/namespaces", {
    method: "POST",
    body: { title: names.kv }
  })).result;
}

async function ensureQueue() {
  const payload = await cloudflare("/queues?per_page=100");
  const existing = payload.result?.find((queue) => queue.queue_name === names.queue);
  if (existing) {
    console.log(`Reusing Queue ${names.queue}.`);
    return existing;
  }

  console.log(`Creating Queue ${names.queue}.`);
  return (await cloudflare("/queues", {
    method: "POST",
    body: { queue_name: names.queue }
  })).result;
}

async function ensureRealtimeApp() {
  const payload = await cloudflare(
    `/realtime/kit/apps?search=${encodeURIComponent(names.realtimeApp)}&per_page=100`
  );
  const existing = payload.data?.find((app) => app.name === names.realtimeApp);
  if (existing) {
    console.log(`Reusing RealtimeKit app ${names.realtimeApp}.`);
    return existing;
  }

  console.log(`Creating RealtimeKit app ${names.realtimeApp}.`);
  const created = await cloudflare("/realtime/kit/apps", {
    method: "POST",
    body: { name: names.realtimeApp }
  });
  return created.data?.app;
}

async function ensurePagesProject() {
  const existing = await cloudflare(`/pages/projects/${names.pagesProject}`, {
    allowNotFound: true
  });
  if (existing) {
    console.log(`Reusing Pages project ${names.pagesProject}.`);
    return;
  }

  console.log(`Creating Pages project ${names.pagesProject}.`);
  await cloudflare("/pages/projects", {
    method: "POST",
    body: {
      name: names.pagesProject,
      production_branch: PRODUCTION_BRANCH
    }
  });
}

function workerConfig({ name, main, databaseId, queueProducer, queueConsumer, durableObject, workflow }) {
  const lines = [
    `name = ${tomlString(name)}`,
    `main = ${tomlString(main)}`,
    `compatibility_date = ${tomlString(COMPATIBILITY_DATE)}`
  ];

  if (databaseId) {
    lines.push(
      "",
      "[[d1_databases]]",
      'binding = "DB"',
      `database_name = ${tomlString(names.database)}`,
      `database_id = ${tomlString(databaseId)}`
    );
  }

  if (queueProducer) {
    lines.push(
      "",
      "[[queues.producers]]",
      'binding = "ANALYTICS_QUEUE"',
      `queue = ${tomlString(names.queue)}`
    );
  }

  if (queueConsumer) {
    lines.push("", "[[queues.consumers]]", `queue = ${tomlString(names.queue)}`);
  }

  if (durableObject) {
    lines.push(
      "",
      "[[migrations]]",
      'tag = "v1"',
      'new_sqlite_classes = ["Counter"]'
    );
  }

  if (workflow) {
    lines.push(
      "",
      "[[workflows]]",
      `name = ${tomlString(names.workflowWorker)}`,
      'binding = "TODO_WORKFLOW"',
      'class_name = "TodoWorkflow"'
    );
  }

  return `${lines.join("\n")}\n`;
}

function pagesConfig({ databaseId, kvId, realtimeAppId }) {
  return `name = ${tomlString(names.pagesProject)}
compatibility_date = ${tomlString(COMPATIBILITY_DATE)}
pages_build_output_dir = "../../dist"

[vars]
CLOUDFLARE_ACCOUNT_ID = ${tomlString(ACCOUNT_ID)}
CLOUDFLARE_REALTIMEKIT_APP_ID = ${tomlString(realtimeAppId)}
REALTIMEKIT_PRESET_NAME = "group_call_participant"

[[kv_namespaces]]
binding = "CONFIG_KV"
id = ${tomlString(kvId)}

[[d1_databases]]
binding = "DB"
database_name = ${tomlString(names.database)}
database_id = ${tomlString(databaseId)}

[[queues.producers]]
binding = "ANALYTICS_QUEUE"
queue = ${tomlString(names.queue)}

[[durable_objects.bindings]]
name = "COUNTER"
class_name = "Counter"
script_name = ${tomlString(names.counterWorker)}

[[services]]
binding = "TODO_WORKFLOW_SERVICE"
service = ${tomlString(names.workflowWorker)}
`;
}

async function writeConfigs(resources) {
  const output = resolve(".cloudflare", "generated");
  await mkdir(output, { recursive: true });

  const configs = {
    counter: workerConfig({
      name: names.counterWorker,
      main: "../../counter-worker/src/index.js",
      durableObject: true
    }),
    analytics: workerConfig({
      name: names.analyticsWorker,
      main: "../../analytics-consumer/src/index.js",
      databaseId: resources.database.uuid,
      queueConsumer: true
    }),
    workflow: workerConfig({
      name: names.workflowWorker,
      main: "../../todo-workflow/src/index.js",
      databaseId: resources.database.uuid,
      queueProducer: true,
      workflow: true
    }),
    pages: pagesConfig({
      databaseId: resources.database.uuid,
      kvId: resources.kv.id,
      realtimeAppId: resources.realtime.id
    })
  };

  await Promise.all(
    Object.entries(configs).map(([name, contents]) =>
      writeFile(resolve(output, `${name}.toml`), contents, "utf8")
    )
  );

  return Object.fromEntries(
    Object.keys(configs).map((name) => [name, resolve(output, `${name}.toml`)])
  );
}

function runWrangler(args, input) {
  const executable = resolve(
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler"
  );

  console.log(`wrangler ${args.join(" ")}`);
  if (DRY_RUN) {
    return Promise.resolve();
  }

  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: API_TOKEN
      },
      stdio: [input ? "pipe" : "inherit", "inherit", "inherit"]
    });

    if (input) {
      child.stdin.end(`${input}\n`);
    }

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`Wrangler exited with code ${code}.`));
      }
    });
  });
}

console.log(DRY_RUN ? "Generating sample Cloudflare configuration..." : "Provisioning Cloudflare resources...");
const [database, kv, queue, realtime] = DRY_RUN
  ? [
      { name: names.database, uuid: "00000000-0000-0000-0000-000000000000" },
      { title: names.kv, id: "00000000000000000000000000000000" },
      { queue_name: names.queue },
      { name: names.realtimeApp, id: "00000000-0000-0000-0000-000000000000" }
    ]
  : await Promise.all([
      ensureD1(),
      ensureKv(),
      ensureQueue(),
      ensureRealtimeApp()
    ]);

if (!database?.uuid || !kv?.id || !queue?.queue_name || !realtime?.id) {
  throw new Error("Cloudflare returned incomplete resource metadata.");
}

if (!DRY_RUN) {
  await ensurePagesProject();
}
const configs = await writeConfigs({ database, kv, queue, realtime });

if (DRY_RUN) {
  console.log("Dry run generated all Wrangler configuration files; deployment commands were skipped.");
  process.exit(0);
}

await runWrangler([
  "d1",
  "execute",
  names.database,
  "--remote",
  "--file",
  resolve("schema.sql"),
  "--config",
  configs.pages
]);
await runWrangler(["deploy", "--config", configs.counter]);
await runWrangler(["deploy", "--config", configs.analytics]);
await runWrangler(["deploy", "--config", configs.workflow]);
await runWrangler([
  "pages",
  "secret",
  "put",
  "REALTIMEKIT_API_TOKEN",
  "--project-name",
  names.pagesProject
], API_TOKEN);
await runWrangler([
  "pages",
  "deploy",
  resolve("dist"),
  "--project-name",
  names.pagesProject,
  "--branch",
  DEPLOY_BRANCH,
  "--commit-dirty=true"
]);

console.log("Cloudflare provisioning and deployment completed.");
