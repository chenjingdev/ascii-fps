import termkit from "terminal-kit";

import { InputTracker, isHangulInput } from "./input.js";
import { MAX_ENEMY_COUNT, configuredEnemyCount, createGameState, updateGame } from "./game.js";
import { renderFrame, renderTitleScreen } from "./render.js";

const { terminal: term } = termkit;
const INTRO_DURATION = 1.25;

function installTerminal() {
  term.fullscreen();
  term.hideCursor();
  term.grabInput();
}

function restoreTerminal() {
  term.styleReset();
  term.hideCursor(false);
  term.grabInput(false);
  term.fullscreen(false);
}

function main() {
  const { stdout } = process;

  if (!term.stdin.isTTY || !stdout.isTTY) {
    console.error("doom-tui requires an interactive terminal.");
    process.exit(1);
  }

  installTerminal();

  const input = new InputTracker();
  const app = {
    mode: "title",
    enemyCount: configuredEnemyCount(),
    bestClearTime: null,
    imeWarningUntil: 0
  };
  let state = null;
  let requestQuit = false;
  const titleStartedAt = performance.now() / 1000;
  let previous = performance.now() / 1000;
  let fps = 0;
  let closed = false;

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(loop);
    term.off("key", onKey);
    process.off("SIGINT", onExit);
    process.off("SIGTERM", onExit);
    process.off("uncaughtException", onCrash);
    process.off("exit", onExit);
    restoreTerminal();
  };

  const onExit = () => {
    cleanup();
  };

  const onCrash = (error) => {
    cleanup();
    console.error(error);
    process.exit(1);
  };

  const onKey = (name) => {
    const now = performance.now() / 1000;
    const normalized = String(name).toUpperCase();

    if (app.mode === "title") {
      if (isHangulInput(name)) {
        app.imeWarningUntil = now + 3;
        return;
      }

      if (normalized === "LEFT" || normalized === "A") {
        app.enemyCount = Math.max(1, app.enemyCount - 1);
        return;
      }
      if (normalized === "RIGHT" || normalized === "D") {
        app.enemyCount = Math.min(MAX_ENEMY_COUNT, app.enemyCount + 1);
        return;
      }
      if (normalized === "SPACE" || normalized === "ENTER" || normalized === "KP_ENTER") {
        state = createGameState(Math.random, {
          enemyCount: app.enemyCount,
          bestClearTime: app.bestClearTime
        });
        app.mode = "playing";
        return;
      }
      if (normalized === "X" || normalized === "ESCAPE" || normalized === "CTRL_C") {
        requestQuit = true;
      }
      return;
    }

    if (app.mode === "ime_pause") {
      if (isHangulInput(name)) {
        return;
      }

      if (normalized === "X" || normalized === "ESCAPE" || normalized === "CTRL_C") {
        requestQuit = true;
        return;
      }

      if (normalized === "ENTER" || normalized === "KP_ENTER" || normalized === "SPACE") {
        input.reset();
        app.mode = "playing";
      }
      return;
    }

    if (isHangulInput(name)) {
      input.reset();
      app.mode = "ime_pause";
      return;
    }

    input.feedKey(name, now);
  };

  term.on("key", onKey);
  process.on("SIGINT", onExit);
  process.on("SIGTERM", onExit);
  process.on("uncaughtException", onCrash);
  process.on("exit", onExit);

  const loop = setInterval(() => {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - previous);
    previous = now;
    fps = fps * 0.9 + 0.1 * (1 / Math.max(dt, 0.0001));

    if (requestQuit) {
      cleanup();
      process.exit(0);
      return;
    }

    if (app.mode === "title") {
      const frame = renderTitleScreen(term.width ?? 80, term.height ?? 24, {
        enemyCount: app.enemyCount,
        bestClearTime: app.bestClearTime,
        imeWarning: app.imeWarningUntil > now,
        phase: now - titleStartedAt
      });
      stdout.write(frame);
      return;
    }

    if (app.mode === "ime_pause") {
      const frame = renderFrame(
        state,
        term.width ?? 80,
        term.height ?? 24,
        fps,
        { imePaused: true }
      );
      stdout.write(frame);
      return;
    }

    const snapshot = input.snapshot(now);
    if (snapshot.quit) {
      cleanup();
      process.exit(0);
      return;
    }

    state = updateGame(state, snapshot, dt, null);
    app.bestClearTime = state.bestClearTime;
    const frame = renderFrame(
      state,
      term.width ?? 80,
      term.height ?? 24,
      fps,
      { imeWarning: snapshot.imeWarning }
    );
    stdout.write(frame);
  }, 16);
}

export { main };
