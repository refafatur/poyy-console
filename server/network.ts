import os from "node:os";

function localIpv4() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return undefined;
}

export function pairingOrigin(host: string | null, protocol: string) {
  const configured = process.env.NEXT_PUBLIC_PAIRING_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  const candidate = host ?? `localhost:${process.env.PORT ?? 3000}`;
  const bareHost = candidate.split(":")[0];
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(bareHost)) {
    const lanAddress = localIpv4();
    if (lanAddress) return `${protocol}://${lanAddress}:${candidate.split(":")[1] ?? process.env.PORT ?? 3000}`;
  }
  return `${protocol}://${candidate}`;
}
