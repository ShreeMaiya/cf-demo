const json = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
};

// Parse request JSON safely and return null for malformed payloads.
async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Pages Function entry point for todo CRUD operations.
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.DB) {
    return json({ error: "D1 binding 'DB' is missing." }, 500);
  }

  if (request.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Allow": "GET, POST, PUT, DELETE, OPTIONS"
      }
    });
  }

  try {
    if (request.method === "GET") {
      // Read todos ordered from newest to oldest.
      const { results } = await env.DB.prepare(
        "SELECT id, title, completed, created_at FROM todos ORDER BY created_at DESC, id DESC"
      ).all();

      return json({ todos: results || [] });
    }

    if (request.method === "POST") {
      // Validate and create a todo, then emit a creation analytics event.
      const body = await parseJsonBody(request);
      const title = typeof body?.title === "string" ? body.title.trim() : "";

      if (!title) {
        return json({ error: "Title is required." }, 400);
      }

      const insert = await env.DB.prepare(
        "INSERT INTO todos (title, completed) VALUES (?, 0)"
      )
        .bind(title)
        .run();

      const insertedId = insert.meta?.last_row_id;
      const todo = insertedId
        ? await env.DB.prepare(
          "SELECT id, title, completed, created_at FROM todos WHERE id = ?"
        )
          .bind(insertedId)
          .first()
        : null;

      if (todo) {
        await publishAnalyticsEvent(context, env, createAnalyticsEvent("todo.created", todo));

        const delaySeconds = parseInt(body?.delaySeconds, 10);
        if (delaySeconds && delaySeconds > 0 && env.TODO_WORKFLOW_SERVICE) {
          const task = env.TODO_WORKFLOW_SERVICE.fetch("http://todo-workflow/", {
            method: "POST",
            body: JSON.stringify({
              todoId: todo.id,
              todoTitle: todo.title,
              delaySeconds: delaySeconds
            }),
            headers: {
              "Content-Type": "application/json"
            }
          })
            .then(async (res) => {
              await res.text();
            })
            .catch(err => console.error("Failed to trigger workflow service", err));

          if (context?.waitUntil) {
            context.waitUntil(task);
          } else {
            await task;
          }
        }
      }

      return json({ todo }, 201);
    }

    if (request.method === "PUT") {
      // Update completion state for a specific todo id and emit analytics.
      const body = await parseJsonBody(request);
      const id = Number(body?.id);

      if (!Number.isInteger(id) || id <= 0) {
        return json({ error: "Valid todo id is required." }, 400);
      }

      const completed = body?.completed ? 1 : 0;

      const update = await env.DB.prepare(
        "UPDATE todos SET completed = ? WHERE id = ?"
      )
        .bind(completed, id)
        .run();

      if (!update.meta?.changes) {
        return json({ error: "Todo not found." }, 404);
      }

      const todo = await env.DB.prepare(
        "SELECT id, title, completed, created_at FROM todos WHERE id = ?"
      )
        .bind(id)
        .first();

      if (todo) {
        await publishAnalyticsEvent(context, env, createAnalyticsEvent("todo.updated", todo));
      }

      return json({ todo });
    }

    if (request.method === "DELETE") {
      // Delete the requested todo id and emit a deletion analytics event.
      const id = Number(url.searchParams.get("id"));

      if (!Number.isInteger(id) || id <= 0) {
        return json({ error: "Valid todo id query parameter is required." }, 400);
      }

      const del = await env.DB.prepare("DELETE FROM todos WHERE id = ?")
        .bind(id)
        .run();

      if (!del.meta?.changes) {
        return json({ error: "Todo not found." }, 404);
      }

      await publishAnalyticsEvent(
        context,
        env,
        createAnalyticsEvent("todo.deleted", {
          id,
          title: null,
          completed: null,
          created_at: null
        })
      );

      return json({ success: true, id });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ error: error?.message || "Internal server error." }, 500);
  }
}

// Build a normalized analytics event payload for queue publishing.
function createAnalyticsEvent(eventType, todo) {
  return {
    event_id: crypto.randomUUID(),
    event_type: eventType,
    todo_id: todo?.id ?? null,
    todo_title: todo?.title ?? null,
    todo_completed: todo?.completed === null || todo?.completed === undefined ? null : (todo.completed ? 1 : 0),
    occurred_at: new Date().toISOString(),
    payload: {
      id: todo?.id ?? null,
      title: todo?.title ?? null,
      completed: todo?.completed === null || todo?.completed === undefined ? null : (todo.completed ? 1 : 0),
      created_at: todo?.created_at ?? null
    }
  };
}

// Queue analytics without blocking the response lifecycle when waitUntil is available.
async function publishAnalyticsEvent(context, env, event) {
  if (!env.ANALYTICS_QUEUE?.send) {
    console.warn("ANALYTICS_QUEUE binding is missing; analytics event was not queued.");
    return;
  }

  const task = env.ANALYTICS_QUEUE.send(event).catch((error) => {
    console.error("Failed to enqueue analytics event.", error);
  });

  if (context?.waitUntil) {
    context.waitUntil(task);
    return;
  }

  await task;
}
