# Cloudinary (media)

Worker never touches image bytes — it only **signs**, the browser uploads direct.
Signing code: `src/lib/cloudinary.ts` (`signUpload`, SHA-1 of sorted params + secret).

## Setup

1. Create account → note **Cloud name**, **API key**, **API secret** (dashboard).
2. `wrangler.jsonc` `vars`: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_FOLDER` (`mike/products`).
3. Secret: `bunx wrangler secret put CLOUDINARY_API_SECRET` (+ `.dev.vars` locally).
4. (Recommended) Create an upload preset + folder `mike/products` with `overwrite=false`, max 5MB, allowed `jpg,png,webp`.

## Upload flow (product image)

```
1. Admin client: POST /api/uploads/signature { folder?, publicId?, overwrite? }
   → { uploadUrl, apiKey, timestamp, folder, signature }
2. Client: POST <uploadUrl> (multipart): file, api_key, timestamp, folder,
   signature (+ public_id/overwrite exactly as signed)
3. Cloudinary → { public_id, secure_url, width, height }
4. Client: POST /api/products/:id/images { publicId, secureUrl, width, height, position }
```

Minimal JS:

```js
const sig = await fetch(API + "/uploads/signature", {
  method: "POST", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({}),
}).then(r => r.json());
const form = new FormData();
form.append("file", file);
form.append("api_key", sig.apiKey);
form.append("timestamp", sig.timestamp);
form.append("folder", sig.folder);
form.append("signature", sig.signature);
const up = await fetch(sig.uploadUrl, { method: "POST", body: form }).then(r => r.json());
await fetch(`${API}/products/${id}/images`, {
  method: "POST", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ publicId: up.public_id, secureUrl: up.secure_url, width: up.width, height: up.height }),
});
```

## Deleting

`DELETE /api/products/:id/images/:imageId` removes only the D1 row. To free
Cloudinary storage, call the Admin API server-side (`POST
https://api.cloudinary.com/v1_1/<cloud>/resources/image/destroy` with basic
auth `api_key:api_secret`) or delete from the Dashboard. A `DELETE
/api/uploads/:publicId` proxy is listed in NEXT_STEPS if you want it automated.

## Transformations (no extra work)

Append e.g. `w_800,q_auto,f_auto` to `secure_url` or use `@cloudinary/url-gen`
(already in devDependencies) on the frontend for thumbnails/placeholders.
