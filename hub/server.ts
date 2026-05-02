const root = new URL("./", import.meta.url);
const port = Number(process.env.PORT || 4173);

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const fileUrl = new URL(`.${pathname}`, root);

    if (!fileUrl.pathname.startsWith(root.pathname)) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(fileUrl);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }

    const extension = pathname.match(/\.[^.]+$/)?.[0] || ".html";
    return new Response(file, {
      headers: {
        "content-type": types[extension] || "application/octet-stream"
      }
    });
  }
});

console.log(`Agora Hub running at http://localhost:${port}`);
