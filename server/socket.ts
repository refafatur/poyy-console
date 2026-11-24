import type { Server, Socket } from "socket.io";
import { isInputAction, isInputAxis } from "@/lib/universal-input";
import { pairingStore, type DeviceInfo } from "@/server/pairing-store";

type OwnerPayload = { sessionId?: string; ownerToken?: string };
type ControllerPayload = { sessionId?: string; token?: string; device?: Partial<DeviceInfo> };

const safeDevice = (device: Partial<DeviceInfo> | undefined): DeviceInfo => ({
  name: String(device?.name || "POYY LINK phone").slice(0, 64),
  platform: String(device?.platform || "mobile").slice(0, 64),
});

function status(sessionId: string) {
  const session = pairingStore.get(sessionId);
  return session
    ? { connected: Boolean(session.controllerSocketId), device: session.device, expiresAt: session.expiresAt }
    : { connected: false, expired: true };
}

export function configureSocketServer(io: Server) {
  io.on("connection", (socket: Socket) => {
    socket.on("pair:owner", (payload: OwnerPayload, reply?: (response: unknown) => void) => {
      if (!payload.sessionId || !payload.ownerToken || !pairingStore.verifyOwner(payload.sessionId, payload.ownerToken)) {
        reply?.({ ok: false, reason: "Session is invalid or expired." });
        return;
      }
      pairingStore.setOwnerSocket(payload.sessionId, socket.id);
      socket.data.sessionId = payload.sessionId;
      socket.data.role = "owner";
      socket.join(`owner:${payload.sessionId}`);
      reply?.({ ok: true, ...status(payload.sessionId) });
    });

    socket.on("pair:controller", (payload: ControllerPayload, reply?: (response: unknown) => void) => {
      if (!payload.sessionId || !payload.token || !pairingStore.verifyController(payload.sessionId, payload.token)) {
        reply?.({ ok: false, reason: "This pairing link is invalid or has expired." });
        return;
      }
      const device = safeDevice(payload.device);
      pairingStore.setControllerSocket(payload.sessionId, socket.id, device);
      socket.data.sessionId = payload.sessionId;
      socket.data.role = "controller";
      io.to(`owner:${payload.sessionId}`).emit("pairing:status", { connected: true, device });
      reply?.({ ok: true, device });
    });

    socket.on("controller:input", (payload: { action?: unknown; pressed?: unknown }) => {
      if (socket.data.role !== "controller" || !socket.data.sessionId || !isInputAction(payload.action) || typeof payload.pressed !== "boolean") return;
      const session = pairingStore.get(socket.data.sessionId);
      if (!session?.controllerSocketId || session.controllerSocketId !== socket.id) return;
      io.to(`owner:${socket.data.sessionId}`).emit("input:event", { action: payload.action, pressed: payload.pressed });
    });

    socket.on("controller:axis", (payload: { axis?: unknown; value?: unknown }) => {
      if (
        socket.data.role !== "controller" ||
        !socket.data.sessionId ||
        !isInputAxis(payload.axis) ||
        typeof payload.value !== "number" ||
        !Number.isFinite(payload.value)
      ) {
        return;
      }
      const session = pairingStore.get(socket.data.sessionId);
      if (!session?.controllerSocketId || session.controllerSocketId !== socket.id) return;
      const clamped = Math.max(-1, Math.min(1, payload.value));
      io.to(`owner:${socket.data.sessionId}`).emit("input:axis", { axis: payload.axis, value: clamped });
    });

    socket.on("disconnect", () => {
      const sessionId = socket.data.sessionId as string | undefined;
      const role = socket.data.role as string | undefined;
      pairingStore.clearSocket(socket.id);
      if (sessionId && role === "controller") {
        io.to(`owner:${sessionId}`).emit("pairing:status", { connected: false });
        io.to(`owner:${sessionId}`).emit("input:release-all");
      }
    });
  });
}
