import type { AnimationSettingsDTO } from "@/lib/types";

/* ================================================================== */
/* SUCCESS-ANIMATION SETTINGS — admin-controlled, visual layer only.   */
/*                                                                    */
/* The switches live in the EXISTING SystemSetting KV store (whitelist */
/* keys in SETTING_DEFAULTS) and are served to members inside the      */
/* session response. This module is CLIENT-SAFE (no db import) so the  */
/* same parsing/effect rules are shared by the server routes and the   */
/* member components.                                                 */
/*                                                                    */
/* Turning any switch OFF never disables the underlying feature — it  */
/* only skips the premium presentation. When animations are OFF, no    */
/* animation timers or effects run at all.                            */
/* ================================================================== */

/** SystemSetting key behind each DTO flag (see SETTING_DEFAULTS). */
const FLAG_KEYS = {
  master: "success_animations_enabled",
  planActivation: "success_animation_plan_activation",
  referralCommission: "success_animation_referral_commission",
  deposit: "success_animation_deposit",
  withdrawal: "success_animation_withdrawal",
  taskClaim: "success_animation_task_claim",
} as const;

/** Individual switches (everything except the master). */
export type AnimationFlag = Exclude<keyof AnimationSettingsDTO, "master">;

/** Professional defaults — every implemented animation ON. */
export const DEFAULT_ANIMATION_SETTINGS: AnimationSettingsDTO = {
  master: true,
  planActivation: true,
  referralCommission: true,
  deposit: true,
  withdrawal: true,
  taskClaim: true,
};

/**
 * Parse the persisted "true"/"false" strings into the DTO. Missing or
 * unrecognized values keep the professional default (ON), so a partially
 * populated settings row can never silently disable a feature's feedback.
 */
export function getAnimationSettings(
  map: Record<string, string> | null | undefined,
): AnimationSettingsDTO {
  const out: AnimationSettingsDTO = { ...DEFAULT_ANIMATION_SETTINGS };
  if (!map) return out;
  for (const [field, key] of Object.entries(FLAG_KEYS) as [
    keyof AnimationSettingsDTO,
    string,
  ][]) {
    const raw = map[key];
    if (raw === "true") out[field] = true;
    else if (raw === "false") out[field] = false;
  }
  return out;
}

/**
 * Effective state of one animation: the master must be ON AND the
 * individual switch must be ON. Absent settings (session still loading,
 * older payload) resolve to ON — the default experience.
 */
export function animationEnabled(
  animations: AnimationSettingsDTO | null | undefined,
  flag: AnimationFlag,
): boolean {
  if (!animations) return true;
  return animations.master !== false && animations[flag] !== false;
}
