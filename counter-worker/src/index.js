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
async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Convert incoming numeric input to a finite number for counter operations.
function toCounterNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Durable Object class that owns and mutates persistent counter state.
export class Counter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          Allow: "GET, POST, PUT, DELETE, OPTIONS"
        }
      });
    }

    const currentValue = (await this.state.storage.get("value")) ?? 0;

    if (request.method === "GET") {
      // Return current counter value without mutation.
      return json({ value: currentValue });
    }

    if (request.method === "POST") {
      // Increment counter by provided delta, defaulting to 1.
      const body = await readBody(request);
      const delta = body?.delta === undefined ? 1 : toCounterNumber(body.delta);

      if (delta === null) {
        return json({ error: "A valid numeric delta is required." }, 400);
      }

      const nextValue = currentValue + delta;
      await this.state.storage.put("value", nextValue);
      return json({ value: nextValue, delta });
    }

    if (request.method === "PUT") {
      // Replace counter value with an explicit numeric value.
      const body = await readBody(request);
      const value = toCounterNumber(body?.value);

      if (value === null) {
        return json({ error: "A valid numeric value is required." }, 400);
      }

      await this.state.storage.put("value", value);
      return json({ value });
    }

    if (request.method === "DELETE") {
      // Reset counter value to zero.
      await this.state.storage.put("value", 0);
      return json({ value: 0 });
    }

    return json({ error: "Method not allowed." }, 405);
  }
}

export default {
  // Worker-level fetch handler for health checks and direct worker access.
  async fetch() {
    return new Response("Counter Durable Object worker is running.");
  }
};