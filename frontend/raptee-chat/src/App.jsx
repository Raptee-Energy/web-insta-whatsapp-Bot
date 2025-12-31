// src/App.jsx
import React from 'react';
import './App.css';
import ChatWidget from './components/ChatWidget/ChatWidget';

function App() {
  return (
    <div className="app-wrapper">
      <div className="page-container">
        <div className="header">
          {/* Grayscale emoji to match the monochrome theme */}
          {/* <span className="brand-icon" role="img" aria-label="motorcycle">
            🏍️
          </span> */}
          <h1>RAPTEE.HV</h1>
          {/* <p>
            Experience the T30. High-voltage performance meets intelligent design.
            <br />
            <strong>Use the assistant below to explore specs, pricing, and more.</strong>
          </p> */}
        </div>
      </div>
      
      {/* The Chat Widget Component */}
      <ChatWidget />
    </div>
  );
}

export default App;