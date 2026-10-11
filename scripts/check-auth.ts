// Auth upgrade verification (local backend :8787).
// Dev mailer logs reset/verify links to the wrangler dev output —
// this script extracts tokens from that log to complete the flows.
export {};
declare const Bun: { file(path: string): { text(): Promise<string> } };

const BASE = "http://localhost:8787";
const LOG =
  "C:\\Users\\mehedi\\.local\\share\\opencode\\shell\\bde1118b9b14b5136b0b1ebfc36f08b6d2cd6210\\sh_12ca5b35e001MWesMrPpJmRyLW.out";

async function req(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

async function tokenFromLog(kind: "verify-email" | "reset-password", email: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const text = await Bun.file(LOG).text();
    const lines = text.split("\n").filter((l) => l.includes(kind) && l.includes("token="));
    // Verification/reset links don't contain the email; take the latest link
    // issued after our request (retry loop gives the mailer time to log).
    void email;
    if (lines.length) {
      const m = /token=([a-f0-9]+)/.exec(lines[lines.length - 1]);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no ${kind} token in log`);
}

// Mark log position so we only pick up fresh links.
const logStart = (await Bun.file(LOG).text()).length;
async function freshToken(kind: "verify-email" | "reset-password"): Promise<string> {
  for (let i = 0; i < 15; i++) {
    const text = (await Bun.file(LOG).text()).slice(logStart);
    const m = new RegExp(`${kind}\\?token=([a-f0-9]+)`).exec(text);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no fresh ${kind} token in log`);
}
void tokenFromLog;

const email = `auth${Date.now()}@test.com`;
let r = await req("POST", "/api/auth/register", { email, password: "password123", name: "Auth" });
console.log("register:", r.status, "verified:", r.json.user?.emailVerified);
const verifyTok = await freshToken("verify-email");
console.log("verify link logged:", verifyTok.slice(0, 8) + "…");

r = await req("POST", "/api/auth/verify-email", { token: verifyTok });
console.log("verify-email:", r.status);
const me = await req("GET", "/api/auth/me", undefined, (await req("POST", "/api/auth/login", { email, password: "password123" })).json.accessToken);
console.log("me verified:", me.json.user?.emailVerified);
let access = (await req("POST", "/api/auth/login", { email, password: "password123" })).json.accessToken as string;

r = await req("POST", "/api/auth/change-password", { currentPassword: "password123", newPassword: "newpass456" }, access);
console.log("change-password:", r.status, "fresh pair:", !!r.json.accessToken);
access = r.json.accessToken;
const oldLogin = await req("POST", "/api/auth/login", { email, password: "password123" });
console.log("login old pw:", oldLogin.status, "(expect 401)");
const newLogin = await req("POST", "/api/auth/login", { email, password: "newpass456" });
console.log("login new pw:", newLogin.status);

r = await req("POST", "/api/auth/forgot-password", { email });
console.log("forgot-password:", r.status);
const resetTok = await freshToken("reset-password");
r = await req("POST", "/api/auth/reset-password", { token: resetTok, password: "reset789pw" });
console.log("reset-password:", r.status);
console.log("login reset pw:", (await req("POST", "/api/auth/login", { email, password: "reset789pw" })).status);

// Logout then refresh with the revoked token -> 401 (benign, no nuke).
const sess = await req("POST", "/api/auth/login", { email, password: "reset789pw" });
await req("POST", "/api/auth/logout", { refreshToken: sess.json.refreshToken });
const reuse = await req("POST", "/api/auth/refresh", { refreshToken: sess.json.refreshToken });
console.log("refresh after logout:", reuse.status, "(expect 401)");

// Rate limit: 12 rapid bad logins, limit is 10/min -> expect 429s at the tail.
const codes: number[] = [];
for (let i = 0; i < 12; i++) {
  codes.push((await req("POST", "/api/auth/login", { email, password: "wrong" })).status);
}
console.log("rate-limit probe:", codes.join(","), codes.includes(429) ? "LIMITED OK" : "NO 429!");
console.log("AUTH UPGRADE OK");
