const canvas = document.getElementById('gameCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec9dc);
scene.fog = new THREE.Fog(0xa8d1e6, 18, 170);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 400);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);
const keys = {};
const joystick = { x: 0, y: 0 };

const world = {
  colliders: [],
  enemies: [],
  loot: [],
  safeRadius: 90,
  minRadius: 22,
  time: 0,
  zoneTimer: 0,
  particles: [],
  hostileShots: []
};

const player = {
  group: new THREE.Group(),
  pos: new THREE.Vector3(0, 0, 16),
  yaw: 0,
  cameraYaw: 0,
  pitch: 0.4,
  hp: 100,
  maxHp: 100,
  coins: 200,
  radius: 0.9,
  jumpVel: 0,
  onGround: true,
  speedBoost: 1,
  weaponIndex: 1,
  fireCooldown: 0,
  reloadTime: 0,
  firing: false,
  jumpRequested: false,
  walkPhase: 0,
  limbs: [],
  kills: 0,
  aiming: false,
  weapons: [
    { name: 'Pistol', ammo: 12, reserve: 48, mag: 12, damage: 18, range: 35, fireRate: 0.28, reload: 1.4 },
    { name: 'Assault Rifle', ammo: 30, reserve: 90, mag: 30, damage: 12, range: 42, fireRate: 0.11, reload: 1.8 },
    { name: 'Shotgun', ammo: 8, reserve: 24, mag: 8, damage: 10, range: 18, fireRate: 0.8, reload: 2.2 },
    { name: 'Sniper', ammo: 5, reserve: 15, mag: 5, damage: 44, range: 80, fireRate: 1.2, reload: 2.5 }
  ],
  loot: { medkit: 1, ammo: 2, armor: 1, boost: 1, backpack: 1, rare: 0, epic: 0 }
};

const hud = {
  ammo: document.getElementById('ammoValue'),
  coins: document.getElementById('coinValue'),
  health: document.getElementById('healthBarInner'),
  enemyCount: document.getElementById('enemyValue'),
  killCount: document.getElementById('killValue'),
  weaponName: document.getElementById('weaponName'),
  weaponSub: document.getElementById('weaponSub'),
  zone: document.getElementById('zoneText'),
  pickup: document.getElementById('pickupPrompt'),
  inventory: document.getElementById('inventoryList'),
  toggle: document.getElementById('inventoryToggle'),
  close: document.getElementById('closeInventory'),
  panel: document.getElementById('inventoryPanel'),
  notification: document.getElementById('notification')
};

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function showToast(text) {
  hud.notification.textContent = text;
  hud.notification.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => hud.notification.classList.remove('show'), 1400);
}

function uiUpdate() {
  const w = player.weapons[player.weaponIndex];
  hud.ammo.textContent = `${w.ammo} / ${w.reserve}`;
  hud.coins.textContent = String(player.coins);
  hud.weaponName.textContent = w.name;
  hud.weaponSub.textContent = `${w.name.toUpperCase().slice(0, 2)} • ${w.mag}-round mag`;
  hud.enemyCount.textContent = String(world.enemies.filter(e => e.alive).length);
  hud.killCount.textContent = String(player.kills);
  hud.zone.textContent = `Safe Zone: ${Math.round(world.safeRadius)}m`;
  const pct = clamp(player.hp / player.maxHp, 0, 1);
  hud.health.style.width = `${pct * 100}%`;
  if (player.hp < 35) hud.health.style.background = 'linear-gradient(90deg, #ff6a6a, #ffc857)';
  else if (player.hp < 70) hud.health.style.background = 'linear-gradient(90deg, #7fff9d, #ffd75d)';
  else hud.health.style.background = 'linear-gradient(90deg, #7fff9d, #ffd75d 60%, #ff5f5f)';
}

function renderInventory() {
  const items = [
    ['Medkit', player.loot.medkit],
    ['Ammo', player.loot.ammo],
    ['Armor', player.loot.armor],
    ['Boost', player.loot.boost],
    ['Backpack', player.loot.backpack],
    ['Rare', player.loot.rare],
    ['Epic', player.loot.epic]
  ];
  hud.inventory.innerHTML = items.map(([n, c]) => `<div class="inv-slot"><span class="name">${n}</span><span class="count">${c}</span></div>`).join('');
}

function setInventoryVisible(v) { hud.panel.classList.toggle('visible', v); }

function addLighting() {
  scene.add(new THREE.HemisphereLight(0xdff7ff, 0x203420, 1.25));
  const sun = new THREE.DirectionalLight(0xfff3d1, 1.4);
  sun.position.set(30, 35, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  scene.add(sun);
}

function addBuilding(x, z, w, d, h, color = 0xe8dab0) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), new THREE.MeshStandardMaterial({ color: 0x5a4c42, roughness: 1 }));
  base.position.y = 0.2;
  g.add(base);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  walls.position.y = h / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  g.add(walls);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.7, d + 0.6), new THREE.MeshStandardMaterial({ color: 0x9f7d5f, roughness: 0.8 }));
  roof.position.y = h + 0.35;
  g.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.24, h * 0.7, 0.22), new THREE.MeshStandardMaterial({ color: 0x674630 }));
  door.position.set(0, h * 0.35, d / 2 + 0.12);
  g.add(door);
  g.position.set(x, 0, z);
  scene.add(g);
  world.colliders.push({ x, z, w, d, h });
}

function createTree(x, z, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * s, 0.34 * s, 2.3 * s, 8), new THREE.MeshStandardMaterial({ color: 0x7b5637, roughness: 1 }));
  trunk.position.y = 1.15 * s;
  trunk.castShadow = true;
  g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.3 * s, 10, 10), new THREE.MeshStandardMaterial({ color: 0x2f8f52, roughness: 1 }));
  leaves.position.y = 3 * s;
  leaves.castShadow = true;
  g.add(leaves);
  g.position.set(x, 0, z);
  scene.add(g);
}

function createRock(x, z, s = 1) {
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1 * s, 0), new THREE.MeshStandardMaterial({ color: 0x858a8f, roughness: 1 }));
  mesh.position.set(x, 0.7 * s, z);
  mesh.scale.set(1.4, 0.9, 1.2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addGround() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x6ea750, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x8b836c, roughness: 1 });
  const roadA = new THREE.Mesh(new THREE.BoxGeometry(15, 0.05, 180), roadMat); roadA.position.y = 0.03; scene.add(roadA);
  const roadB = new THREE.Mesh(new THREE.BoxGeometry(180, 0.05, 15), roadMat); roadB.position.y = 0.03; scene.add(roadB);

  const ring = new THREE.Mesh(new THREE.RingGeometry(88, 90, 64), new THREE.MeshBasicMaterial({ color: 0x67ffc6, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  world.zoneRing = ring;
  scene.add(ring);
}

function addLabel(text, x, z) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(7, 18, 12, 0.8)'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#c7ffd9'; ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
  ctx.fillStyle = '#ecfff0'; ctx.font = 'bold 32px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.position.set(x, 2.5, z); sprite.scale.set(8, 2.4, 1);
  scene.add(sprite);
}

function addLoot(type, x, z) {
  const colors = { medkit: 0x63f0a0, ammo: 0xfad86f, armor: 0x89cbff, boost: 0xff9e7d, backpack: 0xb5d8ff, rare: 0xcf9bff, epic: 0xffcf6f };
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: colors[type] || 0xffffff, emissive: colors[type] || 0x202020, emissiveIntensity: 0.2 }));
  body.castShadow = true;
  g.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.09, 8, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 }));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.position.set(x, 0.9, z);
  scene.add(g);
  world.loot.push({ type, mesh: g, collected: false });
}

function collides(x, z, radius = 0.8) {
  for (const b of world.colliders) {
    const dx = Math.abs(x - b.x), dz = Math.abs(z - b.z);
    if (dx < b.w / 2 + radius && dz < b.d / 2 + radius) return true;
  }
  return x < -110 || x > 110 || z < -110 || z > 110;
}

function buildWorld() {
  addGround(); addLighting();
  const buildings = [
    [-28, -24, 10, 9, 7, 0xe7d6af], [-44, 12, 12, 10, 8, 0xe3d7b7], [18, -22, 11, 9, 7, 0xe8d9b7], [40, 20, 14, 12, 9, 0xd8b98f], [-16, 34, 9, 8, 6, 0xe5d5a7], [22, 44, 11, 10, 8, 0xd3bd9b], [-58, 48, 16, 12, 10, 0xe4cfaf], [58, -50, 24, 16, 12, 0xcac0a2], [60, 52, 12, 10, 7, 0xdbc7a6], [-62, -54, 13, 11, 8, 0xd8c3a2]
  ];
  buildings.forEach(([x, z, w, d, h, c]) => addBuilding(x, z, w, d, h, c));
  [
    ['Ridge Point', -40, 65], ['Harbor Lane', 18, 64], ['The Village', -12, 0], ['Old Warehouse', 60, -42], ['North Gate', -58, 45], ['Dusty Crossroad', 0, -18], ['Stone Ridge', 42, 55], ['Market Row', -24, -48]
  ].forEach(([name, x, z]) => addLabel(name, x, z));
  for (let i = 0; i < 50; i++) { const x = (Math.random() - 0.5) * 180; const z = (Math.random() - 0.5) * 180; if (Math.hypot(x, z) > 24) createTree(x, z, 0.7 + Math.random() * 1.2); }
  for (let i = 0; i < 20; i++) { const x = (Math.random() - 0.5) * 160; const z = (Math.random() - 0.5) * 160; if (Math.hypot(x, z) > 15) createRock(x, z, 0.7 + Math.random() * 1.5); }
  for (let i = 0; i < 8; i++) { const x = (Math.random() - 0.5) * 160; const z = (Math.random() - 0.5) * 160; const hill = new THREE.Mesh(new THREE.SphereGeometry(9 + Math.random() * 12, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshStandardMaterial({ color: 0x6d9d5c, roughness: 1 })); hill.position.set(x, 4 + Math.random() * 5, z); hill.scale.set(1, 0.6, 1); hill.castShadow = true; hill.receiveShadow = true; scene.add(hill); }
  [['medkit', -22, 20], ['ammo', 22, 14], ['armor', 14, -30], ['boost', -42, 30], ['backpack', 40, 24], ['rare', -64, -20], ['epic', 54, 38], ['ammo', -8, 52], ['medkit', 64, -54], ['armor', -58, -60], ['boost', 18, 52], ['backpack', 8, -62]].forEach(([t, x, z]) => addLoot(t, x, z));
}

function createPlayer() {
  const model = createHumanoidModel(player.group, 0x315c48);
  player.limbs = model.limbs;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; player.group.add(shadow);
  player.group.position.copy(player.pos);
  scene.add(player.group);
}

function createRifle(parent, x, y, z) {
  const gun = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x202a2b, metalness: 0.72, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151a19, roughness: 0.78 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x514a36, roughness: 0.86 });
  const addBox = (width, height, depth, material, px, py, pz) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    part.position.set(px, py, pz);
    part.castShadow = true;
    gun.add(part);
    return part;
  };

  addBox(0.2, 0.2, 0.48, metal, 0, 0, 0);
  addBox(0.24, 0.11, 0.26, dark, 0, 0.13, 0.04);
  addBox(0.18, 0.16, 0.3, polymer, 0, 0, -0.36);
  addBox(0.17, 0.29, 0.13, dark, 0, -0.2, 0.02);
  addBox(0.12, 0.2, 0.14, polymer, 0, -0.18, -0.08);
  addBox(0.16, 0.14, 0.44, polymer, 0, 0, 0.43);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.54, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, 0.77);
  barrel.castShadow = true;
  gun.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.13, 10), dark);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.01, 1.09);
  gun.add(muzzle);
  addBox(0.1, 0.17, 0.14, dark, 0, 0.18, 0.02);
  addBox(0.23, 0.045, 0.18, metal, 0, 0.28, 0.02);
  gun.position.set(x, y, z);
  parent.add(gun);
  return gun;
}

function createHumanoidModel(parent, uniformColor) {
  const uniform = new THREE.MeshStandardMaterial({ color: uniformColor, roughness: 0.82 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x4b5143, roughness: 0.92 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98262, roughness: 0.95 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0x343e35, roughness: 0.78 });
  const limbs = [];
  const addMesh = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  addMesh(new THREE.CapsuleGeometry(0.38, 0.75, 6, 12), uniform, 0, 1.52, 0);
  addMesh(new THREE.BoxGeometry(0.67, 0.62, 0.34), vest, 0, 1.58, 0.13);
  addMesh(new THREE.BoxGeometry(0.19, 0.31, 0.08), darkenMaterial(vest.color, 0.18), 0, 1.42, 0.32);
  addMesh(new THREE.SphereGeometry(0.28, 12, 10), skin, 0, 2.27, 0.02);
  addMesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), helmet, 0, 2.42, -0.015);
  addMesh(new THREE.BoxGeometry(0.55, 0.09, 0.36), helmet, 0, 2.35, 0.07);

  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.43, 1.88, 0.1);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.4, 5, 8), uniform);
    upper.position.y = -0.28;
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.35, 5, 8), vest);
    forearm.position.set(0, -0.61, 0.13);
    arm.add(upper, forearm);
    arm.traverse(part => { if (part.isMesh) part.castShadow = true; });
    parent.add(arm);
    limbs.push(arm);

    const leg = new THREE.Group();
    leg.position.set(side * 0.2, 0.9, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.52, 5, 8), uniform);
    thigh.position.y = -0.32;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.42), darkenMaterial(uniform.color, 0.42));
    boot.position.set(0, -0.71, 0.08);
    leg.add(thigh, boot);
    leg.traverse(part => { if (part.isMesh) part.castShadow = true; });
    parent.add(leg);
    limbs.push(leg);
  }

  createRifle(parent, 0.25, 1.65, 0.31);
  return { limbs };
}

function darkenMaterial(color, amount) {
  return new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(1 - amount), roughness: 0.86 });
}

function createEnemy(x, z, color = 0x8bb76f) {
  const g = new THREE.Group();
  const model = createHumanoidModel(g, color);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x34ff7a }));
  bar.position.set(0, 3.1, 0); g.add(bar);
  g.position.set(x, 0, z); scene.add(g);
  world.enemies.push({ group: g, limbs: model.limbs, health: 100, maxHealth: 100, alive: true, attackCooldown: 0.6 + Math.random(), speed: 2.1 + Math.random() * 0.8, healthBar: bar });
}

function switchWeapon(index) {
  if (index < 0 || index >= player.weapons.length) return;
  player.weaponIndex = index; player.fireCooldown = 0; player.reloadTime = 0; uiUpdate();
}

function doReload() {
  const w = player.weapons[player.weaponIndex];
  if (w.ammo >= w.mag || w.reserve <= 0 || player.reloadTime > 0) return;
  player.reloadTime = w.reload;
  showToast(`Reloading ${w.name}`);
}

function finishReload() {
  const w = player.weapons[player.weaponIndex];
  const need = w.mag - w.ammo;
  const load = Math.min(need, w.reserve);
  w.ammo += load; w.reserve -= load; uiUpdate();
}

function shoot() {
  const w = player.weapons[player.weaponIndex];
  if (player.reloadTime > 0 || player.fireCooldown > 0) return;
  if (w.ammo <= 0) { doReload(); return; }
  w.ammo -= 1; player.fireCooldown = w.fireRate; uiUpdate();

  const shootPos = player.group.localToWorld(new THREE.Vector3(0.25, 1.65, 1.42));
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd76d, transparent: true, opacity: 0.9 }));
  flash.position.copy(shootPos); scene.add(flash); world.particles.push({ mesh: flash, life: 0.12, maxLife: 0.12 });

  raycaster.setFromCamera(pointer, camera);
  raycaster.far = w.range;
  const targets = world.enemies.filter(e => e.alive).map(e => e.group);
  const hits = raycaster.intersectObjects(targets, true);
  let hitEnemy = null, hitPoint = null;
  for (const hit of hits) {
    const found = world.enemies.find(e => {
      let node = hit.object;
      while (node && node !== e.group) node = node.parent;
      return node === e.group;
    });
    if (found && found.alive) {
      hitEnemy = found;
      hitPoint = hit.point.clone();
      break;
    }
  }

  if (hitEnemy) {
    const headshot = hitPoint.y - hitEnemy.group.position.y > 2.12;
    const damage = w.damage * (headshot ? 2 : 1);
    hitEnemy.health -= damage;
    hitEnemy.healthBar.scale.x = clamp(hitEnemy.health / hitEnemy.maxHealth, 0, 1);
    hitEnemy.healthBar.material.color.set(hitEnemy.health > 35 ? 0x34ff7a : 0xff4d4d);
    const crosshair = document.getElementById('crosshair');
    crosshair.classList.add('hit');
    clearTimeout(shoot.hitTimer);
    shoot.hitTimer = setTimeout(() => crosshair.classList.remove('hit'), 130);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff6d5c, transparent: true, opacity: 0.9 }));
    spark.position.copy(hitPoint); scene.add(spark); world.particles.push({ mesh: spark, life: 0.1, maxLife: 0.1 });
    showToast(headshot ? `HEADSHOT - ${Math.round(damage)} damage` : `${Math.round(damage)} damage`);
    if (hitEnemy.health <= 0) {
      hitEnemy.alive = false;
      hitEnemy.group.visible = false;
      player.kills += 1;
      player.coins += 25;
      uiUpdate();
      showToast('Enemy eliminated +25 coins');
    }
  } else {
    const far = camera.position.clone().add(raycaster.ray.direction.clone().multiplyScalar(40));
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffe39a, transparent: true, opacity: 0.9 }));
    p.position.copy(far); scene.add(p); world.particles.push({ mesh: p, life: 0.08, maxLife: 0.08 });
  }
}

function showPickupPrompt(text) {
  if (!text) { hud.pickup.classList.remove('visible'); return; }
  hud.pickup.textContent = `Press E to pick up ${text}`;
  hud.pickup.classList.add('visible');
}

function handlePickup() {
  let closest = null;
  for (const item of world.loot) {
    if (item.collected) continue;
    const dx = item.mesh.position.x - player.pos.x; const dz = item.mesh.position.z - player.pos.z; const d = Math.hypot(dx, dz);
    if (d < 2.3 && (!closest || d < closest.d)) closest = { item, d };
  }
  if (!closest) return;
  const { item } = closest;
  showPickupPrompt(item.type);
  if (item.type === 'medkit') { player.loot.medkit += 1; player.hp = clamp(player.hp + 20, 0, player.maxHp); showToast('Medkit collected'); }
  else if (item.type === 'ammo') { player.loot.ammo += 1; player.weapons[0].reserve += 12; player.weapons[1].reserve += 20; showToast('Ammo stash collected'); }
  else if (item.type === 'armor') { player.loot.armor += 1; player.maxHp = 120; player.hp = clamp(player.hp + 25, 0, player.maxHp); showToast('Armor equipped'); }
  else if (item.type === 'boost') { player.loot.boost += 1; player.speedBoost = 1.35; showToast('Boost activated'); setTimeout(() => player.speedBoost = 1, 3000); }
  else if (item.type === 'backpack') { player.loot.backpack += 1; player.weapons[2].reserve += 12; showToast('Backpack secured'); }
  else if (item.type === 'rare') { player.loot.rare += 1; player.coins += 50; showToast('Rare loot found'); }
  else if (item.type === 'epic') { player.loot.epic += 1; player.coins += 120; showToast('Epic loot found'); }
  item.collected = true; scene.remove(item.mesh); renderInventory(); uiUpdate(); showPickupPrompt('');
}

function useMedkit() {
  if (player.loot.medkit <= 0 || player.hp >= player.maxHp) return;
  player.loot.medkit -= 1;
  player.hp = clamp(player.hp + 35, 0, player.maxHp);
  renderInventory();
  uiUpdate();
  showToast('Medkit used');
}

function updateNearbyPickupPrompt() {
  let nearest = null;
  for (const item of world.loot) {
    if (item.collected) continue;
    const distance = Math.hypot(item.mesh.position.x - player.pos.x, item.mesh.position.z - player.pos.z);
    if (distance < 2.3 && (!nearest || distance < nearest.distance)) nearest = { item, distance };
  }
  showPickupPrompt(nearest ? nearest.item.type : '');
}

function damagePlayer(amount) {
  player.hp = clamp(player.hp - amount, 0, player.maxHp);
  if (player.hp <= 0) showToast('You were eliminated');
  uiUpdate();
}

function updatePlayer(dt) {
  const moveX = clamp((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joystick.x, -1, 1);
  const moveZ = clamp((keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - joystick.y, -1, 1);
  const dirX = Math.sin(player.cameraYaw), dirZ = Math.cos(player.cameraYaw);
  const sideX = Math.cos(player.cameraYaw), sideZ = -Math.sin(player.cameraYaw);
  let dx = 0, dz = 0;
  if (moveZ !== 0) { dx += dirX * moveZ; dz += dirZ * moveZ; }
  if (moveX !== 0) { dx += sideX * moveX; dz += sideZ * moveX; }
  if (dx || dz) {
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const speed = (keys.Shift ? 8.5 : 4.8) * player.speedBoost;
    const nx = player.pos.x + dx * speed * dt; const nz = player.pos.z + dz * speed * dt;
    if (!collides(nx, player.pos.z, player.radius)) player.pos.x = nx;
    if (!collides(player.pos.x, nz, player.radius)) player.pos.z = nz;
    player.group.rotation.y = Math.atan2(dx, dz);
    player.walkPhase += dt * (keys.Shift ? 13 : 9);
  } else {
    player.walkPhase = 0;
  }
  if (player.jumpRequested && player.onGround) { player.jumpVel = 8.4; player.onGround = false; }
  player.jumpRequested = false;
  player.jumpVel -= 18 * dt; player.pos.y += player.jumpVel * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.jumpVel = 0; player.onGround = true; }
  player.group.position.copy(player.pos);
  player.limbs.forEach((limb, index) => {
    const phase = player.walkPhase + (index >= 2 ? Math.PI : 0);
    const swing = player.walkPhase ? Math.sin(phase) : 0;
    limb.rotation.x = index % 2 === 0 ? -0.85 + swing * 0.18 : swing * 0.48;
  });
  const cameraDistance = player.aiming ? 5.3 : 8;
  const camOffset = new THREE.Vector3(-Math.sin(player.cameraYaw) * cameraDistance, 4.8 + Math.sin(player.pitch) * 3.2, -Math.cos(player.cameraYaw) * cameraDistance);
  const targetPos = player.pos.clone().add(camOffset);
  camera.position.lerp(targetPos, 1 - Math.exp(-dt * 8));
  camera.fov = THREE.MathUtils.lerp(camera.fov, player.aiming ? 48 : 65, 1 - Math.exp(-dt * 10));
  camera.updateProjectionMatrix();
  camera.lookAt(player.pos.clone().add(new THREE.Vector3(Math.sin(player.cameraYaw) * 5, 1.7 + Math.sin(player.pitch) * 2, Math.cos(player.cameraYaw) * 5)));

  if (player.reloadTime > 0) {
    player.reloadTime -= dt;
    if (player.reloadTime <= 0) finishReload();
  }
  if (player.fireCooldown > 0) player.fireCooldown -= dt;
  if (player.firing) shoot();
  updateNearbyPickupPrompt();
}

function hasLineOfSight(from, to) {
  const distance = from.distanceTo(to);
  const steps = Math.ceil(distance / 1.5);
  for (let i = 1; i < steps; i++) {
    const point = from.clone().lerp(to, i / steps);
    if (world.colliders.some(b => Math.abs(point.x - b.x) < b.w / 2 && Math.abs(point.z - b.z) < b.d / 2 && point.y < b.h)) return false;
  }
  return true;
}

function enemyShoot(enemy, target) {
  const start = enemy.group.localToWorld(new THREE.Vector3(0.25, 1.65, 1.42));
  const aim = target.clone().add(new THREE.Vector3(0, 1.25, 0));
  const direction = aim.sub(start).normalize();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff8b52 }));
  mesh.position.copy(start);
  scene.add(mesh);
  world.hostileShots.push({ mesh, velocity: direction.multiplyScalar(34), life: 1.8, damage: 7 + Math.random() * 5 });
}

function updateEnemies(dt) {
  for (const e of world.enemies) {
    if (!e.alive) continue;
    const to = new THREE.Vector3(player.pos.x - e.group.position.x, 0, player.pos.z - e.group.position.z);
    const dist = to.length();
    if (dist > 0.1) {
      const dir = to.normalize();
      if (dist > 14) {
        const nx = e.group.position.x + dir.x * e.speed * dt; const nz = e.group.position.z + dir.z * e.speed * dt;
        if (!collides(nx, e.group.position.z, 0.7)) e.group.position.x = nx;
        if (!collides(e.group.position.x, nz, 0.7)) e.group.position.z = nz;
      }
      e.group.rotation.y = Math.atan2(dir.x, dir.z);
    }
    e.limbs.forEach((limb, index) => {
      const phase = world.time * 8 + (index >= 2 ? Math.PI : 0);
      const swing = dist > 14 ? Math.sin(phase) : 0;
      limb.rotation.x = index % 2 === 0 ? -0.85 + swing * 0.18 : swing * 0.42;
    });
    e.healthBar.lookAt(camera.position);
    const target = new THREE.Vector3(player.pos.x, 1.25, player.pos.z);
    const muzzle = e.group.localToWorld(new THREE.Vector3(0.25, 1.65, 1.42));
    if (dist < 38 && e.attackCooldown <= 0 && hasLineOfSight(muzzle, target)) {
      enemyShoot(e, player.pos);
      e.attackCooldown = 1.35 + Math.random() * 0.65;
    }
    e.attackCooldown = Math.max(0, e.attackCooldown - dt);
  }
}

function updateHostileShots(dt) {
  const playerTarget = new THREE.Vector3(player.pos.x, player.pos.y + 1.25, player.pos.z);
  for (let i = world.hostileShots.length - 1; i >= 0; i--) {
    const shot = world.hostileShots[i];
    shot.life -= dt;
    shot.mesh.position.addScaledVector(shot.velocity, dt);
    if (shot.mesh.position.distanceTo(playerTarget) < 0.85) {
      damagePlayer(shot.damage);
      scene.remove(shot.mesh);
      world.hostileShots.splice(i, 1);
    } else if (shot.life <= 0 || shot.mesh.position.distanceTo(player.group.position) > 45) {
      scene.remove(shot.mesh);
      world.hostileShots.splice(i, 1);
    }
  }
}

function updateSafeZone(dt) {
  const newRadius = Math.max(world.minRadius, 90 - world.time * 0.5);
  world.safeRadius = THREE.MathUtils.lerp(world.safeRadius, newRadius, 0.08);
  if (world.zoneRing) { world.zoneRing.scale.setScalar(world.safeRadius / 90); world.zoneRing.visible = true; }
  if (Math.hypot(player.pos.x, player.pos.z) > world.safeRadius) {
    world.zoneTimer += dt; if (world.zoneTimer > 0.7) { damagePlayer(7); world.zoneTimer = 0; }
  } else world.zoneTimer = 0;
}

function updateParticles(dt) {
  for (let i = world.particles.length - 1; i >= 0; i--) {
    const p = world.particles[i];
    p.life -= dt;
    p.mesh.material.opacity = clamp(p.life / p.maxLife, 0, 1);
    p.mesh.scale.setScalar(1 + (p.maxLife - p.life) * 18);
    if (p.life <= 0) { scene.remove(p.mesh); world.particles.splice(i, 1); }
  }
}

function drawMiniMap() {
  const ctx = document.getElementById('minimap').getContext('2d');
  const s = 180;
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(10, 16, 13, 0.8)'; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(150, 255, 165, 0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2); ctx.stroke();
  const zone = (world.safeRadius / 120) * (s * 0.42); ctx.strokeStyle = 'rgba(255, 214, 94, 0.9)'; ctx.beginPath(); ctx.arc(s / 2, s / 2, zone, 0, Math.PI * 2); ctx.stroke();
  for (const b of world.colliders) {
    const x = s / 2 + (b.x / 120) * (s * 0.42); const z = s / 2 + (b.z / 120) * (s * 0.42); const w = (b.w / 240) * (s * 0.84); const d = (b.d / 240) * (s * 0.84);
    ctx.fillStyle = 'rgba(173, 130, 96, 0.7)'; ctx.fillRect(x - w / 2, z - d / 2, w, d);
  }
  for (const item of world.loot) if (!item.collected) { const x = s / 2 + (item.mesh.position.x / 120) * (s * 0.42); const z = s / 2 + (item.mesh.position.z / 120) * (s * 0.42); ctx.fillStyle = item.type === 'epic' ? '#ffd166' : item.type === 'rare' ? '#c59bff' : '#7be0ff'; ctx.fillRect(x - 2, z - 2, 4, 4); }
  for (const e of world.enemies) if (e.alive) { const x = s / 2 + (e.group.position.x / 120) * (s * 0.42); const z = s / 2 + (e.group.position.z / 120) * (s * 0.42); ctx.fillStyle = '#ff5d5d'; ctx.fillRect(x - 2.5, z - 2.5, 5, 5); }
  const px = s / 2 + (player.pos.x / 120) * (s * 0.42); const pz = s / 2 + (player.pos.z / 120) * (s * 0.42); ctx.fillStyle = '#66ffb0'; ctx.fillRect(px - 3.5, pz - 3.5, 7, 7);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  world.time += dt;
  updatePlayer(dt);
  updateEnemies(dt);
  updateHostileShots(dt);
  updateSafeZone(dt);
  updateParticles(dt);
  drawMiniMap();
  uiUpdate();
  renderer.render(scene, camera);
}

function setupInput() {
  let joystickPointer = null;
  let lookPointer = null;
  let firePointer = null;
  let lookPosition = null;

  const rotateCamera = (dx, dy) => {
    player.cameraYaw -= dx * 0.0038;
    player.pitch = clamp(player.pitch - dy * 0.002, -1.1, 1.1);
  };

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') event.preventDefault();
    keys[event.code] = true;
    if (event.repeat) return;
    if (event.code === 'Space') player.jumpRequested = true;
    if (event.code === 'Digit1') switchWeapon(0);
    if (event.code === 'Digit2') switchWeapon(1);
    if (event.code === 'Digit3') switchWeapon(2);
    if (event.code === 'Digit4') switchWeapon(3);
    if (event.code === 'KeyR') doReload();
    if (event.code === 'KeyE') handlePickup();
    if (event.code === 'KeyH') useMedkit();
    if (event.code === 'KeyB' && player.loot.boost > 0) {
      player.loot.boost -= 1;
      player.speedBoost = 1.5;
      renderInventory();
      showToast('Boost burst engaged');
      setTimeout(() => player.speedBoost = 1, 2500);
    }
  });
  document.addEventListener('keyup', (event) => { keys[event.code] = false; });
  window.addEventListener('pointermove', (event) => {
    if (event.pointerId === joystickPointer) {
      const bounds = document.getElementById('moveJoystick').getBoundingClientRect();
      const radius = bounds.width * 0.31;
      const dx = event.clientX - (bounds.left + bounds.width / 2);
      const dy = event.clientY - (bounds.top + bounds.height / 2);
      const length = Math.hypot(dx, dy);
      const scale = length > radius ? radius / length : 1;
      const thumb = document.getElementById('joystickThumb');
      thumb.style.left = `calc(50% + ${dx * scale}px)`;
      thumb.style.top = `calc(50% + ${dy * scale}px)`;
      joystick.x = dx * scale / radius;
      joystick.y = dy * scale / radius;
      return;
    }
    if (event.pointerId === lookPointer && lookPosition) {
      rotateCamera(event.clientX - lookPosition.x, event.clientY - lookPosition.y);
      lookPosition = { x: event.clientX, y: event.clientY };
      pointer.set(0, 0);
      return;
    }
    if (event.pointerType === 'mouse') {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
      if (event.buttons === 2) rotateCamera(event.movementX, event.movementY);
    }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') {
      if (event.clientX > window.innerWidth * 0.48) {
        lookPointer = event.pointerId;
        lookPosition = { x: event.clientX, y: event.clientY };
        pointer.set(0, 0);
      }
      return;
    }
    if (event.button === 0) { player.firing = true; shoot(); }
    if (event.button === 2) {
      event.preventDefault();
      player.aiming = true;
    }
  });
  window.addEventListener('pointerup', (event) => {
    if (event.pointerId === joystickPointer) {
      joystickPointer = null;
      joystick.x = 0;
      joystick.y = 0;
      const thumb = document.getElementById('joystickThumb');
      thumb.style.left = '50%';
      thumb.style.top = '50%';
    }
    if (event.pointerId === lookPointer) {
      lookPointer = null;
      lookPosition = null;
    }
    if (event.pointerId === firePointer) {
      firePointer = null;
      player.firing = false;
    }
    if (event.pointerType === 'mouse' && event.button === 0) player.firing = false;
    if (event.pointerType === 'mouse' && event.button === 2) player.aiming = false;
  });
  window.addEventListener('pointercancel', () => {
    joystickPointer = null;
    lookPointer = null;
    firePointer = null;
    lookPosition = null;
    joystick.x = 0;
    joystick.y = 0;
    player.firing = false;
    player.aiming = false;
    document.getElementById('joystickThumb').style.left = '50%';
    document.getElementById('joystickThumb').style.top = '50%';
  });
  const joystickElement = document.getElementById('moveJoystick');
  joystickElement.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    joystickPointer = event.pointerId;
  });
  document.getElementById('fireButton').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    firePointer = event.pointerId;
    player.firing = true;
    shoot();
  });
  document.getElementById('fireButton').addEventListener('pointerup', () => { player.firing = false; });
  document.getElementById('fireButton').addEventListener('pointercancel', () => { player.firing = false; });
  document.getElementById('jumpButton').addEventListener('pointerdown', (event) => { event.preventDefault(); player.jumpRequested = true; });
  document.getElementById('reloadButton').addEventListener('pointerdown', (event) => { event.preventDefault(); doReload(); });
  document.getElementById('pickupButton').addEventListener('pointerdown', (event) => { event.preventDefault(); handlePickup(); });
  document.getElementById('healButton').addEventListener('pointerdown', (event) => { event.preventDefault(); useMedkit(); });
  document.getElementById('weaponButton').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    switchWeapon((player.weaponIndex + 1) % player.weapons.length);
  });
  document.getElementById('aimButton').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    player.aiming = !player.aiming;
    event.currentTarget.classList.toggle('active', player.aiming);
  });
  hud.toggle.addEventListener('click', () => setInventoryVisible(true));
  hud.close.addEventListener('click', () => setInventoryVisible(false));
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
}

function init() {
  buildWorld();
  createPlayer();
  createEnemy(-18, -38, 0x9abf7d);
  createEnemy(24, -20, 0x8ea584);
  createEnemy(-42, 24, 0xc68c6b);
  createEnemy(52, 28, 0x93a7b7);
  createEnemy(-52, -54, 0x7b9fa2);
  createEnemy(14, 54, 0x8d8278);
  createEnemy(64, -6, 0x7fa57f);
  createEnemy(-66, 62, 0x7c9d5d);
  player.pos.set(0, 0, 18); player.group.position.copy(player.pos); camera.position.set(0, 4.2, 10); camera.lookAt(0, 1.5, 12);
  renderInventory(); uiUpdate(); setupInput(); animate();
}

init();
