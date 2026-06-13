export default {
  // Queue consumer entry point for persisted todo analytics events.
  async queue(batch, env) {
    if (!env.DB) {
      throw new Error("D1 binding 'DB' is missing.");
    }

    // Inspect current schema to support safe incremental column additions.
    const { results } = await env.DB.prepare("PRAGMA table_info(todo_analytics_events)").all();
    const existingColumns = new Set((results || []).map((column) => column.name));

    const ensureColumns = [
      ["todo_title", "TEXT"],
      ["todo_completed", "INTEGER"],
      ["payload", "TEXT"]
    ];

    // Ensure optional analytics columns exist before inserts are attempted.
    for (const [columnName, columnType] of ensureColumns) {
      if (!existingColumns.has(columnName)) {
        await env.DB.prepare(`ALTER TABLE todo_analytics_events ADD COLUMN ${columnName} ${columnType}`).run();
        existingColumns.add(columnName);
      }
    }

    // Process each queue message independently to maximize batch resilience.
    for (const message of batch.messages) {
      let event;
      try {
        event = typeof message.body === "string" ? JSON.parse(message.body) : message.body;
      } catch (err) {
        console.error("Failed to parse queue message JSON body:", err);
        continue;
      }

      if (!event?.event_id || !event?.event_type || !event?.occurred_at) {
        console.warn("Skipping invalid analytics event.", event);
        continue;
      }

      const columns = ["event_id", "event_type", "todo_id", "occurred_at"];
      const values = [event.event_id, event.event_type, event.todo_id ?? null, event.occurred_at];

      if (existingColumns.has("todo_title")) {
        columns.push("todo_title");
        values.push(event.todo_title ?? null);
      }

      if (existingColumns.has("todo_completed")) {
        columns.push("todo_completed");
        values.push(event.todo_completed ?? null);
      }

      if (existingColumns.has("payload")) {
        columns.push("payload");
        values.push(JSON.stringify(event.payload ?? null));
      }

      // Insert idempotently by event_id to avoid duplicate analytics rows.
      await env.DB.prepare(
        `INSERT OR IGNORE INTO todo_analytics_events (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})`
      )
        .bind(...values)
        .run();
    }
  }
};