// Game configuration constants

export const CONFIG = {
  GRID_SIZE: 20,           // 20x20 grid
  INITIAL_SNAKE: [{ x: 10, y: 10 }],
  INITIAL_FOOD: { x: 5, y: 5 },
  MOVE_SPEED_MS: 200,      // Base movement speed
  MIN_SPEED_MS: 100,       // Minimum possible speed
  MAX_SNAKE_LENGTH: 5,     // Max snake length before game over
  WINNING_SCORE: 10000,    // Score to win
};

export const DIRECTIONS = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};
