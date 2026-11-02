// The scene's durations in one place; the stylesheets repeat them, and a test holds the two together.
export const TIMING = {
  fadeMs: 400,
  drawMs: 700,
  leaveMs: 200,
  riseMs: 300,
  // A timed advance waits for the scene to start moving; a click shows its caption at once.
  riseAfterTimedMs: 450,
  riseAfterClickMs: 80,
  // After the hand-over, the old caption layer is dropped from the page.
  settleSlackMs: 100,
};

export const HAND_OVER_MS = TIMING.riseAfterTimedMs + TIMING.riseMs + TIMING.settleSlackMs;
