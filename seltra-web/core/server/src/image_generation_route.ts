export function isImageGenerationRoute(method: string, pathname: string): boolean {
  return (
    method === "POST" &&
    (pathname === "/images/generations" ||
      pathname === "/v1/images/generations")
  );
}
