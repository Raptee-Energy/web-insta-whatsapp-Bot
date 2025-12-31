import React, { useState } from 'react';
import { Send, ChevronRight, ChevronDown } from 'lucide-react';
import BlackSkullLogo from '../../assets/Black Skull.png';

// --- FAQ DATA ---
const FAQ_DATA = [
    { question: "What is the delivery time?", answer: "Typical delivery time is 4-6 weeks from order confirmation." },
    { question: "How much Range in single charge?", answer: "Raptee T30 offers up to 150km real-world range." },
    { question: "What is the warranty period?", answer: "3-year warranty on vehicle, 5-year on battery pack." }
];

// --- HELPER COMPONENTS ---
const MenuButton = ({ label, onClick }) => (
    <button
        className="w-full bg-gray-100 border-none rounded-lg px-4 py-3.5 mb-2 flex justify-between items-center cursor-pointer text-sm font-medium text-gray-800 hover:bg-gray-200 transition-colors"
        onClick={onClick}
    >
        <div className="flex items-center gap-2.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
            {label}
        </div>
        <ChevronRight size={16} className="text-gray-400" />
    </button>
);

const FaqItem = ({ question, answer, isExpanded, onToggle }) => (
    <div
        className="border-b border-gray-200 cursor-pointer"
        onClick={onToggle}
    >
        <div className="flex justify-between items-center py-3 text-sm font-medium text-gray-700">
            {question}
            {isExpanded ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
        </div>
        <div className={`text-xs text-gray-500 leading-relaxed overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-52 pb-3' : 'max-h-0'}`}>
            {answer}
        </div>
    </div>
);

// --- MAIN HOMEPAGE COMPONENT ---
const HomePage = ({ onStartChat, onOptionClick }) => {
    const [expandedFaq, setExpandedFaq] = useState(null);

    return (
        <div
            className="h-full flex flex-col bg-gray-50 relative overflow-y-auto pb-16 scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
            {/* Gradient Header Background */}
            <div
                className="absolute top-0 left-0 w-full h-[60%] z-0"
                style={{ background: 'linear-gradient(180deg, #169FA4 0%, #4DBFC3 60%, #F5F7F9 100%)' }}
            />

            {/* Content */}
            <div className="relative z-10 px-6 pt-10 flex flex-col min-h-full">
                {/* Brand Logo */}
                <div className="w-20 h-20 flex items-center justify-center mb-6">
                    <img
                        src={BlackSkullLogo}
                        alt="Raptee"
                        className="w-full object-contain brightness-0 invert opacity-100"
                    />
                </div>

                {/* Welcome Text */}
                <h1 className="text-white text-2xl font-bold leading-tight mb-8">
                    Hello, How can we<br />help you?
                </h1>

                {/* Menu Card */}
                <div className="bg-white rounded-2xl p-3 shadow-lg mb-6">
                    <MenuButton label="Book a Test Ride" onClick={() => onOptionClick('test_ride')} />
                    <MenuButton label="View Booking Status" onClick={() => onOptionClick('booking')} />
                    <MenuButton label="Nearby Charging Station" onClick={() => onOptionClick('chargers')} />

                    <button
                        className="w-full bg-teal-600 text-white border-none rounded-lg py-3.5 text-base font-bold flex justify-center items-center gap-2 cursor-pointer mt-2 hover:bg-teal-700 transition-colors"
                        onClick={onStartChat}
                    >
                        Start a Chat <Send size={18} fill="currentColor" />
                    </button>
                </div>

                {/* FAQ Section */}
                <div className="bg-white rounded-t-3xl p-6 shadow-sm -mx-6">
                    <h3 className="text-base font-bold mb-4 text-gray-900">FAQ's</h3>
                    {FAQ_DATA.map((faq, i) => (
                        <FaqItem
                            key={i}
                            {...faq}
                            isExpanded={expandedFaq === i}
                            onToggle={() => setExpandedFaq(expandedFaq === i ? null : i)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default HomePage;
