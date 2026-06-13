import { WorkflowEntrypoint } from "cloudflare:workers";

export class TodoWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { todoId, delaySeconds, todoTitle } = event.payload;

    // Step 1: sleep for the requested duration
    await step.sleep("wait-for-delete", `${delaySeconds} seconds`);

    // Step 2: delete the todo from D1 and capture what was deleted
    const result = await step.do("delete-todo", async () => {
      const db = this.env.DB;

      if (!db) {
        throw new Error("DB binding is missing in workflow worker.");
      }

      const del = await db
        .prepare("DELETE FROM todos WHERE id = ?")
        .bind(todoId)
        .run();

      return {
        todoId,
        deleted: del.meta?.changes > 0
      };
    });

    // Step 3: publish a todo.auto_deleted analytics event so the dashboard
    // reflects the workflow deletion, not just manual deletes.
    if (result.deleted) {
      await step.do("publish-analytics", async () => {
        const queue = this.env.ANALYTICS_QUEUE;

        if (!queue?.send) {
          console.warn("ANALYTICS_QUEUE binding missing in workflow worker; skipping analytics.");
          return;
        }

        await queue.send({
          event_id: crypto.randomUUID(),
          event_type: "todo.auto_deleted",
          todo_id: todoId,
          todo_title: todoTitle ?? null,
          todo_completed: null,
          occurred_at: new Date().toISOString(),
          payload: {
            id: todoId,
            title: todoTitle ?? null,
            completed: null,
            created_at: null,
            delay_seconds: delaySeconds
          }
        });
      });
    }
  }
}

export default {
  // Expose a fetch handler so the Pages app can trigger the workflow via Service Binding.
  async fetch(req, env, ctx) {
    if (req.method === "POST") {
      const payload = await req.json();

      const instance = await env.TODO_WORKFLOW.create({
        id: `delete-todo-${payload.todoId}-${Date.now()}`,
        params: payload
      });

      return new Response(JSON.stringify({ success: true, instanceId: instance.id }));
    }
    return new Response("Todo Auto-Delete Workflow worker is running.");
  }
};
