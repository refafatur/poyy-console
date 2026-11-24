import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { configureSocketServer } from "@/server/socket";

const development = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev: development, hostname, port });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const httpServer = createServer((request, response) => handle(request, response));
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    transports: ["websocket", "polling"],
  });

  configureSocketServer(io);
  httpServer.listen(port, hostname, () => {
    console.log(`POYY CONSOLE is ready on http://localhost:${port}`);
  });
});
