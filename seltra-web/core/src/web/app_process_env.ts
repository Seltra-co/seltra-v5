const runtimeOnlyPrefixes = ["CORE_", "RUNTIME_", "DYAD_", "MODEL_", "NEST_"];
const secretName = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|API_KEY|ACCESS_KEY|CREDENTIALS?)(?:_|$)/i;

/** Keep gateway/runtime credentials out of generated app processes in web mode. */
export function appProcessEnvironment(
  source: NodeJS.ProcessEnv,
  webRuntime: boolean,
): NodeJS.ProcessEnv {
  if (!webRuntime) return { ...source };
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => {
      if (runtimeOnlyPrefixes.some((prefix) => name.startsWith(prefix))) return false;
      if (/^(?:DATABASE_URL|TEST_DATABASE_URL|FIGMA_ACCESS_TOKEN|VERCEL_TOKEN|GITHUB_APP_PRIVATE_KEY)$/.test(name)) return false;
      return !secretName.test(name);
    }),
  );
}
