export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "CDN-Cache-Control": "no-store",
};

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("bytes"));
  const size = Math.min(524288, Math.max(65536, Number.isFinite(requested) ? requested : 262144));
  const body = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += 65536) {
    crypto.getRandomValues(body.subarray(offset, Math.min(offset + 65536, size)));
  }
  return new Response(body, {
    headers: { ...noStore, "Content-Type": "application/octet-stream", "Content-Length": String(size) },
  });
}

export async function POST(request: Request) {
  await request.arrayBuffer();
  return new Response(null, { status: 204, headers: noStore });
}
