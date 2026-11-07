/* server/email.js — pluggable transactional email for ACED magic links.
   ============================================================================
   The server calls ONE function: sendMagicLink(to, link). This file decides how
   it's actually delivered, picking a provider from env at load time:

     RESEND_API_KEY set  ->  Resend (https://resend.com — simple HTTPS, free tier)
     nothing set         ->  console fallback: sends NOTHING and logs only that
                             delivery was skipped (never the address or the link).
                             Local development gets the link from the /auth/request
                             response instead (localhost APP_URL only; see auth-flow.js).

   The console fallback is fine for local dev. In PRODUCTION it means nobody can
   sign in, so server.js logs a loud warning at boot if it sees the console
   provider with NODE_ENV=production. To go live, set RESEND_API_KEY (and verify a
   sending domain in Resend), or add an SES/Postmark branch below — the server
   never needs to change.
   ============================================================================ */
"use strict";

const APP_NAME = "ACED";
// Resend requires a verified domain. Until you verify yours, Resend allows
// "onboarding@resend.dev" for test sends. Override with EMAIL_FROM in prod.
const FROM = process.env.EMAIL_FROM || "ACED <onboarding@resend.dev>";

function consoleProvider() {
  return {
    name: "console",
    async send() {
      // Recipient, subject, body and link are deliberately NOT logged: the link is a
      // bearer credential and the address is personal data.
      console.log("[email:console] delivery skipped: no email provider configured");
      return { ok: true, provider: "console", delivered: false };
    }
  };
}

function resendProvider(key) {
  return {
    name: "resend",
    async send({ to, subject, html, text }) {
      // Node 18+ has global fetch; this file requires Node >= 18 (see package.json engines).
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [to], subject, html, text })
      });
      if (!res.ok) {
        // Status only: the provider's error body can echo the recipient address.
        throw new Error("Resend HTTP " + Number(res.status));
      }
      return { ok: true, provider: "resend", delivered: true };
    }
  };
}

const provider = process.env.RESEND_API_KEY
  ? resendProvider(process.env.RESEND_API_KEY)
  : consoleProvider();

function magicLinkEmail(link) {
  const subject = APP_NAME + " — your sign-in link";
  const text =
    "Sign in to " + APP_NAME + " by opening this link (valid for 15 minutes):\n\n" +
    link +
    "\n\nThis link works once. If you didn't request it, you can ignore this email — " +
    "no account is created until the link is opened.";
  const html =
    '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;background:#04110b;color:#cdebd9;padding:32px;border-radius:10px;max-width:480px;margin:auto">' +
      '<div style="font-size:13px;letter-spacing:2px;color:#4dff9e;margin-bottom:18px">' + APP_NAME + ' &#47;&#47; SIGN IN</div>' +
      '<p style="line-height:1.5;margin:0 0 18px">Tap to sign in. This link works once and expires in 15 minutes.</p>' +
      '<a href="' + link + '" style="display:inline-block;background:#0d3a25;border:1px solid #4dff9e;color:#9be36b;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px">Open ' + APP_NAME + '</a>' +
      '<p style="font-size:12px;color:#6f8a78;line-height:1.5;margin:20px 0 0">If the button does nothing, paste this URL into your browser:<br>' + link + '</p>' +
      '<p style="font-size:12px;color:#43574a;margin:18px 0 0">Didn\'t request this? Ignore it.</p>' +
    '</div>';
  return { subject, text, html };
}

async function sendMagicLink(to, link) {
  const msg = magicLinkEmail(link);
  return provider.send({ to, subject: msg.subject, html: msg.html, text: msg.text });
}

module.exports = { sendMagicLink, providerName: provider.name };
