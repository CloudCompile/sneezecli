import React from 'react';

const SnakeSnake = ({ snake, onMove }) => {
  return (
    <div className="snake-container">
      {snake.map((segment, index) => (
        <div
          key={index}
          className={`snake-segment ${index === 0 ? 'head' : 'body'}`}
          style={{ left: `${segment.x * 20}px`, top: `${segment.y * 20}px` }}
          title={`Segment ${index + 1}`}
        >
          <span className="snake-fill" style={{ width: '20px', height: '20px', backgroundColor: '#4CAF50' }}></span>
        </div>
      ))}
    </div>
  );
};

export default SnakeSnake;