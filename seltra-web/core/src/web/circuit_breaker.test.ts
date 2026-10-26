import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  type BreakerConfig,
} from "../../server/src/resilience/circuit_breaker";

const config: BreakerConfig = {
  failureThreshold: 2,
  windowMs: 1000,
  cooldownMs: 500,
  halfOpenMaxProbes: 1,
};
const retryable = () => "retryable" as const;

describe("CircuitBreaker", () => {
  it("opens after threshold failures and closes after a successful probe", async () => {
    let now = 0;
    const breaker = new CircuitBreaker("model:test", config, () => now);
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(async () => {
          throw Error("500");
        }, retryable),
      ).rejects.toThrow("500");
    }
    expect(breaker.state).toBe("open");
    await expect(
      breaker.execute(async () => "blocked", retryable),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    now = 500;
    await expect(breaker.execute(async () => "ok", retryable)).resolves.toBe(
      "ok",
    );
    expect(breaker.state).toBe("closed");
  });

  it("reopens after a failed half-open probe", async () => {
    let now = 0;
    const breaker = new CircuitBreaker("model:test", config, () => now);
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(async () => {
          throw Error("500");
        }, retryable),
      ).rejects.toThrow();
    }
    now = 500;
    await expect(
      breaker.execute(async () => {
        throw Error("still down");
      }, retryable),
    ).rejects.toThrow("still down");
    expect(breaker.state).toBe("open");
    now = 999;
    await expect(
      breaker.execute(async () => "blocked", retryable),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("does not count config or client errors toward opening", async () => {
    const breaker = new CircuitBreaker("provider:test", config);
    for (let i = 0; i < 4; i++) {
      await expect(
        breaker.execute(
          async () => {
            throw Error("401");
          },
          () => "config",
        ),
      ).rejects.toThrow("401");
      await expect(
        breaker.execute(
          async () => {
            throw Error("400");
          },
          () => "client_error",
        ),
      ).rejects.toThrow("400");
    }
    expect(breaker.state).toBe("closed");
  });

  it("limits concurrent half-open probes", async () => {
    let now = 0;
    const breaker = new CircuitBreaker("runtime:test", config, () => now);
    for (let i = 0; i < 2; i++) {
      await expect(
        breaker.execute(async () => {
          throw Error("down");
        }, retryable),
      ).rejects.toThrow();
    }
    now = 500;
    let resolveProbe!: (value: string) => void;
    const probe = breaker.execute(
      () =>
        new Promise<string>((resolve) => {
          resolveProbe = resolve;
        }),
      retryable,
    );
    await expect(
      breaker.execute(async () => "extra", retryable),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    resolveProbe("ok");
    await expect(probe).resolves.toBe("ok");
  });
});
