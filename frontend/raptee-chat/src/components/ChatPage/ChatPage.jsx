import React, { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';
import {
    Send,
    ArrowLeft,
    X,
    Menu,
    RotateCcw
} from 'lucide-react';
import RapteeHVLogo from '../../assets/RapteeHV Black.png';

// --- MARKDOWN PARSER ---
const parseMarkdown = (text) => {
    if (!text) return null;

    const lines = text.split('\n');
    const elements = [];
    let key = 0;
    let listItems = [];

    const flushList = () => {
        if (listItems.length > 0) {
            elements.push(
                <ul key={key++} className="my-2 ml-4 space-y-1">
                    {listItems.map((item, idx) => (
                        <li key={idx} className="text-sm flex items-start gap-2">
                            <span className="text-teal-600 mt-0.5">•</span>
                            <span>{parseInline(item)}</span>
                        </li>
                    ))}
                </ul>
            );
            listItems = [];
        }
    };

    const parseInline = (str) => {
        if (!str) return str;
        const result = [];
        let lastIndex = 0;
        const boldRegex = /\*\*(.+?)\*\*/g;
        let match;
        let idx = 0;

        while ((match = boldRegex.exec(str)) !== null) {
            if (match.index > lastIndex) {
                result.push(parseItalic(str.slice(lastIndex, match.index), idx++));
            }
            result.push(<strong key={`b${idx++}`} className="font-semibold">{match[1]}</strong>);
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < str.length) {
            result.push(parseItalic(str.slice(lastIndex), idx++));
        }
        return result.length > 0 ? result : str;
    };

    const parseItalic = (str, baseKey) => {
        if (!str || typeof str !== 'string') return str;
        const italicRegex = /\*([^*]+?)\*/g;
        const result = [];
        let lastIndex = 0;
        let match;
        let idx = 0;

        while ((match = italicRegex.exec(str)) !== null) {
            if (match.index > lastIndex) result.push(str.slice(lastIndex, match.index));
            result.push(<em key={`i${baseKey}_${idx++}`}>{match[1]}</em>);
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < str.length) result.push(str.slice(lastIndex));
        return result.length > 0 ? result : str;
    };

    lines.forEach((line) => {
        const trimmed = line.trim();

        if (!trimmed) { flushList(); elements.push(<div key={key++} className="h-2" />); return; }

        if (trimmed.startsWith('###')) {
            flushList();
            elements.push(<div key={key++} className="font-bold text-teal-700 mt-3 mb-1 text-sm">{parseInline(trimmed.replace(/^#+\s*/, ''))}</div>);
            return;
        }

        if (/^[-*]\s/.test(trimmed)) {
            listItems.push(trimmed.replace(/^[-*]\s*/, ''));
            return;
        }

        if (/^\d+\.\s/.test(trimmed)) {
            flushList();
            elements.push(
                <div key={key++} className="flex items-start gap-2 my-1">
                    <span className="text-teal-600 font-bold min-w-[20px]">{trimmed.match(/^\d+/)[0]}.</span>
                    <span className="text-sm">{parseInline(trimmed.replace(/^\d+\.\s*/, ''))}</span>
                </div>
            );
            return;
        }

        flushList();
        elements.push(<div key={key++} className="text-sm my-0.5">{parseInline(trimmed)}</div>);
    });

    flushList();
    return <div className="space-y-0.5">{elements}</div>;
};

// --- CONSTANTS ---
const API_BASE_URL = '';

const MAIN_MENU_OPTIONS = [
    { id: 'explore', label: 'Explore RapteeHV T30' },
    { id: 'book_t30', label: 'Book T30 Now' },
    { id: 'showroom', label: 'Get Showroom Locations' }
];

const SHOWROOM_LOCATIONS = [
    { id: 'chennai', label: 'Chennai', address: 'Raptee HQ, Chennai, Tamil Nadu' },
    { id: 'bangalore', label: 'Bangalore', address: 'Raptee Experience Center, Indiranagar' },
    { id: 'hyderabad', label: 'Hyderabad', address: 'Raptee Hub, Jubilee Hills' },
    { id: 'kochi', label: 'Kochi', address: 'Raptee Connect, MG Road' }
];

// --- MAIN CHATPAGE COMPONENT ---
const ChatPage = ({ mode, onBack, onClose }) => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [inputVisible, setInputVisible] = useState(true);
    const [snackbar, setSnackbar] = useState({ show: false, message: '' });
    const [handedOff, setHandedOff] = useState(false);

    // Support form state
    const [supportForm, setSupportForm] = useState({ name: '', email: '', issue: '' });
    const [showSupportForm, setShowSupportForm] = useState(false);
    const [submittingForm, setSubmittingForm] = useState(false);

    // Socket & API State
    const [session, setSession] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const socketRef = useRef(null);
    const messagesEndRef = useRef(null);

    // Auto Scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping, inputVisible]);

    useEffect(() => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }, []);

    // --- INITIALIZATION ---
    useEffect(() => {
        let isMounted = true;
        setInputVisible(true);

        if (mode === 'ai_chat') {
            const initSocket = async () => {
                setIsLoading(true);
                setMessages([]);
                setHandedOff(false);

                const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
                let storedSession = JSON.parse(localStorage.getItem('raptee_chat_session'));

                if (storedSession && storedSession.createdAt) {
                    const sessionAge = Date.now() - storedSession.createdAt;
                    if (sessionAge > SESSION_EXPIRY_MS) {
                        console.log('🔄 Session expired (24h+), creating new ticket...');
                        localStorage.removeItem('raptee_chat_session');
                        storedSession = null;
                    }
                }

                if (!storedSession) {
                    try {
                        const res = await fetch(`${API_BASE_URL}/api/chat/init`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({})
                        });
                        const data = await res.json();
                        if (data.success && isMounted) {
                            storedSession = {
                                sessionId: data.sessionId,
                                conversationId: data.conversationId,
                                contactId: data.contactId,
                                createdAt: Date.now()
                            };
                            localStorage.setItem('raptee_chat_session', JSON.stringify(storedSession));
                        }
                    } catch (err) {
                        console.error("Init Error", err);
                        if (isMounted) setIsLoading(false);
                        return;
                    }
                }
                if (isMounted && storedSession) setSession(storedSession);

                if (storedSession && storedSession.conversationId) {
                    try {
                        const histRes = await fetch(`${API_BASE_URL}/api/chat/messages/${storedSession.conversationId}`);
                        const histData = await histRes.json();
                        if (histData.success && histData.messages && isMounted) {
                            const historyMsgs = histData.messages.map(m => ({
                                type: m.type,
                                text: m.content
                            }));

                            // Check if last message indicates handoff
                            const lastMsg = historyMsgs[historyMsgs.length - 1];
                            if (lastMsg && lastMsg.text && lastMsg.text.includes("transferring you to a human agent")) {
                                setHandedOff(true);
                                setInputVisible(false);
                            }

                            setMessages([...historyMsgs, {
                                type: 'bot',
                                text: handedOff ? "An agent will be with you shortly." : (historyMsgs.length > 0 ? "What would you like to do next?" : "Hi there! I'm here to help you explore RapteeHV T30 Motorcycle."),
                                showMenu: !handedOff
                            }]);
                            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 300);
                        } else if (isMounted) {
                            setMessages([{
                                type: 'bot',
                                text: "Hi there! I'm here to help you explore RapteeHV T30 Motorcycle.",
                                showMenu: true
                            }]);
                            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 300);
                        }
                    } catch (e) { console.error("History Error", e); }

                    if (isMounted) connectSocket(storedSession.conversationId);
                }
            };
            initSocket();
        }

        return () => {
            isMounted = false;
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [mode]);

    const connectSocket = (conversationId) => {
        if (socketRef.current && socketRef.current.connected) return;

        const socketUrl = window.location.origin;
        const newSocket = io(socketUrl, { transports: ['websocket'], reconnection: true });
        socketRef.current = newSocket;

        newSocket.on("connect", () => {
            setIsLoading(false);
            newSocket.emit("join_conversation", conversationId);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 200);
        });

        newSocket.on("bot_typing", (status) => setIsTyping(status));

        newSocket.on("new_message", (msg) => {
            if (msg.type === 'bot') {
                setIsTyping(false);

                // Check if bot is requesting support form
                if (msg.showSupportForm) {
                    setShowSupportForm(true);
                }

                // Check if this is a handoff message
                if (msg.assistanceNeeded || (msg.content && msg.content.includes("transferring you to a human agent"))) {
                    setHandedOff(true);
                    setInputVisible(false);
                    setSnackbar({ show: true, message: "Connecting to agent..." });
                    setTimeout(() => setSnackbar({ show: false, message: '' }), 4000);
                }

                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.text === msg.content) return prev;
                    return [...prev, {
                        type: 'bot',
                        text: msg.content,
                        showMenuBtn: !handedOff && !msg.assistanceNeeded && !msg.showSupportForm
                    }];
                });
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
            }
        });
    };

    // Handle support form submission
    const handleSupportFormSubmit = async () => {
        if (!supportForm.name || !supportForm.email || !supportForm.issue) {
            setSnackbar({ show: true, message: "Please fill all fields" });
            setTimeout(() => setSnackbar({ show: false, message: '' }), 3000);
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(supportForm.email)) {
            setSnackbar({ show: true, message: "Please enter a valid email" });
            setTimeout(() => setSnackbar({ show: false, message: '' }), 3000);
            return;
        }

        setSubmittingForm(true);
        try {
            await fetch(`${API_BASE_URL}/api/support/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: session?.sessionId,
                    conversationId: session?.conversationId,
                    contactId: session?.contactId,
                    name: supportForm.name,
                    email: supportForm.email,
                    issue: supportForm.issue
                })
            });
            setShowSupportForm(false);
            setSupportForm({ name: '', email: '', issue: '' });
        } catch (e) {
            console.error("Support form error:", e);
            setSnackbar({ show: true, message: "Failed to submit. Please try again." });
            setTimeout(() => setSnackbar({ show: false, message: '' }), 3000);
        }
        setSubmittingForm(false);
    };

    // --- ACTIONS ---
    const handleMenuSelection = (id) => {
        if (handedOff) return;

        if (id === 'explore') {
            setMessages(prev => [...prev, { type: 'user', text: "Explore RapteeHV T30" }]);
            setTimeout(() => {
                setMessages(prev => [...prev, {
                    type: 'bot',
                    text: "I'm here to help! Ask me anything about the T30 features, specs, or performance.",
                    showMenuBtn: true
                }]);
            }, 600);
            if (socketRef.current) socketRef.current.emit("message", { text: "Context: User clicked Explore T30", sender: 'user', hidden: true });
        } else if (id === 'book_t30') {
            window.open('https://www.rapteehv.com/book-your-t30', '_blank');
        } else if (id === 'showroom') {
            setMessages(prev => [...prev, { type: 'user', text: "Get Showroom Locations" }]);
            setTimeout(() => {
                setMessages(prev => [...prev, {
                    type: 'bot',
                    text: "Select a city to view the showroom:",
                    showLocations: true,
                    showMenuBtn: true
                }]);
            }, 500);
        }
    };

    const handleShowMenu = () => {
        if (handedOff) return;
        setMessages(prev => [...prev, { type: 'bot', text: "Here are the options:", showMenu: true }]);
    };

    const handleLocationSelect = (loc) => {
        if (handedOff) return;

        setMessages(prev => [...prev, { type: 'user', text: loc.label }]);
        setTimeout(() => {
            setMessages(prev => [...prev, {
                type: 'bot',
                text: "",
                showMenuBtn: true,
                showroomCard: { title: loc.label, address: loc.address }
            }]);
        }, 600);
    };

    const handleBackInForm = () => {
        onBack();
    };

    const handleSend = async () => {
        if (!input.trim() || handedOff) return;

        const val = input.trim();
        setMessages(prev => [...prev, { type: 'user', text: val }]);
        setInput('');

        if (mode === 'ai_chat') {
            if (session && session.conversationId) {
                try {
                    await fetch(`${API_BASE_URL}/api/chat/message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sessionId: session.sessionId,
                            conversationId: session.conversationId,
                            message: val
                        })
                    });
                } catch (e) {
                    console.error("Send Error", e);
                }
            }
        }
    };

    // --- RENDER ---
    return (
        <div className="h-full flex flex-col bg-gray-50 pb-16 relative">
            {/* Header */}
            <div className="bg-white px-4 py-3 flex justify-between items-center border-b border-gray-100 sticky top-0 z-10">
                <button onClick={onBack} className="bg-transparent border-none cursor-pointer p-1">
                    <ArrowLeft size={24} className="text-gray-800" />
                </button>
                <img src={RapteeHVLogo} alt="RapteeHV" className="h-5 object-contain" />
                <button onClick={onClose} className="bg-transparent border-none cursor-pointer p-1">
                    <X size={24} className="text-gray-800" />
                </button>
            </div>

            {/* Snackbar */}
            {snackbar.show && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[90%] bg-gray-800 text-white px-3.5 py-2.5 rounded-lg flex items-center gap-2 shadow-xl z-50 text-sm animate-slideDown">
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    {snackbar.message}
                </div>
            )}

            {/* Handoff Banner */}
            {handedOff && (
                <div className="bg-teal-50 border-b border-teal-200 px-4 py-3 text-sm text-teal-800">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
                        <span className="font-medium">Connected to support team. An agent will respond shortly.</span>
                    </div>
                </div>
            )}

            {/* Body */}
            <div className="flex-1 bg-gray-50 p-4 overflow-y-auto flex flex-col gap-3 pt-4">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-2.5">
                        <div className="w-6 h-6 border-3 border-gray-200 border-t-teal-600 rounded-full animate-spin"></div>
                        <span>Connecting to Raptee Specialist...</span>
                    </div>
                ) : (
                    <>
                        <div className="text-center text-gray-400 text-xs mt-2.5 mb-2.5">Today</div>

                        {messages.map((msg, i) => {
                            // SPECIAL CARD RENDERING
                            if (msg.showroomCard) {
                                return (
                                    <div key={i} className="bg-white rounded-xl p-3 mt-2 border border-gray-200 shadow-md w-[90%]">
                                        <img
                                            src="https://lh3.googleusercontent.com/p/AF1QipN33lOhwm4UxCS156bvxaaHGX-TVkU_CPCLzlpV=s400-w400"
                                            alt="Raptee Showroom"
                                            className="w-full h-30 object-cover rounded-lg mb-2 bg-gray-100"
                                            onError={(e) => {
                                                e.target.style.background = 'linear-gradient(135deg, #169FA4 0%, #4DBFC3 100%)';
                                                e.target.style.display = 'flex';
                                                e.target.style.alignItems = 'center';
                                                e.target.style.justifyContent = 'center';
                                                e.target.style.color = 'white';
                                                e.target.style.fontSize = '14px';
                                                e.target.style.fontWeight = '600';
                                                e.target.innerHTML = 'Raptee Showroom';
                                                e.target.removeAttribute('src');
                                            }}
                                        />
                                        <div className="font-bold text-sm mb-1">{msg.showroomCard.title}</div>
                                        <div className="text-xs text-gray-500 mb-2">{msg.showroomCard.address}</div>
                                        <div className="flex gap-2">
                                            <button className="flex-1 py-2 px-3 rounded-md text-xs font-semibold bg-teal-600 text-white border-none cursor-pointer flex items-center justify-center gap-1">Navigate</button>
                                            <button className="flex-1 py-2 px-3 rounded-md text-xs font-semibold bg-teal-600 text-white border-none cursor-pointer flex items-center justify-center gap-1">Call</button>
                                        </div>
                                    </div>
                                );
                            }

                            // STANDARD MESSAGES
                            return (
                                <div key={i} className={`flex w-full mb-1 flex-col ${msg.type === 'user' ? 'items-end' : 'items-start'}`}>
                                    {msg.text && (
                                        <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-line w-fit ${msg.type === 'user'
                                            ? 'bg-teal-600 text-white rounded-br-sm'
                                            : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'
                                            }`}>
                                            {parseMarkdown(msg.text)}
                                        </div>
                                    )}

                                    {/* Chat Menu */}
                                    {msg.showMenu && !handedOff && (
                                        <div className="flex flex-col gap-2 w-[90%] mt-1">
                                            {MAIN_MENU_OPTIONS.map(opt => (
                                                <button
                                                    key={opt.id}
                                                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-left cursor-pointer text-sm font-medium text-gray-800 hover:border-teal-600 hover:text-teal-600 hover:bg-teal-50 transition-all shadow-sm"
                                                    onClick={() => handleMenuSelection(opt.id)}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* Location Chips */}
                                    {msg.showLocations && !handedOff && (
                                        <div className="flex flex-wrap gap-2 mt-2 w-[90%]">
                                            {SHOWROOM_LOCATIONS.map(loc => (
                                                <button
                                                    key={loc.id}
                                                    className="bg-white border border-teal-600 text-teal-600 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer hover:bg-teal-600 hover:text-white transition-all"
                                                    onClick={() => handleLocationSelect(loc)}
                                                >
                                                    {loc.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* Support Form (shown when bot requests it) */}
                                    {showSupportForm && i === messages.length - 1 && (
                                        <div className="bg-white rounded-xl p-4 mt-2 border border-gray-200 shadow-md w-[95%]">
                                            <div className="text-sm font-semibold text-gray-800 mb-3">Contact Support</div>
                                            <div className="flex flex-col gap-3">
                                                <input
                                                    type="text"
                                                    placeholder="Your Name"
                                                    value={supportForm.name}
                                                    onChange={(e) => setSupportForm(prev => ({ ...prev, name: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-teal-500"
                                                />
                                                <input
                                                    type="email"
                                                    placeholder="Your Email"
                                                    value={supportForm.email}
                                                    onChange={(e) => setSupportForm(prev => ({ ...prev, email: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-teal-500"
                                                />
                                                <textarea
                                                    placeholder="Describe your issue..."
                                                    value={supportForm.issue}
                                                    onChange={(e) => setSupportForm(prev => ({ ...prev, issue: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-teal-500 min-h-[60px] resize-none"
                                                    rows={3}
                                                />
                                                <button
                                                    onClick={handleSupportFormSubmit}
                                                    disabled={submittingForm}
                                                    className="w-full bg-teal-600 text-white py-2.5 rounded-lg text-sm font-semibold cursor-pointer hover:bg-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {submittingForm ? 'Submitting...' : 'Submit Request'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* FOOTER ACTIONS */}
                                    <div className="flex gap-2 mt-2 pt-2 border-t border-gray-50 justify-start">
                                        {msg.showBack && (
                                            <button
                                                className="bg-gray-100 border-none cursor-pointer text-gray-500 px-3 py-1.5 rounded-md flex items-center justify-center gap-1 hover:bg-gray-200 hover:text-teal-600 transition-all text-[11px] font-semibold"
                                                onClick={handleBackInForm}
                                                title="Go Back"
                                            >
                                                <RotateCcw size={12} /> Edit
                                            </button>
                                        )}

                                        {msg.showMenuBtn && mode === 'ai_chat' && !handedOff && (
                                            <button
                                                className="bg-gray-100 border-none cursor-pointer text-gray-500 px-3 py-1.5 rounded-md flex items-center justify-center gap-1 hover:bg-gray-200 hover:text-teal-600 transition-all text-[11px] font-semibold"
                                                onClick={handleShowMenu}
                                                title="Show Menu"
                                            >
                                                <Menu size={12} /> Menu
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        {isTyping && (
                            <div className="flex w-full mb-1 flex-col items-start">
                                <div className="px-4 py-2.5 bg-white border border-gray-100 rounded-2xl rounded-bl-sm w-fit flex gap-1 items-center">
                                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '-0.32s' }}></div>
                                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '-0.16s' }}></div>
                                    <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </div>

            {/* Input */}
            {inputVisible && !handedOff && mode !== 'chargers' && (
                <div className="p-4 bg-transparent relative z-5">
                    <div className="relative bg-white rounded-full shadow-md">
                        <input
                            type="text"
                            placeholder="Type your message"
                            className="w-full border-none bg-transparent py-4 pl-5 pr-12 text-sm outline-none rounded-full box-border"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                            disabled={isLoading || handedOff}
                        />
                        <button
                            className="absolute right-2 top-1/2 -translate-y-1/2 bg-teal-600 border-none w-9 h-9 rounded-full text-white flex items-center justify-center cursor-pointer hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={handleSend}
                            disabled={isLoading || handedOff}
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatPage;