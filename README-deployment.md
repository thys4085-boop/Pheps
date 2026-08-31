# Mahlangu Pheps Auto Repairs & Diagnostics — Deployment Guide

This package is a production-ready rebuild of the site. Read this before you deploy.

---

## 1. What's in this folder

```
index.html                          <- the website (was mahlangu-pheps-auto-repairs-3.html)
images/                             <- 5 real photos, each as .jpg (fallback) + .webp (smaller, modern)
api/mechanic-assistant.js           <- Vercel serverless function (AI assistant backend proxy)
netlify/functions/mechanic-assistant.js   <- same thing, for Netlify hosting instead
package.json                        <- minimal project metadata (no dependencies needed)
.env.example                        <- template for your API key (copy to .env locally, never commit it)
.gitignore                          <- keeps .env and local build junk out of git
robots.txt                          <- tells search engines to crawl everything + points to the sitemap
sitemap.xml                         <- single-page sitemap for search engines
README-deployment.md                <- this file
```

---

## 2. The security fix — why it matters (read this first)

The previous version called the Anthropic API **directly from the browser**. That means the
API key would have had to be embedded in client-side JavaScript — visible to anyone via
"View Source" or the browser's Network tab. Anyone who found it could use it to run
unlimited requests on the business's Anthropic account and rack up the bill, or use it for
anything else the key permits.

**Fixed in this version:**

```
Browser  →  POST /api/mechanic-assistant  →  (server-side only)  →  Anthropic API
```

The real key now lives only as an **environment variable on the server** (Vercel/Netlify/etc.),
set once in the hosting dashboard. It is never present in any file sent to a visitor's browser.
The AI's instructions (system prompt) were also moved server-side, so they can no longer be
read or overridden by anyone poking at the frontend JavaScript.

The backend also does basic hygiene the old code didn't:
- Rejects anything that isn't a POST request
- Caps conversation length and message size (limits cost per request)
- A lightweight best-effort rate limiter per IP (not bulletproof — see note in the code —
  but stops obvious abuse for free)
- Never lets the client set its own system prompt

---

## 3. Deploy in ~10 minutes (Vercel — recommended)

Vercel has a free tier that comfortably covers a small business site + this one function.

1. **Get an Anthropic API key**: [console.anthropic.com](https://console.anthropic.com/settings/keys) → Create Key.
2. **Push this folder to a GitHub repository** (or use the Vercel CLI to deploy without git —
   see step 4 below).
3. **Import the repo at [vercel.com](https://vercel.com)** → "Add New Project" → select the repo.
   Vercel auto-detects `index.html` as a static site and the `/api` folder as serverless
   functions. No build configuration is required.
4. **Set the environment variable**: Project → Settings → Environment Variables →
   add `ANTHROPIC_API_KEY` = your real key → Save.
   *(CLI alternative to steps 2–4: install the Vercel CLI with `npm i -g vercel`, run `vercel`
   from this folder, then `vercel env add ANTHROPIC_API_KEY`.)*
5. **Redeploy** (Vercel does this automatically after saving the env var, or click Redeploy).
6. Visit your `https://your-project.vercel.app` URL and test the AI Mechanic Assistant.

### Connecting your real domain
Once you have a domain (e.g. from a South African registrar), add it under
Project → Settings → Domains in Vercel, then update every
`REPLACE-WITH-YOUR-DOMAIN.co.za` placeholder in `index.html`, `robots.txt`, and
`sitemap.xml` to match (canonical URL, Open Graph/Twitter image URLs, JSON-LD `url`/`image`,
sitemap).

---

## 4. Alternative: Netlify

If you'd rather host on Netlify:

1. Use `netlify/functions/mechanic-assistant.js` (already included) instead of the `/api` version.
2. In `index.html`, change the fetch URL from `/api/mechanic-assistant` to
   `/.netlify/functions/mechanic-assistant`.
3. In the Netlify dashboard: Site settings → Environment variables → add `ANTHROPIC_API_KEY`.
4. Deploy (drag-and-drop the folder in Netlify's dashboard, or connect the git repo).

---

## 5. Alternative: Cloudflare Pages / Workers, or a VPS

The same pattern applies anywhere you can run a small bit of server-side code:
- **Cloudflare Pages Functions**: put the same logic in `functions/api/mechanic-assistant.js`
  using Cloudflare's `onRequestPost(context)` signature and `context.env.ANTHROPIC_API_KEY`.
- **Plain Node/Express on a VPS**: wrap the same logic in an Express route
  (`app.post('/api/mechanic-assistant', ...)`) and load the key with `process.env` (e.g. via
  a `.env` file and the `dotenv` package).
- **Cheap shared/cPanel hosting with no server-side code support**: this won't work for the
  AI assistant specifically, because there's nowhere to hide the key. You'd need to host the
  static site there but run this one function on a free Vercel/Netlify/Cloudflare account and
  point the frontend fetch at that function's full URL instead of a relative path.

---

## 6. Choosing the AI model (cost control)

The backend currently uses `claude-haiku-4-5-20251001` — fast and inexpensive, which is
appropriate for short triage-style replies like "why won't my car start." If you want more
detailed answers and don't mind a higher cost per message, change `MODEL` in
`api/mechanic-assistant.js` (and the Netlify equivalent) to `claude-sonnet-5`.

---

## 7. What else changed in this version (summary)

- **Images**: the site previously embedded the same photos as base64 text multiple times,
  bloating the page to ~795 KB. They're now proper files in `/images`, each served once and
  cached by the browser — HTML dropped to ~52 KB. Added WebP versions (served first via
  `<picture>`, ~25% smaller) with the original JPEGs as automatic fallback for older browsers.
  Added `width`/`height` on every image (stops layout jumping while images load) and
  `loading="lazy"` on everything below the fold.
- **Open Graph / Twitter images**: previously a `data:` URI, which social platforms and
  WhatsApp link previews cannot fetch — sharing the site link would have shown no preview
  image. Now a real hosted URL (once you set your domain).
- **JSON-LD structured data**: fixed the same base64 image issue, added `url` and
  `contactPoint`.
- **Accessibility**: skip-to-content link, proper `<nav>`/`<main>` landmarks, ARIA tab pattern
  on the quote/booking tabs, `aria-expanded`/`aria-controls` on the FAQ accordion,
  `aria-live="polite"` on the AI chat log so screen readers announce new replies.
- **Forms**: quote and booking panels are now real `<form>` elements (native validation,
  Enter-to-submit works), Name/Vehicle/Address marked `required`, and a honeypot field added
  to both to quietly drop obvious bot spam.
- **WhatsApp reliability**: the "send via WhatsApp" buttons now fall back to a direct page
  navigation if the browser blocks the pop-up window — this matters especially for visitors
  arriving via Instagram/Facebook's in-app browser, which frequently blocks `window.open`.
- **Navigation/CTAs**: added an always-visible "Call" button in the header (previously only
  WhatsApp showed on mobile), and a second floating WhatsApp button alongside the existing
  floating emergency call button, both padded for iPhone notch/home-indicator safe areas.
- **Nothing about the branding, photos, services, pricing language, or contact details was
  invented or changed** — only the technical delivery of the same content.

---

## 8. Before going live, still do this

- [ ] Set `ANTHROPIC_API_KEY` in your hosting provider's dashboard
- [ ] Replace every `REPLACE-WITH-YOUR-DOMAIN.co.za` placeholder with your real domain
- [ ] Test the AI Mechanic Assistant on the live URL (not just locally)
- [ ] Test both WhatsApp forms and the floating buttons on an actual phone
- [ ] Submit `sitemap.xml` in Google Search Console once the domain is live
- [ ] If you later have a fixed business address, add a `PostalAddress` + `geo` block to the
  JSON-LD in `index.html` — this was deliberately left out here since no address was provided
  and it shouldn't be guessed
