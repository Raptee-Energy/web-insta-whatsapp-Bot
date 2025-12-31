import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Phone, Check, RefreshCw, Calendar, User, MapPin, CreditCard, Bike } from 'lucide-react';
import RapteeHVLogo from '../../assets/RapteeHV Black.png';

const BookingStatus = ({ onBack, onClose }) => {
    // Steps: 0=confirm, 1=phone, 2=otp, 3=results
    const [step, setStep] = useState(0);
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [otpTimer, setOtpTimer] = useState(120);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [jwtToken, setJwtToken] = useState('');

    // OTP Timer countdown
    useEffect(() => {
        let interval;
        if (step === 2 && otpTimer > 0) {
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

    const formatPhone = (p) => {
        let cleaned = p.replace(/\D/g, '');
        if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
        if (!cleaned.startsWith('91')) cleaned = '91' + cleaned;
        return '+' + cleaned;
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const sendOtp = async () => {
        if (!phone || phone.length < 10) {
            setError('Please enter a valid 10-digit phone number');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const formattedPhone = formatPhone(phone);
            await fetch('/api/otp/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: formattedPhone })
            });
            setStep(2);
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
            const formattedPhone = formatPhone(phone);
            await fetch('/api/otp/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: formattedPhone })
            });
            setOtpTimer(120);
            setResendCooldown(30);
            setError('');
        } catch (e) {
            setError('Failed to resend OTP.');
        }
        setLoading(false);
    };

    const validateAndFetchBookings = async () => {
        setLoading(true);
        setError('');
        try {
            const formattedPhone = formatPhone(phone);

            // Validate OTP
            const validateRes = await fetch('/api/otp/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber: formattedPhone, otp })
            });
            const validateData = await validateRes.json();

            if (!validateData.success) {
                setError('Invalid OTP. Please try again.');
                setLoading(false);
                return;
            }

            setJwtToken(validateData.token);

            // Fetch bookings
            const bookingsRes = await fetch('/api/bookings/my-bookings', {
                headers: { 'Authorization': `Bearer ${validateData.token}` }
            });
            const bookingsData = await bookingsRes.json();

            if (bookingsData.status && bookingsData.bookings?.length > 0) {
                setBookings(bookingsData.bookings);
                setStep(3);
            } else if (bookingsData.status && bookingsData.bookings?.length === 0) {
                setError('No bookings found for this phone number.');
            } else {
                setError(bookingsData.error || 'Failed to fetch bookings.');
            }
        } catch (e) {
            setError('Something went wrong. Please try again.');
        }
        setLoading(false);
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        return dateStr;
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
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                        <div className="text-center mb-4">
                            <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                <CreditCard size={28} className="text-teal-600" />
                            </div>
                            <h2 className="text-base font-bold text-gray-900">Check Booking Status</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                View the status of your T30 bookings
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={onBack}
                                className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => setStep(1)}
                                className="flex-1 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 1: Phone Input */}
                {step === 1 && (
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                        <h2 className="text-base font-bold text-gray-900 mb-2">Enter Your Phone</h2>
                        <p className="text-sm text-gray-500 mb-4">
                            Enter the phone number you used for booking
                        </p>

                        <div className="relative mb-4">
                            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="Enter 10-digit number"
                                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-teal-500"
                            />
                        </div>

                        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep(0)}
                                className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm"
                            >
                                Back
                            </button>
                            <button
                                onClick={sendOtp}
                                disabled={loading}
                                className="flex-1 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-50"
                            >
                                {loading ? 'Sending...' : 'Send OTP'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: OTP Verification */}
                {step === 2 && (
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                        <h2 className="text-base font-bold text-gray-900 mb-2">Verify Your Number</h2>
                        <p className="text-sm text-gray-500 mb-4">
                            Enter the 4-digit OTP sent to {formatPhone(phone)}
                        </p>

                        <input
                            type="text"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            placeholder="Enter OTP"
                            maxLength={4}
                            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-lg font-semibold tracking-widest focus:outline-none focus:border-teal-500 mb-3"
                        />

                        <div className="flex justify-between items-center text-xs mb-4">
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

                        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

                        <button
                            onClick={validateAndFetchBookings}
                            disabled={loading || otp.length !== 4 || otpTimer === 0}
                            className="w-full py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-50"
                        >
                            {loading ? 'Verifying...' : 'View Bookings'}
                        </button>
                    </div>
                )}

                {/* Step 3: Booking Results */}
                {step === 3 && (
                    <div className="space-y-3">
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                            <div className="flex items-center gap-2 mb-2">
                                <Check size={18} className="text-green-600" />
                                <span className="text-sm font-semibold text-gray-900">
                                    Found {bookings.length} booking{bookings.length > 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>

                        {bookings.map((booking, idx) => (
                            <div key={idx} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                                {/* Booking ID Header */}
                                <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
                                    <span className="text-xs text-gray-500">Booking ID</span>
                                    <span className="text-sm font-bold text-teal-600">{booking.BookingId}</span>
                                </div>

                                {/* Status Badge */}
                                <div className="mb-3">
                                    <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                                        {booking.BookingDetails?.Status}
                                    </span>
                                </div>

                                {/* Vehicle Details */}
                                <div className="flex items-start gap-2 mb-3">
                                    <Bike size={14} className="text-gray-400 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900">
                                            {booking.BookingDetails?.Vehicle?.ModelName}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            {booking.BookingDetails?.SelectedColor}
                                        </p>
                                    </div>
                                </div>

                                {/* User Details */}
                                <div className="flex items-start gap-2 mb-3">
                                    <User size={14} className="text-gray-400 mt-0.5" />
                                    <div>
                                        <p className="text-sm text-gray-700">{booking.BookingDetails?.User?.Name}</p>
                                        <p className="text-xs text-gray-500">{booking.BookingDetails?.User?.Email}</p>
                                    </div>
                                </div>

                                {/* Booking Date */}
                                <div className="flex items-center gap-2 mb-3">
                                    <Calendar size={14} className="text-gray-400" />
                                    <p className="text-sm text-gray-700">
                                        {formatDate(booking.BookingDetails?.BookingDate)}
                                    </p>
                                </div>

                                {/* Payment Info */}
                                <div className="flex items-center gap-2 mb-3">
                                    <CreditCard size={14} className="text-gray-400" />
                                    <p className="text-sm text-gray-700">
                                        ₹{booking.BookingDetails?.Payment?.PaidAmount} - {booking.BookingDetails?.Payment?.PaymentStatus}
                                    </p>
                                </div>

                                {/* Dealer */}
                                <div className="flex items-center gap-2">
                                    <MapPin size={14} className="text-gray-400" />
                                    <p className="text-sm text-gray-700">
                                        {booking.BookingDetails?.Dealer?.DealerName}
                                    </p>
                                </div>
                            </div>
                        ))}

                        {/* Back to Menu */}
                        <button
                            onClick={onBack}
                            className="w-full py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm mt-2"
                        >
                            Back to Menu
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BookingStatus;
