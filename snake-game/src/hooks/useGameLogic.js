import { useState, useCallback, useRef } from 'react';

// Custom hook for snake game logic
const useGameLogic = () => {
  const [snake, setSnake] = useState([]);
  const [food, setFood] = useState({ x: 5, y: 5 });
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [direction, setDirection] = useState({ x: 0, y: 0 });
  const [speed, setSpeed] = useState(200); // ms per tick

  const updateDirection = useCallback((dir) => {
    setDirection(dir);
  }, []);

  const moveSnake = useCallback((deltaX, deltaY) => {
    const newHead = {
      x: snake[0].x + deltaX,
      y: snake[0].y + deltaY
    };

    // Wall collision
    if (newHead.x < 0 || newHead.x >= 20 || newHead.y < 0 || newHead.y >= 20) {
      setGameOver(true);
      return;
    }

    // Self collision (excluding tail which will move)
    if (snake.some((seg) => seg.x === newHead.x && seg.y === newHead.y)) {
      setGameOver(true);
      return;
    }

    const newSnake = [newHead, ...snake.slice(0, -1)];
    setSnake(newSnake);

    // Check food consumption
    if (newHead.x === food.x && newHead.y === food.y) {
      setScore(prev => prev + 1);
      const newFood = {
        x: Math.floor(Math.random() * 19) + 1,
        y: Math.floor(Math.random() * 19) + 1,
      };
      setFood(newFood);
    }
  }, [snake, food]);

  const resetGame = useCallback(() => {
    setSnake([{ x: 10, y: 10 }]);
    setFood({ x: 5, y: 5 });
    setGameOver(false);
    setScore(0);
    setDirection({ x: 0, y: 0 });
    setSpeed(200);
  }, []);

  return {
    snake,
    food,
    gameOver,
    score,
    direction,
    speed,
    updateDirection,
    moveSnake,
    resetGame
  };
};

export default useGameLogic;
