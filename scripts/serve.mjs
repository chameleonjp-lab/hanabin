import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requestedRoot = process.argv[2] ? resolve(process.argv[2]) : projectRoot;
const root = requestedRoot;
const port = Number(process.env.HANABIN_PORT ?? 4173);
const host = "127.0.0.1";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const send = (response, statusCode, body, headers = {}) => {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body);
};

const resolveRequestPath = (requestUrl) => {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/hanabin" || pathname.startsWith("/hanabin/")) {
    pathname = pathname.slice("/hanabin".length) || "/";
  }
  if (pathname.includes("\0")) return null;
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(root, `.${normalize(relativePath)}`);
  if (filePath !== root && !filePath.startsWith(`${root}/`)) return null;
  return filePath;
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
    return;
  }

  let filePath;
  try {
    filePath = resolveRequestPath(request.url ?? "/");
  } catch {
    send(response, 400, "Bad Request\n");
    return;
  }

  if (!filePath) {
    send(response, 403, "Forbidden\n");
    return;
  }

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      send(response, 404, "Not Found\n");
      return;
    }
    const body = await readFile(filePath);
    const headers = {
      "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
      "Content-Length": body.byteLength,
    };
    send(response, 200, request.method === "HEAD" ? undefined : body, headers);
  } catch (error) {
    if (error?.code === "ENOENT") {
      send(response, 404, "Not Found\n");
      return;
    }
    send(response, 500, "Internal Server Error\n");
  }
});

server.listen(port, host, () => {
  console.log(`HANABIN static server listening at http://${host}:${port}`);
});
