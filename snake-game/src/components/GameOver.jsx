import React from 'react';

const GameOver = ({ score }) => {
  return (
    <div className="game-over-screen">
      <h2>Game Over!</h2>
      <p>Your Score: {score}</p>
      <button onClick={() => window.location.reload()}>Play Again</button>
    </div>
  );
};

export default GameOver;