import { imageGenerationContracts } from "@/ipc/types/image_generation";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import { imageGenerationOperationService } from "../services/image_generation_operation_service";
import { imageGenerationService } from "../services/image_generation_service";
import { createTypedHandler } from "./base";

export function registerImageGenerationHandlers(): void {
  createTypedHandler(
    imageGenerationContracts.waitForOperation,
    async (event, { requestId }) =>
      imageGenerationOperationService.waitFor(
        requestId,
        windowRegistry.ensureRegistered(event.sender),
      ),
  );
  createTypedHandler(
    imageGenerationContracts.saveBlueprintImage,
    async (_event, input) => imageGenerationService.saveBlueprintImage(input),
  );
}
