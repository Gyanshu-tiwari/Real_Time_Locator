const socket = io();

// Persistent Device Identifier stored in browser localStorage
function getOrCreateDeviceId() {
    let id = localStorage.getItem("locator_device_id");
    if (!id) {
        id = "dev_" + Math.random().toString(36).substring(2, 8);
        localStorage.setItem("locator_device_id", id);
    }
    return id;
}
const myDeviceId = getOrCreateDeviceId();

// UI Elements
const statusText = document.getElementById("status-text");
const liveDot = document.getElementById("live-dot");
const userCountText = document.getElementById("user-count-text");
const btnFitAll = document.getElementById("btn-fit-all");
const btnFocusMe = document.getElementById("btn-focus-me");
const toastContainer = document.getElementById("toast-container");

// Leaflet Map Initialization
const map = L.map('map', {
    zoomControl: false
}).setView([20, 0], 2);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// In-memory markers and accuracy storage keyed by persistent deviceId
const markers = {};
const accuracyCircles = {};
let currentPosition = null;
let lastSentPosition = null;
let lastSentTime = 0;

// =========================================
// Distance Calculation (Haversine formula)
// =========================================
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =========================================
// Custom Marker Icons (DivIcons)
// =========================================
function createSelfIcon() {
    return L.divIcon({
        className: 'custom-beacon-container',
        html: `
            <div class="self-marker">
                <div class="self-pulse"></div>
                <div class="self-core"></div>
            </div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12]
    });
}

function createOtherIcon(id) {
    const shortId = id.length > 4 ? id.slice(-4).toUpperCase() : id.toUpperCase();
    return L.divIcon({
        className: 'custom-beacon-container',
        html: `
            <div class="other-marker">
                <div class="other-tag">#${shortId}</div>
                <div class="other-dot"></div>
                <div class="other-pulse"></div>
            </div>
        `,
        iconSize: [40, 44],
        iconAnchor: [20, 36],
        popupAnchor: [0, -36]
    });
}

// Generate popup content with real-time distance and accuracy
function createPopupContent(id, lat, lng, accuracy) {
    const isSelf = (id === myDeviceId);
    const title = isSelf ? "📍 You (This Device)" : `👤 Device #${id.slice(-4).toUpperCase()}`;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    // Accuracy badge
    let accuracyBadge = '';
    if (accuracy !== undefined && accuracy !== null && !isNaN(accuracy)) {
        const roundedAcc = Math.round(accuracy);
        if (roundedAcc <= 25) {
            accuracyBadge = `<div class="accuracy-badge high">🎯 Exact GPS (±${roundedAcc}m)</div>`;
        } else if (roundedAcc <= 100) {
            accuracyBadge = `<div class="accuracy-badge medium">📍 Good (±${roundedAcc}m)</div>`;
        } else {
            const displayStr = roundedAcc > 1000 ? `${(roundedAcc / 1000).toFixed(1)}km` : `${roundedAcc}m`;
            accuracyBadge = `<div class="accuracy-badge low">⚠️ Approx / Wi-Fi (±${displayStr})</div>`;
        }
    }

    // Live distance badge from you to other person
    let distanceBadge = '';
    if (!isSelf && currentPosition) {
        const dist = getDistanceMeters(currentPosition.latitude, currentPosition.longitude, lat, lng);
        const distStr = dist > 1000 ? `${(dist / 1000).toFixed(2)} km` : `${Math.round(dist)} m`;
        distanceBadge = `<div class="distance-badge">📏 ${distStr} away from you</div>`;
    }

    return `
        <div class="popup-card">
            <div class="popup-title">${title}</div>
            <div class="popup-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
            ${accuracyBadge}
            ${distanceBadge}
            <div class="popup-time">Last update: ${timestamp}</div>
        </div>
    `;
}

// Render or update accuracy circle
function updateAccuracyCircle(id, lat, lng, accuracy, isSelf) {
    if (!accuracy || isNaN(accuracy)) return;
    const color = isSelf ? '#0284c7' : '#ec4899';

    if (accuracyCircles[id]) {
        accuracyCircles[id].setLatLng([lat, lng]);
        accuracyCircles[id].setRadius(accuracy);
    } else {
        accuracyCircles[id] = L.circle([lat, lng], {
            radius: accuracy,
            color: color,
            fillColor: color,
            fillOpacity: 0.1,
            weight: 1.5,
            interactive: false
        }).addTo(map);
    }
}

// =========================================
// Dynamic Bounds & Zoom Handling
// =========================================
function fitAllTrackers(smooth = true) {
    const markerList = Object.values(markers);
    if (markerList.length === 0) return;

    if (markerList.length === 1) {
        const latlng = markerList[0].getLatLng();
        if (smooth) {
            map.flyTo(latlng, 16, { duration: 1 });
        } else {
            map.setView(latlng, 16);
        }
        return;
    }

    const featureGroup = L.featureGroup(markerList);
    map.fitBounds(featureGroup.getBounds().pad(0.18), {
        maxZoom: 16,
        animate: smooth,
        duration: 0.8
    });
}

function updateUserCount() {
    const count = Object.keys(markers).length;
    if (userCountText) {
        userCountText.textContent = `${count} ${count === 1 ? 'device' : 'devices'} online`;
    }
}

function showToast(message) {
    if (!toastContainer) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// =========================================
// Socket.IO Events
// =========================================
socket.on("connect", () => {
    console.log("Socket connected. Device ID:", myDeviceId);
    socket.emit("register-device", myDeviceId);

    if (statusText) statusText.textContent = "Live Tracking";
    if (liveDot) liveDot.className = "live-dot";

    // Immediate sync if position is available
    if (currentPosition) {
        sendCurrentLocation(true);
    }
});

socket.on("disconnect", () => {
    if (statusText) statusText.textContent = "Reconnecting...";
    if (liveDot) liveDot.className = "live-dot connecting";
});

// Receive all active devices on sync
socket.on("all-users", (allUsers) => {
    console.log("Synced active devices:", allUsers);

    // 1. Remove any markers from map that are no longer active (eliminate ghost pins)
    for (const id of Object.keys(markers)) {
        if (!allUsers[id]) {
            map.removeLayer(markers[id]);
            delete markers[id];
            if (accuracyCircles[id]) {
                map.removeLayer(accuracyCircles[id]);
                delete accuracyCircles[id];
            }
        }
    }

    // 2. Add or update active devices
    for (const [deviceId, userData] of Object.entries(allUsers)) {
        if (userData.latitude && userData.longitude) {
            const isSelf = (deviceId === myDeviceId);
            const icon = isSelf ? createSelfIcon() : createOtherIcon(deviceId);

            if (markers[deviceId]) {
                markers[deviceId].setLatLng([userData.latitude, userData.longitude]);
                markers[deviceId].setPopupContent(createPopupContent(deviceId, userData.latitude, userData.longitude, userData.accuracy));
            } else {
                const marker = L.marker([userData.latitude, userData.longitude], { icon })
                    .bindPopup(createPopupContent(deviceId, userData.latitude, userData.longitude, userData.accuracy))
                    .addTo(map);
                markers[deviceId] = marker;
            }

            if (userData.accuracy) {
                updateAccuracyCircle(deviceId, userData.latitude, userData.longitude, userData.accuracy, isSelf);
            }
        }
    }

    updateUserCount();
    if (Object.keys(markers).length > 0) {
        fitAllTrackers(true);
    }
});

// Real-time location broadcast
socket.on("receive-location", (data) => {
    const { id, latitude, longitude, accuracy } = data;
    const isSelf = (id === myDeviceId);
    const isNewDevice = !markers[id];

    if (isNewDevice) {
        const icon = isSelf ? createSelfIcon() : createOtherIcon(id);
        const marker = L.marker([latitude, longitude], { icon })
            .bindPopup(createPopupContent(id, latitude, longitude, accuracy))
            .addTo(map);

        markers[id] = marker;
        updateAccuracyCircle(id, latitude, longitude, accuracy, isSelf);
        updateUserCount();

        if (!isSelf) {
            showToast(`👋 Device #${id.slice(-4).toUpperCase()} joined the map`);
        }
        fitAllTrackers(true);
    } else {
        // Update existing marker position smoothly
        markers[id].setLatLng([latitude, longitude]);
        markers[id].setPopupContent(createPopupContent(id, latitude, longitude, accuracy));
        updateAccuracyCircle(id, latitude, longitude, accuracy, isSelf);
    }
});

// Device disconnected
socket.on("user-disconnected", (id) => {
    if (markers[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
    if (accuracyCircles[id]) {
        map.removeLayer(accuracyCircles[id]);
        delete accuracyCircles[id];
    }
    updateUserCount();
    showToast(`🔌 Device #${id.slice(-4).toUpperCase()} left`);
    fitAllTrackers(true);
});

// =========================================
// Geolocation Watching & Emission with GPS Jitter Filter
// =========================================
function sendCurrentLocation(force = false) {
    if (!currentPosition) return;
    const { latitude, longitude, accuracy } = currentPosition;

    if (!force && lastSentPosition) {
        const distance = getDistanceMeters(lastSentPosition.lat, lastSentPosition.lng, latitude, longitude);
        const accuracyImproved = (lastSentPosition.accuracy - accuracy) > 15; // >15m improvement

        // JITTER / DRIFT FILTER:
        // If device has moved less than 5 meters AND accuracy hasn't drastically improved,
        // treat it as static GPS noise and DO NOT jump the pin.
        if (distance < 5 && !accuracyImproved) {
            return;
        }
    }

    lastSentPosition = { lat: latitude, lng: longitude, accuracy };
    lastSentTime = Date.now();

    socket.emit("send-location", {
        deviceId: myDeviceId,
        latitude,
        longitude,
        accuracy
    });
}

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (position) => {
            currentPosition = position.coords;
            const now = Date.now();

            // Emit immediately on first detection or if 2 seconds passed
            if (!lastSentPosition || (now - lastSentTime > 2000)) {
                sendCurrentLocation();
            }
        },
        (error) => {
            console.error("Geolocation error:", error);
            if (statusText) statusText.textContent = "Location Blocked";
            if (liveDot) liveDot.className = "live-dot error";
            showToast("⚠️ Location permission required");
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000
        }
    );
} else {
    alert("Geolocation is not supported by your browser");
}

// Periodic update every 5 seconds (heartbeat)
setInterval(() => {
    sendCurrentLocation(false);
}, 5000);

// =========================================
// HUD Control Buttons
// =========================================
if (btnFitAll) {
    btnFitAll.addEventListener("click", () => {
        fitAllTrackers(true);
    });
}

if (btnFocusMe) {
    btnFocusMe.addEventListener("click", () => {
        if (markers[myDeviceId]) {
            const latlng = markers[myDeviceId].getLatLng();
            map.flyTo(latlng, 17, { duration: 1 });
            markers[myDeviceId].openPopup();
        } else if (currentPosition) {
            map.flyTo([currentPosition.latitude, currentPosition.longitude], 17, { duration: 1 });
        } else {
            showToast("📍 Acquiring your location...");
        }
    });
}

