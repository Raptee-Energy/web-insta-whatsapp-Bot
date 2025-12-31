import React, { useState } from 'react';
import { ArrowLeft, X, MapPin, Zap, Navigation, Locate, Bike } from 'lucide-react';
import RapteeHVLogo from '../../assets/RapteeHV Black.png';

const NearbyChargers = ({ onBack, onClose }) => {
    // Steps: 0=location, 1=range, 2=results
    const [step, setStep] = useState(0);
    const [location, setLocation] = useState({ latitude: null, longitude: null });
    const [range, setRange] = useState(20);
    const [chargers, setChargers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [locationStatus, setLocationStatus] = useState('');

    const requestLocation = () => {
        setLoading(true);
        setLocationStatus('Getting your location...');
        setError('');

        if (!navigator.geolocation) {
            setError('Geolocation is not supported by your browser.');
            setLoading(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLocation({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                });
                setLocationStatus('Location detected!');
                setLoading(false);
                setTimeout(() => setStep(1), 500);
            },
            (err) => {
                setError('Unable to get your location. Please enable location services.');
                setLoading(false);
            }
        );
    };

    const fetchChargers = async () => {
        setLoading(true);
        setError('');
        try {
            // Fetch all chargers within range (use 100 as max count)
            const response = await fetch(
                `/api/chargers/nearby/${location.latitude}/${location.longitude}/${range}/1000000`
            );
            const result = await response.json();

            if (result.success && result.data?.length > 0) {
                setChargers(result.data);
                setStep(2);
            } else {
                setError('No charging stations found. Try increasing the search radius.');
            }
        } catch (e) {
            setError('Failed to fetch charging stations. Please try again.');
        }
        setLoading(false);
    };

    const openNavigation = (charger) => {
        window.open(`https://maps.google.com/?q=${charger.latitude},${charger.longitude}`, '_blank');
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

                {/* Step 0: Location Permission */}
                {step === 0 && (
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                        <div className="text-center mb-4">
                            <div className="w-14 h-14 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                <Locate size={28} className="text-teal-600" />
                            </div>
                            <h2 className="text-base font-bold text-gray-900">Find Nearby Chargers</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                Allow location access to find charging stations near you
                            </p>
                        </div>

                        {locationStatus && !error && (
                            <p className="text-center text-sm text-teal-600 mb-3">{locationStatus}</p>
                        )}
                        {error && <p className="text-center text-sm text-red-500 mb-3">{error}</p>}

                        <div className="flex gap-3">
                            <button
                                onClick={onBack}
                                className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={requestLocation}
                                disabled={loading}
                                className="flex-1 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-50"
                            >
                                {loading ? 'Getting...' : 'Allow Location'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 1: Range Selection with Slider */}
                {step === 1 && (
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                        <h2 className="text-base font-bold text-gray-900 mb-2">Search Radius</h2>
                        <p className="text-sm text-gray-500 mb-6">Drag the slider to set your search distance</p>

                        {/* Range Display */}
                        <div className="text-center mb-4">
                            <span className="text-4xl font-bold text-teal-600">{range}</span>
                            <span className="text-lg text-gray-500 ml-1">km</span>
                        </div>

                        {/* Custom Slider */}
                        <div className="relative mb-6 px-2">
                            {/* Track */}
                            <div className="h-2 bg-gray-200 rounded-full relative">
                                <div
                                    className="h-full bg-gradient-to-r from-teal-400 to-teal-600 rounded-full"
                                    style={{ width: `${range}%` }}
                                />
                            </div>

                            {/* Slider Input */}
                            <input
                                type="range"
                                min="5"
                                max="100"
                                value={range}
                                onChange={(e) => setRange(parseInt(e.target.value))}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />

                            {/* Bike Thumb */}
                            <div
                                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
                                style={{ left: `${((range - 5) / 95) * 100}%` }}
                            >
                                <div className="w-10 h-10 bg-teal-600 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
                                    <Bike size={20} className="text-white" />
                                </div>
                            </div>
                        </div>

                        {/* Range Labels */}
                        <div className="flex justify-between text-xs text-gray-400 mb-6 px-2">
                            <span>5 km</span>
                            <span>50 km</span>
                            <span>100 km</span>
                        </div>

                        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

                        <div className="flex gap-3">
                            <button
                                onClick={() => setStep(0)}
                                className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm"
                            >
                                Back
                            </button>
                            <button
                                onClick={fetchChargers}
                                disabled={loading}
                                className="flex-1 py-3 px-4 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-50"
                            >
                                {loading ? 'Searching...' : 'Find Chargers'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: Results */}
                {step === 2 && (
                    <div className="space-y-3">
                        {/* Summary Card */}
                        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                            <div className="flex items-center gap-2 mb-1">
                                <Zap size={18} className="text-teal-600" />
                                <span className="text-sm font-semibold text-gray-900">
                                    Found {chargers.length} charging station{chargers.length > 1 ? 's' : ''} within {range} km
                                </span>
                            </div>
                            {chargers[0] && (
                                <p className="text-xs text-gray-500 ml-6">
                                    Closest: {chargers[0].distance.toFixed(1)} km away
                                </p>
                            )}
                        </div>

                        {/* Charger Cards */}
                        {chargers.map((charger, idx) => (
                            <div key={idx} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                                {/* Header with logo, name and distance */}
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex gap-2 flex-1 pr-2">
                                        {charger.logo_url && (
                                            <img
                                                src={charger.logo_url}
                                                alt=""
                                                className="w-8 h-8 object-contain rounded"
                                                onError={(e) => e.target.style.display = 'none'}
                                            />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <h3 className="text-sm font-bold text-gray-900 line-clamp-2">
                                                {charger.name || 'Charging Station'}
                                            </h3>
                                            {charger.charger_network && (
                                                <p className="text-xs text-teal-600 font-medium mt-0.5">
                                                    {charger.charger_network}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-xs font-semibold px-2.5 py-1 bg-teal-50 text-teal-700 rounded-full whitespace-nowrap">
                                        {charger.distance.toFixed(1)} km
                                    </span>
                                </div>

                                {/* Address */}
                                <div className="flex items-start gap-2 mb-3 pb-3 border-b border-gray-100">
                                    <MapPin size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-gray-600 leading-relaxed">
                                        {charger.address || 'Address not available'}
                                    </p>
                                </div>

                                {/* Charging Ports */}
                                {charger.charging_port_list && charger.charging_port_list.length > 0 && (
                                    <div className="mb-3">
                                        <p className="text-xs text-gray-500 mb-2">Connectors:</p>
                                        <div className="flex flex-wrap gap-2">
                                            {charger.charging_port_list.map((port, portIdx) => (
                                                <span
                                                    key={portIdx}
                                                    className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 bg-gray-100 text-gray-700 rounded-lg"
                                                >
                                                    <Zap size={10} className="text-yellow-500" />
                                                    {port.type} ({port.total_slot})
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Amenities */}
                                {charger.amenities && charger.amenities.trim() && (
                                    <p className="text-xs text-gray-500 mb-3">
                                        {charger.amenities}
                                    </p>
                                )}

                                {/* Price */}
                                {charger.price && (
                                    <p className="text-xs font-medium text-green-600 mb-3">
                                        {charger.price}
                                    </p>
                                )}

                                {/* Navigate Button */}
                                <button
                                    onClick={() => openNavigation(charger)}
                                    className="w-full py-2.5 rounded-xl bg-teal-600 text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-teal-700 transition-colors"
                                >
                                    <Navigation size={14} />
                                    Get Directions
                                </button>
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

export default NearbyChargers;
