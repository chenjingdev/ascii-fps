const MAP_LAYOUT = [
  "################",
  "#..............#",
  "#..##....##....#",
  "#..............#",
  "#....#.........#",
  "#....#..##.....#",
  "#..............#",
  "#..##......#...#",
  "#..............#",
  "#......##......#",
  "#....#.........#",
  "#..............#",
  "#..#......##...#",
  "#..............#",
  "#..............#",
  "################"
];

const FOV = Math.PI / 3.2;
const MAX_DEPTH = 16.0;
const MOVE_SPEED = 3.4;
const STRAFE_SPEED = 2.8;
const TURN_SPEED = 0.9;
const TURN_SMOOTHING = 7.0;
const MOVE_SMOOTHING = 14.0;
const ENEMY_SPEED = 1.25;
const ENEMY_ATTACK_RANGE = 0.95;
const ENEMY_ATTACK_DAMAGE = 10;
const ENEMY_ATTACK_COOLDOWN = 0.9;
const SHOT_COOLDOWN = 0.24;
const MIN_WIDTH = 70;
const MIN_HEIGHT = 24;
const DEFAULT_ENEMY_COUNT = 10;
const MAX_ENEMY_COUNT = 18;
const OPEN_TILES = MAP_LAYOUT.flatMap((row, y) =>
  [...row].flatMap((cell, x) => (cell === "." ? [{ x: x + 0.5, y: y + 0.5 }] : []))
);

function smoothAxis(current, target, dt, smoothing) {
  if (current && target && Math.sign(current) !== Math.sign(target)) {
    current = 0;
  }
  const blend = Math.min(1, dt * smoothing);
  return current + (target - current) * blend;
}

function configuredEnemyCount() {
  const raw = Number.parseInt(process.env.DOOM_TUI_ENEMIES ?? `${DEFAULT_ENEMY_COUNT}`, 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_ENEMY_COUNT;
  }
  return Math.max(1, Math.min(MAX_ENEMY_COUNT, raw));
}

function pullRandom(pool, random) {
  const index = Math.floor(random() * pool.length);
  return pool.splice(index, 1)[0];
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function selectPlayerSpawn(random = Math.random, preferred = null) {
  if (preferred) {
    return preferred;
  }

  const candidates = OPEN_TILES.filter((tile) => tile.x <= 8.5 && tile.y <= 8.5);
  const pool = candidates.length ? [...candidates] : [...OPEN_TILES];
  return pullRandom(pool, random);
}

function selectEnemySpawns(random = Math.random, playerSpawn, count, preferred = null) {
  if (preferred) {
    return preferred.slice(0, count);
  }

  let minimumDistance = 5.5;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pool = OPEN_TILES.filter((tile) => distance(tile, playerSpawn) >= minimumDistance);
    if (pool.length >= count) {
      const selected = [];
      for (let index = 0; index < count; index += 1) {
        selected.push(pullRandom(pool, random));
      }
      return selected;
    }
    minimumDistance -= 0.8;
  }

  const fallbackPool = OPEN_TILES.filter((tile) => tile.x !== playerSpawn.x || tile.y !== playerSpawn.y);
  const selected = [];
  for (let index = 0; index < Math.min(count, fallbackPool.length); index += 1) {
    selected.push(pullRandom(fallbackPool, random));
  }
  return selected;
}

function makeEnemies(random = Math.random, count = DEFAULT_ENEMY_COUNT, playerSpawn = null, preferredSpawns = null) {
  const positions = selectEnemySpawns(random, playerSpawn, count, preferredSpawns);
  const bossIndex = Math.floor(random() * positions.length);
  return positions.map((position, index) => {
    const maxHealth = index === bossIndex ? 5 : 1 + Math.floor(random() * 4);
    return {
      ...position,
      health: maxHealth,
      maxHealth,
      isBoss: index === bossIndex,
      attackCooldown: 0,
      jitter: random() * Math.PI * 2
    };
  });
}

function makePickups() {
  return [
    { x: 4.5, y: 3.5, kind: "ammo", value: 6, taken: false },
    { x: 7.5, y: 6.5, kind: "med", value: 20, taken: false },
    { x: 11.5, y: 8.5, kind: "ammo", value: 8, taken: false },
    { x: 3.5, y: 11.5, kind: "med", value: 15, taken: false }
  ];
}

function createGameState(random = Math.random, carry = {}) {
  const enemyCount = carry.enemyCount ?? configuredEnemyCount();
  const playerSpawn = selectPlayerSpawn(random, carry.playerSpawn ?? null);
  const enemies = makeEnemies(random, enemyCount, playerSpawn, carry.enemySpawns ?? null);
  return {
    playerX: playerSpawn.x,
    playerY: playerSpawn.y,
    angle: 0,
    enemyCount,
    health: 100,
    ammo: 18,
    kills: 0,
    totalEnemies: enemies.length,
    enemies,
    pickups: makePickups(),
    message: "Clear the floor.",
    messageTimer: 2.0,
    weaponFlash: 0,
    damageFlash: 0,
    damageShake: 0,
    damageDirection: null,
    shotCooldown: 0,
    walkCycle: 0,
    forwardVelocity: 0,
    strafeVelocity: 0,
    turnVelocity: 0,
    elapsed: 0,
    resultTime: null,
    bestClearTime: carry.bestClearTime ?? null,
    gameOver: false,
    victory: false
  };
}

function normalizeAngle(angle) {
  let next = angle;
  while (next < -Math.PI) {
    next += Math.PI * 2;
  }
  while (next > Math.PI) {
    next -= Math.PI * 2;
  }
  return next;
}

function hitDirection(state, sourceX, sourceY) {
  const angleToSource = Math.atan2(sourceY - state.playerY, sourceX - state.playerX);
  const relative = normalizeAngle(angleToSource - state.angle);

  if (relative >= -Math.PI / 4 && relative < Math.PI / 4) {
    return "front";
  }
  if (relative >= Math.PI / 4 && relative < (3 * Math.PI) / 4) {
    return "right";
  }
  if (relative <= -Math.PI / 4 && relative > -(3 * Math.PI) / 4) {
    return "left";
  }
  return "back";
}

function isWall(x, y) {
  if (x < 0 || y < 0) {
    return true;
  }
  const gridX = Math.floor(x);
  const gridY = Math.floor(y);
  if (gridY >= MAP_LAYOUT.length || gridX >= MAP_LAYOUT[0].length) {
    return true;
  }
  return MAP_LAYOUT[gridY][gridX] === "#";
}

function tryMove(state, deltaX, deltaY) {
  const nextX = state.playerX + deltaX;
  const nextY = state.playerY + deltaY;
  const radius = 0.18;
  let moved = false;

  if (deltaX && !isWall(nextX + Math.sign(deltaX) * radius, state.playerY)) {
    state.playerX = nextX;
    moved = true;
  }
  if (deltaY && !isWall(state.playerX, nextY + Math.sign(deltaY) * radius)) {
    state.playerY = nextY;
    moved = true;
  }
  return moved;
}

function castRay(originX, originY, angle, maxDepth = MAX_DEPTH) {
  let distance = 0;
  const step = 0.03;

  while (distance < maxDepth) {
    const testX = originX + Math.cos(angle) * distance;
    const testY = originY + Math.sin(angle) * distance;

    if (isWall(testX, testY)) {
      const tileX = testX - Math.floor(testX);
      const tileY = testY - Math.floor(testY);
      const edge = Math.min(tileX, tileY, 1 - tileX, 1 - tileY);
      return { distance, boundary: edge < 0.035 };
    }

    distance += step;
  }

  return { distance: maxDepth, boundary: false };
}

function hasLineOfSight(originX, originY, targetX, targetY) {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0) {
    return true;
  }

  const steps = Math.max(1, Math.floor(distance / 0.08));
  for (let step = 1; step < steps; step += 1) {
    const ratio = step / steps;
    const sampleX = originX + dx * ratio;
    const sampleY = originY + dy * ratio;
    if (isWall(sampleX, sampleY)) {
      return false;
    }
  }

  return true;
}

function pushMessage(state, text, ttl = 1.8) {
  state.message = text;
  state.messageTimer = ttl;
}

function play(sound, effect) {
  sound?.play(effect);
}

function collectPickups(state, sound) {
  for (const pickup of state.pickups) {
    if (pickup.taken) {
      continue;
    }
    if (Math.hypot(pickup.x - state.playerX, pickup.y - state.playerY) > 0.65) {
      continue;
    }
    pickup.taken = true;
    if (pickup.kind === "ammo") {
      state.ammo += pickup.value;
      play(sound, "pickupAmmo");
      pushMessage(state, `Ammo +${pickup.value}`);
    } else {
      const before = state.health;
      state.health = Math.min(100, state.health + pickup.value);
      play(sound, "pickupHealth");
      pushMessage(state, `Health +${state.health - before}`);
    }
  }
}

function shoot(state, sound) {
  if (state.gameOver || state.victory || state.shotCooldown > 0) {
    return;
  }
  if (state.ammo <= 0) {
    state.weaponFlash = 0.05;
    play(sound, "empty");
    pushMessage(state, "Click. Out of ammo.", 1.0);
    return;
  }

  state.ammo -= 1;
  state.shotCooldown = SHOT_COOLDOWN;
  state.weaponFlash = 0.09;
  play(sound, "shoot");

  let bestEnemy = null;
  let bestAngle = Number.POSITIVE_INFINITY;

  for (const enemy of state.enemies) {
    if (enemy.health <= 0) {
      continue;
    }
    const dx = enemy.x - state.playerX;
    const dy = enemy.y - state.playerY;
    const distance = Math.hypot(dx, dy);
    if (distance > 11.5) {
      continue;
    }
    const angle = Math.abs(normalizeAngle(Math.atan2(dy, dx) - state.angle));
    const aimWindow = 0.035 + 0.12 / Math.max(distance, 0.5);
    if (angle <= aimWindow && hasLineOfSight(state.playerX, state.playerY, enemy.x, enemy.y)) {
      if (angle < bestAngle) {
        bestAngle = angle;
        bestEnemy = enemy;
      }
    }
  }

  if (!bestEnemy) {
    pushMessage(state, "Shot missed.", 0.8);
    return;
  }

  bestEnemy.health -= 1;
  if (bestEnemy.health > 0) {
    pushMessage(state, "Hit.", 0.7);
    return;
  }

  state.kills += 1;
  play(sound, "enemyDown");
  pushMessage(state, `Demon down. ${state.kills}/${state.totalEnemies}`, 1.2);
  if (Math.random() < 0.35) {
    state.pickups.push({ x: bestEnemy.x, y: bestEnemy.y, kind: "ammo", value: 4, taken: false });
  }
  if (state.kills >= state.totalEnemies) {
    state.victory = true;
    state.resultTime = state.elapsed;
    state.bestClearTime = state.bestClearTime === null ? state.elapsed : Math.min(state.bestClearTime, state.elapsed);
    play(sound, "victory");
    pushMessage(state, "Floor clear. Press R to restart.", 9.0);
  }
}

function updateEnemies(state, dt, sound) {
  for (const enemy of state.enemies) {
    if (enemy.health <= 0) {
      continue;
    }

    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    const dx = state.playerX - enemy.x;
    const dy = state.playerY - enemy.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= ENEMY_ATTACK_RANGE && enemy.attackCooldown <= 0) {
      state.health = Math.max(0, state.health - ENEMY_ATTACK_DAMAGE);
      enemy.attackCooldown = ENEMY_ATTACK_COOLDOWN;
      state.damageFlash = 0.45;
      state.damageShake = 1.35;
      state.damageDirection = hitDirection(state, enemy.x, enemy.y);
      play(sound, "playerHurt");
      pushMessage(state, "You were hit.", 0.8);
      continue;
    }

    if (distance > 8.5 || !hasLineOfSight(enemy.x, enemy.y, state.playerX, state.playerY)) {
      continue;
    }

    const directionX = dx / Math.max(distance, 0.001);
    const directionY = dy / Math.max(distance, 0.001);
    const sideStep = Math.sin(state.elapsed * 1.7 + enemy.jitter) * 0.22;
    const moveX = (directionX - directionY * sideStep) * ENEMY_SPEED * dt;
    const moveY = (directionY + directionX * sideStep) * ENEMY_SPEED * dt;

    if (!isWall(enemy.x + moveX, enemy.y)) {
      enemy.x += moveX;
    }
    if (!isWall(enemy.x, enemy.y + moveY)) {
      enemy.y += moveY;
    }
  }
}

function updateGame(state, input, dt, sound) {
  if (input.restart && (state.gameOver || state.victory)) {
    return createGameState(Math.random, {
      bestClearTime: state.bestClearTime,
      enemyCount: state.enemyCount
    });
  }

  if (state.gameOver || state.victory) {
    return state;
  }

  state.elapsed += dt;
  state.shotCooldown = Math.max(0, state.shotCooldown - dt);
  state.weaponFlash = Math.max(0, state.weaponFlash - dt);
  state.damageFlash = Math.max(0, state.damageFlash - dt);
  state.damageShake = Math.max(0, state.damageShake - dt * 5.5);
  if (state.damageFlash <= 0) {
    state.damageDirection = null;
  }
  state.messageTimer = Math.max(0, state.messageTimer - dt);

  if (input.fire) {
    shoot(state, sound);
  }

  const turnTarget = input.turn * TURN_SPEED;
  state.turnVelocity = smoothAxis(state.turnVelocity, turnTarget, dt, TURN_SMOOTHING);
  if (Math.abs(state.turnVelocity) < 0.01 && turnTarget === 0) {
    state.turnVelocity = 0;
  }
  if (state.turnVelocity) {
    state.angle = normalizeAngle(state.angle + state.turnVelocity * dt);
  }

  const forwardTarget = input.forward * MOVE_SPEED;
  const strafeTarget = input.strafe * STRAFE_SPEED;
  state.forwardVelocity = smoothAxis(state.forwardVelocity, forwardTarget, dt, MOVE_SMOOTHING);
  state.strafeVelocity = smoothAxis(state.strafeVelocity, strafeTarget, dt, MOVE_SMOOTHING);
  if (Math.abs(state.forwardVelocity) < 0.02 && forwardTarget === 0) {
    state.forwardVelocity = 0;
  }
  if (Math.abs(state.strafeVelocity) < 0.02 && strafeTarget === 0) {
    state.strafeVelocity = 0;
  }

  let moveX = Math.cos(state.angle) * state.forwardVelocity * dt;
  let moveY = Math.sin(state.angle) * state.forwardVelocity * dt;
  moveX += Math.cos(state.angle + Math.PI / 2) * state.strafeVelocity * dt;
  moveY += Math.sin(state.angle + Math.PI / 2) * state.strafeVelocity * dt;

  if (moveX || moveY) {
    const speed = Math.hypot(state.forwardVelocity, state.strafeVelocity);
    const maxSpeed = Math.max(MOVE_SPEED, STRAFE_SPEED);
    const length = Math.hypot(moveX, moveY);
    const scale = Math.min(1, maxSpeed * dt / Math.max(length, 0.001));
    if (tryMove(state, moveX * scale, moveY * scale)) {
      state.walkCycle += dt * (5.5 + speed * 1.6);
    }
  }

  collectPickups(state, sound);
  updateEnemies(state, dt, sound);

  if (state.health <= 0) {
    state.health = 0;
    state.gameOver = true;
    state.resultTime = state.elapsed;
    play(sound, "death");
    pushMessage(state, "You died. Press R to restart.", 9.0);
  }

  return state;
}

export {
  ENEMY_ATTACK_COOLDOWN,
  FOV,
  MAP_LAYOUT,
  MAX_DEPTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  MAX_ENEMY_COUNT,
  configuredEnemyCount,
  createGameState,
  castRay,
  hitDirection,
  hasLineOfSight,
  isWall,
  normalizeAngle,
  updateGame
};
