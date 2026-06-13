const json = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
};

function defaultConfig() {
  return {
    sections: {
      todos: true,
      analytics: true,
      counter: true,
      call: true
    }
  };
}

// Normalize persisted config to a stable shape for API and UI consumers.
function normalizeConfig(value) {
  const base = defaultConfig();
  const config = value && typeof value === "object" ? value : {};
  const sections = config.sections && typeof config.sections === "object" ? config.sections : {};

  return {
    sections: {
      todos: sections.todos === undefined ? base.sections.todos : Boolean(sections.todos),
      analytics: sections.analytics === undefined ? base.sections.analytics : Boolean(sections.analytics),
      counter: sections.counter === undefined ? base.sections.counter : Boolean(sections.counter),
      call: sections.call === undefined ? base.sections.call : Boolean(sections.call)
    }
  };
}

async function readConfig(env) {
  const stored = await env.CONFIG_KV.get("app", "json");
  return normalizeConfig(stored);
}

// Pages Function endpoint for reading and updating global app configuration.
export async function onRequest(context) {
  const { request, env } = context;

  if (!env.CONFIG_KV) {
    return json({ error: "KV binding 'CONFIG_KV' is missing." }, 500);
  }

  if (request.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "GET, POST, OPTIONS"
      }
    });
  }

  if (request.method === "GET") {
    try {
      const config = await readConfig(env);
      return json({ config });
    } catch (error) {
      return json({ error: error?.message || "Internal server error." }, 500);
    }
  }

  if (request.method === "POST") {
    try {
      const body = await request.json().catch(() => null);
      const incoming = body?.config ?? body;
      const config = normalizeConfig(incoming);
      await env.CONFIG_KV.put("app", JSON.stringify(config));
      return json({ config });
    } catch (error) {
      return json({ error: error?.message || "Internal server error." }, 500);
    }
  }

  return json({ error: "Method not allowed." }, 405);
}
