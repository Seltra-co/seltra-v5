import {
  useKeyedController,
  useKeyedMachineSelector,
} from "@/state_machines/react";
import { useAppRunRemoteManager } from "@/app_run/AppRunRemoteProvider";

export function useConsoleEntries(appId: number | null) {
  const manager = useAppRunRemoteManager();
  const entries = useKeyedController(manager.previewConsole, appId ?? -1);
  return appId === null ? [] : entries;
}

export function useLatestConsoleEntry(appId: number | null) {
  const manager = useAppRunRemoteManager();
  return useKeyedMachineSelector(
    manager.previewConsole,
    appId ?? -1,
    (entries) =>
      appId === null
        ? undefined
        : window.__SELTRA_WEB__ === true
          ? [...entries]
              .reverse()
              .find((entry) => !/^\[DEBUG\]/i.test(entry.message))
          : entries.at(-1),
  );
}
