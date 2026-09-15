// return mapbox settings for a valid browser token
export function resolveMapStyle(token: string | undefined) {
  // mapbox only accepts public browser tokens
  const hasPublicToken = Boolean(token?.startsWith("pk."));
  return {
    accessToken: hasPublicToken ? token : undefined,
    style: "mapbox://styles/mapbox/light-v11",
  };
}
