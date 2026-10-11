// Cloudinary signed-upload helpers.
// The Worker NEVER proxies image bytes: it only signs params, the browser
// uploads directly to https://api.cloudinary.com/v1_1/<cloud>/image/upload.
// See docs/CLOUDINARY.md for the full flow.

export interface SignatureParams {
  timestamp: number;
  folder?: string;
  publicId?: string;
  overwrite?: boolean;
}

/** Build the `signature` for a Cloudinary upload (SHA-1 of sorted params + secret). */
export async function signUpload(
  apiSecret: string,
  params: SignatureParams,
): Promise<{ paramsToSign: string; signature: string }> {
  const entries: [string, string][] = [
    ["timestamp", String(params.timestamp)],
  ];
  if (params.folder) entries.push(["folder", params.folder]);
  if (params.publicId) entries.push(["public_id", params.publicId]);
  if (params.overwrite !== undefined)
    entries.push(["overwrite", params.overwrite ? "1" : "0"]);

  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const paramsToSign = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(paramsToSign + apiSecret),
  );
  const signature = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { paramsToSign, signature };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
