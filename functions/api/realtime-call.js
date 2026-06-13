const json = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
};

const DEFAULT_PRESET_NAME = "group_call_participant";

function getMissingBindings(env) {
  const missing = [];

  if (!env.CLOUDFLARE_ACCOUNT_ID) {
    missing.push("CLOUDFLARE_ACCOUNT_ID");
  }

  if (!env.CLOUDFLARE_REALTIMEKIT_APP_ID) {
    missing.push("CLOUDFLARE_REALTIMEKIT_APP_ID");
  }

  if (!env.REALTIMEKIT_API_TOKEN) {
    missing.push("REALTIMEKIT_API_TOKEN");
  }

  return missing;
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getApiBase(env) {
  return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/realtime/kit/${env.CLOUDFLARE_REALTIMEKIT_APP_ID}`;
}

async function callRealtimeKit(env, path, options = {}) {
  const response = await fetch(`${getApiBase(env)}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.REALTIMEKIT_API_TOKEN}`
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    const message =
      payload?.errors?.[0]?.message || payload?.messages?.[0]?.message || payload?.result?.message || "RealtimeKit API request failed.";
    throw new Error(message);
  }

  return payload.data || payload.result || {};
}

async function createMeeting(env, title) {
  const meeting = await callRealtimeKit(env, "/meetings", {
    method: "POST",
    body: {
      title: title || "Realtime Call"
    }
  });

  if (!meeting?.id) {
    throw new Error("Meeting ID was missing from RealtimeKit response.");
  }

  return meeting.id;
}

async function createParticipantToken(env, roomId, name) {
  const presetName = env.REALTIMEKIT_PRESET_NAME || DEFAULT_PRESET_NAME;

  const participant = await callRealtimeKit(env, `/meetings/${encodeURIComponent(roomId)}/participants`, {
    method: "POST",
    body: {
      name,
      preset_name: presetName,
      custom_participant_id: crypto.randomUUID()
    }
  });

  const authToken = participant?.authToken || participant?.token;

  if (!authToken) {
    throw new Error("RealtimeKit participant token was not returned.");
  }

  return authToken;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "POST, OPTIONS"
      }
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const missingBindings = getMissingBindings(env);
  if (missingBindings.length) {
    return json(
      {
        error: `Missing required bindings: ${missingBindings.join(", ")}. Run the Cloudflare deployment workflow.`
      },
      500
    );
  }

  const body = await parseBody(request);
  const action = typeof body?.action === "string" ? body.action : "";

  try {
    if (action === "create_call") {
      const title = typeof body?.title === "string" ? body.title.trim() : "Realtime Call";
      const roomId = await createMeeting(env, title);
      return json({ roomId });
    }

    if (action === "join_call") {
      const roomId = typeof body?.roomId === "string" ? body.roomId.trim() : "";
      const name = typeof body?.name === "string" ? body.name.trim() : "";

      if (!roomId) {
        return json({ error: "roomId is required." }, 400);
      }

      if (!name) {
        return json({ error: "name is required." }, 400);
      }

      const authToken = await createParticipantToken(env, roomId, name);

      return json({
        roomId,
        authToken,
        baseURI: env.REALTIMEKIT_BASE_URI || null
      });
    }

    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    return json({ error: error?.message || "Internal server error." }, 500);
  }
}
