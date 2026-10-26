import { toast } from "sonner";

export function throwBridgeRpcError(
  code: string | undefined,
  message: string,
): never {
  if (code === "UNSUPPORTED_IN_WEB") toast.error(message);
  throw Object.assign(new Error(message), { code });
}
