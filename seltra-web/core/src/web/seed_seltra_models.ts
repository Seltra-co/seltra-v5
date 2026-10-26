import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { language_model_providers, language_models } from "../db/schema";
import { readSettings, writeSettings } from "../main/settings";

const providerId = "custom::seltra";
const modelDefinitions = [
  ["BUILDER", "Seltra Builder", "AI_MODEL_DEFAULT", 16_384, 262_144],
  ["PLANNER", "Seltra Planner", "AI_MODEL_REASONING", 16_384, 24_000],
  ["FAST", "Seltra Fast", "AI_MODEL_FAST", 8_192, 64_000],
  ["VISION", "Seltra Vision", "AI_MODEL_VISION", 8_192, 64_000],
] as const;

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSeltraModelDefinitions() {
  return modelDefinitions.map(
    ([kind, displayName, envName, output, context]) => ({
      apiName: process.env[envName] || `seltra-${kind.toLowerCase()}`,
      alias: `seltra-${kind.toLowerCase()}`,
      displayName,
      maxOutputTokens: positiveInteger(
        `SELTRA_${kind}_MAX_OUTPUT_TOKENS`,
        output,
      ),
      contextWindow: positiveInteger(`SELTRA_${kind}_CONTEXT_WINDOW`, context),
    }),
  );
}

/** Seed the workspace's local Seltra provider and models without duplicating rows. */
export function seedSeltraModels(firstRun: boolean): void {
  const baseUrl = process.env.MODEL_GATEWAY_URL;
  const token = process.env.WORKSPACE_MODEL_TOKEN;
  if (!baseUrl || !token) return;

  db.insert(language_model_providers)
    .values({ id: providerId, name: "Seltra", api_base_url: baseUrl })
    .onConflictDoUpdate({
      target: language_model_providers.id,
      set: {
        name: "Seltra",
        api_base_url: baseUrl,
        env_var_name: null,
        updatedAt: new Date(),
      },
    })
    .run();

  const definitions = getSeltraModelDefinitions();
  const retainedNames: string[] = definitions.map((model) => model.apiName);
  const existing = db
    .select({ id: language_models.id, apiName: language_models.apiName })
    .from(language_models)
    .where(eq(language_models.customProviderId, providerId))
    .all();
  const keepIds = new Set<number>();
  for (const model of definitions) {
    const duplicates = existing.filter((row) => row.apiName === model.apiName);
    const [canonical, ...duplicatesToRemove] = duplicates;
    if (canonical) {
      keepIds.add(canonical.id);
      db.update(language_models)
        .set({
          displayName: model.displayName,
          description: `${model.displayName} · ${model.apiName}`,
          max_output_tokens: model.maxOutputTokens,
          context_window: model.contextWindow,
          updatedAt: new Date(),
        })
        .where(eq(language_models.id, canonical.id))
        .run();
      if (duplicatesToRemove.length) {
        db.delete(language_models)
          .where(
            inArray(
              language_models.id,
              duplicatesToRemove.map((row) => row.id),
            ),
          )
          .run();
      }
    } else {
      const inserted = db
        .insert(language_models)
        .values({
          displayName: model.displayName,
          apiName: model.apiName,
          customProviderId: providerId,
          description: `${model.displayName} · ${model.apiName}`,
          max_output_tokens: model.maxOutputTokens,
          context_window: model.contextWindow,
        })
        .run();
      keepIds.add(Number(inserted.lastInsertRowid));
    }
  }
  const staleIds = existing
    .filter(
      (row) => !retainedNames.includes(row.apiName) || !keepIds.has(row.id),
    )
    .map((row) => row.id);
  if (staleIds.length) {
    db.delete(language_models)
      .where(inArray(language_models.id, staleIds))
      .run();
  }

  const settings = readSettings();
  const currentSelection = settings.selectedModel;
  writeSettings({
    enableAppPreviewDomains: true,
    ...(firstRun ||
    !settings.selectedModel?.name ||
    (settings.selectedModel.provider === "auto" &&
      settings.selectedModel.name === "auto") ||
    (currentSelection?.provider === providerId &&
      [
        "seltra-builder",
        "seltra-planner",
        "seltra-fast",
        "seltra-vision",
      ].includes(currentSelection.name))
      ? {
          selectedModel: {
            name: definitions[0].apiName,
            provider: providerId,
          } as typeof settings.selectedModel,
        }
      : {}),
    providerSettings: {
      ...settings.providerSettings,
      [providerId]: {
        ...settings.providerSettings[providerId],
        apiKey: { value: token },
      },
    },
  });
}
