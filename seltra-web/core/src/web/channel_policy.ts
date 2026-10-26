import {
  VALID_INVOKE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "../ipc/preload/channels";

export type ChannelClass = "PORT" | "ADAPT" | "SANDBOX" | "DISABLE";
export type ChannelPolicyEntry = {
  channel: string;
  class: ChannelClass;
  reason: string;
};

const ALWAYS_DISABLED =
  /(?:^chat:stream$|release|recording|coolify|telemetry|catalog|quota|subscription|test:|^pro:|theme|import|(?:^|:)\b(?:supabase|neon|vercel|cloudflare|github|mcp|connection-flow|local-models)\b|^distributed-machine:(?!subscribe$|dispatch$|unsubscribe$))/i;
const LOCAL_MODEL_LISTINGS = new Set([
  "get-language-model",
  "get-language-models",
  "get-language-model-providers",
  "get-language-models-by-providers",
]);
const RUNTIME_SETTINGS_CHANNELS = new Set(["set-user-settings"]);
const WEB_APP_SETTINGS_CHANNELS = new Set(["set-app-theme"]);
const LOCAL_RUNTIME_CHANNELS = new Set(["select-app-for-preview"]);
const WEB_PREVIEW_CLEANUP_CHANNELS = new Set([
  "version-preview:release-window-interest",
]);

function classify(channel: string): ChannelPolicyEntry {
  if (RUNTIME_SETTINGS_CHANNELS.has(channel)) {
    return {
      channel,
      class: "PORT",
      reason: "Updates this isolated runtime workspace's persisted settings.",
    };
  }
  if (WEB_APP_SETTINGS_CHANNELS.has(channel)) {
    return {
      channel,
      class: "SANDBOX",
      reason: "Persists the approved app's selected Core theme in its isolated workspace.",
    };
  }
  if (LOCAL_RUNTIME_CHANNELS.has(channel)) {
    return {
      channel,
      class: "PORT",
      reason: "Updates the selected app in this isolated runtime process.",
    };
  }
  if (LOCAL_MODEL_LISTINGS.has(channel)) {
    return {
      channel,
      class: "PORT",
      reason:
        "Reads the runtime-local model catalog; web runtime disables remote catalog fetches.",
    };
  }
  if (WEB_PREVIEW_CLEANUP_CHANNELS.has(channel)) {
    return {
      channel,
      class: "PORT",
      reason:
        "Releases this renderer's owned preview interest and closes its preview actor when it is the final owner.",
    };
  }
  if (ALWAYS_DISABLED.test(channel)) {
    return {
      channel,
      class: "DISABLE",
      reason: "Outside the M1 browser runtime allowlist.",
    };
  }
  if (/^(?:get-|list-|search-|check-)/i.test(channel)) {
    return { channel, class: "PORT", reason: "Read-only engine operation." };
  }
  if (/^(?:select-|set-|copy-|open-|show-|choose-)/i.test(channel)) {
    return {
      channel,
      class: "ADAPT",
      reason: "Requires a browser-safe replacement or is unavailable.",
    };
  }
  return {
    channel,
    class: "SANDBOX",
    reason: "Engine operation runs only inside the isolated workspace runtime.",
  };
}

const channelNames = [
  ...new Set([
    ...(VALID_INVOKE_CHANNELS as readonly string[]),
    ...(VALID_SEND_CHANNELS as readonly string[]),
  ]),
].sort();

export const CHANNEL_POLICY: readonly ChannelPolicyEntry[] = Object.freeze(
  channelNames.map(classify),
);
const policyByChannel = new Map(
  CHANNEL_POLICY.map((entry) => [entry.channel, entry]),
);

export function getChannelPolicy(
  channel: string,
): ChannelPolicyEntry | undefined {
  return policyByChannel.get(channel);
}

export function isWebChannelAllowed(channel: string): boolean {
  const entry = getChannelPolicy(channel);
  return (
    entry !== undefined && entry.class !== "DISABLE" && entry.class !== "ADAPT"
  );
}
