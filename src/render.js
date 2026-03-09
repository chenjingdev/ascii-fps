import { FOV, MAP_LAYOUT, MAX_DEPTH, MIN_HEIGHT, MIN_WIDTH, castRay, normalizeAngle } from "./game.js";

const RESET = "\x1b[0m";
const withReset = (style) => `${RESET}${style}`;

const STYLES = {
  default: RESET,
  sky: withReset("\x1b[38;5;153m\x1b[48;5;18m"),
  wallNear: withReset("\x1b[1;38;5;196m"),
  wallMid: withReset("\x1b[1;38;5;220m"),
  wallFar: withReset("\x1b[38;5;69m"),
  wallEdge: withReset("\x1b[1;38;5;255m"),
  floorNear: withReset("\x1b[38;5;45m"),
  floorFar: withReset("\x1b[38;5;24m"),
  damageSoft: withReset("\x1b[1;38;5;203m"),
  damageStrong: withReset("\x1b[1;38;5;196m"),
  enemyHp1: withReset("\x1b[1;38;5;224m"),
  enemyHp2: withReset("\x1b[1;38;5;217m"),
  enemyHp3: withReset("\x1b[1;38;5;210m"),
  enemyHp4: withReset("\x1b[1;38;5;203m"),
  enemyHp5: withReset("\x1b[1;38;5;196m"),
  pickupAmmo: withReset("\x1b[1;38;5;51m"),
  pickupHealth: withReset("\x1b[1;38;5;118m"),
  weapon: withReset("\x1b[1;38;5;220m"),
  weaponFlash: withReset("\x1b[1;38;5;196m"),
  crosshair: withReset("\x1b[1;38;5;15m"),
  title: withReset("\x1b[1;38;5;207m"),
  hudText: withReset("\x1b[38;5;255m"),
  hudAccent: withReset("\x1b[1;38;5;51m"),
  hudWarning: withReset("\x1b[1;38;5;196m"),
  hudGood: withReset("\x1b[1;38;5;118m"),
  loadingBar: withReset("\x1b[1;38;5;196m"),
  loadingTrack: withReset("\x1b[38;5;238m"),
  introMain: withReset("\x1b[1;38;5;196m"),
  introAccent: withReset("\x1b[1;38;5;208m"),
  introHint: withReset("\x1b[38;5;255m"),
  minimapBorder: withReset("\x1b[1;38;5;45m"),
  minimapWall: withReset("\x1b[1;38;5;196m"),
  minimapFloor: withReset("\x1b[38;5;24m"),
  minimapPlayer: withReset("\x1b[1;38;5;226m")
};

function blankBuffer(height, width) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => [" ", "default"])
  );
}

function put(buffer, y, x, char, style = "default") {
  if (y < 0 || y >= buffer.length || x < 0 || x >= buffer[0].length) {
    return;
  }
  buffer[y][x] = [char, style];
}

function drawText(buffer, y, x, text, style = "hudText") {
  if (y < 0 || y >= buffer.length) {
    return;
  }
  for (let index = 0; index < text.length; index += 1) {
    put(buffer, y, x + index, text[index], style);
  }
}

function drawMaskedText(buffer, y, x, text, style) {
  if (y < 0 || y >= buffer.length) {
    return;
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== " ") {
      put(buffer, y, x + index, char, style);
    }
  }
}

function wallShade(distance, boundary) {
  if (boundary) {
    return "|";
  }
  const shades = "@%#*+=-:.";
  const index = Math.min(shades.length - 1, Math.floor(distance / MAX_DEPTH * shades.length));
  return shades[index];
}

function wallStyle(distance, boundary) {
  if (boundary) {
    return "wallEdge";
  }
  if (distance < MAX_DEPTH * 0.28) {
    return "wallNear";
  }
  if (distance < MAX_DEPTH * 0.55) {
    return "wallMid";
  }
  return "wallFar";
}

function floorShade(y, viewHeight) {
  const shades = ".,-~:";
  const factor = (y / Math.max(viewHeight - 1, 1)) ** 1.6;
  const index = Math.min(shades.length - 1, Math.floor(factor * shades.length));
  return shades[index];
}

function floorStyle(y, viewHeight) {
  return y > viewHeight * 0.72 ? "floorNear" : "floorFar";
}

function damageOffset(state) {
  if (!state.damageFlash) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.trunc(Math.sin(state.elapsed * 70) * state.damageShake),
    y: Math.trunc(Math.cos(state.elapsed * 55) * state.damageShake)
  };
}

function enemyChar(relativeY, relativeX) {
  if (relativeY < 0.2) {
    return "O";
  }
  if (relativeY < 0.62) {
    return relativeX > 0.25 && relativeX < 0.75 ? "H" : "/";
  }
  if (relativeY < 0.9) {
    return relativeX > 0.35 && relativeX < 0.65 ? "M" : "!";
  }
  return relativeX < 0.5 ? "^" : "!";
}

function enemyStyle(enemy) {
  const health = Math.max(1, Math.min(5, enemy.health));
  return `enemyHp${health}`;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(2).padStart(5, "0")}`;
}

function renderScene(buffer, state, width, viewHeight) {
  const depthBuffer = Array(width).fill(MAX_DEPTH);
  const horizonJitter = Math.trunc(Math.sin(state.walkCycle) * 1.2);

  for (let column = 0; column < width; column += 1) {
    const rayAngle = state.angle - FOV / 2 + column / Math.max(width - 1, 1) * FOV;
    const { distance, boundary } = castRay(state.playerX, state.playerY, rayAngle);
    depthBuffer[column] = distance;
    const wallHeight = Math.trunc(viewHeight / Math.max(distance, 0.25));
    const ceiling = Math.max(0, Math.trunc(viewHeight / 2) - wallHeight + horizonJitter);
    const floor = Math.min(viewHeight - 1, viewHeight - ceiling);

    for (let y = 0; y < viewHeight; y += 1) {
      if (y < ceiling) {
        put(buffer, 1 + y, column, " ", "sky");
      } else if (y <= floor) {
        put(buffer, 1 + y, column, wallShade(distance, boundary), wallStyle(distance, boundary));
      } else {
        put(buffer, 1 + y, column, floorShade(y, viewHeight), floorStyle(y, viewHeight));
      }
    }
  }

  return depthBuffer;
}

function drawEnemies(buffer, state, depthBuffer, width, viewHeight) {
  const enemies = state.enemies
    .filter((enemy) => enemy.health > 0)
    .sort((left, right) =>
      Math.hypot(right.x - state.playerX, right.y - state.playerY) -
      Math.hypot(left.x - state.playerX, left.y - state.playerY)
    );

  for (const enemy of enemies) {
    const dx = enemy.x - state.playerX;
    const dy = enemy.y - state.playerY;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.3) {
      continue;
    }
    const angle = normalizeAngle(Math.atan2(dy, dx) - state.angle);
    if (Math.abs(angle) > FOV * 0.7) {
      continue;
    }

    const screenX = Math.trunc((angle + FOV / 2) / FOV * width);
    const spriteHeight = Math.max(3, Math.trunc(viewHeight / Math.max(distance, 0.45)));
    const spriteWidth = Math.max(2, Math.trunc(spriteHeight / 2));
    const top = Math.max(1, 1 + Math.trunc(viewHeight / 2) - Math.trunc(spriteHeight / 2));
    const left = screenX - Math.trunc(spriteWidth / 2);

    for (let spriteX = 0; spriteX < spriteWidth; spriteX += 1) {
      const column = left + spriteX;
      if (column < 0 || column >= width || distance >= depthBuffer[column]) {
        continue;
      }
      for (let spriteY = 0; spriteY < spriteHeight; spriteY += 1) {
        const row = top + spriteY;
        if (row < 1 || row >= 1 + viewHeight) {
          continue;
        }
        const char = enemyChar(spriteY / spriteHeight, spriteX / Math.max(spriteWidth - 1, 1));
        if (char !== " ") {
          put(buffer, row, column, char, enemyStyle(enemy));
        }
      }
    }
  }
}

function drawWeapon(buffer, state, width, viewHeight) {
  const weapon = [
    "      ||      ",
    state.weaponFlash > 0 ? "     /**\\     " : "     /==\\     ",
    "    /====\\    ",
    " __/======\\__ "
  ];
  const bobX = Math.trunc(Math.sin(state.walkCycle * 0.9) * 2);
  const bobY = Math.trunc(Math.abs(Math.cos(state.walkCycle * 0.7)) * 1.5);
  const shake = damageOffset(state);
  const startY = Math.max(1, viewHeight - weapon.length + bobY - 1);
  const startX = Math.max(0, Math.trunc(width / 2) - Math.trunc(weapon[0].length / 2) + bobX + shake.x);
  const style = state.weaponFlash > 0 ? "weaponFlash" : "weapon";
  weapon.forEach((line, offset) => drawMaskedText(buffer, startY + offset + shake.y, startX, line, style));
}

function drawMinimap(buffer, state, originX, originY) {
  const mapWidth = MAP_LAYOUT[0].length;
  const mapHeight = MAP_LAYOUT.length;
  drawText(buffer, originY - 1, originX, "+----------------+", "minimapBorder");

  for (let row = 0; row < mapHeight; row += 1) {
    put(buffer, originY + row, originX, "|", "minimapBorder");
    put(buffer, originY + row, originX + mapWidth + 1, "|", "minimapBorder");
    for (let col = 0; col < mapWidth; col += 1) {
      const char = MAP_LAYOUT[row][col] === "#" ? "#" : ".";
      put(buffer, originY + row, originX + 1 + col, char, char === "#" ? "minimapWall" : "minimapFloor");
    }
  }

  drawText(buffer, originY + mapHeight, originX, "+----------------+", "minimapBorder");

  for (const enemy of state.enemies) {
    if (enemy.health > 0) {
      put(
        buffer,
        originY + Math.trunc(enemy.y),
        originX + 1 + Math.trunc(enemy.x),
        enemy.isBoss ? "B" : "m",
        enemyStyle(enemy)
      );
    }
  }

  let facing = ">";
  if (state.angle >= -3 * Math.PI / 4 && state.angle < -Math.PI / 4) {
    facing = "^";
  } else if (state.angle >= Math.PI / 4 && state.angle < 3 * Math.PI / 4) {
    facing = "v";
  } else if (state.angle >= 3 * Math.PI / 4 || state.angle < -3 * Math.PI / 4) {
    facing = "<";
  }

  put(
    buffer,
    originY + Math.trunc(state.playerY),
    originX + 1 + Math.trunc(state.playerX),
    facing,
    "minimapPlayer"
  );
}

function encodeRows(buffer, width) {
  return buffer.map((row) => {
    let line = "";
    let currentStyle = "";
    for (let index = 0; index < width; index += 1) {
      const [char, style] = row[index];
      const styleCode = STYLES[style] ?? RESET;
      if (styleCode !== currentStyle) {
        line += styleCode;
        currentStyle = styleCode;
      }
      line += char;
    }
    return line + RESET;
  }).join("\n");
}

function drawIntroOverlay(buffer, width, height, progress) {
  if (progress >= 1) {
    return;
  }

  const logo = [
    "#####     #####    #####   ##   ##",
    "##   ##  ##   ##  ##   ##  ### ###",
    "##   ##  ##   ##  ##   ##  #######",
    "##   ##  ##   ##  ##   ##  ## # ##",
    "##   ##  ##   ##  ##   ##  ##   ##",
    "#####     #####    #####   ##   ##"
  ];
  const subtitle = "RIP AND TEAR";
  const hint = "No loading pause. Hell starts immediately.";
  const centerY = Math.max(3, Math.trunc(height / 2) - 6);
  const reveal = Math.min(1, progress / 0.85);

  logo.forEach((line, index) => {
    const local = Math.max(0, Math.min(1, (reveal - index * 0.08) / 0.45));
    if (local <= 0) {
      return;
    }
    const offset = Math.trunc((1 - local) * (index % 2 === 0 ? -18 : 18));
    const style = index < 2 ? "introMain" : "introAccent";
    const startX = Math.max(0, Math.trunc((width - line.length) / 2) + offset);
    drawMaskedText(buffer, centerY + index, startX, line, style);
  });

  if (progress > 0.3) {
    const subtitleX = Math.max(0, Math.trunc((width - subtitle.length) / 2));
    drawText(buffer, centerY + logo.length + 1, subtitleX, subtitle, "introAccent");
  }

  if (progress > 0.55) {
    const hintX = Math.max(0, Math.trunc((width - hint.length) / 2));
    drawText(buffer, centerY + logo.length + 3, hintX, hint, "introHint");
  }
}

function renderTitleScreen(width, height, options = {}) {
  const { enemyCount = 10, bestClearTime = null, imeWarning = false, phase = 0 } = options;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    const warning = `Resize terminal to at least ${MIN_WIDTH}x${MIN_HEIGHT}. Current ${width}x${height}.`;
    return `\x1b[H\x1b[2J${STYLES.hudWarning}${warning.padEnd(Math.max(width, warning.length))}${RESET}`;
  }

  const buffer = blankBuffer(height, width);
  drawIntroOverlay(buffer, width, height, 0.2 + ((Math.sin(phase * 3) + 1) / 2) * 0.8);

  const lines = [
    `Bots: ${String(enemyCount).padStart(2, "0")}`,
    "Left/Right or A/D to adjust",
    "Press Enter or Space to start",
    "Press X to quit",
    bestClearTime !== null ? `Best Time: ${formatTime(bestClearTime)}` : ""
  ].filter(Boolean);

  const centerY = Math.trunc(height / 2) + 7;
  lines.forEach((line, index) => {
    const x = Math.max(2, Math.trunc((width - line.length) / 2));
    const style = index === 0 ? "hudAccent" : "hudText";
    drawText(buffer, centerY + index * 2, x, line, style);
  });

  if (imeWarning) {
    const message = "Hangul input detected. Switch keyboard to English.";
    drawText(buffer, height - 2, Math.max(2, Math.trunc((width - message.length) / 2)), message.slice(0, width - 4), "hudWarning");
  }

  return `\x1b[H${encodeRows(buffer, width)}\x1b[0J${RESET}`;
}

function drawEndScreen(buffer, state, width, height) {
  const title = state.victory ? "FLOOR CLEARED" : "YOU DIED";
  const titleStyle = state.victory ? "hudGood" : "hudWarning";
  const resultLabel = state.victory ? "Clear Time" : "Survival Time";
  const resultTime = formatTime(state.resultTime ?? state.elapsed);
  const lines = [
    title,
    `${resultLabel}: ${resultTime}`,
    `Demons Down: ${state.kills}/${state.totalEnemies}`,
    state.victory && state.bestClearTime !== null ? `Best Time: ${formatTime(state.bestClearTime)}` : "",
    "Press R to restart",
    "Press X to quit"
  ].filter(Boolean);

  const contentWidth = Math.max(...lines.map((line) => line.length));
  const boxWidth = Math.min(width - 8, Math.max(32, contentWidth + 6));
  const boxHeight = lines.length + 2;
  const left = Math.max(2, Math.trunc((width - boxWidth) / 2));
  const top = Math.max(2, Math.trunc((height - boxHeight) / 2));

  drawText(buffer, top, left, `+${"-".repeat(boxWidth - 2)}+`, "hudAccent");
  for (let row = 1; row < boxHeight - 1; row += 1) {
    drawText(buffer, top + row, left, `|${" ".repeat(boxWidth - 2)}|`, "hudAccent");
  }
  drawText(buffer, top + boxHeight - 1, left, `+${"-".repeat(boxWidth - 2)}+`, "hudAccent");

  lines.forEach((line, index) => {
    const style = index === 0 ? titleStyle : index <= 2 ? "hudText" : "hudAccent";
    const x = left + Math.max(2, Math.trunc((boxWidth - line.length) / 2));
    drawText(buffer, top + 1 + index, x, line, style);
  });
}

function drawImePauseOverlay(buffer, width, height) {
  const lines = [
    "INPUT PAUSED",
    "Hangul keyboard detected.",
    "Switch keyboard to English.",
    "Press Enter to resume",
    "Press X to quit"
  ];
  const contentWidth = Math.max(...lines.map((line) => line.length));
  const boxWidth = Math.min(width - 8, Math.max(34, contentWidth + 6));
  const boxHeight = lines.length + 2;
  const left = Math.max(2, Math.trunc((width - boxWidth) / 2));
  const top = Math.max(2, Math.trunc((height - boxHeight) / 2));

  drawText(buffer, top, left, `+${"-".repeat(boxWidth - 2)}+`, "hudWarning");
  for (let row = 1; row < boxHeight - 1; row += 1) {
    drawText(buffer, top + row, left, `|${" ".repeat(boxWidth - 2)}|`, "hudWarning");
  }
  drawText(buffer, top + boxHeight - 1, left, `+${"-".repeat(boxWidth - 2)}+`, "hudWarning");

  lines.forEach((line, index) => {
    const style = index === 0 ? "hudWarning" : index <= 2 ? "hudText" : "hudAccent";
    const x = left + Math.max(2, Math.trunc((boxWidth - line.length) / 2));
    drawText(buffer, top + 1 + index, x, line, style);
  });
}

function drawDamageOverlay(buffer, width, height, intensity, direction) {
  if (intensity <= 0) {
    return;
  }

  const borderStyle = intensity > 0.22 ? "damageStrong" : "damageSoft";
  const edgeChar = intensity > 0.25 ? "!" : ".";
  const emphasize = direction ?? "front";

  const drawTop = emphasize === "front" || emphasize === "left" || emphasize === "right";
  const drawBottom = emphasize === "back" || emphasize === "left" || emphasize === "right";
  const drawLeft = emphasize === "left" || emphasize === "front" || emphasize === "back";
  const drawRight = emphasize === "right" || emphasize === "front" || emphasize === "back";

  for (let x = 0; x < width; x += 2) {
    if (drawTop) {
      put(buffer, 1, x, edgeChar, borderStyle);
      put(buffer, 2, x, edgeChar, borderStyle);
    }
    if (drawBottom) {
      put(buffer, height - 5, x, edgeChar, borderStyle);
      put(buffer, height - 6, x, edgeChar, borderStyle);
    }
  }

  for (let y = 2; y < height - 5; y += 2) {
    if (drawLeft) {
      put(buffer, y, 0, edgeChar, borderStyle);
      put(buffer, y, 1, edgeChar, borderStyle);
    }
    if (drawRight) {
      put(buffer, y, width - 1, edgeChar, borderStyle);
      put(buffer, y, width - 2, edgeChar, borderStyle);
    }
  }

  if (intensity > 0.18) {
    const warning = {
      front: "FRONT HIT",
      back: "REAR HIT",
      left: "LEFT HIT",
      right: "RIGHT HIT"
    }[emphasize] ?? "IMPACT";
    const startX = Math.max(2, Math.trunc((width - warning.length) / 2));
    drawText(buffer, 2, startX, warning, "damageStrong");
  }
}

function renderFrame(state, width, height, fps, options = {}) {
  const { imeWarning = false, imePaused = false } = options;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    const warning = `Resize terminal to at least ${MIN_WIDTH}x${MIN_HEIGHT}. Current ${width}x${height}.`;
    return `\x1b[H\x1b[2J${STYLES.hudWarning}${warning.padEnd(Math.max(width, warning.length))}${RESET}`;
  }

  const hudRows = 4;
  const viewHeight = height - hudRows;
  const buffer = blankBuffer(height, width);

  drawText(buffer, 0, 2, "DOOM-TUI", "title");
  drawText(buffer, 0, 11, " // ", "hudAccent");
  drawText(buffer, 0, 15, "node + terminal-kit", "hudText");

  const depthBuffer = renderScene(buffer, state, width, viewHeight - 1);
  drawEnemies(buffer, state, depthBuffer, width, viewHeight - 1);
  drawWeapon(buffer, state, width, viewHeight - 1);

  const shake = damageOffset(state);
  const centerY = 1 + Math.trunc((viewHeight - 1) / 2) + shake.y;
  const centerX = Math.trunc(width / 2) + shake.x;
  put(buffer, centerY, centerX, state.weaponFlash > 0 ? "*" : "+", state.weaponFlash > 0 ? "weaponFlash" : "crosshair");

  if (width >= 24) {
    drawMinimap(buffer, state, width - 19, 2);
  }

  drawText(buffer, height - 4, 0, "-".repeat(width), "hudAccent");

  const hpStyle = state.health >= 60 ? "hudGood" : state.health >= 30 ? "hudAccent" : "hudWarning";
  drawText(buffer, height - 3, 2, "HP ", "hudAccent");
  drawText(buffer, height - 3, 5, String(state.health).padStart(3, "0"), hpStyle);
  drawText(buffer, height - 3, 11, "AMMO ", "hudAccent");
  drawText(buffer, height - 3, 16, String(state.ammo).padStart(2, "0"), "pickupAmmo");
  drawText(buffer, height - 3, 22, "KILLS ", "hudAccent");
  drawText(buffer, height - 3, 28, `${state.kills}/${state.totalEnemies}`, "enemyHp4");
  drawText(buffer, height - 3, 36, "TIME ", "hudAccent");
  drawText(buffer, height - 3, 41, formatTime(state.elapsed), "hudText");
  drawText(buffer, height - 3, 50, "FPS ", "hudAccent");
  drawText(buffer, height - 3, 54, fps.toFixed(1).padStart(4, "0"), "hudText");

  drawText(
    buffer,
    height - 2,
    2,
    "W/S move  A/D strafe  Q/E turn  Arrows also work  SPACE fire  R restart  X quit",
    "hudText"
  );

  let status = state.messageTimer > 0 ? state.message : "Push deeper into the maze.";
  let statusStyle = "hudText";
  if (imeWarning) {
    status = "Hangul input detected. Switch keyboard to English.";
    statusStyle = "hudWarning";
  } else if (state.gameOver) {
    status = `You died after ${formatTime(state.resultTime ?? state.elapsed)}.`;
    statusStyle = "hudWarning";
  } else if (state.victory) {
    status = `All demons down in ${formatTime(state.resultTime ?? state.elapsed)}.`;
    statusStyle = "hudGood";
  } else if (status.toLowerCase().includes("ammo") || status.toLowerCase().includes("health")) {
    statusStyle = "hudAccent";
  }
  drawText(buffer, height - 1, 2, status.slice(0, width - 4), statusStyle);

  drawDamageOverlay(buffer, width, height, state.damageFlash, state.damageDirection);

  if (state.gameOver || state.victory) {
    drawEndScreen(buffer, state, width, height);
  }
  if (imePaused) {
    drawImePauseOverlay(buffer, width, height);
  }

  return `\x1b[H${encodeRows(buffer, width)}\x1b[0J${RESET}`;
}

export { renderFrame, renderTitleScreen };
