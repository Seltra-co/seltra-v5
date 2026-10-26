import { createHash } from "node:crypto";

export type FailureClass =
  | "type_error"
  | "missing_dependency"
  | "runtime_error"
  | "build_config"
  | "visual_defect"
  | "infrastructure";

export function normalizeFailureText(text: string): string {
  return text
    .replace(/\b[A-Z]:\\[^\s:]+/gi, "<path>")
    .replace(/\/(?:[^\s/:]+\/)+[^\s/:]+/g, "<path>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function fingerprintFailure(text: string): string {
  return createHash("sha256").update(normalizeFailureText(text)).digest("hex");
}

export function classifyFailure(
  text: string,
  source: "command" | "browser" | "runner" = "command",
): FailureClass {
  if (source === "runner") return "infrastructure";
  if (source === "browser") return "visual_defect";
  if (
    /cannot find module|module not found|missing dependency|package .* not found/i.test(
      text,
    )
  )
    return "missing_dependency";
  if (/ts\d{4}|type error|typecheck failed|typescript error/i.test(text))
    return "type_error";
  if (
    /vite config|webpack config|invalid configuration|build config/i.test(text)
  )
    return "build_config";
  return "runtime_error";
}
