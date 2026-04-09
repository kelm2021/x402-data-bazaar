const http = require("node:http");
const { createApp } = require("../app");

let backendServerPromise = null;

async function ensureBackendBaseUrl() {
  if (!backendServerPromise) {
    backendServerPromise = new Promise((resolve, reject) => {
      const app = createApp({
        env: process.env,
        enableDebugRoutes: false,
        mercTrustMiddleware: null,
      });
      const server = http.createServer(app);

      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("backend_server_missing_address"));
          return;
        }

        resolve(`http://127.0.0.1:${address.port}`);
      });

      server.on("error", reject);
    }).catch((error) => {
      backendServerPromise = null;
      throw error;
    });
  }

  return backendServerPromise;
}

function copyHeaders(source) {
  const headers = new Headers();

  source.forEach((value, key) => {
    if (key === "connection" || key === "keep-alive" || key === "transfer-encoding") {
      return;
    }
    headers.append(key, value);
  });

  return headers;
}

async function proxyToBackend(request, pathnameOverride) {
  try {
    const baseUrl = await ensureBackendBaseUrl();
    const incomingUrl = new URL(request.url);
    const targetUrl = new URL(pathnameOverride || incomingUrl.pathname, baseUrl);
    targetUrl.search = incomingUrl.search;

    const headers = copyHeaders(request.headers);
    headers.set("host", incomingUrl.host);
    headers.set("x-forwarded-host", incomingUrl.host);
    headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = Buffer.from(await request.arrayBuffer());
    }

    const response = await fetch(targetUrl, init);
    const responseBody = response.body == null
      ? null
      : Buffer.from(await response.arrayBuffer());

    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: copyHeaders(response.headers),
    });
  } catch (error) {
    console.error("next_backend_proxy_error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      cwd: process.cwd(),
      dirname: __dirname,
      url: request.url,
    });
    throw error;
  }
}

module.exports = {
  proxyToBackend,
};
