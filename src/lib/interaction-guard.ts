/* ================================================================== */
/* BODY POINTER-EVENTS GUARD — frontend responsiveness safeguard.       */
/*                                                                    */
/* Radix's DismissableLayer (used by Dialog, Sheet, DropdownMenu and   */
/* Popover contents) locks the page while a modal layer is open by     */
/* setting an inline `pointer-events: none` on <body>, restoring the   */
/* original value when the layer unmounts.                            */
/*                                                                    */
/* On mobile this app tears layers down in unusual ways — route paths  */
/* change through a hash router whose AnimatePresence remounts views  */
/* mid-animation, popups auto-open/close around navigation, and the   */
/* CSS exit animation that Radix waits for can be interrupted or drop */
/* its animationend event under load. When that happens the inline     */
/* lock survives with NO layer left owning it: every tap/click on the */
/* page then appears completely dead until a full page refresh —       */
/* exactly the intermittent "tap an option and nothing happens,       */
/* refresh fixes it" symptom reported on the member site.             */
/*                                                                    */
/* This guard removes the stale lock — and ONLY the stale lock: while */
/* any real Radix layer still exists in the DOM (open or animating    */
/* out) the lock is left untouched, so legitimate modals keep working */
/* exactly as before. Cost when healthy is one attribute read plus    */
/* one querySelector per second, outside React entirely.              */
/* ================================================================== */

/**
 * Elements that indicate a Radix modal layer currently owns (or is
 * animating out with) the body pointer-events lock. Matches every
 * DismissableLayer surface this app renders:
 *  - Dialog / Sheet content and overlays (role="dialog", data-state)
 *  - DropdownMenu content (role="menu", data-state)
 *  - Popover content (role="dialog", data-state)
 *  - Popper positioning wrappers
 */
const ACTIVE_LAYER_SELECTOR = [
  '[data-state="open"]',
  '[role="dialog"]',
  '[role="menu"]',
  "[data-radix-dialog-overlay]",
  "[data-radix-popper-content-wrapper]",
].join(", ");

/** How often to check for a stale lock (cheap — no React involvement). */
const CHECK_INTERVAL_MS = 1_000;

/** Installs the guard. Returns a stop function for clean unmounts. */
export function startBodyPointerEventsGuard(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const id = window.setInterval(() => {
    const { body } = document;
    // Fast path: no inline lock at all (the normal case — do nothing).
    if (!body.style.pointerEvents || body.style.pointerEvents === "auto") return;
    // A real layer still owns the lock — leave it alone.
    if (body.querySelector(ACTIVE_LAYER_SELECTOR)) return;
    // Stale lock with no owner: restore default pointer behavior so the
    // page becomes tappable/clickable again without a manual refresh.
    body.style.removeProperty("pointer-events");
  }, CHECK_INTERVAL_MS);

  return () => window.clearInterval(id);
}
