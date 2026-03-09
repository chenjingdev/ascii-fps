import test from "node:test";
import assert from "node:assert/strict";

import { createGameState, castRay, hasLineOfSight, hitDirection, updateGame } from "../src/game.js";
import { InputTracker } from "../src/input.js";
import { renderFrame, renderTitleScreen } from "../src/render.js";

const FIXED_PLAYER = { x: 2.5, y: 3.5 };
const FIXED_ENEMY_SPAWNS = [
  { x: 10.5, y: 3.5 },
  { x: 12.5, y: 6.5 },
  { x: 8.5, y: 8.5 },
  { x: 12.5, y: 11.5 },
  { x: 5.5, y: 13.5 },
  { x: 13.5, y: 14.5 },
  { x: 6.5, y: 4.5 },
  { x: 3.5, y: 8.5 },
  { x: 9.5, y: 13.5 },
  { x: 14.5, y: 4.5 }
];

function fixedState(random = () => 0.5) {
  return createGameState(random, {
    playerSpawn: FIXED_PLAYER,
    enemySpawns: FIXED_ENEMY_SPAWNS,
    enemyCount: FIXED_ENEMY_SPAWNS.length
  });
}

test("ray hits outer wall at expected distance", () => {
  const state = fixedState();
  const result = castRay(state.playerX, state.playerY, Math.PI);
  assert.equal(result.boundary, true);
  assert.ok(result.distance > 1.4);
  assert.ok(result.distance < 1.6);
});

test("line of sight is blocked by a wall", () => {
  assert.equal(hasLineOfSight(2.5, 3.5, 6.5, 5.5), false);
});

test("each round has exactly one 5 hp boss and no other 5 hp enemies", () => {
  const state = fixedState(() => 0.99);
  assert.equal(state.enemies.length, 10);
  const bosses = state.enemies.filter((enemy) => enemy.health === 5);
  assert.equal(bosses.length, 1);
  assert.equal(bosses[0].isBoss, true);
  assert.ok(state.enemies.every((enemy) => enemy.health >= 1 && enemy.health <= 5));
  assert.ok(state.enemies.filter((enemy) => !enemy.isBoss).every((enemy) => enemy.health <= 4));
});

test("single update can move and turn together", () => {
  const state = fixedState();
  updateGame(state, { forward: 1, strafe: 0, turn: -1, fire: false, restart: false }, 0.25);
  assert.ok(state.playerX > 2.5);
  assert.ok(state.angle < 0);
});

test("victory stores clear time and best time", () => {
  const state = fixedState(() => 0.5);
  state.totalEnemies = 1;
  state.kills = 0;
  state.elapsed = 12.34;
  state.enemies = [{ x: 5.5, y: 3.5, health: 1, maxHealth: 1, isBoss: false, attackCooldown: 0, jitter: 0 }];
  state.angle = 0;
  state.playerX = 2.5;
  state.playerY = 3.5;
  state.ammo = 10;
  updateGame(state, { forward: 0, strafe: 0, turn: 0, fire: true, restart: false }, 0.016, null);
  assert.equal(state.victory, true);
  assert.ok(state.resultTime >= 12.34);
  assert.equal(state.bestClearTime, state.resultTime);
});

test("movement smoothing bridges small input gaps", () => {
  const state = fixedState();
  updateGame(state, { forward: 1, strafe: 0, turn: 0, fire: false, restart: false }, 0.016);
  const afterPress = state.playerX;
  updateGame(state, { forward: 0, strafe: 0, turn: 0, fire: false, restart: false }, 0.016);
  assert.ok(state.playerX > afterPress);
});

test("monster hit triggers damage flash effect", () => {
  const state = fixedState();
  state.enemies = [{ x: 3.0, y: 3.5, health: 1, maxHealth: 1, isBoss: false, attackCooldown: 0, jitter: 0 }];
  updateGame(state, { forward: 0, strafe: 0, turn: 0, fire: false, restart: false }, 0.016, null);
  assert.ok(state.damageFlash > 0);
  assert.ok(state.damageShake > 0);
  assert.equal(state.damageDirection, "front");
});

test("hit direction is computed relative to player view", () => {
  const state = createGameState();
  state.playerX = 5;
  state.playerY = 5;
  state.angle = 0;
  assert.equal(hitDirection(state, 7, 5), "front");
  assert.equal(hitDirection(state, 5, 7), "right");
  assert.equal(hitDirection(state, 5, 3), "left");
  assert.equal(hitDirection(state, 3, 5), "back");
});

test("opposite turn input does not continue old direction first", () => {
  const state = fixedState();
  updateGame(state, { forward: 0, strafe: 0, turn: -1, fire: false, restart: false }, 0.05);
  const angleAfterLeft = state.angle;
  updateGame(state, { forward: 0, strafe: 0, turn: 1, fire: false, restart: false }, 0.05);
  assert.ok(state.angle >= angleAfterLeft);
});

test("new opposite input clears previous latched direction immediately", () => {
  const tracker = new InputTracker();
  tracker.feedKey("LEFT", 10);
  tracker.feedKey("RIGHT", 10.01);
  const snapshot = tracker.snapshot(10.011);
  assert.equal(snapshot.turn, 1);
});

test("stale opposite repeat is ignored briefly after direction swap", () => {
  const tracker = new InputTracker();
  tracker.feedKey("LEFT", 10);
  tracker.feedKey("RIGHT", 10.01);
  tracker.feedKey("LEFT", 10.015);
  const snapshot = tracker.snapshot(10.02);
  assert.equal(snapshot.turn, 1);
});

test("hangul warning remains active across repeated ime input", () => {
  const tracker = new InputTracker();
  tracker.feedKey("ㅁ", 10);
  tracker.feedKey("ㅇ", 10.01);
  tracker.feedKey("ㅁ", 10.08);
  const snapshot = tracker.snapshot(10.085);
  assert.equal(snapshot.strafe, 0);
  assert.equal(snapshot.imeWarning, true);
});

test("restart returns a fresh game state", () => {
  const state = fixedState();
  state.health = 0;
  state.gameOver = true;
  state.bestClearTime = 9.5;
  const restarted = updateGame(state, { forward: 0, strafe: 0, turn: 0, fire: false, restart: true }, 0.016);
  assert.equal(restarted.health, 100);
  assert.equal(restarted.gameOver, false);
  assert.equal(restarted.bestClearTime, 9.5);
});

test("timer does not advance after death", () => {
  const state = fixedState();
  state.gameOver = true;
  state.elapsed = 12.34;
  updateGame(state, { forward: 0, strafe: 0, turn: 0, fire: false, restart: false }, 1.5, null);
  assert.equal(state.elapsed, 12.34);
});

test("input tracker turns keypresses into latched axes", () => {
  const tracker = new InputTracker();
  tracker.feedKey("w", 10);
  tracker.feedKey("q", 10);
  const snapshot = tracker.snapshot(10.02);
  assert.equal(snapshot.forward, 1);
  assert.equal(snapshot.turn, -1);
});

test("input tracker understands terminal-kit key names", () => {
  const tracker = new InputTracker();
  tracker.feedKey("UP", 10);
  tracker.feedKey("SPACE", 10);
  const snapshot = tracker.snapshot(10.01);
  assert.equal(snapshot.forward, 1);
  assert.equal(snapshot.fire, true);
});

test("hangul input triggers warning instead of movement", () => {
  const tracker = new InputTracker();
  tracker.feedKey("ㅈ", 10);
  const snapshot = tracker.snapshot(10.01);
  assert.equal(snapshot.forward, 0);
  assert.equal(snapshot.strafe, 0);
  assert.equal(snapshot.turn, 0);
  assert.equal(snapshot.imeWarning, true);
});

test("input tracker reset clears latched movement", () => {
  const tracker = new InputTracker();
  tracker.feedKey("W", 10);
  tracker.feedKey("SPACE", 10);
  tracker.reset();
  const snapshot = tracker.snapshot(10.01);
  assert.equal(snapshot.forward, 0);
  assert.equal(snapshot.fire, false);
});

test("render frame includes ansi color codes and title", () => {
  const frame = renderFrame(fixedState(), 90, 30, 60);
  assert.match(frame, /\x1b\[H/);
  assert.match(frame, /DOOM-TUI/);
  assert.match(frame, /\x1b\[1;38;5;207m/);
});

test("render frame resets style before non-sky cells to avoid background bleed", () => {
  const frame = renderFrame(fixedState(), 90, 30, 60);
  assert.match(frame, /\x1b\[0m\x1b\[1;38;5;255m/);
});

test("title screen shows intro logo and bot count", () => {
  const frame = renderTitleScreen(90, 30, { enemyCount: 14, bestClearTime: null, imeWarning: false, phase: 0.5 });
  assert.match(frame, /RIP AND TEAR/);
  assert.match(frame, /Bots: 14/);
});

test("render frame shows end screen for victory", () => {
  const state = fixedState();
  state.victory = true;
  state.resultTime = 42.5;
  state.bestClearTime = 42.5;
  const frame = renderFrame(state, 90, 30, 60);
  assert.match(frame, /FLOOR CLEARED/);
  assert.match(frame, /Clear Time:/);
});

test("render frame shows hit overlay when damaged", () => {
  const state = fixedState();
  state.damageFlash = 0.4;
  state.damageShake = 1.2;
  state.damageDirection = "left";
  const frame = renderFrame(state, 90, 30, 60);
  assert.match(frame, /LEFT HIT/);
  assert.match(frame, /\x1b\[0m\x1b\[1;38;5;196m/);
});

test("render frame shows ime pause overlay", () => {
  const frame = renderFrame(fixedState(), 90, 30, 60, { imePaused: true });
  assert.match(frame, /INPUT PAUSED/);
  assert.match(frame, /Switch keyboard to English/);
});

test("game state randomizes player spawn when not fixed", () => {
  const state = createGameState(() => 0.95);
  assert.notDeepEqual({ x: state.playerX, y: state.playerY }, FIXED_PLAYER);
});
