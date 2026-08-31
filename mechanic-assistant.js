// api/mechanic-assistant.js
//
// Vercel Serverless Function — secure backend proxy for the AI Mechanic Assistant.
//
// WHY THIS FILE EXISTS
// ---------------------
// The old version of this site called the Anthropic API directly from the
// browser. That means an API key would have had to live in client-side
// JavaScript, where ANYONE can read it (View Source, browser DevTools, or
// just watching the Network tab). Once someone has that key, they can run up
// unlimited usage on the business's Anthropic account. This file fixes that:
//
//   Browser  --POST-->  /api/mechanic-assistant  --(server-to-server)-->  Anthropic API
//
// The real ANTHROPIC_API_KEY only ever lives on the server (as an environment
// variable), never in HTML/JS shipped to the browser. The browser only ever
// talks to this same-origin endpoint.
//
// DEPLOYMENT (Vercel — recommended, has a generous free tier)
// -------------------------------------------------------------
// 1. Put this whole project (the HTML file, /images, /api) in a folder and
//    push it to a GitHub repo, or install the Vercel CLI (`npm i -g vercel`).
// 2. Import the repo at vercel.com (New Project) or run `vercel` from the
//    project folder. Vercel auto-detects the /api folder as serverless
//    functions — no extra config needed for this file to work.
// 3. In the Vercel dashboard: Project Settings -> Environment Variables ->
//    add ANTHROPIC_API_KEY with your real key (get one at console.anthropic.com).
// 4. Redeploy. Your assistant now works at https://your-site.vercel.app and
//    the key is never exposed to visitors.
//
// (If you're not using Vercel, see /netlify/functions/mechanic-assistant.js
// for the Netlify Functions equivalent, and README-deployment.md for
// Cloudflare Pages Functions notes.)

const SYSTEM_PROMPT =
  "You are the AI Mechanic Assistant for Mahlangu Pheps Auto Repairs & Diagnostics, a mobile mechanic in South Africa. " +
  "A customer will describe a car problem. Ask short, specific follow-up questions one or two at a time " +
  "(vehicle make/model/year, whether the engine cranks, warning lights, battery age, when the problem started) " +
  "until you have enough to give a helpful answer. Once you have enough, give a short list of the most likely causes " +
  "in plain language, then recommend they book a mobile diagnostic with Mahlangu Pheps to confirm. " +
  "Keep every reply under 80 words. Never claim certainty - you're narrowing possibilities, not diagnosing. " +
  "Stay strictly on car problems, repairs, and this business; politely decline anything unrelated.";

// Cheaper/faster model, well suited to short triage-style replies. Swap to
// "claude-sonnet-5" for smarter (but pricier) answers if you want more depth.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 300;
const MAX_HISTORY_MESSAGES = 12; // caps conversation length sent per request
const MAX_MESSAGE_LENGTH = 800; // caps characters per message

// ---- Very small in-memory rate limiter (best-effort only) ----
// Serverless functions can run as multiple, short-lived instances, so this
// resets often and isn't a substitute for real rate limiting. It's here to
// blunt obvious abuse (e.g. a script hammering the endpoint) at zero cost.
// For real protection at scale, use Vercel's built-in Firewall/Rate Limiting
// or a shared store like Upstash Redis - see README-deployment.md.
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (isRateLimited(ip)) {
    return res.status(429).json({
      error:
        "Too many requests. Please try again shortly, or WhatsApp us directly on 081 307 1205.",
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set in environment variables");
    return res.status(500).json({
      error: "Assistant is not configured yet. Please WhatsApp us directly on 081 307 1205.",
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const incoming = Array.isArray(body?.messages) ? body.messages : [];

  // Only ever forward role: user/assistant string content. The system prompt
  // above is fixed server-side and can never be replaced by the client.
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
    return res.status(400).json({ error: "No user message provided" });
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
      return res.status(502).json({
        error:
          "The assistant is temporarily unavailable. Please WhatsApp us directly on 081 307 1205.",
      });
    }

    const data = await anthropicRes.json();
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({
      reply: reply || "Sorry, I couldn't process that — please WhatsApp us on 081 307 1205.",
    });
  } catch (err) {
    console.error("Mechanic assistant proxy error:", err);
    return res.status(500).json({
      error: "Something went wrong. Please WhatsApp us directly on 081 307 1205.",
    });
  }
};
