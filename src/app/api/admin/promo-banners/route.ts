import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import {
  applyPromoBannerAction,
  parseStoredPromoBanners,
  PROMO_BANNERS_KEY,
  serializePromoBanners,
  toAdminPromoBannerDTOs,
  validatePromoBannerInput,
  type PromoBannerAction,
  type StoredPromoBanner,
} from "@/lib/promo-banners";
import { getSettings } from "@/lib/settings";
import { supabaseAdminPromoBannersGet, supabaseAdminPromoBannersPost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

/* ================================================================== */
/* Admin Promotional Banners — management side of the premium overlay.  */
/*                                                                    */
/* The whole banner list lives in ONE system_settings row             */
/* (promo_banners, a JSON array) — the same storage pattern as the     */
/* Login Welcome Popup and Branding images. No new database objects.   */
/*                                                                    */
/* GET  → every banner (active + inactive) in display order.          */
/* POST → one action per call:                                       */
/*        { action: "create",  banner: { image, title?, ctaText?,    */
/*                                        ctaLink?, isActive? } }     */
/*        { action: "update",  id, banner: { …partial fields } }      */
/*        { action: "delete",  id }                                   */
/*        { action: "reorder", ids: [id, id, …] }                     */
/* Everything is validated BEFORE anything is persisted; the ids are  */
/* generated server-side and clients can never choose them.          */
/* ================================================================== */

const BANNER_ACTIONS = ["create", "update", "delete", "reorder"] as const;

async function readBannerList(): Promise<StoredPromoBanner[]> {
  const settings = await getSettings();
  return parseStoredPromoBanners(settings[PROMO_BANNERS_KEY]);
}

async function writeBannerList(list: StoredPromoBanner[]): Promise<void> {
  const value = serializePromoBanners(list);
  await db.systemSetting.upsert({
    where: { key: PROMO_BANNERS_KEY },
    update: { value },
    create: { key: PROMO_BANNERS_KEY, value },
  });
}

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminPromoBannersGet();
    }
    await requireAdmin();
    return NextResponse.json({ banners: toAdminPromoBannerDTOs(await readBannerList()) });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminPromoBannersPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<PromoBannerAction>(req);
    const action = body.action;

    if (!(BANNER_ACTIONS as readonly string[]).includes(action)) {
      throw new ApiError("Unknown banner action — use create, update, delete or reorder.", 400);
    }
    if ((action === "update" || action === "delete") && !(body.id ?? "").trim()) {
      throw new ApiError("Missing banner id.", 400);
    }
    if (action === "reorder" && !Array.isArray(body.ids)) {
      throw new ApiError("reorder requires the ordered ids array.", 400);
    }
    if (action === "create" || action === "update") {
      const err = validatePromoBannerInput(body.banner ?? {}, action === "create");
      if (err) throw new ApiError(err, 400);
    }

    const list = await readBannerList();
    const id = (body.id ?? "").trim();
    if ((action === "update" || action === "delete") && !list.some((b) => b.id === id)) {
      throw new ApiError("Banner not found.", 404);
    }

    const next = applyPromoBannerAction(list, body);
    await writeBannerList(next);
    return NextResponse.json({ banners: toAdminPromoBannerDTOs(next) });
  });
}
