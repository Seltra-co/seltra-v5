/** Full agent-tool access is enabled for the hosted web builder runtime. */
export function hasFullToolAccess(): boolean {
  return process.env.DYAD_WEB_RUNTIME === "1";
}
