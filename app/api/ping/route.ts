export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "CDN-Cache-Control": "no-store",
    },
  });
}
