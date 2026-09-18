import { ApiError } from "@/lib/api-helpers";

/**
 * Shared numeric guard rails for investment-package writes (packages hotfix).
 *
 * Both data backends store package money columns as signed 32-bit integers:
 *  - local track: Prisma `Int` over SQLite (SQLite accepts 64-bit values, so
 *    an out-of-range write SUCCEEDS and every later read fails with P2023
 *    "Conversion failed: Value … does not fit in an INT column" — this exact
 *    failure took the admin Packages catalog down with "Could not load
 *    packages");
 *  - Supabase track: canonical `integer` columns (Postgres int4, max the same).
 *
 * Every package number resolved on the server must pass through these
 * assertions BEFORE it reaches the database, so the catalog can never again
 * be broken by an oversized create/update.
 */

export const PACKAGE_INT_MAX = 2_147_483_647;
export const PACKAGE_INT_MIN = -2_147_483_648;

const fmt = (n: number) => n.toLocaleString("en-US");

/** Assert a single resolved package number fits the Int column range. */
export function assertPackageFieldFits(label: string, value: number): void {
  if (!Number.isFinite(value) || value > PACKAGE_INT_MAX || value < PACKAGE_INT_MIN) {
    throw new ApiError(
      `${label} (${fmt(value)}) is outside the supported range of ${fmt(PACKAGE_INT_MIN)} to ${fmt(PACKAGE_INT_MAX)}. Please use a smaller value.`,
      400,
    );
  }
}

/**
 * Validate the complete resolved number set of a package create/update.
 *
 * `totalReturn` must be the value that will actually be stored (auto-computed
 * daily × duration or the admin's custom override). When the auto total
 * overflows, the error explains the arithmetic so the admin knows exactly
 * which input to lower.
 */
export function assertPackageNumbersFit(opts: {
  price: number;
  dailyEarning: number;
  durationDays: number;
  totalReturn: number;
}): void {
  assertPackageFieldFits("Price", opts.price);
  assertPackageFieldFits("Daily earnings", opts.dailyEarning);
  assertPackageFieldFits("Duration", opts.durationDays);

  if (opts.totalReturn > PACKAGE_INT_MAX && opts.totalReturn === opts.dailyEarning * opts.durationDays) {
    throw new ApiError(
      `Daily earnings (${fmt(opts.dailyEarning)}) × duration (${fmt(opts.durationDays)}) = ${fmt(opts.totalReturn)} exceeds the maximum supported total return of ${fmt(PACKAGE_INT_MAX)}. Reduce daily earnings or duration, or set a custom total return.`,
      400,
    );
  }
  assertPackageFieldFits("Total return", opts.totalReturn);

  const netProfit = opts.totalReturn - opts.price;
  if (netProfit > PACKAGE_INT_MAX || netProfit < PACKAGE_INT_MIN) {
    throw new ApiError(
      `Net profit (${fmt(netProfit)}) is outside the supported range. Adjust the price or total return.`,
      400,
    );
  }
}

/** Assert the display-priority (sortOrder) fits the Int column range. */
export function assertSortOrderFits(value: number): void {
  assertPackageFieldFits("Priority", value);
}
