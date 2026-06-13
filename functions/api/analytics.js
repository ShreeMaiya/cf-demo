const json = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
};

// Parse JSON text payload safely when optional analytics columns are present.
function parsePayload(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Read table schema to support backward-compatible column selection.
async function getAnalyticsColumns(env) {
  const { results } = await env.DB.prepare("PRAGMA table_info(todo_analytics_events)").all();
  return new Set((results || []).map((column) => column.name));
}

// Normalize database rows into the response shape used by the client.
function buildRecentEventRow(event, hasColumns) {
  const payload = parsePayload(event.payload);
  const todoTitle = hasColumns.has("todo_title")
    ? event.todo_title
    : payload?.title ?? null;
  const todoCompletedRaw = hasColumns.has("todo_completed")
    ? event.todo_completed
    : payload?.completed ?? null;
  const todoCompleted =
    todoCompletedRaw === null || todoCompletedRaw === undefined
      ? null
      : Boolean(todoCompletedRaw);

  return {
    event_id: event.event_id,
    event_type: event.event_type,
    todo_id: event.todo_id,
    todo_title: todoTitle,
    todo_completed: todoCompleted,
    payload,
    occurred_at: event.occurred_at
  };
}

// Pages Function entry point for analytics dashboard reads.
export async function onRequest(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({ error: "D1 binding 'DB' is missing." }, 500);
  }

  if (request.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "GET, OPTIONS"
      }
    });
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const analyticsColumns = await getAnalyticsColumns(env);

    // Aggregate event totals for analytics summary cards.
    const countsRows = await env.DB.prepare(
      "SELECT event_type, COUNT(*) AS total FROM todo_analytics_events GROUP BY event_type"
    ).all();

    const counts = {
      "todo.created": 0,
      "todo.updated": 0,
      "todo.deleted": 0,
      "todo.auto_deleted": 0
    };

    for (const row of countsRows.results || []) {
      counts[row.event_type] = row.total;
    }

    const recentColumns = ["event_id", "event_type", "todo_id", "occurred_at"];

    if (analyticsColumns.has("todo_title")) {
      recentColumns.push("todo_title");
    }

    if (analyticsColumns.has("todo_completed")) {
      recentColumns.push("todo_completed");
    }

    if (analyticsColumns.has("payload")) {
      recentColumns.push("payload");
    }

    // Fetch recent events with graceful support for optional columns.
    const recent = await env.DB.prepare(
      `SELECT ${recentColumns.join(", ")}
       FROM todo_analytics_events
       ORDER BY occurred_at DESC, id DESC
       LIMIT 20`
    ).all();

    const recentEvents = (recent.results || []).map((event) =>
      buildRecentEventRow(event, analyticsColumns)
    );

    return json({ counts, recent_events: recentEvents });
  } catch (error) {
    return json({ error: error?.message || "Internal server error." }, 500);
  }
}