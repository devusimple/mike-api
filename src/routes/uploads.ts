import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { signUpload } from "../lib/cloudinary";
import { requireAdmin, requireAuth } from "../middleware/auth";

type Env = { Bindings: CloudflareBindings };
export const uploadRoutes = new Hono<Env>();

const signatureSchema = z.object({
  folder: z.string().max(200).optional(),
  publicId: z.string().max(300).optional(),
  overwrite: z.boolean().optional(),
});

/** Public Cloudinary config for the frontend uploader. */
uploadRoutes.get("/config", async (c) => {
  return c.json({
    cloudName: c.env.CLOUDINARY_CLOUD_NAME,
    apiKey: c.env.CLOUDINARY_API_KEY,
    folder: c.env.CLOUDINARY_FOLDER ?? "mike/products",
  });
});

/**
 * Sign an upload. Admin-only in v1 to prevent abuse (product images).
 * Client then POSTs a multipart form directly to Cloudinary with:
 * file, api_key, timestamp, folder, signature (+ public_id/overwrite if signed).
 */
uploadRoutes.post(
  "/signature",
  requireAuth,
  requireAdmin,
  zValidator("json", signatureSchema),
  async (c) => {
    if (!c.env.CLOUDINARY_API_SECRET) {
      throw new HTTPException(500, { message: "CLOUDINARY_API_SECRET not configured" });
    }
    const input = c.req.valid("json");
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = input.folder ?? c.env.CLOUDINARY_FOLDER ?? "mike/products";
    const { signature } = await signUpload(c.env.CLOUDINARY_API_SECRET, {
      timestamp,
      folder,
      publicId: input.publicId,
      overwrite: input.overwrite,
    });
    return c.json({
      cloudName: c.env.CLOUDINARY_CLOUD_NAME,
      apiKey: c.env.CLOUDINARY_API_KEY,
      timestamp,
      folder,
      publicId: input.publicId,
      overwrite: input.overwrite ?? false,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${c.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    });
  },
);
