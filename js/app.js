import { db, auth } from "./firebase-config.js";
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  doc, 
  updateDoc, 
  query, 
  orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// =========================================================
// 1. STATE VARIABLES & CONFIGURATION
// =========================================================
let currentUser = null;
let isSignUpMode = false;
let activeTab = "collector";
let currentFilter = "all";
let cachedRequests = [];

// Recycler Processing Center Default Coordinates (e.g., Pune Base)
const RECYCLER_LAT = 18.5204;
const RECYCLER_LNG = 73.8567;

// Gemini API Key for AI Assistant (Replace with your actual API key)
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";

// =========================================================
// 2. HELPER FUNCTIONS
// =========================================================

// Calculate straight-line distance (Haversine Formula in Km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c).toFixed(2);
}

// Convert uploaded file to Base64 String
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = (err) => reject(err);
});

// =========================================================
// 3. NAVIGATION & VIEW ROUTER
// =========================================================
const collectorView = document.getElementById("collectorView");
const authView = document.getElementById("authView");
const recyclerView = document.getElementById("recyclerView");
const collectorBtn = document.getElementById("collectorTabBtn");
const recyclerBtn = document.getElementById("recyclerTabBtn");

function renderNavigation() {
  collectorView.classList.remove("active-view");
  authView.classList.remove("active-view");
  recyclerView.classList.remove("active-view");
  collectorBtn.classList.remove("active");
  recyclerBtn.classList.remove("active");

  if (activeTab === "collector") {
    collectorView.classList.add("active-view");
    collectorBtn.classList.add("active");
    // Trigger map resize fix when switching tabs
    setTimeout(() => collectorMap.invalidateSize(), 200);
  } else {
    recyclerBtn.classList.add("active");
    if (currentUser) {
      recyclerView.classList.add("active-view");
      setTimeout(() => recyclerMap.invalidateSize(), 200);
    } else {
      authView.classList.add("active-view");
    }
  }
}

collectorBtn.addEventListener("click", () => { activeTab = "collector"; renderNavigation(); });
recyclerBtn.addEventListener("click", () => { activeTab = "recycler"; renderNavigation(); });

// =========================================================
// 4. COLLECTOR MAP & GEOCODING SEARCH
// =========================================================
let selectedLat = RECYCLER_LAT;
let selectedLng = RECYCLER_LNG;

const collectorMap = L.map('collectorMap').setView([selectedLat, selectedLng], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(collectorMap);
let collectorPin = L.marker([selectedLat, selectedLng], { draggable: true }).addTo(collectorMap);

function updateCollectorCoords(lat, lng, addressLabel = "") {
  selectedLat = lat;
  selectedLng = lng;
  const labelText = addressLabel ? ` (${addressLabel})` : "";
  document.getElementById("locationStatus").innerHTML = 
    `📍 Pinned Coordinates: <strong>${lat.toFixed(4)}, ${lng.toFixed(4)}</strong>${labelText}`;
}
updateCollectorCoords(selectedLat, selectedLng);

// Interactive Click Pinning
collectorMap.on('click', (e) => {
  collectorPin.setLatLng(e.latlng);
  updateCollectorCoords(e.latlng.lat, e.latlng.lng);
});

// Drag Marker Pinning
collectorPin.on('dragend', (e) => {
  const pos = e.target.getLatLng();
  updateCollectorCoords(pos.lat, pos.lng);
});

// Pincode / Address Geocoding Search (OpenStreetMap Nominatim)
const locationSearchInput = document.getElementById("locationSearchInput");
const searchLocationBtn = document.getElementById("searchLocationBtn");

searchLocationBtn.addEventListener("click", async () => {
  const queryText = locationSearchInput.value.trim();
  if (!queryText) {
    alert("Please enter a pincode or address to search.");
    return;
  }

  searchLocationBtn.innerText = "Searching...";
  searchLocationBtn.disabled = true;

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryText)}`);
    const results = await response.json();

    if (results && results.length > 0) {
      const firstResult = results[0];
      const lat = parseFloat(firstResult.lat);
      const lon = parseFloat(firstResult.lon);

      collectorMap.setView([lat, lon], 15);
      collectorPin.setLatLng([lat, lon]);

      const displayName = firstResult.display_name.split(',').slice(0, 2).join(',');
      updateCollectorCoords(lat, lon, displayName);
    } else {
      alert("Location/Pincode not found. Please try entering a full address or city name.");
    }
  } catch (error) {
    console.error("Geocoding Error:", error);
    alert("Could not fetch location. Please check your network connection.");
  } finally {
    searchLocationBtn.innerText = "Search & Pin";
    searchLocationBtn.disabled = false;
  }
});

// Image Preview Handler
const imageInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");
imageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      imagePreview.src = reader.result;
      imagePreview.style.display = "block";
    };
    reader.readAsDataURL(file);
  }
});

// Submit Pickup Form Handler
const collectorForm = document.getElementById("collectorForm");
const submitBtn = document.getElementById("submitBtn");

collectorForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.innerText = "Saving Request...";

  try {
    const type = document.getElementById("eWasteType").value;
    const weight = Number(document.getElementById("weight").value);
    const file = imageInput.files[0];
    const imageBase64 = await fileToBase64(file);

    await addDoc(collection(db, "pickup_requests"), {
      type: type,
      weight: weight,
      lat: selectedLat,
      lng: selectedLng,
      imageUrl: imageBase64,
      status: "Requested",
      timestamp: new Date()
    });

    alert("Pickup Request Created Successfully!");
    collectorForm.reset();
    imagePreview.style.display = "none";
  } catch (err) {
    console.error("Firestore Error:", err);
    alert("Error saving request: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = "Submit Pickup Request";
  }
});

// =========================================================
// 5. RECYCLER AUTHENTICATION
// =========================================================
const authForm = document.getElementById("authForm");
const authTitle = document.getElementById("authTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authToggleText = document.getElementById("authToggleText");
const switchAuthModeBtn = document.getElementById("switchAuthModeBtn");

switchAuthModeBtn.addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  if (isSignUpMode) {
    authTitle.innerText = "Create Recycler Account";
    authSubmitBtn.innerText = "Sign Up";
    authToggleText.innerText = "Already have an account?";
    switchAuthModeBtn.innerText = "Log In";
  } else {
    authTitle.innerText = "Authorized Recycler Portal";
    authSubmitBtn.innerText = "Log In";
    authToggleText.innerText = "Need an authorized account?";
    switchAuthModeBtn.innerText = "Sign Up";
  }
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("authEmail").value;
  const password = document.getElementById("authPassword").value;

  try {
    if (isSignUpMode) {
      await createUserWithEmailAndPassword(auth, email, password);
      alert("Account created successfully!");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    alert("Authentication Error: " + err.message);
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    document.getElementById("userEmailBadge").innerText = `Logged in as: ${user.email}`;
  }
  renderNavigation();
});

// =========================================================
// 6. RECYCLER DASHBOARD & REAL-TIME LISTENING
// =========================================================
const recyclerMap = L.map('recyclerMap').setView([RECYCLER_LAT, RECYCLER_LNG], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(recyclerMap);

L.marker([RECYCLER_LAT, RECYCLER_LNG])
  .addTo(recyclerMap)
  .bindPopup("<b>🏢 Recycler Processing Hub</b>")
  .openPopup();

let recyclerMapMarkers = [];

const q = query(collection(db, "pickup_requests"), orderBy("timestamp", "desc"));

onSnapshot(q, (snapshot) => {
  cachedRequests = [];
  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const dist = calculateDistance(RECYCLER_LAT, RECYCLER_LNG, data.lat || RECYCLER_LAT, data.lng || RECYCLER_LNG);
    cachedRequests.push({ id: docSnap.id, ...data, distance: Number(dist) });
  });

  // Sort live requests by distance from the recycler hub
  cachedRequests.sort((a, b) => a.distance - b.distance);

  renderCollectorCards(cachedRequests);
  renderRecyclerUI(cachedRequests);
});

function renderCollectorCards(requests) {
  const container = document.getElementById("collectorStatusList");
  container.innerHTML = "";

  if (requests.length === 0) {
    container.innerHTML = "<p class='loading'>No active pickup requests found.</p>";
    return;
  }

  requests.forEach(item => {
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <img src="${item.imageUrl}" class="thumb-img" alt="Scrap preview" />
      <div class="item-info">
        <h4>${item.type}</h4>
        <p><strong>Weight:</strong> ${item.weight} kg</p>
        <p><strong>Status:</strong> <span class="badge ${item.status.toLowerCase()}">${item.status}</span></p>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderRecyclerUI(requests) {
  const container = document.getElementById("recyclerMatchingList");
  container.innerHTML = "";

  recyclerMapMarkers.forEach(m => recyclerMap.removeLayer(m));
  recyclerMapMarkers = [];

  const filtered = requests.filter(req => currentFilter === 'all' || req.status === currentFilter);

  if (filtered.length === 0) {
    container.innerHTML = "<p class='loading'>No requests match the selected filter.</p>";
    return;
  }

  filtered.forEach(item => {
    if (item.lat && item.lng) {
      const marker = L.marker([item.lat, item.lng])
        .addTo(recyclerMap)
        .bindPopup(`<b>${item.type}</b><br>Distance: <strong>${item.distance} km</strong><br>Status: ${item.status}`);
      recyclerMapMarkers.push(marker);
    }

    const card = document.createElement("div");
    card.className = "item-card";

    let actionBtn = "";
    if (item.status === 'Requested') {
      actionBtn = `<button class="btn accept-btn" data-id="${item.id}" data-status="Accepted">Accept Pickup</button>`;
    } else if (item.status === 'Accepted') {
      actionBtn = `<button class="btn complete-btn" data-id="${item.id}" data-status="Completed">Mark Recycled</button>`;
    } else {
      actionBtn = `<span class="badge completed">✅ Processed</span>`;
    }

    card.innerHTML = `
      <img src="${item.imageUrl}" class="thumb-img" alt="Scrap preview" />
      <div class="item-info">
        <h4>${item.type} (${item.weight} kg)</h4>
        <p class="distance-tag">📏 <strong>${item.distance} km away</strong></p>
        <p>Status: <span class="badge ${item.status.toLowerCase()}">${item.status}</span></p>
        <div class="action-box">${actionBtn}</div>
      </div>
    `;
    container.appendChild(card);
  });

  // Action listeners for status updates
  container.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      const newStatus = e.target.getAttribute("data-status");
      await updateDoc(doc(db, "pickup_requests", id), { status: newStatus });
    });
  });
}

// Filter button logic
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    currentFilter = e.target.getAttribute("data-filter");
    renderRecyclerUI(cachedRequests);
  });
});

// =========================================================
// 7. LANGUAGE TRANSLATION & AI ASSISTANT BOT
// =========================================================

// Google Translate Dropdown Bridge
window.googleTranslateElementInit = function() {
  new google.translate.TranslateElement({
    pageLanguage: 'en',
    autoDisplay: false
  }, 'google_translate_element');
};

const languageSelect = document.getElementById("languageSelect");
languageSelect.addEventListener("change", (e) => {
  const lang = e.target.value;
  const translateCombo = document.querySelector(".goog-te-combo");
  if (translateCombo) {
    translateCombo.value = lang;
    translateCombo.dispatchEvent(new Event("change"));
  }
});

// AI Chatbot UI & API Logic
const toggleBotBtn = document.getElementById("toggleBotBtn");
const closeBotBtn = document.getElementById("closeBotBtn");
const botChatWindow = document.getElementById("botChatWindow");
const sendBotBtn = document.getElementById("sendBotBtn");
const botInput = document.getElementById("botInput");
const botMessages = document.getElementById("botMessages");

toggleBotBtn.addEventListener("click", () => botChatWindow.classList.toggle("hidden"));
closeBotBtn.addEventListener("click", () => botChatWindow.classList.add("hidden"));

function appendMessage(sender, text) {
  const msgDiv = document.createElement("div");
  msgDiv.className = sender === "user" ? "user-msg" : "bot-msg";
  msgDiv.innerText = text;
  botMessages.appendChild(msgDiv);
  botMessages.scrollTop = botMessages.scrollHeight;
}

sendBotBtn.addEventListener("click", handleBotSend);
botInput.addEventListener("keypress", (e) => { if (e.key === "Enter") handleBotSend(); });

async function handleBotSend() {
  const userText = botInput.value.trim();
  if (!userText) return;

  const currentLangName = languageSelect.options[languageSelect.selectedIndex].text;

  appendMessage("user", userText);
  botInput.value = "";

  const loadingMsg = document.createElement("div");
  loadingMsg.className = "bot-msg";
  loadingMsg.innerText = "Thinking...";
  botMessages.appendChild(loadingMsg);
  botMessages.scrollTop = botMessages.scrollHeight;

  try {
    const prompt = `You are an expert AI assistant for the e-waste recycling platform "Tech Nova". 
    Respond concisely in ${currentLangName}. Explain clearly what to do with the items or how to use the app based on the user request: "${userText}"`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await res.json();
    loadingMsg.remove();

    if (data.candidates && data.candidates[0].content.parts[0].text) {
      appendMessage("bot", data.candidates[0].content.parts[0].text);
    } else {
      appendMessage("bot", "Sorry, I couldn't process that request right now.");
    }
  } catch (err) {
    loadingMsg.remove();
    console.error("AI Bot Error:", err);
    appendMessage("bot", "Connection error. Please ensure your Gemini API key is valid.");
  }
}