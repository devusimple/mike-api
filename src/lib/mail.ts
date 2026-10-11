// Outbound email. Uses Resend when RESEND_API_KEY is configured;
// otherwise logs the message (local dev) so flows stay testable.
// To go live: sign up at resend.com, verify your domain, then
//   bunx wrangler secret put RESEND_API_KEY
// and set MAIL_FROM in wrangler.jsonc, e.g. "Mike Shop <hello@shop.com>".

export function frontendBase(
  env: CloudflareBindings,
  originHeader: string | undefined,
): string {
  const norm = (s: string) => s.trim().replace(/\/+$/, "");
  const o = norm(originHeader ?? "");
  if (o) {
    try {
      const u = new URL(o);
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      const allowed = (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase().replace(/\/+$/, ""))
        .filter(Boolean);
      if (local || allowed.includes(o.toLowerCase())) return o;
    } catch {
      /* fall through to default */
    }
  }
  return norm(env.FRONTEND_URL ?? "https://mike-storefront.vercel.app");
}

export async function sendMail(
  env: CloudflareBindings,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail:dev] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM ?? "Mike Shop <onboarding@resend.dev>",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) {
    console.error("Resend failed:", await res.text());
    throw new Error("Failed to send email");
  }
}
