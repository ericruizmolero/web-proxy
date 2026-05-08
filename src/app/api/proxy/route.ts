import { NextRequest, NextResponse } from "next/server";

const BLOCKED_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-type-options",
]);

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
    if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  const origin = `${targetUrl.protocol}//${targetUrl.host}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
  } catch {
    return new NextResponse("Failed to fetch target URL", { status: 502 });
  }

  const contentType = response.headers.get("content-type") ?? "";

  // For non-HTML content, pass through after stripping blocking headers
  if (!contentType.includes("text/html")) {
    const headers = new Headers();
    response.headers.forEach((value, key) => {
      if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    });
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  }

  // Process HTML
  const html = await response.text();
  const rewritten = rewriteHtml(html, origin);

  return new NextResponse(rewritten, {
    status: response.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

function rewriteHtml(html: string, origin: string): string {
  // Inject <base> so relative assets (CSS, JS, images) load from the real origin
  let result = html.replace(
    /(<head[^>]*>)/i,
    `$1<base href="${origin}/" target="_self">`
  );

  // Block all link navigation — keeps scroll working, prevents iframe errors
  const blockNavScript = `<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target.closest('a');
    if(a){ e.preventDefault(); e.stopPropagation(); }
  }, true);
  try { history.pushState = function(){}; history.replaceState = function(){}; } catch(e){}
})();
</script>`;

  result = result.replace(/(<\/head>)/i, blockNavScript + "$1");

  // Disable iframe-busting JS
  result = result.replace(/window\.top\s*[!=]/g, "window.self =");

  return result;
}
