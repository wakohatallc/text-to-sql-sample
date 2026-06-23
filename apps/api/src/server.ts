import { serve } from "@hono/node-server";
import { config } from "./config";
import { app } from "./routes";

/**
 * HonoアプリケーションをローカルAPIサーバとして起動する。
 */
serve(
  {
    fetch: app.fetch,
    port: config.port,
    hostname: "127.0.0.1"
  },
  (info) => {
    console.log(`API listening on http://${info.address}:${info.port}`);
  }
);
