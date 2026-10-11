// Owner notifications. Telegram when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
// are configured; silent no-op otherwise. Never throws — checkout must not
// fail because a notification failed.
// Setup: message @BotFather → /newbot → token → `bunx wrangler secret put
// TELEGRAM_BOT_TOKEN`. Then message your bot once and open
// https://api.telegram.org/bot<token>/getUpdates to read your chat id →
// set TELEGRAM_CHAT_ID in wrangler.jsonc vars.

function taka(cents: number): string {
  return `৳${((cents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface OrderAlert {
  orderId: string;
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  shippingZone: string | null;
  totalCents: number;
}

export async function sendOrderAlert(
  env: CloudflareBindings,
  alert: OrderAlert,
): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const lines = [
      `🧾 New order #${alert.orderId.slice(0, 8)}`,
      `${alert.itemCount} item(s)${alert.shippingZone ? ` · ${alert.shippingZone}` : ""}`,
      `Subtotal ${taka(alert.subtotalCents)}`,
    ];
    if (alert.discountCents > 0) lines.push(`Discount −${taka(alert.discountCents)}`);
    if (alert.shippingCents > 0) lines.push(`Shipping ${taka(alert.shippingCents)}`);
    lines.push(`Total ${taka(alert.totalCents)} (COD)`);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: lines.join("\n") }),
    });
    if (!res.ok) console.error("telegram alert failed:", await res.text());
  } catch (e) {
    console.error("telegram alert failed:", e);
  }
}
