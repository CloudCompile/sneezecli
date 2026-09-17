import React from 'react';

const ScoreDisplay = ({ score, onReset }) => {
  return (
    <div className="score-display">
      <span className="score-value">{score}</span>
      <button onClick={onReset}>Reset Game</button>
    </div>
  );
};

export default ScoreDisplay;