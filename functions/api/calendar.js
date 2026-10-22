// Cloudflare Pages Function: /api/calendar
// Proxies and caches the public iCloud iCal feed for Egan Hoops

const ICLOUD_FEED_URL = "https://p106-caldav.icloud.com/published/2/MTEzMzQzNDIwOTExMzM0MzDdaOwUKN-asCHRraXSKwGHwRpsKDE3B77yGoRMrYBEOUFvkxtZdkqkGvKNd_L2jFbU9ybD3S5MRqtadZoIuoY";

export async function onRequestGet(context) {
  try {
    const response = await fetch(ICLOUD_FEED_URL, {
      headers: {
        "User-Agent": "MacCalendar/1.0",
        "Accept": "text/calendar, text/plain, */*"
      },
      cf: {
        cacheTtl: 600, // cache at Cloudflare edge for 10 minutes
        cacheEverything: true
      }
    });

    if (!response.ok) {
      return new Response(`Error fetching calendar: ${response.status} ${response.statusText}`, {
        status: response.status,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const icsText = await response.text();

    return new Response(icsText, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=600, s-maxage=600"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
