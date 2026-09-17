import React, { useState, useEffect, useRef } from 'react';
import SnakeSnake from './SnakeSnake';
import Food from './Food';
import { GameOver } from './GameOver';

function SnakeGame() {
  const [snake, setSnake] = useState([{ x: 10, y: 10 }]);
  const [food, setFood] = useState({ x: 5, y: 5 });
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);

  const gameAreaRef = useRef(null);

  const handleKeyDown = (e) => {
    if (gameOver) return;
    const { key } = e;
    switch (key) {
      case 'ArrowUp':
        moveUp();
        break;
      case 'ArrowDown':
        moveDown();
        break;
      case 'ArrowLeft':
        moveLeft();
        break;
      case 'ArrowRight':
        moveRight();
        break;
      default:
        break;
    }
  };

  function moveUp() {
    setSnake((prev) => {
      const newHead = { ...prev[0], y: prev[0].y - 1 };
      // Check collision with boundaries
      if (newHead.y < 0 || newHead.y >= 20) return prev;
      // Check collision with self
      if (snake.some((segment) => segment.x === newHead.x && segment.y === newHead.y)) {
        return prev;
      }
      return [...prev, newHead];
    });
  }

  function moveDown() {
    setSnake((prev) => {
      const newHead = { ...prev[0], y: prev[0].y + 1 };
      // Check collision with boundaries
      if (newHead.y >= 20) return prev;
      // Check collision with self
      if (snake.some((segment) => segment.x === newHead.x && segment.y === newHead.y)) {
        return prev;
      }
      return [...prev, newHead];
    });
  }

  function moveLeft() {
    setSnake((prev) => {
      const newHead = { ...prev[0], x: prev[0].x - 1 };
      // Check collision with boundaries
      if (newHead.x < 0) return prev;
      // Check collision with self
      if (snake.some((segment) => segment.x === newHead.x && segment.y === newHead.y)) {
        return prev;
      }
      return [...prev, newHead];
    });
  }

  function moveRight() {
    setSnake((prev) => {
      const newHead = { ...prev[0], x: prev[0].x + 1 };
      // Check collision with boundaries
      if (newHead.x >= 20) return prev;
      // Check collision with self
      if (snake.some((segment) => segment.x === newHead.x && segment.y === newHead.y)) {
        return prev;
      }
      return [...prev, newHead];
    });
  }

  const { key } = window?.keydown ? {} : null;

  useEffect(() => {
    if (!gameOver) {
      const interval = setInterval(() => {
        const head = snake[0];
        let newHead;
        switch (key) {
          case 'ArrowUp': newHead = { ...head, y: head.y - 1 }; break;
          case 'ArrowDown': newHead = { ...head, y: head.y + 1 }; break;
          case 'ArrowLeft': newHead = { ...head, x: head.x - 1 }; break;
          case 'ArrowRight': newHead = { ...head, x: head.x + 1 }; break;
          default: return;
        }
        // Wall collision
        if (newHead.x < 0 || newHead.x >= 20 || newHead.y < 0 || newHead.y >= 20) {
          setGameOver(true);
          return;
        }
        // Self collision
        if (snake.some((segment) => segment.x === newHead.x && segment.y === newHead.y)) {
          setGameOver(true);
          return;
        }
        setSnake(prev => [newHead, ...snake.slice(0, -1)]);
        if (newHead.x === food.x && newHead.y === food.y) {
          setScore(prevScore => prevScore + 1);
          const newFood = {
            x: Math.floor(Math.random() * 19) + 1,
            y: Math.floor(Math.random() * 19) + 1,
          };
          setFood(newFood);
        }
      }, 100);
    }
  }, [snake, food, gameOver, key]);

  return (
    <div ref={gameAreaRef} className="game-area">
      <SnakeSnake snake={snake} onMove={moveUp} onMoveDown={moveDown} onMoveLeft={moveLeft} onMoveRight={moveRight} />
      <Food food={food} />
      {gameOver && <GameOver score={score} />}
    </div>
  );
}

export default SnakeGame;