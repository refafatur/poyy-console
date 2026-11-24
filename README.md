# POYY CONSOLE

POYY CONSOLE is a functional Next.js gaming platform prototype with secure temporary device pairing, a POYY LINK phone controller, a reusable input layer, and a playable procedural Three.js arcade racer.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` on the laptop. The pairing QR code automatically uses the first detected IPv4 LAN address, so the phone and laptop must share Wi-Fi. If automatic detection is unsuitable, create `.env.local` with:

```bash
NEXT_PUBLIC_PAIRING_ORIGIN=http://192.168.1.10:3000
```

For public deployments, use HTTPS and set `NEXT_PUBLIC_PAIRING_ORIGIN` to the public HTTPS origin.

## Controls

- `W` / `↑`: accelerate
- `S` / `↓`: brake
- `A` / `←` and `D` / `→`: steer
- `Shift`: nitro
- `Space`: drift
- `Esc`: pause

The POYY LINK phone page sends the same universal input actions over Socket.IO. The backend validates an ephemeral pairing token, expires sessions after five minutes, separates owner and controller credentials, and rate-limits session creation.

## Validation

```bash
npm test
npm run build
```

## Asset pipeline

The in-browser racer uses procedural Three.js geometry, so it has no runtime model dependency. `blender/scripts/create_poyy_racer.py` creates an editable `.blend` and `.glb` only when Blender is installed and the script is explicitly run; generated assets are intentionally not committed.
