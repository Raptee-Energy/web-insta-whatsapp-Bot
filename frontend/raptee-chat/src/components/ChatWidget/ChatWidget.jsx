import React, { useState } from 'react';
import { X, MessageCircle, Home, MessageSquare } from 'lucide-react';
import HomePage from '../HomePage/HomePage';
import ChatPage from '../ChatPage/ChatPage';
import TestRideBooking from '../TestRideBooking/TestRideBooking';
import NearbyChargers from '../NearbyChargers/NearbyChargers';
import BookingStatus from '../BookingStatus/BookingStatus';

// --- MAIN WIDGET COMPONENT ---
const ChatWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'chat'
  const [homeMode, setHomeMode] = useState('home_menu');

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end font-['Conigen','Segoe_UI',Roboto,Helvetica,Arial,sans-serif]">
      {/* Chat Window */}
      <div
        className={`w-[420px] h-[650px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 ease-in-out origin-bottom-right absolute bottom-20 right-0 ${isOpen
          ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 scale-90 translate-y-5 pointer-events-none'
          }`}
      >
        <div className="flex-1 overflow-hidden relative flex flex-col">
          {/* HOME TAB */}
          {activeTab === 'home' && (
            <>
              {homeMode === 'home_menu' ? (
                <HomePage
                  onStartChat={() => setActiveTab('chat')}
                  onOptionClick={(m) => setHomeMode(m)}
                />
              ) : homeMode === 'test_ride' ? (
                <TestRideBooking
                  onBack={() => setHomeMode('home_menu')}
                  onClose={() => setIsOpen(false)}
                />
              ) : homeMode === 'chargers' ? (
                <NearbyChargers
                  onBack={() => setHomeMode('home_menu')}
                  onClose={() => setIsOpen(false)}
                />
              ) : homeMode === 'booking' ? (
                <BookingStatus
                  onBack={() => setHomeMode('home_menu')}
                  onClose={() => setIsOpen(false)}
                />
              ) : (
                <ChatPage
                  mode={homeMode}
                  onBack={() => setHomeMode('home_menu')}
                  onClose={() => setIsOpen(false)}
                />
              )}
            </>
          )}

          {/* CHAT TAB (AI Socket) */}
          {activeTab === 'chat' && (
            <ChatPage
              mode="ai_chat"
              onBack={() => setActiveTab('home')}
              onClose={() => setIsOpen(false)}
            />
          )}
        </div>

        {/* Bottom Nav */}
        <div className="absolute bottom-0 left-0 w-full h-[60px] bg-white flex border-t border-gray-100 z-50">
          <div
            className={`flex-1 flex flex-col items-center justify-center cursor-pointer transition-colors ${activeTab === 'home' ? 'text-teal-600' : 'text-gray-400'}`}
            onClick={() => setActiveTab('home')}
          >
            <Home size={22} />
            <span className="text-[11px] font-semibold mt-1">Home</span>
          </div>
          <div
            className={`flex-1 flex flex-col items-center justify-center cursor-pointer transition-colors ${activeTab === 'chat' ? 'text-teal-600' : 'text-gray-400'}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={22} />
            <span className="text-[11px] font-semibold mt-1">Chat</span>
          </div>
        </div>
      </div>

      {/* Launcher Button */}
      <button
        className="w-[60px] h-[60px] rounded-full bg-teal-600 text-white border-none shadow-lg cursor-pointer flex items-center justify-center transition-transform duration-200 mt-4 hover:scale-105 hover:bg-teal-700"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? <X size={28} /> : <MessageCircle size={28} />}
      </button>
    </div>
  );
};

export default ChatWidget;