import React from 'react';

const Food = ({ food }) => {
  return (
    <div
      className="food"
      style={{ left: `${food.x * 20}px`, top: `${food.y * 20}px` }}
      title="Food"
    >
      <svg viewBox="0 0 24 24" fill="#FF5733">
        <path d="M12 2L15.09 8H6l-9 8 9 8h9" />
      </svg>
    </div>
  );
};

export default Food;