import React from "react";

const LoadingScreen: React.FC<{ message?: string }> = ({ message = "Loading workspace..." }) => {
  return (
    <div className="login-page">
      <div className="glass-card login-card">
        <h2>{message}</h2>
      </div>
    </div>
  );
};

export default LoadingScreen;
