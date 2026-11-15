export function frameAncestors(allowedOrigins: Iterable<string>): string {
  const cspOrigins = [...allowedOrigins].filter((origin) => {
    try {
      return new URL(origin).hostname !== "[::1]";
    } catch {
      return false;
    }
  });
  return ["'self'", ...cspOrigins].join(" ");
}
