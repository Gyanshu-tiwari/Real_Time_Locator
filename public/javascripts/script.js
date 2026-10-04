const socket = io();

// UI Elements
const statusText = document.getElementById("status-text");
const liveDot = document.getElementById("live-dot");
const userCountText = document.getElementById("user-count-text");
const btnFitAll = document.getElementById("btn-fit-all");
const btnFocusMe = document.getElementById("btn-focus-me");
const toastContainer = document.getElementById("toast-container");

// Leaflet Map Initialization
const map = L.map('map', {
    zoomControl: false // Cleaner interface, standard gestures still work
}).setView([20, 0], 2);

// Add custom zoom control in bottom-right corner
L.control.zoom({ position: 'bottomright' }).addTo(map);

// OpenStreetMap Tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// In-memory markers storage { [socketId]: L.marker }
const markers = {};
const accuracyCircles = {};
let currentPosition = null;
let lastSentTime = 0;

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

// Generate popup content with accuracy badge
function createPopupContent(id, lat, lng, accuracy) {
    const isSelf = (id === socket.id);
    const title = isSelf ? "📍 You (This Device)" : `👤 Device #${id.slice(-4).toUpperCase()}`;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
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

    return `
        <div class="popup-card">
            <div class="popup-title">${title}</div>
            <div class="popup-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
            ${accuracyBadge}
            <div class="popup-time">Last update: ${timestamp}</div>
        </div>
    `;
}

// Render or update accuracy circle on the map
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

    // Multiple devices: calculate bounding box to fit everyone
    const featureGroup = L.featureGroup(markerList);
    map.fitBounds(featureGroup.getBounds().pad(0.18), {
        maxZoom: 16,
        animate: smooth,
        duration: 0.8
    });
}

// Update Active Devices Count Badge in HUD
function updateUserCount() {
    const count = Object.keys(markers).length;
    if (userCountText) {
        userCountText.textContent = `${count} ${count === 1 ? 'device' : 'devices'} online`;
    }
}

// Show Toast Alert
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
    console.log("Connected to server with ID:", socket.id);
    if (statusText) statusText.textContent = "Live Tracking";
    if (liveDot) liveDot.className = "live-dot";

    // If self marker was created before socket.id was ready, refresh its icon to self
    if (markers[socket.id]) {
        markers[socket.id].setIcon(createSelfIcon());
        const latLng = markers[socket.id].getLatLng();
        const acc = currentPosition ? currentPosition.accuracy : null;
        markers[socket.id].setPopupContent(createPopupContent(socket.id, latLng.lat, latLng.lng, acc));
        updateAccuracyCircle(socket.id, latLng.lat, latLng.lng, acc, true);
    }
});

socket.on("disconnect", () => {
    if (statusText) statusText.textContent = "Disconnected";
    if (liveDot) liveDot.className = "live-dot error";
});

// Receive all existing users on first connection
socket.on("all-users", (allUsers) => {
    console.log("Initial users list:", allUsers);
    let addedCount = 0;

    for (const [userId, userData] of Object.entries(allUsers)) {
        if (!markers[userId] && userData.latitude && userData.longitude) {
            const isSelf = (userId === socket.id);
            const icon = isSelf ? createSelfIcon() : createOtherIcon(userId);
            
            const marker = L.marker([userData.latitude, userData.longitude], { icon })
                .bindPopup(createPopupContent(userId, userData.latitude, userData.longitude, userData.accuracy))
                .addTo(map);

            markers[userId] = marker;
            if (userData.accuracy) {
                updateAccuracyCircle(userId, userData.latitude, userData.longitude, userData.accuracy, isSelf);
            }
            addedCount++;
        }
    }

    updateUserCount();
    if (addedCount > 0) {
        fitAllTrackers(true);
    }
});

// Real-time location broadcast received
socket.on("receive-location", (data) => {
    const { id, latitude, longitude, accuracy } = data;
    const isSelf = (id === socket.id);
    const isNewUser = !markers[id];

    if (isNewUser) {
        // Create new marker with distinct icon for self vs others
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

        // Auto-fit bounds so the newly joined person is immediately visible on screen
        fitAllTrackers(true);
    } else {
        // Update existing marker position and accuracy smoothly
        markers[id].setLatLng([latitude, longitude]);
        markers[id].setPopupContent(createPopupContent(id, latitude, longitude, accuracy));
        updateAccuracyCircle(id, latitude, longitude, accuracy, isSelf);
    }
});

// User disconnected
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
    showToast(`🔌 Device #${id.slice(-4).toUpperCase()} disconnected`);
    fitAllTrackers(true);
});

// =========================================
// Geolocation Watching & Emission
// =========================================
function sendCurrentLocation() {
    if (!currentPosition) return;
    const { latitude, longitude, accuracy } = currentPosition;
    socket.emit("send-location", { latitude, longitude, accuracy });
    lastSentTime = Date.now();
}

if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
        (position) => {
            currentPosition = position.coords;
            const now = Date.now();

            // Emit immediately if first time or if more than 2 seconds since last emit
            if (now - lastSentTime > 2000) {
                sendCurrentLocation();
            }
        },
        (error) => {
            console.error("Geolocation error:", error);
            if (statusText) {
                statusText.textContent = "Location Blocked";
            }
            if (liveDot) liveDot.className = "live-dot error";
            showToast("⚠️ Location permission denied or requires HTTPS");
        },
        {
            enableHighAccuracy: true, // Forces hardware GPS on mobile devices
            maximumAge: 0,            // Never use cached stale coordinates
            timeout: 15000            // Generous timeout for satellite lock
        }
    );
} else {
    alert("Geolocation is not supported by your browser");
}

// Periodic update every 5 seconds (heartbeat)
setInterval(() => {
    sendCurrentLocation();
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
        if (markers[socket.id]) {
            const latlng = markers[socket.id].getLatLng();
            map.flyTo(latlng, 17, { duration: 1 });
            markers[socket.id].openPopup();
        } else if (currentPosition) {
            map.flyTo([currentPosition.latitude, currentPosition.longitude], 17, { duration: 1 });
        } else {
            showToast("📍 Acquiring your location...");
        }
    });
}

