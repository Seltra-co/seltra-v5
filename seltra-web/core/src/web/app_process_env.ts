const runtimeOnlyPrefixes = ["CORE_", "RUNTIME_", "DYAD_", "MODEL_", "NEST_"];
const secretName = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|API_KEY|ACCESS_KEY|CREDENTIALS?)(?:_|$)/i;

/** Keep gateway/runtime credentials out of generated app processes in web mode. */
export function appProcessEnvironment(
  source: NodeJS.ProcessEnv,
  webRuntime: boolean,
): NodeJS.ProcessEnv {
  if (!webRuntime) return { ...source };
  const environment = Object.fromEntries(
    Object.entries(source).filter(([name]) => {
      if (runtimeOnlyPrefixes.some((prefix) => name.startsWith(prefix)))
        return false;
      if (
        /^(?:DATABASE_URL|TEST_DATABASE_URL|FIGMA_ACCESS_TOKEN|VERCEL_TOKEN|GITHUB_APP_PRIVATE_KEY)$/.test(
          name,
        )
      )
        return false;
      return !secretName.test(name);
    }),
  );
  // A signed gateway workspace has a dedicated container; SWC's native addon
  // cache ownership check rejects the shared workspace mount there. Keep this
  // opt-out scoped to that isolated runtime, not local web development.
  if (typeof source.DYAD_WORKSPACE_ID === "string" && source.DYAD_WORKSPACE_ID) {
    environment.SWC_NATIVE_BINDING_CACHE = "/opt/dyad/tmp/swc-native-binding";
    environment.SWC_NATIVE_BINDING_CACHE_SKIP_SECURITY_CHECK = "1";
  }
  return environment;
}
