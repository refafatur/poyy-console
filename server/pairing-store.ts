import { randomBytes, randomUUID } from "node:crypto";

export type DeviceInfo = { name: string; platform: string };

export type PairingSession = {
  id: string;
  publicToken: string;
  ownerToken: string;
  createdAt: number;
  expiresAt: number;
  ownerSocketId?: string;
  controllerSocketId?: string;
  device?: DeviceInfo;
};

export class PairingStore {
  private readonly sessions = new Map<string, PairingSession>();

  constructor(private readonly now = () => Date.now()) {}

  create(ttlMs = 5 * 60 * 1000) {
    this.cleanup();
    const session: PairingSession = {
      id: randomUUID(),
      publicToken: randomBytes(24).toString("base64url"),
      ownerToken: randomBytes(32).toString("base64url"),
      createdAt: this.now(),
      expiresAt: this.now() + ttlMs,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  verifyOwner(sessionId: string, ownerToken: string) {
    const session = this.get(sessionId);
    return Boolean(session && session.ownerToken === ownerToken);
  }

  verifyController(sessionId: string, token: string) {
    const session = this.get(sessionId);
    return Boolean(session && session.publicToken === token);
  }

  setOwnerSocket(sessionId: string, socketId: string) {
    const session = this.get(sessionId);
    if (session) session.ownerSocketId = socketId;
    return session;
  }

  setControllerSocket(sessionId: string, socketId: string, device: DeviceInfo) {
    const session = this.get(sessionId);
    if (session) {
      session.controllerSocketId = socketId;
      session.device = device;
    }
    return session;
  }

  clearSocket(socketId: string) {
    for (const session of this.sessions.values()) {
      if (session.ownerSocketId === socketId) session.ownerSocketId = undefined;
      if (session.controllerSocketId === socketId) {
        session.controllerSocketId = undefined;
        session.device = undefined;
      }
    }
  }

  cleanup() {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= this.now()) this.sessions.delete(id);
    }
  }
}

const globalStore = globalThis as typeof globalThis & { poyyPairingStore?: PairingStore };
export const pairingStore = globalStore.poyyPairingStore ?? new PairingStore();
globalStore.poyyPairingStore = pairingStore;
