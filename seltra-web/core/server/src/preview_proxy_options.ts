export function previewProxyOptions(
  target: string,
  remoteRuntime: boolean,
  headers?: Record<string, string>,
) {
  return {
    target,
    ...(remoteRuntime ? { changeOrigin: true, secure: true } : {}),
    ...(!remoteRuntime && headers ? { headers } : {}),
  }
}
