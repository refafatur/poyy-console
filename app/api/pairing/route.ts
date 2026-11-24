import { NextRequest, NextResponse } from "next/server";
import { pairingOrigin } from "@/server/network";
import { pairingStore } from "@/server/pairing-store";

const attempts = new Map<string, { count: number; resetAt: number }>();

function allowRequest(request: NextRequest) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const record = attempts.get(address);
  if (!record || record.resetAt < now) {
    attempts.set(address, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  record.count += 1;
  return record.count <= 12;
}

export async function POST(request: NextRequest) {
  if (!allowRequest(request)) return NextResponse.json({ error: "Too many pairing attempts. Try again shortly." }, { status: 429 });
  const session = pairingStore.create();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" ? "https" : request.nextUrl.protocol.replace(":", "") || "http";
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host");
  const origin = pairingOrigin(host, protocol);
  const controllerUrl = `${origin}/link?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(session.publicToken)}`;
  return NextResponse.json({
    sessionId: session.id,
    ownerToken: session.ownerToken,
    controllerUrl,
    expiresAt: session.expiresAt,
  });
}
