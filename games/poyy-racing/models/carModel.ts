import * as THREE from "three";

export type CarLivery = {
  id: string;
  name: string;
  bodyHex: number;
  accentHex: number;
};

export const CAR_LIVERIES: Record<string, CarLivery> = {
  player: { id: "player", name: "POYY Crimson", bodyHex: 0xe6392f, accentHex: 0xf4f2ec },
  cobalt: { id: "cobalt", name: "Cobalt Apex", bodyHex: 0x2563eb, accentHex: 0x93c5fd },
  amber: { id: "amber", name: "Solar GT", bodyHex: 0xd97706, accentHex: 0xfde68a },
  emerald: { id: "emerald", name: "Emerald V8", bodyHex: 0x059669, accentHex: 0x6ee7b7 },
};

export type RacerCarRig = {
  root: THREE.Group;
  bodyTiltGroup: THREE.Group;
  frontWheels: THREE.Group[];
  allWheels: THREE.Group[];
  brakeMaterial: THREE.MeshStandardMaterial;
  nitroFlames: THREE.Mesh[];
  driftSmoke: THREE.Group;
};

function createSoftShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.65)");
  grad.addColorStop(0.65, "rgba(0,0,0,0.28)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

let cachedShadowTex: THREE.CanvasTexture | undefined;

export function createRacerCarMesh(livery: CarLivery): RacerCarRig {
  const root = new THREE.Group();
  const bodyTiltGroup = new THREE.Group();
  root.add(bodyTiltGroup);

  // Materials calibrated with >=0.25 roughness deltas
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: livery.bodyHex,
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    metalness: 0.22,
    roughness: 0.72,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: livery.accentHex,
    metalness: 0.55,
    roughness: 0.28,
  });
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b121b,
    metalness: 0.9,
    roughness: 0.08,
    clearcoat: 1.0,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x121316,
    metalness: 0.05,
    roughness: 0.85,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd1d5db,
    metalness: 0.94,
    roughness: 0.16,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xe0f2fe,
    emissiveIntensity: 2.2,
    roughness: 0.15,
  });
  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0xff1e1e,
    emissiveIntensity: 1.1,
    roughness: 0.2,
  });

  // 1. Grounded contact shadow plane
  if (!cachedShadowTex) cachedShadowTex = createSoftShadowTexture();
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.7, 5.1),
    new THREE.MeshBasicMaterial({ map: cachedShadowTex, transparent: true, depthWrite: false, opacity: 0.75 }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.05;
  root.add(contactShadow);

  // 2. Sculpted side-profile extruded chassis silhouette (car faces -Z)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.15, 0.22); // nose tip (-Z maps after rotateY)
  hullShape.lineTo(-1.8, 0.52);
  hullShape.lineTo(-0.78, 0.64);
  hullShape.lineTo(-0.32, 1.04); // windshield slope
  hullShape.lineTo(0.65, 1.04); // roof
  hullShape.lineTo(1.62, 0.72); // rear deck
  hullShape.lineTo(2.08, 0.68);
  hullShape.lineTo(2.12, 0.24);
  hullShape.lineTo(-2.15, 0.22);

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 1.72,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.07,
    bevelSegments: 2,
  });
  hullGeo.translate(0, 0, -0.86);
  // Rotate so shape's -X becomes -Z (forward) and +Z becomes +X (width)
  hullGeo.rotateY(-Math.PI / 2);
  const hullMesh = new THREE.Mesh(hullGeo, paintMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  bodyTiltGroup.add(hullMesh);

  // 3. Smoked glass cockpit canopy
  const canopyGeo = new THREE.BoxGeometry(1.38, 0.34, 1.48);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 0.88, 0.08);
  bodyTiltGroup.add(canopy);

  // 4. Racing center stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 3.9), accentMat);
  stripe.position.set(0, 0.69, 0.02);
  bodyTiltGroup.add(stripe);

  // 5. Carbon front splitter, side skirts, and rear diffuser
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.07, 0.55), carbonMat);
  splitter.position.set(0, 0.21, -2.02);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.14, 0.4), carbonMat);
  diffuser.position.set(0, 0.24, 2.02);
  const skirtGeo = new THREE.BoxGeometry(0.12, 0.1, 2.75);
  const skirtL = new THREE.Mesh(skirtGeo, carbonMat);
  skirtL.position.set(-0.96, 0.23, 0);
  const skirtR = new THREE.Mesh(skirtGeo, carbonMat);
  skirtR.position.set(0.96, 0.23, 0);
  bodyTiltGroup.add(splitter, diffuser, skirtL, skirtR);

  // 6. GT Rear Wing + twin uprights
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.06, 0.38), carbonMat);
  wing.position.set(0, 1.15, 1.9);
  wing.rotation.x = 0.14;
  wing.castShadow = true;
  const strutGeo = new THREE.BoxGeometry(0.06, 0.42, 0.18);
  const strutL = new THREE.Mesh(strutGeo, carbonMat);
  strutL.position.set(-0.56, 0.92, 1.84);
  const strutR = new THREE.Mesh(strutGeo, carbonMat);
  strutR.position.set(0.56, 0.92, 1.84);
  bodyTiltGroup.add(wing, strutL, strutR);

  // 7. LED Headlights & Taillights
  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.1), headlightMat);
  headL.position.set(-0.66, 0.44, -2.14);
  const headR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.1), headlightMat);
  headR.position.set(0.66, 0.44, -2.14);
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.09, 0.1), brakeMaterial);
  tailBar.position.set(0, 0.56, 2.13);
  bodyTiltGroup.add(headL, headR, tailBar);

  // 8. Twin Exhaust Tips + Nitro Flame Cones
  const exhaustGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.2, 12);
  exhaustGeo.rotateX(Math.PI / 2);
  const exhaustL = new THREE.Mesh(exhaustGeo, rimMat);
  exhaustL.position.set(-0.42, 0.28, 2.18);
  const exhaustR = new THREE.Mesh(exhaustGeo, rimMat);
  exhaustR.position.set(0.42, 0.28, 2.18);
  bodyTiltGroup.add(exhaustL, exhaustR);

  const flameGeo = new THREE.ConeGeometry(0.14, 1.35, 12);
  flameGeo.rotateX(Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.88 });
  const flameL = new THREE.Mesh(flameGeo, flameMat);
  flameL.position.set(-0.42, 0.28, 2.86);
  flameL.visible = false;
  const flameR = new THREE.Mesh(flameGeo, flameMat);
  flameR.position.set(0.42, 0.28, 2.86);
  flameR.visible = false;
  bodyTiltGroup.add(flameL, flameR);

  // 9. Drift Smoke Puffs
  const driftSmoke = new THREE.Group();
  driftSmoke.visible = false;
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xd4d4d8, transparent: true, opacity: 0.35, depthWrite: false });
  const puffGeo = new THREE.CircleGeometry(0.62, 14);
  puffGeo.rotateX(-Math.PI / 2);
  const puffL = new THREE.Mesh(puffGeo, puffMat);
  puffL.position.set(-0.85, 0.11, 1.75);
  const puffR = new THREE.Mesh(puffGeo, puffMat);
  puffR.position.set(0.85, 0.11, 1.75);
  driftSmoke.add(puffL, puffR);
  root.add(driftSmoke);

  // 10. Four multi-part wheels (pivot at wheel center for steering/spin)
  const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 22);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.295, 16);
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.305, 0.05, 0.36);

  const wheelPositions: Array<[number, number, number]> = [
    [-0.96, 0.36, -1.28],
    [0.96, 0.36, -1.28],
    [-0.96, 0.36, 1.28],
    [0.96, 0.36, 1.28],
  ];
  const frontWheels: THREE.Group[] = [];
  const allWheels: THREE.Group[] = [];

  wheelPositions.forEach(([x, y, z], index) => {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(x, y, z);
    const spinGroup = new THREE.Group();
    const tireMesh = new THREE.Mesh(tireGeo, tireMat);
    tireMesh.castShadow = true;
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    const spokeA = new THREE.Mesh(spokeGeo, carbonMat);
    const spokeB = new THREE.Mesh(spokeGeo, carbonMat);
    spokeB.rotation.x = Math.PI / 2;
    spinGroup.add(tireMesh, rimMesh, spokeA, spokeB);
    steerPivot.add(spinGroup);
    root.add(steerPivot);
    if (index < 2) frontWheels.push(steerPivot);
    allWheels.push(spinGroup);
  });

  return {
    root,
    bodyTiltGroup,
    frontWheels,
    allWheels,
    brakeMaterial,
    nitroFlames: [flameL, flameR],
    driftSmoke,
  };
}
