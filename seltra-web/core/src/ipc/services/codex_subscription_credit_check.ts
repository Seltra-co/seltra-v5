import { SubscriptionBillingError } from "@/shared/subscription_billing_error";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { fetchUserInfo, UserInfoApiError } from "./user_budget_service";

const logger = log.scope("codex_subscription_credit_check");
/** BYO only: reject confirmed denial, but let generation proceed on lookup failures. */
export async function checkSubscriptionCredits(
  apiKey: string,
  signal?: AbortSignal,
): Promise<void> {
  // Web workspaces are billed by Seltra's backend against the authenticated
  // user's shared user_credits account. The desktop account-info endpoint is
  // intentionally unavailable in this runtime; its zero-value placeholder
  // must not reject a request before the Seltra model gateway can enforce the
  // real per-user balance.
  if (process.env.DYAD_WEB_RUNTIME === "1") return;

  // Seltra Engine keys are not Dyad subscription keys. A native/local process
  // may use the Seltra Engine without DYAD_WEB_RUNTIME being set; querying the
  // Dyad account-info endpoint with that key returns a misleading 402 and
  // blocks a request before Seltra can enforce the user's shared account.
  if (apiKey.startsWith("sk_seltra_")) return;

  let info;
  try {
    signal?.throwIfAborted();
    info = await fetchUserInfo(apiKey, signal);
  } catch (error) {
    if (signal?.aborted)
      throw new DyadError(
        "Subscription request cancelled.",
        DyadErrorKind.UserCancelled,
      );
    if (error instanceof UserInfoApiError) {
      if (error.status === 401 || error.status === 403)
        throw new SubscriptionBillingError("KEY_REJECTED");
      if (error.status === 402)
        throw new SubscriptionBillingError("OUT_OF_CREDITS");
    }
    // No upstream bodies, request objects, or credentials in logs.
    logger.warn(
      "BYO subscription credit check unavailable; allowing generation",
      { status: error instanceof UserInfoApiError ? error.status : undefined },
    );
    return;
  }
  if (signal?.aborted)
    throw new DyadError(
      "Subscription request cancelled.",
      DyadErrorKind.UserCancelled,
    );
  if (info.totalCredits <= info.usedCredits)
    throw new SubscriptionBillingError("OUT_OF_CREDITS");
}
