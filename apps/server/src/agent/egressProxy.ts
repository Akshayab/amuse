import http from "node:http";
import net from "node:net";
import { logger } from "../lib/logger";
import { resolvePublic } from "./sentinel";

/**
 * A local forward proxy that Chromium is launched behind. Every connection the agent's browser
 * makes (pages, redirects, subresources, websockets) is resolved here, refused if any address is
 * private, and connected to the exact address that was checked, so DNS can't change in between.
 */
let started: Promise<string> | null = null;

async function connectChecked(host: string, port: number): Promise<net.Socket> {
  const [addr] = await resolvePublic(host);
  return await new Promise((resolve, reject) => {
    const s = net.connect({ host: addr!.address, port }, () => resolve(s));
    s.once("error", reject);
  });
}

export function startEgressProxy(): Promise<string> {
  started ??= new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // Plain http:// requests arrive with an absolute URL.
      let url: URL;
      try {
        url = new URL(req.url ?? "");
        if (url.protocol !== "http:") throw new Error("bad scheme");
      } catch {
        res.writeHead(400).end();
        return;
      }
      try {
        const [addr] = await resolvePublic(url.hostname);
        const headers = { ...req.headers };
        delete headers["proxy-connection"];
        const up = http.request(
          { host: addr!.address, port: Number(url.port || 80), method: req.method, path: url.pathname + url.search, headers, setHost: false },
          (r) => {
            res.writeHead(r.statusCode ?? 502, r.headers);
            r.pipe(res);
          },
        );
        up.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
        req.pipe(up);
      } catch (e) {
        res.writeHead(403, { "content-type": "text/plain" }).end((e as Error).message);
      }
    });
    // https:// and websockets tunnel through CONNECT host:port.
    server.on("connect", async (req, client: net.Socket, head) => {
      const [host, portStr] = (req.url ?? "").split(/:(?=\d+$)/);
      try {
        const up = await connectChecked(host!.replace(/^\[|\]$/g, ""), Number(portStr || 443));
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) up.write(head);
        up.pipe(client).pipe(up);
        up.on("error", () => client.destroy());
        client.on("error", () => up.destroy());
      } catch (e) {
        client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\n${(e as Error).message}`);
      }
    });
    server.on("error", (err) => (logger.error({ err }, "egress proxy failed"), reject(err)));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.unref();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  return started;
}
