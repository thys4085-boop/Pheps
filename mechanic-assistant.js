// netlify/functions/mechanic-assistant.js
//
// Netlify Functions version of the same secure AI Mechanic Assistant proxy
// used in /api/mechanic-assistant.js. Use THIS file instead if you're hosting
// on Netlify rather than Vercel — the logic is identical, only the handler
// signature differs (Netlify uses `event`/`context` instead of `req`/`res`).
//
// DEPLOYMENT (Netlify)
// ---------------------
// 1. Keep this file at netlify/functions/mechanic-assistant.js in your repo.
// 2. In the Netlify dashboard: Site settings -> Environment variables ->
//    add ANTHROPIC_API_KEY with your real key.
// 3. Update the frontend fetch URL in the HTML from "/api/mechanic-assistant"
//    to "/.netlify/functions/mechanic-assistant".
// 4. Deploy (Netlify auto-detects functions in the netlify/functions folder,
//    or configure the functions directory in netlify.toml).
//
// If you deployed via Vercel instead, ignore this file — use /api/mechanic-assistant.js.

const SYSTEM_PROMPT =
  "You are the AI Mechanic Assistant for Mahlangu Pheps Auto Repairs & Diagnostics, a mobile mechanic in South Africa. " +
  "A customer will describe a car problem. Ask short, specific follow-up questions one or two at a time " +
  "(vehicle make/model/year, whether the engine cranks, warning lights, battery age, when the problem started) " +
  "until you have enough to give a helpful answer. Once you have enough, give a short list of the most likely causes " +
  "in plain language, then recommend they book a mobile diagnostic with Mahlangu Pheps to confirm. " +
  "Keep every reply under 80 words. Never claim certainty - you're narrowing possibilities, not diagnosing. " +
  "Stay strictly on car problems, repairs, and this business; politely decline anything unrelated.";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 300;
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 800;

// Best-effort in-memory rate limiter — see note in api/mechanic-assistant.js
const requestLog = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;

function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (requestLog.get(key) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { Allow: "POST" }, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const ip =
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    event.headers["client-ip"] ||
    "unknown";

  if (isRateLimited(ip)) {
    return {
      statusCode: 429,
      body: JSON.stringify({
        error: "Too many requests. Please try again shortly, or WhatsApp us directly on 081 307 1205.",
      }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set in environment variables");
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Assistant is not configured yet. Please WhatsApp us directly on 081 307 1205.",
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  const messages = incoming
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return { statusCode: 400, body: JSON.stringify({ error: "No user message provided" }) };
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "The assistant is temporarily unavailable. Please WhatsApp us directly on 081 307 1205.",
        }),
      };
    }

    const data = await anthropicRes.json();
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: reply || "Sorry, I couldn't process that — please WhatsApp us on 081 307 1205.",
      }),
    };
  } catch (err) {
    console.error("Mechanic assistant proxy error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Something went wrong. Please WhatsApp us directly on 081 307 1205.",
      }),
    };
  }
};
