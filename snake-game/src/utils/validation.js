// Validation utilities for snake game

export const validatePosition = (x, y) => {
  // Valid grid coordinates (0-19 for both axes)
  return x >= 0 && x <= 19 && y >= 0 && y <= 19;
};

export const validateDirectionChange = (currentDir, newDir) => {
  // Prevent reversing direction directly (e.g., right -> left)
  const dirs = ['up', 'down', 'left', 'right'];
  if (dirs.indexOf(currentDir) !== -1 && dirs.indexOf(newDir) !== -1) {
    if (currentDir === 'up' && newDir === 'down') return false;
    if (currentDir === 'down' && newDir === 'up') return false;
    if (currentDir === 'left' && newDir === 'right') return false;
    if (currentDir === 'right' && newDir === 'left') return false;
  }
  return true;
};

export const getValidMoves = (snake) => {
  const moves = [];
  if (snake.length > 1) {
    // Can't go back to previous position
    const lastPos = snake[snake.length - 1];
    moves.push({ x: 0, y: -1 }); // up
    moves.push({ x: 0, y: 1 });   // down
    moves.push({ x: -1, y: 0 });  // left
    moves.push({ x: 1, y: 0 });   // right
  }
  return moves;
};
