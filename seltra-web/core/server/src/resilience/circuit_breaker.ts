export type BreakerState = "closed" | "open" | "half_open";
export interface BreakerConfig {
  failureThreshold: number;
  windowMs: number;
  cooldownMs: number;
  halfOpenMaxProbes: number;
}
export type FailureClass = "retryable" | "config" | "client_error";

export class CircuitOpenError extends Error {
  constructor(readonly breakerKey: string) {
    super(`Circuit is open for ${breakerKey}`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private stateValue: BreakerState = "closed";
  private failures: number[] = [];
  private openedAt = 0;
  private probes = 0;

  constructor(
    readonly key: string,
    private readonly config: BreakerConfig,
    private readonly now = () => Date.now(),
  ) {
    if (config.failureThreshold < 1 || config.halfOpenMaxProbes < 1)
      throw new Error("Breaker limits must be positive");
  }

  get state(): BreakerState {
    return this.stateValue;
  }

  private admit(): "closed" | "half_open" {
    if (this.stateValue === "open") {
      if (this.now() - this.openedAt < this.config.cooldownMs)
        throw new CircuitOpenError(this.key);
      this.stateValue = "half_open";
      this.probes = 0;
    }
    if (this.stateValue === "half_open") {
      if (this.probes >= this.config.halfOpenMaxProbes)
        throw new CircuitOpenError(this.key);
      this.probes++;
      return "half_open";
    }
    return "closed";
  }

  private succeed(admitted: "closed" | "half_open") {
    if (admitted === "half_open" && this.stateValue === "half_open") {
      this.stateValue = "closed";
      this.failures = [];
      this.probes = 0;
    }
  }

  private fail(admitted: "closed" | "half_open", failureClass: FailureClass) {
    if (failureClass !== "retryable") {
      if (admitted === "half_open") this.probes = Math.max(0, this.probes - 1);
      return;
    }
    if (admitted === "half_open" || this.stateValue === "half_open") {
      this.openedAt = this.now();
      this.stateValue = "open";
      this.probes = 0;
      return;
    }
    const cutoff = this.now() - this.config.windowMs;
    this.failures = this.failures.filter((timestamp) => timestamp >= cutoff);
    this.failures.push(this.now());
    if (this.failures.length >= this.config.failureThreshold) {
      this.openedAt = this.now();
      this.stateValue = "open";
    }
  }

  async execute<T>(
    operation: () => Promise<T>,
    classify: (error: unknown) => FailureClass,
  ): Promise<T> {
    const admitted = this.admit();
    try {
      const result = await operation();
      this.succeed(admitted);
      return result;
    } catch (error) {
      this.fail(admitted, classify(error));
      throw error;
    }
  }
}

export function createBreakerRegistry(config: BreakerConfig) {
  const breakers = new Map<string, CircuitBreaker>();
  return {
    get(key: string) {
      let breaker = breakers.get(key);
      if (!breaker) {
        breaker = new CircuitBreaker(key, config);
        breakers.set(key, breaker);
      }
      return breaker;
    },
  };
}
