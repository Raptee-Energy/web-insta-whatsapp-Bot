import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Calendar, Clock, User, Phone, MapPin, Check, RefreshCw } from 'lucide-react';
import RapteeHVLogo from '../../assets/RapteeHV Black.png';

// Fixed values
const VEHICLE_ID = 'VH-1';
const DEALER_ID = 'DEA-0001';

const TestRideBooking = ({ onBack, onClose }) => {
    // Step: 0=confirm, 1=form, 2=slots, 3=otp, 4=success
    const [step, setStep] = useState(0);
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        rideType: 'Showroom',
        date: ''
    });
    const [slots, setSlots] = useState([]);
    const [selectedSlot, setSelectedSlot] = useState('');
    const [otp, setOtp] = useState('');
    const [otpTimer, setOtpTimer] = useState(120);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [bookingResult, setBookingResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // OTP Timer countdown
    useEffect(() => {
        let interval;
        if (step === 3 && otpTimer > 0) {
            interval = setInterval(() => setOtpTimer(t => t - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [step, otpTimer]);

    // Resend cooldown
    useEffect(() => {
        let interval;
        if (resendCooldown > 0) {
            interval = setInterval(() => setResendCooldown(c => c - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [resendCooldown]);

    const formatPhone = (phone) => {
        // Remove all non-digits
        let cleaned = phone.replace(/\D/g, '');
        // Remove leading 0 if present
        if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
        // Ensure 91 prefix
        if (!cleaned.startsWith('91')) cleaned = '91' + cleaned;
        return '+' + cleaned;
    };

    const checkSlotAvailability = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/testride/slots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    VehicleId: VEHICLE_ID,
                    DealerId: DEALER_ID,
                    RideType: formData.rideType,
                    PreferredDate: formData.date
                })
            });
            const data = await res.json();
            if (data.status && data.timeSlots?.length > 0) {
                setSlots(data.timeSlots);
                setSelectedSlot(data.timeSlots[0].time);
                setStep(2);
            } else {
                setError('No slots available for this date. Please try another date.');
            }
        } catch (e) {
            setError('Failed to check availability. Please try again.');
        }
        setLoading(false);
    };

    const sendOtp = async () => {
        setLoading(true);
        setError('');
        try {
            const phone = formatPhone(formData.phone);
            await fetch('/api/otp/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: phone })
            });
            setStep(3);
            setOtpTimer(120);
            setResendCooldown(30);
        } catch (e) {
            setError('Failed to send OTP. Please try again.');
        }
        setLoading(false);
    };

    const resendOtp = async () => {
        if (resendCooldown > 0) return;
        setLoading(true);
        try {
            const phone = formatPhone(formData.phone);
            await fetch('/api/otp/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: phone })
            });
            setOtpTimer(120);
            setResendCooldown(30);
            setError('');
        } catch (e) {
            setError('Failed to resend OTP.');
        }
        setLoading(false);
    };

    const validateAndBook = async () => {
        setLoading(true);
        setError('');
        try {
            const phone = formatPhone(formData.phone);

            // Validate OTP
            const validateRes = await fetch('/api/otp/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: phone, otp })
            });
            const validateData = await validateRes.json();

            if (!validateData.success) {
                setError('Invalid OTP. Please try again.');
                setLoading(false);
                return;
            }

            // Book test ride
            const bookRes = await fetch('/api/testride/book', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${validateData.token}`
                },
                body: JSON.stringify({
                    Name: formData.name,
                    Slot: selectedSlot,
                    RideType: formData.rideType,
                    VehicleId: VEHICLE_ID,
                    DealerId: DEALER_ID,
                    PreferredDate: formData.date
                })
            });
            const bookData = await bookRes.json();

            if (bookData.status) {
                setBookingResult(bookData.result);
                setStep(4);
            } else {
                setError(bookData.error || 'Booking failed. Please try again.');
            }
        } catch (e) {
            setError('Something went wrong. Please try again.');
        }
        setLoading(false);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const getTodayDate = () => {
        const today = new Date();
        today.setDate(today.getDate() + 1); // Minimum tomorrow
        return today.toISOString().split('T')[0];
    };

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

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>

                {/* Step 0: Confirmation */}
                {step === 0 && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                            <h2 className="text-lg font-bold text-gray-900 mb-2">Book a Test Ride</h2>
                            <p className="text-sm text-gray-600 mb-6">
                                Experience the Raptee T30 firsthand. Would you like to schedule a test ride?
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={onBack}
                                    className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-all"
                                >
                                    Maybe Later
                                </button>
                                <button
                                    onClick={() => setStep(1)}
                                    className="flex-1 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 transition-all"
                                >
                                    Yes, Book Now
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 1: Form */}
                {step === 1 && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <h2 className="text-base font-bold text-gray-900 mb-4">Enter Your Details</h2>

                            <div className="space-y-4">
                                {/* Name */}
                                <div>
                                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Full Name</label>
                                    <div className="relative">
                                        <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Enter your name"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-teal-500"
                                        />
                                    </div>
                                </div>

                                {/* Phone */}
                                <div>
                                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Phone Number</label>
                                    <div className="relative">
                                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="tel"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            placeholder="Enter 10-digit number"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-teal-500"
                                        />
                                    </div>
                                </div>

                                {/* Ride Type */}
                                <div>
                                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Ride Type</label>
                                    <div className="relative">
                                        <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <select
                                            value={formData.rideType}
                                            onChange={(e) => setFormData({ ...formData, rideType: e.target.value })}
                                            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-teal-500 bg-white appearance-none cursor-pointer"
                                        >
                                            <option value="Showroom">Showroom Visit</option>
                                            <option value="Doorstep">Doorstep Delivery</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Date */}
                                <div>
                                    <label className="text-xs font-medium text-gray-500 mb-1.5 block">Preferred Date</label>
                                    <div className="relative">
                                        <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                        <input
                                            type="date"
                                            value={formData.date}
                                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                            min={getTodayDate()}
                                            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-teal-500"
                                        />
                                    </div>
                                </div>
                            </div>

                            {error && <p className="text-red-500 text-xs mt-3">{error}</p>}

                            <button
                                onClick={checkSlotAvailability}
                                disabled={loading || !formData.name || !formData.phone || !formData.date}
                                className="w-full mt-5 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Checking Availability...' : 'Check Availability'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: Slot Selection */}
                {step === 2 && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <div className="text-center mb-4">
                                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Check size={24} className="text-green-600" />
                                </div>
                                <h2 className="text-base font-bold text-gray-900">Great news! Slots are available</h2>
                                <p className="text-sm text-gray-500 mt-1">{formatDate(formData.date)}</p>
                            </div>

                            <div className="space-y-2 mb-4">
                                {slots.map((slot, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setSelectedSlot(slot.time)}
                                        className={`w-full p-3 rounded-xl border text-left flex items-center gap-3 transition-all ${selectedSlot === slot.time
                                            ? 'border-teal-600 bg-teal-50'
                                            : 'border-gray-200 hover:border-gray-300'
                                            }`}
                                    >
                                        <Clock size={16} className={selectedSlot === slot.time ? 'text-teal-600' : 'text-gray-400'} />
                                        <p className={`text-sm font-medium ${selectedSlot === slot.time ? 'text-teal-700' : 'text-gray-700'}`}>
                                            {slot.time}
                                        </p>
                                    </button>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setStep(1)}
                                    className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50"
                                >
                                    Change Date
                                </button>
                                <button
                                    onClick={sendOtp}
                                    disabled={loading}
                                    className="flex-1 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-50"
                                >
                                    {loading ? 'Sending OTP...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 3: OTP Verification */}
                {step === 3 && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <h2 className="text-base font-bold text-gray-900 mb-2">Verify Your Number</h2>
                            <p className="text-sm text-gray-500 mb-4">
                                Enter the 4-digit OTP sent to {formatPhone(formData.phone)}
                            </p>

                            <input
                                type="text"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                placeholder="Enter OTP"
                                maxLength={4}
                                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-lg font-semibold tracking-widest focus:outline-none focus:border-teal-500"
                            />

                            <div className="flex justify-between items-center mt-3 text-xs">
                                <span className={otpTimer === 0 ? 'text-red-500 font-medium' : otpTimer <= 30 ? 'text-red-500' : 'text-gray-500'}>
                                    {otpTimer === 0 ? 'OTP Expired - Please resend' : `Expires in ${formatTime(otpTimer)}`}
                                </span>
                                <button
                                    onClick={resendOtp}
                                    disabled={resendCooldown > 0 || loading}
                                    className={`flex items-center gap-1 ${resendCooldown > 0 ? 'text-gray-400' : 'text-teal-600 hover:underline'}`}
                                >
                                    <RefreshCw size={12} />
                                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend OTP'}
                                </button>
                            </div>

                            {error && <p className="text-red-500 text-xs mt-3">{error}</p>}

                            <button
                                onClick={validateAndBook}
                                disabled={loading || otp.length !== 4 || otpTimer === 0}
                                className="w-full mt-5 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-50"
                            >
                                {loading ? 'Verifying...' : 'Verify & Book'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 4: Success */}
                {step === 4 && bookingResult && (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <div className="text-center mb-5">
                                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Check size={28} className="text-green-600" />
                                </div>
                                <h2 className="text-lg font-bold text-gray-900">Booking Confirmed!</h2>
                                <p className="text-sm text-gray-500 mt-1">Your test ride has been scheduled</p>
                            </div>

                            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                <div className="flex justify-between">
                                    <span className="text-xs text-gray-500">Booking ID</span>
                                    <span className="text-sm font-semibold text-teal-600">{bookingResult.TestRideId}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-xs text-gray-500">Name</span>
                                    <span className="text-sm font-medium">{bookingResult.TestRideDetails.User.Name}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-xs text-gray-500">Phone</span>
                                    <span className="text-sm font-medium">{bookingResult.TestRideDetails.User.PhoneNumber}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-xs text-gray-500">Date</span>
                                    <span className="text-sm font-medium">{formatDate(formData.date)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-xs text-gray-500">Time Slot</span>
                                    <span className="text-sm font-medium">{selectedSlot}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-xs text-gray-500">Type</span>
                                    <span className="text-sm font-medium">{formData.rideType}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-xs text-gray-500">Location</span>
                                    <span className="text-sm font-medium">{bookingResult.TestRideDetails.Dealer.DealerName}</span>
                                </div>
                            </div>

                            <p className="text-center text-xs text-gray-500 mt-4">
                                Our team will contact you shortly to confirm the details.
                            </p>

                            <button
                                onClick={onBack}
                                className="w-full mt-4 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TestRideBooking;
