export const dynamic = "force-dynamic";

let lastLookupAt = 0;

type NominatimResult = {
  address?: Record<string, string | undefined>;
};

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams;
  const lat = Number(input.get("lat"));
  const lon = Number(input.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const wait = Math.max(0, 1100 - (Date.now() - lastLookupAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastLookupAt = Date.now();

  const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("lat", lat.toFixed(5));
  endpoint.searchParams.set("lon", lon.toFixed(5));
  endpoint.searchParams.set("zoom", "13");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("layer", "address");
  endpoint.searchParams.set("accept-language", "en");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "Referer": "https://signal-trail.hey548648.chatgpt.site/",
        "User-Agent": "SignalTrail/1.0 (https://signal-trail.hey548648.chatgpt.site)",
      },
    });
    if (!response.ok) return Response.json({ error: "Place unavailable" }, { status: 502 });
    const result = await response.json() as NominatimResult;
    const address = result.address ?? {};
    const name = address.neighbourhood ?? address.suburb ?? address.village ?? address.town ?? address.city
      ?? address.municipality ?? address.county ?? address.state ?? address.country;
    if (!name) return Response.json({ error: "Place unavailable" }, { status: 404 });
    return Response.json({ name }, {
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400" },
    });
  } catch {
    return Response.json({ error: "Place unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
