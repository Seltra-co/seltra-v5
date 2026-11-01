import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchUserInfo } = vi.hoisted(() => ({ fetchUserInfo: vi.fn() }));

vi.mock("./user_budget_service", () => ({ fetchUserInfo }));

import { SubscriptionBillingError } from "@/shared/subscription_billing_error";
import { checkSubscriptionCredits } from "./codex_subscription_credit_check";

describe("checkSubscriptionCredits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("leaves web runtime billing to Seltra's user credit account", async () => {
    vi.stubEnv("DYAD_WEB_RUNTIME", "1");

    await expect(checkSubscriptionCredits("workspace-model-token")).resolves.toBeUndefined();
    expect(fetchUserInfo).not.toHaveBeenCalled();
  });

  it("never checks Seltra Engine keys against Dyad subscription credits", async () => {
    vi.stubEnv("DYAD_WEB_RUNTIME", "0");

    await expect(
      checkSubscriptionCredits("sk_seltra_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"),
    ).resolves.toBeUndefined();
    expect(fetchUserInfo).not.toHaveBeenCalled();
  });

  it("still rejects an exhausted desktop subscription account", async () => {
    vi.stubEnv("DYAD_WEB_RUNTIME", "0");
    fetchUserInfo.mockResolvedValue({ totalCredits: 0, usedCredits: 0 });

    await expect(checkSubscriptionCredits("desktop-pro-key")).rejects.toBeInstanceOf(SubscriptionBillingError);
    expect(fetchUserInfo).toHaveBeenCalledWith("desktop-pro-key", undefined);
  });
});
