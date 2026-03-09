const MOVE_HOLD_TIME = 0.16;
const TURN_HOLD_TIME = 0.055;
const MOVE_OPPOSITE_SUPPRESS_TIME = 0.09;
const TURN_OPPOSITE_SUPPRESS_TIME = 0.07;
const HANGUL_KEY_PATTERN = /[ㄱ-ㅎㅏ-ㅣ가-힣ᄀ-ᇿ]/u;
const IME_WARNING_TIME = 3.0;

const KEY_ALIASES = new Map([
  ["W", "FORWARD"],
  ["UP", "FORWARD"],
  ["S", "BACKWARD"],
  ["DOWN", "BACKWARD"],
  ["A", "STRAFE_LEFT"],
  ["D", "STRAFE_RIGHT"],
  ["Q", "TURN_LEFT"],
  ["LEFT", "TURN_LEFT"],
  ["E", "TURN_RIGHT"],
  ["RIGHT", "TURN_RIGHT"],
  [" ", "FIRE"],
  ["SPACE", "FIRE"],
  ["ENTER", "FIRE"],
  ["KP_ENTER", "FIRE"],
  ["R", "RESTART"],
  ["X", "QUIT"],
  ["CTRL_C", "QUIT"],
  ["ESCAPE", "QUIT"]
]);

class InputTracker {
  constructor() {
    this.forwardUntil = 0;
    this.backwardUntil = 0;
    this.strafeLeftUntil = 0;
    this.strafeRightUntil = 0;
    this.turnLeftUntil = 0;
    this.turnRightUntil = 0;
    this.suppressUntil = {
      FORWARD: 0,
      BACKWARD: 0,
      STRAFE_LEFT: 0,
      STRAFE_RIGHT: 0,
      TURN_LEFT: 0,
      TURN_RIGHT: 0
    };
    this.fireQueued = false;
    this.restartQueued = false;
    this.quitQueued = false;
    this.imeWarningUntil = 0;
  }

  setAxis(direction, now, holdTime, suppressTime) {
    if ((this.suppressUntil[direction] ?? 0) > now) {
      return;
    }

    switch (direction) {
      case "FORWARD":
        this.suppressUntil.FORWARD = 0;
        if (this.backwardUntil > now) {
          this.suppressUntil.BACKWARD = now + suppressTime;
        }
        this.backwardUntil = 0;
        this.forwardUntil = now + holdTime;
        break;
      case "BACKWARD":
        this.suppressUntil.BACKWARD = 0;
        if (this.forwardUntil > now) {
          this.suppressUntil.FORWARD = now + suppressTime;
        }
        this.forwardUntil = 0;
        this.backwardUntil = now + holdTime;
        break;
      case "STRAFE_LEFT":
        this.suppressUntil.STRAFE_LEFT = 0;
        if (this.strafeRightUntil > now) {
          this.suppressUntil.STRAFE_RIGHT = now + suppressTime;
        }
        this.strafeRightUntil = 0;
        this.strafeLeftUntil = now + holdTime;
        break;
      case "STRAFE_RIGHT":
        this.suppressUntil.STRAFE_RIGHT = 0;
        if (this.strafeLeftUntil > now) {
          this.suppressUntil.STRAFE_LEFT = now + suppressTime;
        }
        this.strafeLeftUntil = 0;
        this.strafeRightUntil = now + holdTime;
        break;
      case "TURN_LEFT":
        this.suppressUntil.TURN_LEFT = 0;
        if (this.turnRightUntil > now) {
          this.suppressUntil.TURN_RIGHT = now + suppressTime;
        }
        this.turnRightUntil = 0;
        this.turnLeftUntil = now + holdTime;
        break;
      case "TURN_RIGHT":
        this.suppressUntil.TURN_RIGHT = 0;
        if (this.turnLeftUntil > now) {
          this.suppressUntil.TURN_LEFT = now + suppressTime;
        }
        this.turnLeftUntil = 0;
        this.turnRightUntil = now + holdTime;
        break;
      default:
        break;
    }
  }

  feedKey(name, now = performance.now() / 1000) {
    const normalized = String(name).toUpperCase();
    if (HANGUL_KEY_PATTERN.test(normalized)) {
      this.imeWarningUntil = now + IME_WARNING_TIME;
      return;
    }

    const action = KEY_ALIASES.get(normalized);

    switch (action) {
      case "FORWARD":
        this.setAxis("FORWARD", now, MOVE_HOLD_TIME, MOVE_OPPOSITE_SUPPRESS_TIME);
        break;
      case "BACKWARD":
        this.setAxis("BACKWARD", now, MOVE_HOLD_TIME, MOVE_OPPOSITE_SUPPRESS_TIME);
        break;
      case "STRAFE_LEFT":
        this.setAxis("STRAFE_LEFT", now, MOVE_HOLD_TIME, MOVE_OPPOSITE_SUPPRESS_TIME);
        break;
      case "STRAFE_RIGHT":
        this.setAxis("STRAFE_RIGHT", now, MOVE_HOLD_TIME, MOVE_OPPOSITE_SUPPRESS_TIME);
        break;
      case "TURN_LEFT":
        this.setAxis("TURN_LEFT", now, TURN_HOLD_TIME, TURN_OPPOSITE_SUPPRESS_TIME);
        break;
      case "TURN_RIGHT":
        this.setAxis("TURN_RIGHT", now, TURN_HOLD_TIME, TURN_OPPOSITE_SUPPRESS_TIME);
        break;
      case "FIRE":
        this.fireQueued = true;
        break;
      case "RESTART":
        this.restartQueued = true;
        break;
      case "QUIT":
        this.quitQueued = true;
        break;
      default:
        break;
    }
  }

  snapshot(now = performance.now() / 1000) {
    for (const key of Object.keys(this.suppressUntil)) {
      if (this.suppressUntil[key] <= now) {
        this.suppressUntil[key] = 0;
      }
    }

    const input = {
      forward: Number(this.forwardUntil > now) - Number(this.backwardUntil > now),
      strafe: Number(this.strafeRightUntil > now) - Number(this.strafeLeftUntil > now),
      turn: Number(this.turnRightUntil > now) - Number(this.turnLeftUntil > now),
      fire: this.fireQueued,
      restart: this.restartQueued,
      quit: this.quitQueued,
      imeWarning: this.imeWarningUntil > now
    };

    this.fireQueued = false;
    this.restartQueued = false;
    this.quitQueued = false;
    return input;
  }

  reset() {
    this.forwardUntil = 0;
    this.backwardUntil = 0;
    this.strafeLeftUntil = 0;
    this.strafeRightUntil = 0;
    this.turnLeftUntil = 0;
    this.turnRightUntil = 0;
    this.fireQueued = false;
    this.restartQueued = false;
    this.quitQueued = false;
  }
}

function isHangulInput(name) {
  return HANGUL_KEY_PATTERN.test(String(name));
}

export { InputTracker, isHangulInput };
