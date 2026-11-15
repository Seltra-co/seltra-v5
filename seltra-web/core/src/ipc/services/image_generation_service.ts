import {
  ImageGenerationApiResponseSchema,
  type ImageThemeMode,
} from "../types/image_generation";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { DYAD_MEDIA_DIR_NAME, getDyadMediaDir } from "../utils/media_path_utils";
import { safeJoin } from "../utils/path_utils";
import {
  appOperationCoordinator,
  readAppResource,
} from "./app_operation_coordinator";
import { assertNoActiveRecording } from "./recording_registry";
import { readSettings } from "../../main/settings";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { getSeltraEngineBaseUrl } from "../utils/seltra_engine_url";
import { ensureDyadGitignored } from "../handlers/gitignoreUtils";

const logger = log.scope("image_generation_service");

const IMAGE_GENERATION_TIMEOUT_MS = 120_000;
const BLUEPRINT_IMAGE_GENERATION_TIMEOUT_MS = 60_000;
/** Named once: the early refusal and the save-time refusal must read alike. */
const IMAGE_SAVE_ACTION = "save a generated image";
const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB

export interface GenerateImageInput {
  requestId: string;
  prompt: string;
  themeMode: ImageThemeMode;
  targetAppId: number;
  assetSlot?: string;
}

interface ActiveGeneration {
  controller: AbortController;
  targetAppId: number;
  settlement: Promise<unknown>;
}

function throwIfGenerationCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    if (signal.reason instanceof Error && signal.reason.name === "TimeoutError") {
      throw new DyadError(
        "Image generation timed out. Please try again.",
        DyadErrorKind.External,
        { cause: signal.reason },
      );
    }
    throw new DyadError(
      "Image generation cancelled.",
      DyadErrorKind.UserCancelled,
    );
  }
}

function generatedImageExtension(bytes: Buffer): "png" | "jpg" | "webp" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) return "webp";
  return null;
}

function getHttpErrorKind(status: number): DyadErrorKind {
  if (status === 401 || status === 403) {
    return DyadErrorKind.Auth;
  }
  if (status === 402) {
    return DyadErrorKind.Precondition;
  }
  if (status === 429) {
    return DyadErrorKind.RateLimited;
  }
  return DyadErrorKind.External;
}

const THEME_SYSTEM_PROMPTS: Record<ImageThemeMode, string | null> = {
  plain: null,
  "3d-clay":
    "Render in a breathtaking 3D claymorphism style with cinematic quality. All subjects must look hand-sculpted from luxuriously smooth, matte clay with a beautiful subsurface-scattering glow that makes surfaces feel warm and alive. Use dramatic yet soft three-point studio lighting — a warm key light, cool fill light, and gentle rim light — to create depth and dimension with delicate ambient occlusion and velvety contact shadows. Edges should be perfectly rounded and beveled with satisfying, pillowy softness; proportions slightly inflated and charmingly stylized. Apply a curated palette of 4–6 rich, harmonious tones with subtle color variation across surfaces — gentle hue shifts, soft specular highlights, and warm-to-cool gradients that give each piece visual interest. Add micro-details: tiny imperfections in the clay texture, soft fingerprint-like dimples, and delicate catchlights in glossy areas. Backgrounds should use a beautiful soft gradient with atmospheric depth and a subtle ground-plane reflection. The final render should feel like an award-winning Blender/Cinema 4D hero shot: irresistibly tactile, miniature-world charming, and gallery-worthy.",
  "real-photography":
    "Produce a jaw-droppingly photorealistic image that rivals the work of world-class photographers. Simulate masterful lighting — whether golden-hour warmth, dramatic chiaroscuro, or pristine studio setups — with physically accurate specular highlights, luminous soft falloff, and rich, natural shadows with subtle color in the shadow tones. Render hyper-detailed material textures: visible skin pores with natural translucency, intricate fabric weave catching the light, polished metal with environment reflections, and surfaces that beg to be touched. Apply cinematic depth of field (f/1.4–f/2.8) with creamy, circular bokeh that transforms background lights into dreamy orbs. Compose using the rule of thirds with leading lines and intentional framing that draws the eye. Color grade with a refined, editorial look — rich mid-tones, lifted shadows with subtle color casts, and controlled highlights that feel magazine-cover worthy. Include atmospheric details: volumetric light rays, natural lens flares, gentle vignetting, and film-like grain at ISO 100–400. The image should feel like it was captured on a medium-format Hasselblad with a Zeiss prime lens — breathtaking clarity, extraordinary dynamic range, and an unmistakable sense of artistry.",
  "isometric-illustration":
    "Create a stunning isometric illustration at a true 30° isometric projection angle with extraordinary attention to detail and visual richness. Use a refined vector style with vibrant, carefully chosen colors that feel premium and modern. Apply a sophisticated color palette (5–8 colors) with beautiful gradients, subtle lighting effects, and gentle color transitions that give depth and dimension — avoid flat, lifeless fills. Add layered soft shadows and ambient occlusion beneath and between objects to create a sense of depth and realism while maintaining the illustrative style. Include micro-details: tiny highlights, subtle textures (gentle noise, fine patterns), and delicate light reflections on surfaces to make the scene feel alive and crafted. Compose the scene with visual storytelling — arrange elements with intentional hierarchy, negative space, and a sense of narrative. Use a soft, complementary background with a subtle gradient or atmospheric glow that enhances the focal objects. The overall aesthetic should feel like a premium Dribbble or Behance showcase piece: elegant, whimsical yet polished, with a warm inviting atmosphere suitable for high-end SaaS product marketing or editorial illustration.",
};

export class ImageGenerationService {
  private readonly active = new Map<string, ActiveGeneration>();
  private readonly cancellationTombstones = new Set<string>();
  private readonly deletionFences = new Map<number, number>();
  private resetFenceCount = 0;

  generate(params: GenerateImageInput) {
    this.assertAcceptingGenerations(params.targetAppId);
    if (params.assetSlot && !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(params.assetSlot)) {
      throw new DyadError("Invalid blueprint photo slot.", DyadErrorKind.Validation);
    }
    // Before the recording refusal below: a cancellation that arrived first is
    // what happened to this request, and reporting it as blocked by a recording
    // would both misname it and leave its tombstone behind until eviction.
    if (this.cancellationTombstones.delete(params.requestId)) {
      throw new DyadError(
        "Image generation cancelled.",
        DyadErrorKind.UserCancelled,
      );
    }
    // Refuse before the generation, not just before the save: the save runs
    // behind a recording's session-long `repository` claim, and the user would
    // otherwise pay for and wait through a full generation to be told so.
    // The coordinator repeats this check atomically for a recording that
    // starts mid-generation; this one is only the early exit.
    assertNoActiveRecording(params.targetAppId, IMAGE_SAVE_ACTION);
    if (this.active.has(params.requestId)) {
      throw new DyadError(
        "Image generation invocation is already active",
        DyadErrorKind.Conflict,
      );
    }
    const controller = new AbortController();
    const settlement = this.execute(params, controller).finally(() => {
      if (this.active.get(params.requestId)?.settlement === settlement) {
        this.active.delete(params.requestId);
      }
    });
    this.active.set(params.requestId, {
      controller,
      targetAppId: params.targetAppId,
      settlement,
    });
    return settlement;
  }

  beginAppDeletion(appId: number): void {
    this.deletionFences.set(appId, (this.deletionFences.get(appId) ?? 0) + 1);
  }

  endAppDeletion(appId: number): void {
    const remaining = (this.deletionFences.get(appId) ?? 1) - 1;
    if (remaining > 0) this.deletionFences.set(appId, remaining);
    else this.deletionFences.delete(appId);
  }

  beginReset(): void {
    this.resetFenceCount += 1;
  }

  endReset(): void {
    this.resetFenceCount = Math.max(0, this.resetFenceCount - 1);
  }

  assertAcceptingGenerations(appId: number): void {
    if (this.resetFenceCount > 0 || this.deletionFences.has(appId)) {
      throw new DyadError(
        "The app is being deleted",
        DyadErrorKind.Precondition,
      );
    }
  }

  async saveBlueprintImage(input: {
    targetAppId: number
    assetSlot: string
    prompt: string
    mimeType: "image/jpeg" | "image/png" | "image/webp"
    base64: string
  }) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(input.assetSlot) || input.prompt.length > 2000) {
      throw new DyadError("Invalid blueprint image.", DyadErrorKind.Validation)
    }
    const imageBuffer = Buffer.from(input.base64, "base64")
    if (imageBuffer.toString("base64") !== input.base64 || imageBuffer.byteLength < 20 * 1024 || imageBuffer.byteLength > 2 * 1024 * 1024) {
      throw new DyadError("Stock image data is invalid or outside the supported size.", DyadErrorKind.Validation)
    }
    const extension = generatedImageExtension(imageBuffer)
    const expectedMime = extension === "jpg" ? "image/jpeg" : extension ? `image/${extension}` : undefined
    if (!extension || input.mimeType !== expectedMime) {
      throw new DyadError("Stock image format does not match its raster bytes.", DyadErrorKind.Validation)
    }
    const controller = new AbortController()
    if (process.env.DYAD_WEB_RUNTIME === "1") {
      await this.uploadBlueprintAssetToR2({
        requestId: `stock-${Date.now()}`,
        targetAppId: input.targetAppId,
        assetSlot: input.assetSlot,
        prompt: input.prompt,
        themeMode: "real-photography",
      }, imageBuffer, extension, controller.signal)
    }
    return appOperationCoordinator.run(
      {
        appId: input.targetAppId,
        operation: "save-generated-image",
        resources: [readAppResource("app-path"), "media", "repository"],
        refuseWhenRecording: IMAGE_SAVE_ACTION,
      },
      async () => {
        const app = await db.query.apps.findFirst({ where: eq(apps.id, input.targetAppId) })
        if (!app) throw new DyadError("Target app not found", DyadErrorKind.NotFound)
        const appPath = getDyadAppPath(app.path)
        await ensureDyadGitignored(appPath)
        const timestamp = Date.now()
        const sanitizedPrompt = input.prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "stock_image"
        const fileName = `generated_${sanitizedPrompt}_${timestamp}.${extension}`
        const mediaDir = getDyadMediaDir(appPath)
        const filePath = safeJoin(mediaDir, fileName)
        const assetsDirectory = safeJoin(appPath, "public", "assets")
        const assetName = `${input.assetSlot}.${extension}`
        const assetPath = safeJoin(assetsDirectory, assetName)
        const tempMediaPath = safeJoin(mediaDir, `.${fileName}.tmp`)
        const tempAssetPath = safeJoin(assetsDirectory, `.${assetName}.${timestamp}.tmp`)
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
        await fs.promises.mkdir(assetsDirectory, { recursive: true })
        try {
          await fs.promises.writeFile(tempMediaPath, imageBuffer, { signal: controller.signal })
          await fs.promises.writeFile(tempAssetPath, imageBuffer, { signal: controller.signal })
          await fs.promises.rename(tempMediaPath, filePath)
          await fs.promises.rename(tempAssetPath, assetPath)
        } catch (error) {
          await Promise.allSettled([
            fs.promises.rm(tempMediaPath, { force: true }),
            fs.promises.rm(tempAssetPath, { force: true }),
            fs.promises.rm(filePath, { force: true }),
          ])
          throw error
        }
        return {
          fileName,
          filePath,
          appPath: app.path,
          appId: app.id,
          appName: app.name,
          publicAssetPath: `public/assets/${assetName}`,
        }
      },
    )
  }

  private async execute(
    params: GenerateImageInput,
    controller: AbortController,
  ) {
    const timeoutMs = params.assetSlot ? BLUEPRINT_IMAGE_GENERATION_TIMEOUT_MS : IMAGE_GENERATION_TIMEOUT_MS;
    const settings = readSettings();
    const webRuntime = process.env.DYAD_WEB_RUNTIME === "1";
    const apiKey = webRuntime
      ? process.env.WORKSPACE_MODEL_TOKEN?.trim()
      : process.env.SELTRA_ENGINE_API_KEY ??
        settings.seltraEngineApiKey?.value ??
        (process.env.SELTRA_ENGINE_URL ? undefined : settings.providerSettings?.auto?.apiKey?.value);

    if (!apiKey) {
      throw new DyadError(
        webRuntime
          ? "Workspace model token is required for image generation"
          : "Seltra engine API key is required for image generation",
        DyadErrorKind.Auth,
      );
    }

    const app = await db.query.apps.findFirst({
      where: eq(apps.id, params.targetAppId),
    });
    if (!app) {
      throw new DyadError("Target app not found", DyadErrorKind.NotFound);
    }

    const systemPrompt = THEME_SYSTEM_PROMPTS[params.themeMode];
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n${params.prompt}`
      : params.prompt;

    const requestId = params.requestId;
    const timeoutId = setTimeout(
      () => controller.abort(new DOMException("Image generation timed out.", "TimeoutError")),
      timeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(`${getSeltraEngineBaseUrl()}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Request-ID": requestId,
          ...(process.env.SELTRA_ENGINE_CREDIT_IDENTITY?.trim()
            ? { "x-seltra-credit-identity": process.env.SELTRA_ENGINE_CREDIT_IDENTITY.trim() }
            : {}),
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          model: "dyad/image-gen",
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        if (controller.signal.reason instanceof Error && controller.signal.reason.name === "TimeoutError") {
          throw new DyadError(
            "Image generation timed out. Please try again.",
            DyadErrorKind.External,
            { cause: error },
          );
        }
        throw new DyadError(
          "Image generation cancelled or timed out.",
          DyadErrorKind.UserCancelled,
        );
      }
      throw new DyadError(
        "Failed to connect to image generation service.",
        DyadErrorKind.External,
      );
    }

    let imageBuffer: Buffer;
    try {
      if (!response.ok) {
        // Only log status code and request ID — never log response body
        // as it may echo back request details including credentials
        logger.error(
          `Image generation API error: HTTP ${response.status} (request: ${requestId})`,
        );
        throw new DyadError(
          `Image generation failed (HTTP ${response.status}). Please try again.`,
          getHttpErrorKind(response.status),
        );
      }

      const rawData = await response.json();
      const parsed = ImageGenerationApiResponseSchema.safeParse(rawData);
      if (!parsed.success) {
        logger.error("Invalid image generation response:", parsed.error);
        throw new DyadError(
          "Invalid response from image generation service",
          DyadErrorKind.External,
        );
      }

      const imageData = parsed.data.data[0];
      if (!imageData?.b64_json && !imageData?.url) {
        throw new DyadError(
          "No image data returned from generation service",
          DyadErrorKind.External,
        );
      }

      // Prepare image data before acquiring lock (network I/O outside lock)
      if (imageData.b64_json) {
        imageBuffer = Buffer.from(imageData.b64_json, "base64");
        if (imageBuffer.byteLength > MAX_IMAGE_SIZE) {
          throw new DyadError(
            "Decoded image exceeds maximum allowed size",
            DyadErrorKind.Validation,
          );
        }
      } else if (imageData.url) {
        const imageUrl = new URL(imageData.url);
        if (imageUrl.protocol !== "https:") {
          throw new DyadError("Image URL must use HTTPS", DyadErrorKind.External);
        }
        const downloadTimeoutSignal = AbortSignal.timeout(timeoutMs);
        try {
          const imgResponse = await fetch(imageData.url, {
            signal: AbortSignal.any([controller.signal, downloadTimeoutSignal]),
          });
          if (!imgResponse.ok) {
            throw new DyadError(
              `Failed to download image: ${imgResponse.status} ${imgResponse.statusText}`,
              getHttpErrorKind(imgResponse.status),
            );
          }
          const arrayBuffer = await imgResponse.arrayBuffer();
          if (arrayBuffer.byteLength > MAX_IMAGE_SIZE) {
            throw new DyadError(
              "Downloaded image exceeds maximum allowed size",
              DyadErrorKind.Validation,
            );
          }
          imageBuffer = Buffer.from(arrayBuffer);
        } catch (dlError) {
          throwIfGenerationCancelled(controller.signal);
          if (downloadTimeoutSignal.aborted) {
            throw new DyadError(
              "Image download timed out. Please try again.",
              DyadErrorKind.External,
              { cause: dlError },
            );
          }
          if (isDyadError(dlError)) {
            throw dlError;
          }
          throw new DyadError(
            "Failed to download generated image.",
            DyadErrorKind.External,
            { cause: dlError },
          );
        }
      } else {
        throw new DyadError(
          "Unexpected image response format",
          DyadErrorKind.External,
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }

    throwIfGenerationCancelled(controller.signal);
    const imageExtension = generatedImageExtension(imageBuffer);
    if (!imageExtension) {
      throw new DyadError(
        "Image provider returned invalid raster data; only PNG, JPEG, or WebP images can be saved.",
        DyadErrorKind.External,
      );
    }
    if (params.assetSlot && webRuntime) {
      await this.uploadBlueprintAssetToR2(params, imageBuffer, imageExtension, controller.signal);
    }

    // Save to app's media folder under lock (consistent with media CRUD handlers)
    const savedImage = await appOperationCoordinator.run(
      {
        appId: params.targetAppId,
        operation: "save-generated-image",
        resources: [readAppResource("app-path"), "media", "repository"],
        // `repository` is a recording's for the whole session, so saving the
        // image would sit behind it with only a spinner to show for it.
        refuseWhenRecording: IMAGE_SAVE_ACTION,
      },
      async () => {
        this.assertAcceptingGenerations(params.targetAppId);
        throwIfGenerationCancelled(controller.signal);
        const currentApp = await db.query.apps.findFirst({
          where: eq(apps.id, params.targetAppId),
        });
        if (!currentApp) {
          throw new DyadError("Target app not found", DyadErrorKind.NotFound);
        }
        const resolvedAppPath = getDyadAppPath(currentApp.path);
        await ensureDyadGitignored(resolvedAppPath);
        const mediaDir = getDyadMediaDir(resolvedAppPath);
        await fs.promises.mkdir(mediaDir, { recursive: true });

        const timestamp = Date.now();
        const sanitizedPrompt =
          params.prompt
            .slice(0, 30)
            .replace(/[^a-zA-Z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "")
            .toLowerCase() || "image";
        const fileName = `generated_${sanitizedPrompt}_${timestamp}.${imageExtension}`;
        const filePath = safeJoin(mediaDir, fileName);
        const tempFilePath = safeJoin(mediaDir, `.${fileName}.tmp`);

        throwIfGenerationCancelled(controller.signal);
        let finalized = false;
        try {
          await fs.promises.writeFile(tempFilePath, imageBuffer, {
            signal: controller.signal,
          });
          throwIfGenerationCancelled(controller.signal);
          await fs.promises.rename(tempFilePath, filePath);
          finalized = true;
          throwIfGenerationCancelled(controller.signal);
          let publicAssetPath: string | undefined;
          if (params.assetSlot) {
            const assetsDir = safeJoin(resolvedAppPath, "public", "assets");
            await fs.promises.mkdir(assetsDir, { recursive: true });
            const assetName = `${params.assetSlot}.${imageExtension}`;
            const assetPath = safeJoin(assetsDir, assetName);
            const assetTempPath = safeJoin(assetsDir, `.${assetName}.${timestamp}.tmp`);
            await fs.promises.copyFile(filePath, assetTempPath);
            await fs.promises.rename(assetTempPath, assetPath);
            publicAssetPath = `public/assets/${assetName}`;
          }
          logger.log(`Generated image saved to app assets: ${fileName}`);
          return {
            fileName,
            filePath,
            appPath: currentApp.path,
            appId: currentApp.id,
            appName: currentApp.name,
            ...(publicAssetPath ? { publicAssetPath } : {}),
          };
        } catch (error) {
          const cleanupOperations = [
            fs.promises.rm(tempFilePath, { force: true }),
          ];
          if (finalized && controller.signal.aborted) {
            cleanupOperations.push(fs.promises.rm(filePath, { force: true }));
          }
          await Promise.allSettled(cleanupOperations);
          throwIfGenerationCancelled(controller.signal);
          throw error;
        }

      },
    );

    return savedImage;
  }

  private async uploadBlueprintAssetToR2(
    params: GenerateImageInput,
    imageBuffer: Buffer,
    extension: "png" | "jpg" | "webp",
    signal: AbortSignal,
  ): Promise<void> {
    const apiKey = process.env.WORKSPACE_MODEL_TOKEN?.trim();
    if (!apiKey) throw new DyadError("Workspace model token is required to persist generated images.", DyadErrorKind.Auth);
    const mimeType = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    const timeoutSignal = AbortSignal.timeout(BLUEPRINT_IMAGE_GENERATION_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${getSeltraEngineBaseUrl()}/images/assets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
          "X-Request-ID": params.requestId,
        },
        body: JSON.stringify({
          appId: params.targetAppId,
          slot: params.assetSlot,
          mimeType,
          base64: imageBuffer.toString("base64"),
        }),
        signal: AbortSignal.any([signal, timeoutSignal]),
      });
    } catch (error) {
      throwIfGenerationCancelled(signal);
      throw new DyadError(
        "Generated image could not be uploaded to durable storage.",
        DyadErrorKind.External,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new DyadError(
        `Generated image upload failed (HTTP ${response.status}).`,
        response.status === 401 || response.status === 403 ? DyadErrorKind.Auth : DyadErrorKind.External,
      );
    }
    const result = await response.json().catch(() => null) as { ok?: unknown; size?: unknown } | null;
    if (result?.ok !== true || result.size !== imageBuffer.byteLength) {
      throw new DyadError("Generated image upload could not be verified.", DyadErrorKind.External);
    }
  }

  cancel(
    requestId: string,
    options: { readonly retainIfMissing?: boolean } = {},
  ): boolean {
    const active = this.active.get(requestId);
    if (!active) {
      if (!options.retainIfMissing) return false;
      if (this.cancellationTombstones.size >= 128) {
        const oldest = this.cancellationTombstones.values().next().value;
        if (oldest) this.cancellationTombstones.delete(oldest);
      }
      this.cancellationTombstones.add(requestId);
      return true;
    }
    active.controller.abort();
    logger.log(`Image generation cancellation requested: ${requestId}`);
    return true;
  }

  async cancelAndSettleApp(appId: number, timeoutMs = 1_000): Promise<void> {
    const matching = [...this.active.entries()].filter(
      ([, active]) => active.targetAppId === appId,
    );
    for (const [, active] of matching) active.controller.abort();
    await boundedSettle(
      matching.map(([, active]) => active.settlement),
      timeoutMs,
    );
  }

  async cancelAndSettleAll(timeoutMs = 1_000): Promise<void> {
    const active = [...this.active.values()];
    for (const entry of active) entry.controller.abort();
    await boundedSettle(
      active.map((entry) => entry.settlement),
      timeoutMs,
    );
    this.cancellationTombstones.clear();
  }

  inspectOwnedResources(): {
    readonly active: number;
    readonly cancellationTombstones: number;
  } {
    return {
      active: this.active.size,
      cancellationTombstones: this.cancellationTombstones.size,
    };
  }
}

async function boundedSettle(
  settlements: readonly Promise<unknown>[],
  timeoutMs: number,
): Promise<void> {
  if (settlements.length === 0) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(settlements),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
}

export const imageGenerationService = new ImageGenerationService();
