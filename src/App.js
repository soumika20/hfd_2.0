import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Home, Edit, Menu, User, ChevronRight, MapPin, Phone, Video, Camera, Image, AlertCircle, Navigation, Heart, Cloud, CloudRain, Wind, Thermometer, Activity, Wifi, WifiOff, Radio, Users,PlusCircle, ChevronLeft, Upload, Trash } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// Firebase (inlined minimal setup)
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

// imports...
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';


import React, { useState, useEffect, useCallback, useRef } from 'react';
// Firestore imports MUST BE AT TOP
import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  doc,
  updateDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  arrayUnion, deleteDoc,
  query,
  orderBy,
  where,
} from "firebase/firestore";

// ---- Add this here ----
async function requestMobilePermissions() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const locPerm = await Geolocation.requestPermissions();
    console.log("Loc perm: ", locPerm);

    const notifPerm = await PushNotifications.requestPermissions();
    if (notifPerm.receive === "granted") {
      PushNotifications.register();
    }
  } catch (err) {
    console.log("Permission request failed", err);
  }
}

async function getCurrentPositionSafe() {
  if (!Capacitor.isNativePlatform()) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });
  } else {
    await Geolocation.checkPermissions(); // keep permission active
    return await Geolocation.getCurrentPosition();
  }
}

// Fix for default marker icons in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});


// 🔎 Reverse-geocode exact address from lat/lng
const fetchExactAddress = async (lat, lng) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data && data.display_name) {
      return data.display_name;  // Full address (street, area, city, state, country)
    }
    return null;
  } catch (err) {
    console.error("Reverse geocoding failed:", err);
    return null;
  }
};

// Custom marker icons
const createCustomIcon = (color) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="background-color: ${color}; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
};

const App = () => {
  const [currentScreen, setCurrentScreen] = useState('splash');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [mediaFiles, setMediaFiles] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('action');
  const [userLocation, setUserLocation] = useState({ lat: 12.9716, lng: 77.5946 });
  const [weather, setWeather] = useState(null);
  const [weatherAlerts, setWeatherAlerts] = useState([]);
  const [meshStatus, setMeshStatus] = useState('disconnected');
  const [meshPeers, setMeshPeers] = useState([]);
  const [meshMessages, setMeshMessages] = useState([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [meshNode, setMeshNode] = useState(null);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [locationPermission, setLocationPermission] = useState('prompt');
  const [showEmergencyCallMenu, setShowEmergencyCallMenu] = useState(false);
  const [selectedEmergencyType, setSelectedEmergencyType] = useState(null);
  const [createdEvents, setCreatedEvents] = useState([]);
  const [eventVolunteers, setEventVolunteers] = useState({});
  const [userRespondingTo, setUserRespondingTo] = useState([]);
  const [userActivities, setUserActivities] = useState([]);
  const [eventMediaFiles, setEventMediaFiles] = useState([]);
  const [showEventChat, setShowEventChat] = useState(false);
  const [chatMessages, setChatMessages] = useState({});
  const [eventMessages, setEventMessages] = useState([]);
  const [isChatMaximized, setIsChatMaximized] = useState(true);

  const typingTimeoutRef = useRef(null);
  const [isTyping, setIsTyping] = useState(false);

  const [activeEventTab, setActiveEventTab] = useState('updates');
 // Chat/media/recording state (add near your existing chat state block)
const [recording, setRecording] = useState(false);
const mediaRecorderRef = useRef(null);
const recordedChunksRef = useRef([]);
const chatFileInputRef = useRef(null); // hidden file input for chat uploads

const deleteMediaItem = async (eventId, mediaObj) => {
  if (!mediaObj) return;

  try {
    // 1) Storage delete
    if (mediaObj.path) {
      try {
        await deleteObject(ref(storage, mediaObj.path));
      } catch (err) {
        console.warn("Storage delete failed:", err);
      }
    }

    // 2) Update event mediaFiles
    const prev = createdEvents.find(e => e.id === eventId);
    const updated = (prev.mediaFiles || []).filter(m => m.path !== mediaObj.path);

    try {
      await updateDoc(doc(db, "createdEvents", eventId), { mediaFiles: updated });
    } catch (e) {
      console.warn("Firestore update failed:", e);
    }

    setCreatedEvents(prev =>
      prev.map(ev => ev.id === eventId ? { ...ev, mediaFiles: updated } : ev)
    );

    if (selectedEvent?.id === eventId) {
      setSelectedEvent(prev => ({ ...prev, mediaFiles: updated }));
    }

    // 3) Delete chat entries referencing this media
    try {
      const chatCol = collection(db, "createdEvents", eventId, "chat");
      const q = query(chatCol, where("media.path", "==", mediaObj.path));
      const snaps = await getDocs(q);
      for (const sd of snaps.docs) {
        try { await deleteDoc(sd.ref); } catch (err) {}
      }
    } catch (err) {
      console.warn("Chat cleanup failed:", err);
    }

  } catch (err) {
    console.error("deleteMediaItem failed:", err);
  }
};

useEffect(() => {
  if (!selectedEvent?.id) return;

  const chatColRef = collection(db, "createdEvents", selectedEvent.id, "chat");
  const q = query(chatColRef, orderBy("timestamp", "asc"));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const msgs = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        ...d,
        timestamp: d.timestamp?.toDate ? d.timestamp.toDate() : d.timestamp
      };
    });

    setChatMessages(prev => ({ ...prev, [selectedEvent.id]: msgs }));
    setEventMessages(msgs);
  });

  return () => unsubscribe();
}, [selectedEvent?.id]);

useEffect(() => {
  if (!selectedEvent || selectedEvent === null) return;
  if (selectedEvent.exactAddress) return;
  if (typeof selectedEvent.lat !== "number" || typeof selectedEvent.lng !== "number") return;

  fetchExactAddress(selectedEvent.lat, selectedEvent.lng)
    .then(addr => {
      if (addr) {
        setSelectedEvent(prev =>
          prev ? { ...prev, exactAddress: addr } : prev
        );
      }
    })
    .catch(err => console.error("Reverse geocode error:", err));
}, [selectedEvent]);


  const [currentChatMessage, setCurrentChatMessage] = useState('');
  const [editingEvent, setEditingEvent] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [eventToDelete, setEventToDelete] = useState(null);
  const [showMediaDropdown, setShowMediaDropdown] = useState(false);
  const [newEventForm, setNewEventForm] = useState({
  incidentType: '',
  location: '',
  volunteersNeeded: 1,
  suppliesNeeded: '',
  emergencyServiceStatus: 'Not Arrived',
  mediaFiles: []
});
const [showCallEndDialog, setShowCallEndDialog] = useState(false);
const [pendingTimerCall, setPendingTimerCall] = useState(null);
const [routeCoordinates, setRouteCoordinates] = useState([]);
const [showFullscreenMedia, setShowFullscreenMedia] = useState(false);
const [fullscreenMediaIndex, setFullscreenMediaIndex] = useState(0);
const [reqName, setReqName] = useState("");
const [reqContact, setReqContact] = useState("");
const [reqDescription, setReqDescription] = useState("");
const [requests, setRequests] = useState([]);
const [showReqDropdown, setShowReqDropdown] = useState(false);

const isMobile = /android|iphone|ipad|mobile|miui|oppo|vivo|oneplus|realme/i.test(
  navigator.userAgent
);
// Context menu state for active events list (right-click)
const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, event: null });

const handleContextMenu = (e, event) => {
  e.preventDefault();
  setContextMenu({
    visible: true,
    x: e.clientX,
    y: e.clientY,
    event: event
  });
};

const hideContextMenu = () => setContextMenu({ visible: false, x: 0, y: 0, event: null });

const sendTextMessage = async (eventId) => {
  if (!currentChatMessage.trim()) return;
  const message = {
    sender: auth.currentUser?.displayName || 'Anonymous',
    userId: auth.currentUser?.uid || 'anonymous',
    text: currentChatMessage.trim(),
    timestamp: serverTimestamp(),
    isVolunteer: userRespondingTo.includes(eventId),
    type: 'text'
  };

  const chatColRef = collection(db, "createdEvents", eventId, "chat");
  try {
    await addDoc(chatColRef, message);
  } catch (err) {
    console.error("Failed to send chat message:", err);
  }

  setCurrentChatMessage('');
};

/**
 * Upload media and sync it to:
 * 1) Firebase Storage
 * 2) Chat messages array
 * 3) eventDetails.mediaFiles
 * 4) Local UI states (media tab + selectedEvent)
 */
const uploadAndSendMedia = async (fileOrBlob, type = "image") => {
  if (!selectedEvent?.id) {
    console.warn("No event selected for media upload");
    return;
  }

  try {
    // 1️⃣ Upload file
    const uploaded = await uploadFile(fileOrBlob);
    if (!uploaded) return;

    // Build media entry
    const mediaEntry = {
      type,
      url: uploaded.url,
      path: uploaded.path,
      uploadedAt: Date.now(),
      userId: auth.currentUser?.uid || "anonymous",
    };

    // 2️⃣ Update Firestore (createdEvents only)
    await updateDoc(doc(db, "createdEvents", selectedEvent.id), {
      mediaFiles: arrayUnion(mediaEntry),
    });

    // 3️⃣ Update React state (Media tab)
    setSelectedEvent(prev => ({
      ...prev,
      mediaFiles: [...(prev.mediaFiles || []), mediaEntry]
    }));

    setCreatedEvents(prev =>
      prev.map(ev =>
        ev.id === selectedEvent.id
          ? { ...ev, mediaFiles: [...(ev.mediaFiles || []), mediaEntry] }
          : ev
      )
    );

    // 4️⃣ Also insert into chat (optional but you wanted it)
    const chatRef = collection(db, "createdEvents", selectedEvent.id, "chat");
    await addDoc(chatRef, {
      sender: "You",
      userId: auth.currentUser?.uid,
      type,
      media: mediaEntry,
      timestamp: serverTimestamp(),
    });

  } catch (err) {
    console.error("Media upload failed:", err);
  }
};
// Replace your existing deleteCreatedEvent function with this
const deleteCreatedEvent = async (id) => {
  if (!id) return setShowDeleteConfirm(false);

  try {
    // find event in createdEvents or selectedEvent
    const ev = createdEvents.find(e => e.id === id) || (selectedEvent && selectedEvent.id === id ? selectedEvent : null);
    const city = ev?.cityName || ev?.city || "unknown-city";

    // 1) delete storage files (best effort)
    if (ev?.mediaFiles && Array.isArray(ev.mediaFiles)) {
      await Promise.all(ev.mediaFiles.map(async (m) => {
        if (m?.path) {
          try { await deleteObject(ref(storage, m.path)); } catch (e) { console.warn("storage delete failed", e); }
        }
      }));
    }

    // 2) delete chat doc and eventDetails doc
    try {
      await deleteDoc(doc(db, "events", city, id, "chat"));
    } catch (e) { console.warn("Failed to delete chat doc:", e); }

    try {
      await deleteDoc(doc(db, "events", city, id, "eventDetails"));
    } catch (e) { console.warn("Failed to delete eventDetails doc", e); }

    // 3) delete createdEvents index doc if exists
    try { await deleteDoc(doc(db, "createdEvents", id)); } catch (e) { /* ignore */ }

    // 4) update local state
    setCreatedEvents(prev => prev.filter(ev => ev.id !== id));
    if (selectedEvent?.id === id) setSelectedEvent(null);
    setShowDeleteConfirm(false);
    setEventToDelete(null);
    hideContextMenu();
    setCurrentScreen('createdEvents');

    console.log("Event fully removed:", id);
  } catch (err) {
    console.error("Delete failed:", err);
    setShowDeleteConfirm(false);
    setEventToDelete(null);
  }
};
const startEditEvent = (event) => {
  // Put the selected event into the create form and open create screen
  setSelectedEvent(event);
  setNewEventForm(prev => ({
    ...prev,
    incidentType: event.type || prev.incidentType,
    location: event.location || prev.location,
    volunteersNeeded: event.volunteersNeeded || prev.volunteersNeeded,
    suppliesNeeded: event.suppliesNeeded || prev.suppliesNeeded,
    emergencyServiceStatus: event.emergencyServiceStatus || prev.emergencyServiceStatus,
    mediaFiles: event.mediaFiles || []
  }));
  setCurrentScreen('createEvent');
  hideContextMenu();
};

const updateEvent = () => {
  if (!editingEvent) return;
  
  setCreatedEvents(createdEvents.map(e => 
    e.id === editingEvent.id ? editingEvent : e
  ));
  
  setEditingEvent(null);
  alert('Event updated successfully!');
  setCurrentScreen('eventDetail');
};
// Global click to hide the context menu
useEffect(() => {
  const onDocClick = () => { if (contextMenu.visible) hideContextMenu(); };
  window.addEventListener('click', onDocClick);
  return () => window.removeEventListener('click', onDocClick);
}, [contextMenu.visible]);

const fetchRoute = async (startLat, startLng, endLat, endLng) => {
  try {
    // Using Geoapify Routing API
    if (!GEOAPIFY_API_KEY || GEOAPIFY_API_KEY === '6a5a6eee4fb44c20bee69310910f4bdc') {
      console.warn(' Geoapify API key not configured. Using direct line.');
      return [[startLat, startLng], [endLat, endLng]];
    }

    const response = await fetch(
      `https://api.geoapify.com/v1/routing?waypoints=${startLat},${startLng}|${endLat},${endLng}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`
    );
    const data = await response.json();
    
    if (data.features && data.features[0] && data.features[0].geometry) {
      const coords = data.features[0].geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
      console.log('✓ Route fetched successfully');
      return coords;
    }
  } catch (error) {
    console.error('Route fetch failed, using direct line:', error);
    return [[startLat, startLng], [endLat, endLng]];
  }
  return [[startLat, startLng], [endLat, endLng]];
};

const fetchNearbyPlaces = async (lat, lng, categories, limit = 3) => {
  if (!GEOAPIFY_API_KEY || GEOAPIFY_API_KEY === '6a5a6eee4fb44c20bee69310910f4bdc') {
    console.warn('⚠️ Geoapify API key not configured. Using mock data.');
    return [];
  }

  try {
    const radius = 5000; // 5km radius
    const url = `https://api.geoapify.com/v2/places?categories=${categories}&filter=circle:${lng},${lat},${radius}&limit=${limit}&apiKey=${GEOAPIFY_API_KEY}`;
    
    console.log(`Fetching ${categories} places...`);
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      console.log(`✓ Found ${data.features.length} ${categories} locations`);
      return data.features.map((place, index) => {
        const props = place.properties;
        return {
          id: `${categories}_${index}`,
          name: props.name || props.address_line1 || `${categories} Location`,
          type: categories.split('.')[0],
          lat: props.lat,
          lng: props.lon,
          status: 'Available',
          address: props.address_line2 || props.formatted,
          distance: props.distance ? (props.distance / 1000).toFixed(1) : calculateDistance(lat, lng, props.lat, props.lon)
        };
      });
    } else {
      console.log(`No ${categories} locations found`);
      return [];
    }
  } catch (error) {
    console.error(`Failed to fetch ${categories} places:`, error);
    return [];
  }
};

// Add state for nearby resources
const [nearbyResources, setNearbyResources] = useState([]);
const [selectedResource, setSelectedResource] = useState(null);

useEffect(() => {
  // Run only on native app (Android/iOS), NOT on laptop web version
  if (Capacitor.getPlatform() !== 'web') {
    requestMobilePermissions();
  }
}, []);

/* Load resource requests globally */
useEffect(() => {
  if (currentScreen === "requestList" || currentScreen === "requestForm") {
    const fetchReqs = async () => {
      const colRef = collection(db, "resourceRequests");
      const q = await getDocs(colRef);

      const list = q.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(req => req.userId === auth.currentUser?.uid);

      setRequests(list.reverse());
    };

    fetchReqs();
  }
}, [currentScreen]);

// Fetch route when navigation screen is active
  useEffect(() => {
    if (currentScreen === 'navigation' && selectedResource) {
      const getRoute = async () => {
        const route = await fetchRoute(
          userLocation.lat, 
          userLocation.lng, 
          selectedResource.lat, 
          selectedResource.lng
        );
        setRouteCoordinates(route);
      };
      getRoute();
    }
  }, [currentScreen, selectedResource, userLocation]);


// Live clock update
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Emergency timer states
  const [emergencyTimers, setEmergencyTimers] = useState({});
  const [emergencyUpdates, setEmergencyUpdates] = useState([]);

  useEffect(() => {
    if (currentScreen === 'eventDetail' && selectedEvent) {
      // Initialize mediaFiles for createdEvents that don't have any
      if (!selectedEvent.mediaFiles) {
        selectedEvent.mediaFiles = [];
      }
      setMediaFiles(selectedEvent.mediaFiles || []);
    }
  }, [currentScreen, selectedEvent]);

  // STEP 1: Replace with your WeatherAPI.com API key
  const WEATHER_API_KEY = 'bf8edeaa51844f2caad151032252110';
  const GEOAPIFY_API_KEY = '6a5a6eee4fb44c20bee69310910f4bdc';

  // --- Firebase init & centralized upload helper ---
  // Replace these firebaseConfig values with your project's config in production
  const firebaseConfig = {
    apiKey: "AIzaSyAWQIO_2SGUprCVggbunCLMXI2mgh5NDaE",
    authDomain: "hfd1-946b8.firebaseapp.com",
    projectId: "hfd1-946b8",
    storageBucket: "hfd1-946b8.firebasestorage.app",
    messagingSenderId: "4293306151",
    appId: "1:4293306151:web:ef2705baeb1dab54856b02",
    measurementId: "G-WTH3PB3JEX"
  };

  const firebaseApp = initializeApp(firebaseConfig);
  const auth = getAuth(firebaseApp);
  // ensure anonymous auth so app can read/write according to rules
  signInAnonymously(auth).catch(err => console.error('Anonymous auth failed:', err));

  const storage = getStorage(firebaseApp);
  const db = getFirestore(firebaseApp);
  

  /**
   * Centralized upload helper used by multiple upload inputs.
   * Returns { url, path, name } on success, or null on failure.
   */
  const uploadFile = async (file) => {
    if (!file) return null;

    try {
      // In production this uploads to Firebase Storage. Here we call uploadBytes.
      const uniqueName = `${Date.now()}_${file.name}`;
      const storagePath = `uploads/${uniqueName}`;
      const fileRef = ref(storage, storagePath);

      // uploadBytes works in browser environment where File is available
      const snapshot = await uploadBytes(fileRef, file);
      const url = await getDownloadURL(snapshot.ref);

      return { url, path: storagePath, name: uniqueName };
    } catch (err) {
      console.error('uploadFile error:', err);
      return null;
    }
  };
  // Starts a MediaRecorder for microphone
const startAudioRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunksRef.current = [];
    const options = { mimeType: 'audio/webm' };
    const mr = new MediaRecorder(stream, options);

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    mr.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
      await uploadAndSendMedia(blob, 'audio');
      // stop all tracks to release mic
      stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorderRef.current = mr;
    mr.start();
    setRecording(true);
  } catch (err) {
    console.error('Audio record start failed', err);
    alert('Unable to access microphone.');
    setRecording(false);
  }
};

const stopAudioRecording = () => {
  try {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  } catch (err) {
    console.warn('stopAudioRecording err', err);
  } finally {
    setRecording(false);
  }
};
  // --- end firebase helper ---
const eventTypeColors = {
  "Fire": "#DC2626",             // red
  "Accident": "#EA580C",         // orange
  "Medical Emergency": "#2563EB",// blue
  "Natural Disaster": "#9333EA", // purple
  "Other": "#6B7280"             // gray
};

const getEventColor = (type) => {
  if (!type) return "#6B7280";
  const t = type.toLowerCase();

  if (t.includes("fire")) return "#DC2626";
  if (t.includes("mva") || t.includes("accident") || t.includes("collision")) return "#EA580C";
  if (t.includes("cardiac") || t.includes("medical") || t.includes("cva") || t.includes("stroke") || t.includes("respiratory"))
    return "#2563EB";
  if (t.includes("natural") || t.includes("disaster") || t.includes("earthquake") || t.includes("flood"))
    return "#9333EA";

  return "#6B7280";
};
/** Reverse geocode to get readable location */
async function getLocationName(lat, lng) {
  try {
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${GEOAPIFY_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    const props = data.features?.[0]?.properties || {};
    const formatted = props.formatted || "Unknown Location";
    const city =
      props.city ||
      props.county ||
      props.state ||
      "Unknown-City";

    return { formatted, city };
  } catch {
    return { formatted: "Unknown Location", city: "Unknown-City" };
  }
}

/** Save event to Firestore */
/** Save event to Firestore — creates eventDetails and an empty chat doc */
const saveEventToFirestore = async (eventData) => {
  try {
    // get formatted location + city
    const { formatted, city } = await getLocationName(eventData.lat, eventData.lng);

    // timestamp-based ID: HHMMSS-type-DD-MM-YYYY
    const ts = new Date();
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const ss = String(ts.getSeconds()).padStart(2, '0');
    const dateString = ts.toLocaleDateString('en-GB').replaceAll('/', '-');

    const cleanCity = (city || 'unknown-city').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const cleanType = (eventData.type || 'event').replace(/ /g, '-').toLowerCase();

    const eventId = `${hh}${mm}${ss}-${cleanType}-${dateString}`;

    // write event details
    await setDoc(
      doc(db, "events", cleanCity, eventId, "eventDetails"),
      {
        ...eventData,
        id: eventId,
        cityName: cleanCity,
        locationName: formatted,
        createdAt: serverTimestamp()
      }
    );

    // ensure chat doc exists for this event (one doc containing messages array)
    await setDoc(
      doc(db, "events", cleanCity, eventId, "chat"),
      { messages: [] }
    );

    return { eventId, cityName: cleanCity };
  } catch (err) {
    console.error("🔥 Firestore save failed:", err);
    return null;
  }
};

/** Listen for createdEvents in Firestore */
useEffect(() => {
  const unsubscribe = onSnapshot(collection(db, "createdEvents"), (snapshot) => {
    const createdEventsFromDB = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    setCreatedEvents(createdEventsFromDB);
    // 🔥 Auto-fetch exact address for each created event
createdEventsFromDB.forEach(async (ev) => {
  if (!ev.exactAddress && typeof ev.lat === "number" && typeof ev.lng === "number") {
    const addr = await fetchExactAddress(ev.lat, ev.lng);
    if (addr) {
      try {
        await updateDoc(doc(db, "createdEvents", ev.id), { exactAddress: addr });
      } catch (e) {
        console.warn("Failed to update exactAddress:", e);
      }
    }

    // Update local state
    setCreatedEvents(prev =>
      prev.map(e =>
        e.id === ev.id ? { ...e, exactAddress: addr } : e
      )
    );
  }
});
  });

  return () => unsubscribe();
}, []);


  // Mesh Network Manager
  const MeshNetworkManager = useCallback(() => {
    let ws = null;
    let reconnectTimer = null;
    let heartbeatTimer = null;

    const connect = () => {
      try {
        ws = new WebSocket('ws://localhost:9001');
        
        ws.onopen = () => {
          console.log('Mesh network connected');
          setMeshStatus('connected');
          
          const handshake = {
            type: 'handshake',
            peerId: generatePeerId(),
            location: userLocation,
            timestamp: Date.now()
          };
          ws.send(JSON.stringify(handshake));
          
          heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'heartbeat' }));
            }
          }, 30000);
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleMeshMessage(message);
          } catch (e) {
            console.error('Failed to parse mesh message:', e);
          }
        };

        ws.onerror = (error) => {
          console.error('Mesh network error:', error);
          setMeshStatus('disconnected');
        };

        ws.onclose = () => {
          console.log('Mesh network disconnected');
          setMeshStatus('disconnected');
          clearInterval(heartbeatTimer);
          
          reconnectTimer = setTimeout(() => {
            if (!isOnline) {
              setMeshStatus('connecting');
              connect();
            }
          }, 5000);
        };
      } catch (error) {
        console.error('Failed to connect to mesh network:', error);
        setMeshStatus('disconnected');
        simulateMeshNetwork();
      }
    };

    const disconnect = () => {
      if (ws) {
        clearInterval(heartbeatTimer);
        clearTimeout(reconnectTimer);
        ws.close();
      }
    };

    return { connect, disconnect };
  }, [userLocation, isOnline]);

  const generatePeerId = () => {
    return 'peer_' + Math.random().toString(36).substr(2, 9);
  };

  const handleMeshMessage = (message) => {
    switch (message.type) {
      case 'peer_list':
        setMeshPeers(message.peers || []);
        break;
      case 'emergency_broadcast':
        setMeshMessages(prev => [...prev, message]);
        LocalNotifications.schedule({
          notifications: [
            {
              title: "Emergency Alert via Mesh",
              body: message.content,
              id: Date.now(),
              schedule: { at: new Date(Date.now() + 1000) },
              sound: null,
              attachments: null,
              actionTypeId: "",
              extra: null
            }
          ]
        });
        break;
      case 'resource_share':
        console.log('Resource shared:', message.resource);
        break;
      case 'location_update':
        setMeshPeers(prev => 
          prev.map(p => p.id === message.peerId ? { ...p, location: message.location } : p)
        );
        break;
      default:
        console.log('Unknown mesh message type:', message.type);
    }
  };

  const simulateMeshNetwork = () => {
    setMeshStatus('connected');
    const mockPeers = [
      { id: 'peer_1', name: 'Emergency Responder 1', distance: 0.5, type: 'responder' },
      { id: 'peer_2', name: 'Medical Team', distance: 1.2, type: 'medical' },
      { id: 'peer_3', name: 'Volunteer', distance: 0.8, type: 'volunteer' }
    ];
    setMeshPeers(mockPeers);
  };

  const broadcastEmergencyMesh = (message) => {
    if (meshNode && meshNode.connect) {
      const broadcast = {
        type: 'emergency_broadcast',
        content: message,
        location: userLocation,
        timestamp: Date.now(),
        sender: generatePeerId()
      };
      
      try {
        console.log('Broadcasting via mesh:', broadcast);
        setMeshMessages(prev => [...prev, broadcast]);
        return true;
      } catch (error) {
        console.error('Failed to broadcast on mesh:', error);
        return false;
      }
    }
    return false;
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setMeshStatus('disconnected');
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      setMeshStatus('connecting');
      const network = MeshNetworkManager();
      network.connect();
      setMeshNode(network);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    if (!navigator.onLine) {
      handleOffline();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (meshNode) {
        meshNode.disconnect();
      }
    };
  }, [MeshNetworkManager]);

// Desktop: auto-fetch location
// Mobile: wait for user to tap "Grant Permission"
useEffect(() => {
  if (!navigator.geolocation) return;

  if (!isMobile) {
    getCurrentPositionSafe()
      .then(pos => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocationPermission("granted");
      })
      .catch(err => {
        console.log("Desktop location denied:", err);
        setLocationPermission("denied");
      });
  }
}, []);

const requestLocation = async () => {
  try {
    const pos = await getCurrentPositionSafe();

    setUserLocation({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
    });

    setLocationPermission("granted");
    setShowLocationDialog(false);
  } catch (err) {
    console.log("Location denied/error:", err);
    setLocationPermission("denied");
    setShowLocationDialog(false);
    alert("Unable to get location. Enable location in app settings.");
  }
};

const requestMobileLocation = async () => {
  try {
    setShowLocationDialog(false);

    const success = (pos) => {
      setUserLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      setLocationPermission("granted");
    };

    const error = (err) => {
      console.log("Mobile geolocation error:", err);
      alert("Unable to get location. Please enable location permissions.");
      setLocationPermission("denied");
    };

    // Unified safe location function
    try {
      const pos = await getCurrentPositionSafe();
      success({ coords: pos.coords });
    } catch (err) {
      error(err);
    }
  } catch (e) {
    console.log("Mobile geolocation exception:", e);
    alert("Error fetching your location.");
    setLocationPermission("denied");
  }
};
  
  useEffect(() => {
    const fetchWeather = async () => {
      if (!WEATHER_API_KEY) {
        console.warn('⚠️ Weather API key not configured. Using mock data. Get your free key at https://www.weatherapi.com/');
        setWeather({
          temp: 28,
          condition: 'Partly Cloudy',
          humidity: 65,
          windSpeed: 12,
          feelsLike: 30
        });
        setWeatherAlerts([
          { 
            type: 'Heavy Rainfall', 
            severity: 'Moderate',
            category: 'Heavy rain',
            headline: 'Heavy rain expected',
            areas: 'Local area',
            effective: new Date().toISOString(),
            expires: new Date(Date.now() + 7200000).toISOString(),
            description: 'This is sample mock data. Add your WeatherAPI.com key to see real weather alerts.'
          }
        ]);
        return;
      }

      try {
        console.log('Fetching live weather data from WeatherAPI.com...');
        const weatherRes = await fetch(
          `https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${userLocation.lat},${userLocation.lng}&days=1&aqi=no&alerts=yes`
        );
        const weatherData = await weatherRes.json();
        
        if (weatherData.error) {
          console.error('Weather API Error:', weatherData.error.message);
          throw new Error(weatherData.error.message);
        }
        
        console.log('✓ Live weather data loaded successfully');
        setWeather({
          temp: Math.round(weatherData.current.temp_c),
          condition: weatherData.current.condition.text,
          humidity: weatherData.current.humidity,
          windSpeed: Math.round(weatherData.current.wind_kph),
          feelsLike: Math.round(weatherData.current.feelslike_c)
        });

        if (weatherData.alerts && weatherData.alerts.alert && weatherData.alerts.alert.length > 0) {
          console.log('⚠️ Active weather alerts found:', weatherData.alerts.alert.length);
          setWeatherAlerts(weatherData.alerts.alert.map(alert => ({
            type: alert.event || 'Weather Alert',
            severity: alert.severity || 'Moderate',
            category: alert.category || 'General',
            headline: alert.headline || alert.event,
            areas: alert.areas || 'Local area',
            effective: alert.effective,
            expires: alert.expires,
            description: alert.desc || alert.instruction || 'Weather alert in effect.'
          })));
        } else {
          console.log('✓ No active weather alerts');
          setWeatherAlerts([]);
        }
      } catch (error) {
        console.error('Failed to fetch weather data:', error);
        console.error('API URL was:', `https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${userLocation.lat},${userLocation.lng}&days=1&aqi=no&alerts=yes`);

        setWeather({
          temp: 28,
          condition: 'Data Unavailable',
          humidity: 65,
          windSpeed: 12,
          feelsLike: 30
        });
        setWeatherAlerts([]);
      }
    };

    if (isOnline) {
      fetchWeather();
      const interval = setInterval(fetchWeather, 300000); // Update every 5 minutes
      return () => clearInterval(interval);
    } else {
      setWeather({
        temp: 28,
        condition: 'Offline Mode',
        humidity: 65,
        windSpeed: 12,
        feelsLike: 30
      });
    }
  }, [userLocation, isOnline, WEATHER_API_KEY]);

// Initialize nearby resources when location is available
useEffect(() => {
  const loadNearbyResources = async () => {
    if (userLocation.lat && userLocation.lng) {
      console.log('Loading nearby emergency resources from Geoapify...');
      
      if (!GEOAPIFY_API_KEY || GEOAPIFY_API_KEY === '6a5a6eee4fb44c20bee69310910f4bdc') {
        // Use mock data if API key not configured
        console.log('Using mock data - Add your Geoapify API key for real data');
        const mockResources = [
          {
            id: 1,
            name: 'City General Hospital',
            type: 'healthcare',
            lat: userLocation.lat + 0.01,
            lng: userLocation.lng + 0.01,
            status: 'Emergency Available',
            distance: calculateDistance(userLocation.lat, userLocation.lng, userLocation.lat + 0.01, userLocation.lng + 0.01)
          },
          {
            id: 2,
            name: 'Community Medical Center',
            type: 'healthcare',
            lat: userLocation.lat + 0.015,
            lng: userLocation.lng - 0.005,
            status: 'Open 24/7',
            distance: calculateDistance(userLocation.lat, userLocation.lng, userLocation.lat + 0.015, userLocation.lng - 0.005)
          },
          {
            id: 3,
            name: 'District Health Clinic',
            type: 'healthcare',
            lat: userLocation.lat - 0.012,
            lng: userLocation.lng + 0.018,
            status: 'ICU Available',
            distance: calculateDistance(userLocation.lat, userLocation.lng, userLocation.lat - 0.012, userLocation.lng + 0.018)
          },
          {
            id: 4,
            name: 'Central Police Station',
            type: 'service',
            lat: userLocation.lat - 0.008,
            lng: userLocation.lng + 0.012,
            status: 'On Duty',
            distance: calculateDistance(userLocation.lat, userLocation.lng, userLocation.lat - 0.008, userLocation.lng + 0.012)
          },
          {
            id: 5,
            name: 'North District Police',
            type: 'service',
            lat: userLocation.lat + 0.013,
            lng: userLocation.lng + 0.008,
            status: '24/7 Active',
            distance: calculateDistance(userLocation.lat, userLocation.lng, userLocation.lat + 0.013, userLocation.lng + 0.008)
          },
          {
            id: 6,
            name: 'Fire Station Alpha',
            type: 'service',
            lat: userLocation.lat + 0.017,
            lng: userLocation.lng - 0.008,
            status: 'Ready',
            distance: calculateDistance(userLocation.lat, userLocation.lng, userLocation.lat + 0.017, userLocation.lng - 0.008)
          }
        ];
        
        mockResources.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
        setNearbyResources(mockResources);
      } else {
        // Fetch real data from Geoapify Places API
        const [hospitals, policeStations, fireStations, pharmacies] = await Promise.all([
          fetchNearbyPlaces(userLocation.lat, userLocation.lng, 'healthcare.hospital'),
          fetchNearbyPlaces(userLocation.lat, userLocation.lng, 'service.police'),
          fetchNearbyPlaces(userLocation.lat, userLocation.lng, 'service.fire_station'),
          fetchNearbyPlaces(userLocation.lat, userLocation.lng, 'healthcare.pharmacy')
        ]);
        
        const allResources = [...hospitals, ...policeStations, ...fireStations, ...pharmacies];
        allResources.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
        
        console.log('✓ All nearby resources loaded:', allResources.length);
        setNearbyResources(allResources);
      }
    }
  };
  
  loadNearbyResources();
}, [userLocation, GEOAPIFY_API_KEY]);

// Check for nearby createdEvents and send notifications
/*******************************
 * Ensure eventData.id is set after saving event
 *******************************/
// (Search for usage of saveEventToFirestore and ensure the returned ID is set)
// Example event creation logic (ensure this logic is present wherever a new event is created):
// const id = await saveEventToFirestore(eventData);
// eventData.id = id;
  useEffect(() => {
      const checkNearbycreatedEvents = () => {
        // Use LocalNotifications for native, fallback to Notification for web if needed
        // Here, always use LocalNotifications as per instructions
        const allcreatedEvents = [...createdEvents];
        allcreatedEvents.forEach(event => {
          const distance = parseFloat(calculateDistance(userLocation.lat, userLocation.lng, event.lat, event.lng));
          if (distance <= 1) {
            LocalNotifications.schedule({
              notifications: [
                {
                  title: "Nearby Emergency Event",
                  body: `${event.type} - ${distance} km away. ${eventVolunteers[event.id] || 0} volunteers responding.`,
                  id: Date.now(),
                  schedule: { at: new Date(Date.now() + 1000) },
                  sound: null,
                  attachments: null,
                  actionTypeId: "",
                  extra: null
                }
              ]
            });
          }
        });
      };

      if (locationPermission === 'granted') {
        checkNearbycreatedEvents();
        const interval = setInterval(checkNearbycreatedEvents, 60000); // Check every minute
        return () => clearInterval(interval);
      }
    }, [userLocation, createdEvents, createdEvents, eventVolunteers, locationPermission]);
  
    useEffect(() => {
      if (currentScreen === 'splash') {
        setTimeout(() => setCurrentScreen('home'), 2500);
      }
    }, [currentScreen]);

  const eventCodeColors = {
    action: "bg-red-100 text-red-700",
    resource: "bg-blue-100 text-blue-700",
    medical: "bg-green-100 text-green-700",
    fire: "bg-orange-100 text-orange-700",
    hospital: "bg-purple-100 text-purple-700",
    subtype: "bg-gray-200 text-gray-800"
  };

  const eventCodes = {
    action: [
      { code: 'V', subtype: 'Volunteer Needed', useCase: 'Immediate volunteer required' },
      { code: 'E', subtype: 'Equipment Needed', useCase: 'Will call you later' },
      { code: 'S', subtype: 'Specialized Help Needed', useCase: 'Expert Response like Medic etc.' },
      { code: 'R', subtype: 'Responders Needed', useCase: 'Police, Fire or Official Responders' }
    ],
    resource: [
      { code: 'M', subtype: 'Medical Needed', useCase: 'Standard Hospital or clinic' },
      { code: 'T', subtype: 'Transport Needed', useCase: 'Ambulance, Evacuation' },
      { code: 'X', subtype: 'Extended Support', useCase: 'Backup team or Additional resources' },
      { code: 'F', subtype: 'Food/Water Needed', useCase: 'Food, Water or Basic Supplies' }
    ],
    medical: [
      { code: 'M1', resource: 'Basic Medical', description: 'First Aid Box or basic medical injury' },
      { code: 'M2', resource: 'Enhanced Medical', description: 'Includes defibrillator, stretcher, oxygen' },
      { code: 'M3', resource: 'Full Medical Cluster', description: 'Complete medical setup' }
    ],
    fire: [
      { code: 'F1', resource: 'Fire Extinguisher', description: 'Basic fire equipment' },
      { code: 'F2', resource: 'Hydrant Available', description: 'Includes hydrant and hoses' },
      { code: 'F3', resource: 'Full Fire Cluster', description: 'Complete fire response setup' }
    ],
    hospital: [
      { code: 'H1', resource: 'Standard Hospital', description: 'Full operational hospital' },
      { code: 'H2', resource: 'Emergency Ready', description: 'Critical care ready' },
      { code: 'H3', resource: 'Full Critical Care', description: 'Complete emergency facilities' }
    ],
    subtype: [
      { code: 'C', subtype: 'Cardiac', useCase: 'Heart related' },
      { code: 'A', subtype: 'Assault', useCase: 'Violence or Physical Assault' },
      { code: 'B', subtype: 'Blood Loss', useCase: 'Severe Bleeding' },
      { code: 'F', subtype: 'Fracture', useCase: 'Bone Fractures' },
      { code: 'U', subtype: 'Unconscious', useCase: 'Person Unconscious' },
      { code: 'I', subtype: 'Injury', useCase: 'Severe Injuries' }
    ]
  };

  const emergencyContacts = {
    medical: {
      title: 'Medical Emergency',
      icon: '🏥',
      color: 'bg-red-600',
      numbers: [
        { name: 'Emergency Ambulance', number: '108', description: 'Free ambulance service' },
        { name: 'National Emergency', number: '112', description: 'All emergency services' },
        { name: 'Private Ambulance', number: '102', description: 'Alternative ambulance' }
      ]
    },
    police: {
      title: 'Police/Crime',
      icon: '👮',
      color: 'bg-blue-600',
      numbers: [
        { name: 'Police Emergency', number: '100', description: 'Police control room' },
        { name: 'National Emergency', number: '112', description: 'All emergency services' },
        { name: 'Women Helpline', number: '1091', description: 'Women safety' }
      ]
    },
    fire: {
      title: 'Fire Emergency',
      icon: '🔥',
      color: 'bg-orange-600',
      numbers: [
        { name: 'Fire Service', number: '101', description: 'Fire department' },
        { name: 'National Emergency', number: '112', description: 'All emergency services' }
      ]
    },
    accident: {
      title: 'Road Accident',
      icon: '🚗',
      color: 'bg-yellow-600',
      numbers: [
        { name: 'National Emergency', number: '112', description: 'All emergency services' },
        { name: 'Ambulance', number: '108', description: 'Medical assistance' },
        { name: 'Police', number: '100', description: 'Traffic police' }
      ]
    },
    disaster: {
      title: 'Natural Disaster',
      icon: '🏔️',
      color: 'bg-purple-600',
      numbers: [
        { name: 'National Emergency', number: '112', description: 'All emergency services' },
        { name: 'Disaster Helpline', number: '1078', description: 'Disaster management' },
        { name: 'NDRF', number: '011-24363260', description: 'National disaster response' }
      ]
    },

    flood: {
      title: 'Flood Emergency',
      icon: '🌊',
      color: 'bg-blue-700',
      numbers: [
        { name: 'National Emergency', number: '112', description: 'All emergency services' },
        { name: 'Flood Control', number: '1070', description: 'Flood control room' },
        { name: 'NDRF', number: '011-24363260', description: 'Rescue operations' }
      ]
    },
    mental: {
      title: 'Mental Health Crisis',
      icon: '🧠',
      color: 'bg-teal-600',
      numbers: [
        { name: 'Mental Health Helpline', number: '08046110007', description: 'Vandrevala Foundation' },
        { name: 'iCall', number: '9152987821', description: 'TISS counseling' },
        { name: 'NIMHANS', number: '080-46110007', description: 'Mental health support' }
      ]
    }
  };

  const startEmergencyTimer = (serviceName, number) => {
    const timerConfig = {
      '108': { duration: 5, service: 'Ambulance', icon: '🚑' },
      '100': { duration: 3, service: 'Police', icon: '🚓' },
      '101': { duration: 4, service: 'Fire Service', icon: '🚒' },
      '112': { duration: 4, service: 'Emergency Services', icon: '🚨' }
    };
    
    const config = timerConfig[number] || { duration: 5, service: serviceName, icon: '🚨' };
    const timerId = `timer_${Date.now()}`;
    const arrivalTime = new Date(Date.now() + config.duration * 60000);
    
    setEmergencyTimers(prev => ({
      ...prev,
      [timerId]: {
        service: config.service,
        icon: config.icon,
        startTime: new Date(),
        arrivalTime: arrivalTime,
        duration: config.duration,
        status: 'On Route',
        number: number
      }
    }));
    
    // Simulate arrival after timer expires
    setTimeout(() => {
      setEmergencyUpdates(prev => [{
        id: timerId,
        service: config.service,
        icon: config.icon,
        message: `${config.service} has arrived at your location`,
        time: new Date()
      }, ...prev]);
      
      setEmergencyTimers(prev => {
        const updated = { ...prev };
        if (updated[timerId]) {
          updated[timerId].status = 'Arrived';
        }
        return updated;
      });
    }, config.duration * 60000);
    
    return timerId;
  };

  const makeEmergencyCall = (number) => {
    const serviceMap = {
      '108': 'Ambulance',
      '100': 'Police',
      '101': 'Fire Service',
      '112': 'Emergency Services'
    };
    
    const serviceName = serviceMap[number] || 'Emergency Service';
    startEmergencyTimer(serviceName, number);
    setShowCallEndDialog(true);
    window.location.href = `tel:${number}`;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && pendingTimerCall) {
        setShowCallEndDialog(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
  };

  const confirmCallEnded = () => {
    if (pendingTimerCall) {
      startEmergencyTimer(pendingTimerCall.serviceName, pendingTimerCall.number);
      setShowCallEndDialog(false);
      setPendingTimerCall(null);
    }
  };



  const activities = [
    { id: 1, type: 'CVX', desc: 'Kannankudy Block, Varkala Jamath, Masjid...', time: 'Attended at 2:22 PM', date: '12.08.2024' },
    { id: 2, type: 'MVA', desc: 'Miyakanda Road, Rasool Pallikat, 4...Media', time: 'Attended at 1:30 PM', date: '10.08.2024' }
  ];

  const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return (R * c).toFixed(1);
  };

  if (currentScreen === 'splash') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-32 h-32 mx-auto mb-6 bg-gradient-to-br from-gray-700 to-gray-800 rounded-3xl flex items-center justify-center">
            <div className="text-center">
              <Heart className="w-12 h-12 text-red-500 mx-auto mb-2 animate-pulse" strokeWidth={2.5} />
              <div className="text-cyan-400 text-xs font-bold">REACH</div>
            </div>
          </div>
          <h1 className="text-white text-3xl font-bold mb-2">R.E.A.C.H</h1>
          <p className="text-gray-400 text-sm italic px-8">
            Rapid Emergency<br />Access, Care, and Help<br />Anytime, Anywhere.
          </p>
        </div>
      </div>
    );
  }

  if (currentScreen === 'home') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white px-4 py-3 flex items-center justify-between border-b">
          <div className="flex flex-col items-start">
            <span className="text-sm font-medium">{currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
            <span className="text-[10px] text-gray-500">{currentTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <span className="text-xs text-gray-500">Emergency Services</span>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowLocationDialog(true)}
              className="relative"
            >
              <MapPin className={`w-4 h-4 ${locationPermission === 'granted' ? 'text-green-500' : locationPermission === 'denied' ? 'text-red-500' : 'text-gray-400'}`} />
            </button>

            
		{isOnline ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : meshStatus === 'connected' ? (
              <Radio className="w-4 h-4 text-blue-500 animate-pulse" title="Mesh Network Active" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
          </div>        
	</div>

        {showLocationDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <MapPin className="w-6 h-6 text-blue-500" />
                <h3 className="text-lg font-bold">Location Access</h3>
              </div>
              
              {locationPermission === 'granted' ? (
                <div>
                  <p className="text-sm text-gray-600 mb-4">✓ Location access enabled</p>
                  <div className="bg-green-50 p-3 rounded-lg mb-4">
                    <p className="text-xs text-green-800 font-medium">📍 Current Location:</p>
                    <p className="text-sm text-green-900 mt-1">Latitude: {userLocation.lat.toFixed(6)}</p>
                    <p className="text-sm text-green-900">Longitude: {userLocation.lng.toFixed(6)}</p>
                  </div>
                  <p className="text-xs text-gray-500">Your location helps emergency services reach you faster.</p>
                </div>
              ) : locationPermission === 'denied' ? (
                <div>
                  <p className="text-sm text-gray-600 mb-4">⚠️ Location access denied</p>
                  <div className="bg-red-50 p-3 rounded-lg mb-4 border border-red-200">
                    <p className="text-xs text-red-800 font-medium">Using default location</p>
                    <p className="text-xs text-red-700 mt-1">Enable location in browser settings for accurate emergency response</p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-600 mb-4">Allow R.E.A.C.H to access your location for accurate emergency services.</p>
                  <button 
                    onClick={requestLocation}
                    className="w-full bg-blue-500 text-white py-3 rounded-lg font-medium mb-2 hover:bg-blue-600"
                  >
                    Grant Permission
                  </button>
                </div>
              )}
              
      <button
              onClick={ () => setShowLocationDialog(false) }
                className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setLocationPermission("denied");
                  setUserLocation({ lat: 12.9716, lng: 77.5946 }); // fallback default
                }}
                className="w-full bg-red-100 text-red-700 py-3 rounded-lg font-medium hover:bg-red-200 mt-2"
              >
                Remove Location Access
              </button>
            </div>
          </div>
        )}

        {!isOnline && meshStatus === 'connected' && (
          <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 animate-pulse" />
              <span className="text-sm font-medium">Mesh Network Active</span>
            </div>
            <button 
              onClick={() => setCurrentScreen('meshNetwork')}
              className="text-xs bg-white bg-opacity-20 px-2 py-1 rounded"
            >
              {meshPeers.length} Peers
            </button>
          </div>
        )}

        {weather && weatherAlerts.length > 0 && (
          <div onClick={() => setCurrentScreen('weatherAlert')} className="bg-red-600 text-white px-4 py-3 cursor-pointer hover:bg-red-700 transition-colors">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-sm">Weather Alert: {weatherAlerts[0].type}</p>
                <p className="text-xs opacity-90">Severity: {weatherAlerts[0].severity}</p>
              </div>
              <button className="bg-white text-red-600 px-3 py-1 rounded text-xs font-medium">View Details</button>
            </div>
          </div>
        )}

        {weather && (
          <div className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white px-4 py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs opacity-75">
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
              <span className="text-xs opacity-75">
                Updated: {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Thermometer className="w-5 h-5" />
                  <span className="text-3xl font-bold">{weather.temp}°C</span>
                </div>
                <p className="text-sm opacity-90 mt-1">{weather.condition}</p>
                <p className="text-xs opacity-75">Feels like {weather.feelsLike}°C</p>
              </div>
              <div className="text-right text-sm">
                <div className="flex items-center gap-1 justify-end mb-1">
                  <Wind className="w-4 h-4" />
                  <span>{weather.windSpeed} km/h</span>
                </div>
                <div className="flex items-center gap-1 justify-end">
                  <CloudRain className="w-4 h-4" />
                  <span>{weather.humidity}%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Active Emergency Response Timers */}
        {Object.entries(emergencyTimers).length > 0 && (
          <div className="mx-4 mt-4 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl p-4 shadow-lg">
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5 animate-pulse" />
              Active Emergency Response
            </h3>
            <div className="space-y-3">
              {Object.entries(emergencyTimers).map(([id, timer]) => {
                const timeLeft = Math.max(0, Math.floor((timer.arrivalTime - currentTime) / 1000));
                const minutes = Math.floor(timeLeft / 60);
                const seconds = timeLeft % 60;
                
                return (
                  <div key={id} className="bg-white bg-opacity-20 backdrop-blur-sm rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{timer.icon}</span>
                        <span className="font-bold">{timer.service}</span>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        timer.status === 'Arrived' 
                          ? 'bg-green-500' 
                          : 'bg-yellow-500 text-black animate-pulse'
                      }`}>
                        {timer.status}
                      </span>
                    </div>
                    
                    {timer.status === 'On Route' && timeLeft > 0 ? (
                      <div className="bg-black bg-opacity-30 rounded-lg p-3 mb-2">
                        <div className="flex items-baseline gap-2">
                          <div className="text-4xl font-bold tabular-nums">
                            {minutes}:{seconds.toString().padStart(2, '0')}
                          </div>
                          <span className="text-sm opacity-90">min remaining</span>
                        </div>
                        <div className="w-full bg-white bg-opacity-30 rounded-full h-2 mt-2">
                          <div 
                            className="bg-white h-2 rounded-full transition-all duration-1000"
                            style={{ 
                              width: `${((timer.duration * 60 - timeLeft) / (timer.duration * 60)) * 100}%` 
                            }}
                          />
                        </div>
                      </div>
                    ) : timer.status === 'Arrived' ? (
                      <div className="bg-green-500 bg-opacity-30 rounded-lg p-3 mb-2">
                        <p className="font-medium">✓ Service has arrived at location</p>
                      </div>
                    ) : null}
                    
                    <p className="text-xs opacity-75">
                      Called at {timer.startTime.toLocaleTimeString()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Emergency Updates */}
        {emergencyUpdates.length > 0 && (
          <div className="mx-4 mt-4 bg-white rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold mb-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-500" />
              Recent Updates
            </h3>
            <div className="space-y-2">
              {emergencyUpdates.slice(0, 3).map(update => (
                <div key={update.id} className="bg-green-50 rounded-lg p-3 border-l-4 border-green-500">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{update.icon}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-green-900">{update.message}</p>
                      <p className="text-xs text-green-700 mt-1">{update.time.toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 space-y-4 pb-24">
          <button onClick={() => setCurrentScreen('createEvent')} className="w-full bg-red-900 text-white rounded-2xl p-4 flex items-center justify-between hover:bg-gray-800 transition-colors">
            <div className="flex items-center gap-3">
              <PlusCircle className="w-5 h-5" />
              <span className="font-medium">Add Event</span>
            </div>
          </button>

          <button onClick={() => setCurrentScreen('requestForm')} className="w-full bg-gray-900 text-white rounded-2xl p-4 flex items-center justify-between hover:bg-gray-800 transition-colors">
            <div className="flex items-center gap-3">
              <Edit className="w-5 h-5" />
              <span className="font-medium">Request Resources</span>
            </div>
          </button>

          <button
            onClick={() => setCurrentScreen("requestList")}
            className="w-full bg-blue-600 text-white rounded-2xl p-4 flex items-center justify-between hover:bg-blue-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5" />
              <span className="font-medium">View Requested Resources</span>
            </div>
          </button>

          <button onClick={() => setShowEmergencyCallMenu(true)} className="w-full bg-red-900 text-white rounded-2xl p-4 flex items-center justify-between hover:bg-gray-800 transition-colors">
            <div className="flex items-center gap-3">
              <Phone className="w-5 h-5" />
              <span className="font-medium">Emergency Call</span>
            </div>
          </button>
{showCallEndDialog && (
            <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
                <h3 className="text-lg font-bold mb-4">Emergency Call</h3>
                <p className="text-sm text-gray-600 mb-6">
                  Has your emergency call ended? We'll start tracking the response time.
                </p>
                <button
                  onClick={confirmCallEnded}
                  className="w-full bg-blue-500 text-white py-3 rounded-lg font-medium mb-2 hover:bg-blue-600"
                >
                  Call Ended - Start Timer
                </button>
                <button
                  onClick={() => setShowCallEndDialog(false)}
                  className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200"
                >
                  Still on Call
                </button>
              </div>
            </div>
          )}

          {showEmergencyCallMenu && (
            <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end justify-center">
              <div className="bg-white rounded-t-3xl w-full max-h-[80vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b px-4 py-4 flex items-center justify-between">
                  <h3 className="text-lg font-bold">Select Emergency Type</h3>
                  <button onClick={() => setShowEmergencyCallMenu(false)} className="text-gray-500 text-2xl">×</button>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3">
                  {Object.entries(emergencyContacts).map(([key, emergency]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setSelectedEmergencyType(key);
                        setShowEmergencyCallMenu(false);
                        setCurrentScreen('emergencyNumbers');
                      }}
                      className={`${emergency.color} text-white rounded-2xl p-4 text-center hover:opacity-90 transition-opacity`}
                    >
                      <div className="text-3xl mb-2">{emergency.icon}</div>
                      <p className="font-semibold text-sm">{emergency.title}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        <BottomNav currentScreen={currentScreen} setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

  if (currentScreen === 'emergencyNumbers' && selectedEmergencyType) {
    const emergency = emergencyContacts[selectedEmergencyType];
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title={emergency.title} onBack={() => setCurrentScreen('home')} />
        <div className="p-4 pb-24">
          <div className={`${emergency.color} text-white rounded-2xl p-6 mb-4 text-center`}>
            <div className="text-5xl mb-3">{emergency.icon}</div>
            <h2 className="text-2xl font-bold">{emergency.title}</h2>
            <p className="text-sm opacity-90 mt-2">Tap any number to call immediately</p>
          </div>

          <div className="space-y-3">
            {emergency.numbers.map((contact, idx) => (
              <button
                key={idx}
                onClick={() => makeEmergencyCall(contact.number)}
                className="w-full bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="text-left flex-1">
                    <h3 className="font-bold text-lg">{contact.name}</h3>
                    <p className="text-sm text-gray-600">{contact.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-blue-600">{contact.number}</span>
                    <Phone className="w-5 h-5 text-green-600" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
            <h3 className="font-bold text-yellow-900 mb-2">⚠️ Important</h3>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>• Stay calm and speak clearly</li>
              <li>• Provide your exact location</li>
              <li>• Describe the emergency situation</li>
              <li>• Follow dispatcher instructions</li>
            </ul>
          </div>
        </div>
        <BottomNav currentScreen="home" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

  if (currentScreen === 'weatherAlert') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Weather Alert" onBack={() => setCurrentScreen('home')} />
        <div className="relative pb-24">
          <div className="h-96 relative">
            <MapContainer 
              center={[userLocation.lat, userLocation.lng]} 
              zoom={8} 
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap'
              />
              <Marker position={[userLocation.lat, userLocation.lng]} icon={createCustomIcon('#3B82F6')}>
                <Popup>Your Location</Popup>
              </Marker>
              <Circle center={[userLocation.lat, userLocation.lng]} radius={10000} color="#DC2626" fillOpacity={0.1} />
            </MapContainer>
            <div className="absolute top-4 left-4 bg-white px-3 py-2 rounded-lg shadow-lg z-[1000]">
              <p className="text-xs font-semibold text-red-600">⚠️ Active Weather Alert</p>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {weatherAlerts.length > 0 ? (
              weatherAlerts.map((alert, idx) => (
                <div key={idx} className="bg-red-600 text-white rounded-2xl p-4 min-h-[35vh] shadow-lg">
                  <div className="flex items-start gap-2 mb-3">
                    <AlertCircle className="w-6 h-6 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-bold text-lg">{alert.headline || alert.type}</p>
                      <p className="text-sm mt-1 opacity-90">Category: {alert.category}</p>
                      <p className="text-sm opacity-90">Severity: {alert.severity}</p>
                    </div>
                  </div>
                  
                  {alert.description && (
                    <div className="bg-white bg-opacity-20 rounded-lg p-3 mb-3">
                      <p className="text-sm">{alert.description}</p>
                    </div>
                  )}
                  
                  {alert.areas && (
                    <p className="text-xs opacity-75 mb-1">📍 Affected Areas: {alert.areas}</p>
                  )}
                  
                  <div className="flex justify-between text-xs opacity-75 mt-2">
                    {alert.effective && (
                      <span>From: {new Date(alert.effective).toLocaleString()}</span>
                    )}
                    {alert.expires && (
                      <span>Until: {new Date(alert.expires).toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
                <p className="text-green-800 font-medium">✓ No active weather alerts</p>
                <p className="text-sm text-green-600 mt-1">Weather conditions are currently normal</p>
              </div>
            )}

            {weather && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h3 className="font-bold mb-3 flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-blue-500" />
                  Current Conditions
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 p-3 rounded-lg">
                    <Thermometer className="w-5 h-5 text-blue-600 mb-1" />
                    <p className="text-xs text-gray-600">Temperature</p>
                    <p className="text-xl font-bold text-blue-900">{weather.temp}°C</p>
                    <p className="text-xs text-gray-500">Feels like {weather.feelsLike}°C</p>
                  </div>
                  <div className="bg-cyan-50 p-3 rounded-lg">
                    <Wind className="w-5 h-5 text-cyan-600 mb-1" />
                    <p className="text-xs text-gray-600">Wind Speed</p>
                    <p className="text-xl font-bold text-cyan-900">{weather.windSpeed} km/h</p>
                  </div>
                  <div className="bg-indigo-50 p-3 rounded-lg">
                    <CloudRain className="w-5 h-5 text-indigo-600 mb-1" />
                    <p className="text-xs text-gray-600">Humidity</p>
                    <p className="text-xl font-bold text-indigo-900">{weather.humidity}%</p>
                  </div>
                  <div className="bg-purple-50 p-3 rounded-lg">
                    <Cloud className="w-5 h-5 text-purple-600 mb-1" />
                    <p className="text-xs text-gray-600">Condition</p>
                    <p className="text-base font-bold text-purple-900">{weather.condition}</p>
                  </div>
                </div>
              </div>
            )}

            {weatherAlerts.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
                <h3 className="font-bold mb-2 text-yellow-900">⚠️ Safety Tips</h3>
                <ul className="text-sm text-yellow-800 space-y-1">
                  <li>• Stay indoors if possible</li>
                  <li>• Keep emergency contacts ready</li>
                  <li>• Monitor weather updates regularly</li>
                  <li>• Avoid travel unless necessary</li>
                </ul>
              </div>
            )}
          </div>
        </div>
        <BottomNav currentScreen="home" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

 
  /*******************************
 * REQUEST FORM (NEW VERSION)
 *******************************/
if (currentScreen === "requestForm") {

  const submitRequest = async () => {
    if (!reqName || !reqContact || !reqDescription) {
      alert("Please fill all fields");
      return;
    }

    const newReq = {
      userId: auth.currentUser?.uid || "unknown",
      name: reqName,
      contact: reqContact,
      description: reqDescription,
      location: {
        lat: userLocation.lat,
        lng: userLocation.lng,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      await addDoc(collection(db, "resourceRequests"), newReq);

      alert("Request submitted!");
      setCurrentScreen("requestList"); // redirect to listing page
    } catch (err) {
      console.error("Failed to save request:", err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Request Form" onBack={() => setCurrentScreen("home")} />

      <div className="p-4 space-y-4 pb-24">
        <div className="bg-white rounded-2xl p-4 space-y-4">
          
          {/* NAME */}
          <div>
            <label className="block text-sm font-semibold mb-2">Name</label>
            <input
              type="text"
              value={reqName}
              onChange={(e) => setReqName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg"
              placeholder="Enter your name"
            />
          </div>

          {/* LOCATION */}
          <div>
            <label className="block text-sm font-semibold mb-2">Location</label>
            <input
              type="text"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg"
              value={`${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`}
              readOnly
            />
          </div>

          {/* CONTACT */}
          <div>
            <label className="block text-sm font-semibold mb-2">Contact</label>
            <input
              type="tel"
              value={reqContact}
              onChange={(e) => setReqContact(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg"
              placeholder="Enter contact number"
            />
          </div>

          {/* DESCRIPTION */}
          <div>
            <label className="block text-sm font-semibold mb-2">Description</label>
            <textarea
              value={reqDescription}
              onChange={(e) => setReqDescription(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg"
              placeholder="Describe what assistance you need"
            />
            <p className="text-xs text-gray-500 mt-2">
              *Please provide details of assistance needed
            </p>
          </div>

          {/* SUBMIT BUTTON */}
          <button
            onClick={submitRequest}
            className="w-full bg-gray-900 text-white rounded-lg py-3 font-semibold hover:bg-gray-800"
          >
            Request
          </button>

          {/* VIEW PREVIOUS REQUESTS DROPDOWN */}
          <button
            onClick={() => setShowReqDropdown(prev => !prev)}
            className="w-full bg-blue-500 text-white rounded-lg py-3 font-semibold mt-2"
          >
            {showReqDropdown ? "Hide Requested Resources" : "View Requested Resources"}
          </button>

          {showReqDropdown && (
            <div className="bg-white rounded-xl p-4 mt-3 space-y-3 shadow">
              {requests.length === 0 ? (
                <p className="text-gray-500 text-sm text-center">No requests yet.</p>
              ) : (
                requests.map((r) => (
                  <div key={r.id} className="border rounded-lg p-3">
                    <p className="font-semibold text-sm">{r.name}</p>
                    <p className="text-gray-600 text-sm mt-1">{r.description}</p>
                    <p className="text-xs text-gray-400 mt-1">📍 {r.location.lat.toFixed(4)}, {r.location.lng.toFixed(4)}</p>
                    <p className="text-xs text-gray-400">📞 {r.contact}</p>
                    <p className="text-xs text-gray-400 mt-1">⏱ {new Date(r.timestamp).toLocaleString()}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <BottomNav currentScreen="home" setCurrentScreen={setCurrentScreen} />
    </div>
  );
}

/*******************************
 * REQUEST LIST SCREEN
 *******************************/




/*******************************
 * REQUEST LIST SCREEN
 *******************************/

/* Load resource requests globally */

if (currentScreen === "requestList") {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Requested Resources" onBack={() => setCurrentScreen("home")} />

      <div className="p-4 space-y-4 pb-24">
        {requests.length === 0 ? (
          <p className="text-center text-gray-500 py-10">No requests submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div key={r.id} className="bg-white rounded-lg p-4 shadow">
                <p className="text-sm font-semibold">{r.name}</p>
                <p className="text-gray-600 text-sm mt-1">{r.description}</p>
                <p className="text-xs text-gray-400 mt-2">
                  📍 {r.location.lat.toFixed(4)}, {r.location.lng.toFixed(4)}
                </p>
                <p className="text-xs text-gray-400">
                  📞 {r.contact}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  ⏱ {new Date(r.timestamp).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => setCurrentScreen("requestForm")}
          className="w-full bg-blue-500 text-white rounded-lg py-3 font-semibold mt-4"
        >
          Make Another Request
        </button>
      </div>

      <BottomNav currentScreen="home" setCurrentScreen={setCurrentScreen} />
    </div>
  );
}

if (currentScreen === 'navigation' && selectedResource) {
  const destination = selectedResource;
  
  const routePath = routeCoordinates.length > 0 ? routeCoordinates : [
    [userLocation.lat, userLocation.lng],
    [destination.lat, destination.lng]
  ];
  
  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="" onBack={() => {
        setCurrentScreen('map');
        setSelectedResource(null);
      }} />
      <div className="relative h-screen pb-24">
        <div className="h-full">
          <MapContainer 
            center={[userLocation.lat + 0.005, userLocation.lng + 0.005]} 
            zoom={14} 
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
  <Marker position={[userLocation.lat, userLocation.lng]} icon={L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-	markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-	shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
    })}
  >
              <Popup>Your Location</Popup>
            </Marker>
            <Marker position={[destination.lat, destination.lng]} icon={createCustomIcon(
              destination.type === 'healthcare' ? '#DC2626' :
              destination.type === 'service' ? '#2563EB' :
              '#F59E0B'
            )}>
              <Popup>{destination.name}</Popup>
            </Marker>
            <Polyline positions={routePath} color="#FF6B35" weight={4} />
          </MapContainer>
        </div>
        <div className="absolute top-4 left-4 right-4 bg-white rounded-2xl p-4 shadow-lg z-[1000]">
          <div className="flex items-center justify-between">
            <button className="p-2" onClick={() => {
              setCurrentScreen('map');
              setSelectedResource(null);
            }}>
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold text-orange-500">ETA - {Math.round(parseFloat(destination.distance) * 5)} min</p>
              <p className="text-xs text-gray-500">{destination.distance} km via Main Route</p>
            </div>
            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
              <Navigation className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 bg-green-50 rounded-lg px-3 py-2 flex items-center justify-center gap-2">
            <Activity className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700 font-medium">On Route to {destination.name}</span>
          </div>
        </div>
      </div>
      <BottomNav currentScreen="map" setCurrentScreen={setCurrentScreen} />
    </div>
  );
}
  if (currentScreen === 'activityHistory') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Activity History" onBack={() => setCurrentScreen('profile')} />
        <div className="p-4">
          <div className="mb-4">
            <div className="relative">
              <input type="text" placeholder="Search" className="w-full px-4 py-2 pl-10 bg-gray-100 rounded-lg" />
              <div className="absolute left-3 top-2.5 text-gray-400">🔍</div>
            </div>
          </div>
<div className="space-y-3 pb-24">
  {userActivities.length > 0 ? userActivities.map(activity => (
    <div key={activity.id} className="bg-red-500 text-white rounded-2xl p-4">
      <div className="flex justify-between items-start mb-2">
       	<h3 className="font-bold text-lg">{activity.type}</h3>
       	<span className="bg-blue-500 px-3 py-1 rounded-full text-xs">See more</span>
      	</div>
      	<p className="text-sm opacity-90 mb-2">{activity.desc}</p>
      	<div className="flex justify-between items-center text-xs">
        	<span>{activity.time}</span>
        	<span>{activity.date}</span>
      	</div>
    	</div>
 	 )) : (
    	<div className="bg-white rounded-2xl p-6 text-center">
      	<p className="text-gray-500">No activity history yet</p>
      	<p className="text-sm text-gray-400 mt-2">Your volunteer responses and created createdEvents 	will appear here</p>
   	 </div>
  	)}
	</div>
        </div>
        <BottomNav currentScreen="profile" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

  if (currentScreen === 'eventCodes') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Event Codes" onBack={() => setCurrentScreen('profile')} />
        <div className="p-4 pb-24">
          <div className="mb-4">
            <div className="relative">
              <input type="text" placeholder="Search" className="w-full px-4 py-2 pl-10 bg-gray-100 rounded-lg" />
              <div className="absolute left-3 top-2.5 text-gray-400">🔍</div>
            </div>
          </div>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
            {['action', 'resource', 'medical', 'fire', 'hospital', 'subtype'].map(cat => (
              <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${selectedCategory === cat ? 'bg-blue-500 text-white' : 'bg-white text-gray-700'}`}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Code</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Type</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {eventCodes[selectedCategory].map((item, idx) => (
                  <tr key={idx} className="border-t border-gray-100">
                    <td className="px-4 py-3 text-sm font-medium">
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${eventCodeColors[selectedCategory]}`}>
                        {item.code}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{item.subtype || item.resource}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.useCase || item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <BottomNav currentScreen="profile" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }
 /*******************************
  * EVENT DETAIL SCREEN (CLEAN)
  *******************************/
  if (currentScreen === "eventDetail" && selectedEvent) {
    const isCreator = createdEvents.some((e) => e.id === selectedEvent.id);

    // Add tab state at top of component if missing

    // 🔥 Firestore Live Chat Listener

    // Reverse geocode helper for full address
    const fetchExactAddress = async (lat, lng) => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        const data = await res.json();
        if (data?.display_name) {
          return data.display_name;
        }
      } catch (e) {
        console.error("Reverse geocode failed:", e);
      }
      return null;
    };


    return (
      <div className="min-h-screen bg-gray-50">
        <Header
          title="Event Details"
          onBack={() => setCurrentScreen("createdEvents")}
        />

        {/* MAP */}
        <div className="h-64">
          <MapContainer
            center={[selectedEvent.lat, selectedEvent.lng]}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={createCustomIcon("#3B82F6")}
            >
              <Popup>Your Location</Popup>
            </Marker>
            <Marker
              position={[selectedEvent.lat, selectedEvent.lng]}
              icon={createCustomIcon(selectedEvent.color)}
            >
              <Popup>{selectedEvent.type}</Popup>
            </Marker>

            {/* Simple polyline route */}
            <Polyline
              positions={[
                [userLocation.lat, userLocation.lng],
                [
                  userLocation.lat +
                    (selectedEvent.lat - userLocation.lat) * 0.3,
                  userLocation.lng +
                    (selectedEvent.lng - userLocation.lng) * 0.3,
                ],
                [
                  userLocation.lat +
                    (selectedEvent.lat - userLocation.lat) * 0.7,
                  userLocation.lng +
                    (selectedEvent.lng - userLocation.lng) * 0.7,
                ],
                [selectedEvent.lat, selectedEvent.lng],
              ]}
              color="#3B82F6"
              weight={4}
            />
          </MapContainer>
        </div>

        {/* DETAIL CONTENT */}
        <div className="p-4 space-y-4 pb-24">
          {/* EVENT CARD */}
          <div className="bg-red-600 text-white rounded-2xl p-4 min-h-[20vh]">
            <div className="flex flex-col gap-3 mb-2">
              <div className="flex justify-between items-start">
                <h2 className="font-bold text-xl">{selectedEvent.type}</h2>

                {/* CREATOR ACTIONS */}
                {isCreator && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingEvent({ ...selectedEvent });
                        setCurrentScreen("editEvent");
                      }}
                      className="bg-white bg-opacity-20 p-2 rounded-lg hover:bg-opacity-30"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEventToDelete(selectedEvent.id);
                        setShowDeleteConfirm(true);
                      }}
                      className="bg-white bg-opacity-20 p-2 rounded-lg hover:bg-opacity-30"
                    >
                      <Trash className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* START TIME + LOCATION (moved up) */}
              <div className="mt-1">
                <p className="text-sm mb-1">Start Time: {selectedEvent.time?.split(' - ')[0]}</p>

                <div className="flex items-center gap-2 mb-1">
                  <button
                    onClick={() => {
                      // set selected resource and open navigation to this event
                      try {
                        setSelectedResource({ lat: selectedEvent.lat, lng: selectedEvent.lng, name: selectedEvent.location });
                      } catch (e) {
                        // fallback if setSelectedResource not present
                        window.selectedResource = { lat: selectedEvent.lat, lng: selectedEvent.lng, name: selectedEvent.location };
                      }
                      setCurrentScreen('navigation');
                    }}
                    className="flex items-center gap-2 text-sm text-white"
                    title="Open map and get directions"
                  >
                    {/* REPLACE LOCATION DISPLAY BLOCK */}
                    <div className="flex items-center gap-2 mb-1">
                      <MapPin className="w-4 h-4" />
                      <span>
                        {selectedEvent.exactAddress
                          ? selectedEvent.exactAddress
                          : selectedEvent.location}
                      </span>
                    </div>
                  </button>
                </div>

                <p className="text-sm mb-3 opacity-90">Distance: {calculateDistance(userLocation.lat, userLocation.lng, selectedEvent.lat, selectedEvent.lng)} km away</p>
              </div>

              {/* EVENT DESCRIPTION */}
              {selectedEvent.description && (
                <div className="bg-white bg-opacity-20 text-white rounded-lg p-3 text-sm">
                  <p className="font-medium mb-1">Description</p>
                  <p className="text-sm text-white/95">{selectedEvent.description}</p>
                  {/* show exact coordinates too */}
                  <p className="text-xs text-white/75 mt-2">📍 {selectedEvent.lat.toFixed(5)}, {selectedEvent.lng.toFixed(5)}</p>
                </div>
              )}

              {/* VOLUNTEERS + RESPOND BUTTON (moved below description) */}
              <div className="flex items-center justify-between mt-2">
                <div className="bg-white rounded-lg p-3 text-gray-900 flex items-center gap-2 flex-1">
                  <Users className="w-5 h-5 text-blue-500" />
                  <span className="font-bold">
                    {eventVolunteers[selectedEvent.id] || 0} Volunteer{(eventVolunteers[selectedEvent.id] || 0) !== 1 ? 's' : ''} Responding
                  </span>
                </div>

                <div className="ml-3">
                  <button
                    onClick={() => {
                      if (!userRespondingTo.includes(selectedEvent.id)) {
                        setEventVolunteers({
                          ...eventVolunteers,
                          [selectedEvent.id]: (eventVolunteers[selectedEvent.id] || 0) + 1,
                        });
                        setUserRespondingTo([...userRespondingTo, selectedEvent.id]);

                        setUserActivities((prev) => [
                          {
                            id: Date.now(),
                            type: 'Volunteer Response',
                            eventType: selectedEvent.type,
                            desc: `Volunteered for ${selectedEvent.type} at ${selectedEvent.location}`,
                            time: new Date().toLocaleTimeString(),
                            date: new Date().toLocaleDateString('en-GB'),
                          },
                          ...prev,
                        ]);
                      }
                    }}
                    disabled={userRespondingTo.includes(selectedEvent.id)}
                    className={`${
                      userRespondingTo.includes(selectedEvent.id) ? 'bg-green-500 text-white' : 'bg-white text-red-600'
                    } px-4 py-2 rounded-lg font-medium`}
                  >
                    {userRespondingTo.includes(selectedEvent.id) ? '✓ Responding' : 'I am responding'}
                  </button>
                </div>
              </div>

              {/* TABS: Updates | Chat | Media (black background, unselected text white) */}
              <div className="mt-3 rounded-lg p-1 bg-black">
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveEventTab('updates')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${activeEventTab === 'updates' ? 'bg-white text-black' : 'bg-transparent text-white'}`}
                  >
                    Updates
                  </button>

                  <button
                    onClick={() => setActiveEventTab('chat')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${activeEventTab === 'chat' ? 'bg-white text-black' : 'bg-transparent text-white'}`}
                  >
                    Chat ({(chatMessages[selectedEvent.id] || []).length})
                  </button>

                  <button
                    onClick={() => setActiveEventTab('media')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${activeEventTab === 'media' ? 'bg-white text-black' : 'bg-transparent text-white'}`}
                  >
                    Media ({(selectedEvent.mediaFiles || []).length})
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SUBSCREEN: Updates | Chat | Media (inline, swap by activeEventTab) */}
          <div className="mt-4">
            {activeEventTab === 'updates' && (
              <div className="bg-white rounded-2xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold">Updates</h3>
                  <button className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm">See more</button>
                </div>

                <div className="space-y-2">
                  {[
                    'Volunteer Arrived at Scene',
                    'ETA confirmed for Ambulance',
                    'Paramedic en route',
                  ].map((update, idx) => (
                    <div key={idx} className="bg-red-50 rounded-lg p-3 text-sm">
                      <p className="text-red-800">{update}</p>
                      <p className="text-gray-500 text-xs mt-1">{5 + idx * 3} mins ago</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

                            {/* ================= CHAT TAB ================= */}
                {activeEventTab === "chat" && (
                  <div className="bg-black text-white rounded-2xl p-4 flex flex-col" style={{ minHeight: "60vh" }}>
                    
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold">Event Chat</h3>
                      <button
                        onClick={() => setIsChatMaximized(prev => !prev)}
                        className="px-2 py-1 bg-gray-800 rounded"
                      >
                        {isChatMaximized ? "Minimize" : "Maximize"}
                      </button>
                    </div>

                    {/* Messages */}
                    <div className="bg-gray-900 rounded-lg p-3 mb-3 overflow-y-auto flex-1 min-h-0">
                      {(!eventMessages || eventMessages.length === 0) ? (
                        <p className="text-sm text-gray-300 text-center py-4">No messages yet.</p>
                      ) : (
                        eventMessages.map((msg, i) => {
                          const isMine = msg.userId === auth.currentUser?.uid || msg.sender === "You";
                          const timeStr = msg.timestamp
                            ? (msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp))
                                .toLocaleString("en-GB", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  day: "2-digit",
                                  month: "short",
                                })
                            : "";

                          return (
                            <div key={i} className={`mb-3 flex ${isMine ? "justify-end" : "justify-start"}`}>
                              <div className={`inline-block max-w-[80%] rounded-lg p-3 ${isMine ? "bg-blue-500 text-white" : "bg-gray-700 text-white"}`}>
                                
                                {/* Sender */}
                                <div className="text-xs font-semibold mb-1">
                                  {msg.sender} {msg.isVolunteer ? "(Volunteer)" : "(Bystander)"}
                                </div>

                                {/* TEXT */}
                                {msg.text && <div className="text-sm mb-1">{msg.text}</div>}

                                {/* IMAGE */}
                                {msg.media?.type === "image" && (
                                  <img
                                    src={msg.media.url}
                                    className="mt-2 rounded-lg"
                                    style={{ maxWidth: "180px", maxHeight: "180px", objectFit: "cover" }}
                                    alt=""
                                  />
                                )}

                                {/* VIDEO */}
                                {msg.media?.type === "video" && (
                                  <video
                                    src={msg.media.url}
                                    controls
                                    className="mt-2 rounded-lg"
                                    style={{ maxWidth: "200px" }}
                                  />
                                )}

                                {/* AUDIO */}
                                {msg.media?.type === "audio" && (
                                  <audio src={msg.media.url} controls className="mt-2 w-full" />
                                )}

                                {/* Time */}
                                <div className="text-xs opacity-75 mt-2 text-right">{timeStr}</div>
                              </div>
                            </div>
                          );
                        })
                      )}

                      {/* Typing indicator */}
                      {isTyping && (
                        <div className="text-left mt-1">
                          <div className="inline-block bg-gray-700 text-white px-3 py-1 rounded-lg text-xs opacity-80 animate-pulse">
                            Someone is typing…
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Input Row */}
                    <div className="p-3 border-t bg-white flex items-center gap-2">

                      {/* Record button */}
                      <button
                        onMouseDown={startAudioRecording}
                        onMouseUp={stopAudioRecording}
                        onTouchStart={startAudioRecording}
                        onTouchEnd={stopAudioRecording}
                        className={`p-2 rounded-lg ${recording ? "bg-red-400 text-white" : "bg-gray-200"}`}
                      >
                        {recording ? "● REC" : "🎤"}
                      </button>

                      {/* Stop button */}
                      <button
                        onClick={stopAudioRecording}
                        className="p-2 rounded-lg bg-red-500 text-white"
                      >
                        ⏹
                      </button>

                      {/* File upload */}
                      <button
                        onClick={() => chatFileInputRef.current?.click()}
                        className="p-2 rounded-lg bg-gray-200"
                      >
                        📎
                      </button>

                      {/* Message input */}
                      <input
                        type="text"
                        value={currentChatMessage}
                        onChange={(e) => setCurrentChatMessage(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendTextMessage(selectedEvent.id)}
                        placeholder="Type a message…"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-white text-black"
                      />

                      {/* Send button */}
                      <button
                        onClick={() => sendTextMessage(selectedEvent.id)}
                        className="bg-blue-500 text-white px-4 py-2 rounded-lg"
                      >
                        Send
                      </button>
                    </div>

                    {/* Hidden file input */}
                    <input
                      ref={chatFileInputRef}
                      type="file"
                      accept="image/*,video/*,audio/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;

                        let type = "image";
                        if (f.type.startsWith("video")) type = "video";
                        if (f.type.startsWith("audio")) type = "audio";

                        await uploadAndSendMedia(f, type);
                        e.target.value = null;
                      }}
                    />
                  </div>
                )}
                
{activeEventTab === 'media' && (
  <div id="mediaSection" className="bg-black text-white rounded-2xl p-4 space-y-4">
    <h3 className="font-bold mb-2">Event Media</h3>

    {selectedEvent.mediaFiles?.length > 0 ? (
      <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
        {selectedEvent.mediaFiles.map((media, idx) => (
          <div
            key={idx}
            className="relative overflow-hidden cursor-pointer aspect-square flex items-center justify-center"
            onClick={() => {
              setFullscreenMediaIndex(idx);
              setShowFullscreenMedia(true);
            }}
          >
            {/* IMAGE THUMBNAIL (reduced size) */}
            {media.type === 'image' ? (
              <img
                src={media.url}
                alt="event-media"
                className="w-full h-full object-cover"
                style={{ maxWidth: '300px', maxHeight: '300px' }}
              />

            ) : media.type === 'audio' ? (
              /* AUDIO THUMBNAIL - show small bubble with play button */
              <div className="p-3 w-full flex items-center justify-center">
                <AudioBubble url={media.url} isMine={false} />
              </div>

            ) : (
              /* VIDEO THUMBNAIL (no autoplay) */
              <video src={media.url} className="w-full h-full object-cover" />
            )}

            {/* NOTE: delete moved to slideshow (no overlay here) */}
          </div>
        ))}
      </div>
    ) : (
      <p className="text-gray-300 text-sm">No media uploaded yet.</p>
    )}

    <button onClick={() => document.getElementById('addMoreMediaInput').click()} className="w-full bg-white text-black border border-gray-300 rounded-lg p-3 flex items-center justify-center gap-2">
      <Upload className="w-5 h-5" /> Add More Media
    </button>

    <input
      id="addMoreMediaInput"
      type="file"
      accept="image/*,video/*,audio/*"
      multiple
      className="hidden"
      onChange={async (e) => {
        const files = Array.from(e.target.files || []);
        for (const f of files) {
          const type = f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image';
          await uploadAndSendMedia(f, type);
        }
        e.target.value = null;
      }}
    />

    {/* ============ Fullscreen Slideshow Modal ============ */}
    {showFullscreenMedia && selectedEvent && (
      <div className="fixed inset-0 z-50 bg-black bg-opacity-80 flex items-center justify-center p-4">
        <div className="relative w-full max-w-4xl bg-transparent">
          {/* Header: slide index + close */}
          <div className="flex items-center justify-between mb-3 text-white">
            <div className="text-sm">{(fullscreenMediaIndex + 1)}/{(selectedEvent.mediaFiles || []).length}</div>
            <div className="flex gap-2">
              <button onClick={() => setShowFullscreenMedia(false)} className="px-3 py-1 bg-white bg-opacity-10 rounded">Close</button>
            </div>
          </div>
          {/* Custom Slideshow Block */}
          <div className="w-full flex flex-col items-center justify-center text-white">
            {/* Slide content (no borders) */}
            <div className="flex items-center justify-center mb-4" style={{ maxHeight: '70vh' }}>
              {(() => {
                const media = (selectedEvent.mediaFiles || [])[fullscreenMediaIndex];
                if (!media) return null;

                if (media.type === 'image') {
                  return (
                    <img src={media.url} className="max-h-[70vh] max-w-full object-contain" alt="slide" />
                  );
                }

                if (media.type === 'video') {
                  return (
                    <video src={media.url} controls className="max-h-[70vh] max-w-full" />
                  );
                }

                if (media.type === 'audio') {
                  return (
                    <div className="p-6 bg-gray-900 rounded-lg flex items-center justify-center">
                      <AudioBubble url={media.url} isMine={true} />
                    </div>
                  );
                }

                return null;
              })()}
            </div>
            {/* Prev / Delete / Next (below the media, centered) */}
            <div className="flex items-center justify-center gap-6 mt-4">
              <button
                onClick={() => setFullscreenMediaIndex(i => Math.max(0, i - 1))}
                className="px-4 py-2 bg-white bg-opacity-10 rounded-lg text-white"
              >
                ◀ Prev
              </button>
              <button
                onClick={async () => {
                  const media = selectedEvent.mediaFiles[fullscreenMediaIndex];
                  await deleteMediaItem(selectedEvent.id, media);
                
                  const updated = selectedEvent.mediaFiles.filter(
                    (_, i) => i !== fullscreenMediaIndex
                  );
                
                  if (updated.length === 0) {
                    setShowFullscreenMedia(false);
                  } else {
                    setFullscreenMediaIndex(i =>
                      Math.min(updated.length - 1, i)
                    );
                  }
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg"
              >
                Delete
              </button>
              <button
                onClick={() => setFullscreenMediaIndex(i =>
                  Math.min((selectedEvent.mediaFiles || []).length - 1, i + 1)
                )}
                className="px-4 py-2 bg-white bg-opacity-10 rounded-lg text-white"
              >
                Next ▶
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

  </div>
)}
          </div>

          {/* CONTEXT MENU */}
          {contextMenu.visible && contextMenu.event && (
            <div
              style={{
                position: "fixed",
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 10000,
              }}
              className="bg-white rounded-md shadow-lg"
            >
              <button
                onClick={() => startEditEvent(contextMenu.event)}
                className="block w-full text-left px-4 py-2 hover:bg-gray-100"
              >
                Edit
              </button>

              <button
                onClick={() => deleteCreatedEvent(contextMenu.event.id)}
                className="block w-full text-left px-4 py-2 text-red-600 hover:bg-gray-100"
              >
                Delete
              </button>

              <button
                onClick={updateEvent}
                className="w-full bg-blue-500 text-white rounded-lg py-3 font-semibold hover:bg-blue-600"
              >
                Update Event
              </button>
            </div>
          )}

          <BottomNav
            currentScreen="createdEvents"
            setCurrentScreen={setCurrentScreen}
          />
          {showDeleteConfirm && (
            <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 w-64 text-center">
                <h3 className="font-bold text-lg mb-4">Delete this event?</h3>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-2 rounded-lg bg-gray-200"
                  >
                    Cancel
                  </button>

                  <button
                    onClick={() => deleteCreatedEvent(eventToDelete)}
                    className="flex-1 py-2 rounded-lg bg-red-600 text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentScreen === 'createEvent') {
    return (
      <>
      <div className="min-h-screen bg-gray-50">
        <Header title="Create Event" onBack={() => setCurrentScreen('home')} />
        <div className="p-4 space-y-4 pb-24">
          <div className="bg-white rounded-2xl p-4 space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Incident Type</label>
              <select
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                value={newEventForm.incidentType}
                onChange={(e) => setNewEventForm({ ...newEventForm, incidentType: e.target.value })}
              >
                <option value="">Select incident type</option>
                <option value="Medical Emergency">Medical Emergency</option>
                <option value="Fire">Fire</option>
                <option value="Accident">Accident</option>
                <option value="Natural Disaster">Natural Disaster</option>
                <option value="Other">Other</option>
              </select>
            </div>
  
            {/* Location */}
            <div>
              <label className="block text-sm font-semibold mb-2">Location</label>
              <input
                type="text"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-black placeholder-gray-500"
                value={newEventForm.location || `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`}
                onChange={(e) => setNewEventForm({ ...newEventForm, location: e.target.value })}
              />
            </div>
  
            {/* Volunteers Required */}
            <div>
              <label className="block text-sm font-semibold mb-2">Number of Volunteers Required</label>
              <input
                type="number"
                min="1"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                value={newEventForm.volunteersNeeded}
                onChange={(e) =>
                  setNewEventForm({ ...newEventForm, volunteersNeeded: parseInt(e.target.value) })
                }
              />
            </div>
  
            {/* Supplies */}
            <div>
              <label className="block text-sm font-semibold mb-2">Emergency Supplies Needed</label>
              <textarea
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                rows="3"
                value={newEventForm.suppliesNeeded}
                onChange={(e) => setNewEventForm({ ...newEventForm, suppliesNeeded: e.target.value })}
              />
            </div>
  
            {/* Emergency Services */}
            <div>
              <label className="block text-sm font-semibold mb-2">Emergency Service Status</label>
              <div className="space-y-2">
                {["Not Arrived", "On Route", "Arrived"].map((status) => (
                  <label key={status} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="serviceStatus"
                      value={status}
                      checked={newEventForm.emergencyServiceStatus === status}
                      onChange={(e) => setNewEventForm({ ...newEventForm, emergencyServiceStatus: e.target.value })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">{status}</span>
                  </label>
                ))}
              </div>
            </div>
  
            {/* Upload Media */}
            <div>
              <label className="block text-sm font-semibold mb-2">Upload Media</label>
  
              <div className="space-y-2">
  
                {/* IMAGES */}
                <button
                  onClick={() => document.getElementById("eventImageInput").click()}
                  className="w-full bg-gray-100 text-gray-700 rounded-lg p-4 flex items-center justify-center gap-2 hover:bg-gray-200"
                >
                  <Camera className="w-5 h-5" />
                  <span>Add Photos</span>
                </button>
                <input
                  id="eventImageInput"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files);
                    setNewEventForm({
                      ...newEventForm,
                      mediaFiles: [
                        ...newEventForm.mediaFiles,
                        ...files.map((f) => ({ type: "image", file: f })),
                      ],
                    });
                  }}
                />
  
                {/* VIDEOS */}
                <button
                  onClick={() => document.getElementById("eventVideoInput").click()}
                  className="w-full bg-gray-100 text-gray-700 rounded-lg p-4 flex items-center justify-center gap-2 hover:bg-gray-200"
                >
                  <Video className="w-5 h-5" />
                  <span>Add Videos</span>
                </button>
                <input
                  id="eventVideoInput"
                  type="file"
                  accept="video/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files);
                    setNewEventForm({
                      ...newEventForm,
                      mediaFiles: [
                        ...newEventForm.mediaFiles,
                        ...files.map((f) => ({ type: "video", file: f })),
                      ],
                    });
                  }}
                />
              </div>
  
              {/* PREVIEW SELECTED FILES */}
              {newEventForm.mediaFiles.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-lg font-bold mb-2">Uploaded Files</h3>
                  <p className="text-sm text-gray-600 mb-3">
                    {newEventForm.mediaFiles.length} file(s)
                  </p>

                  <div className="grid grid-cols-4 gap-2">
                    {newEventForm.mediaFiles.map((media, idx) => (
                      <div
                        key={idx}
                        className="aspect-square bg-gray-200 rounded-lg flex items-center justify-center relative overflow-hidden"
                      >
                        {media.type === "image" ? (
                          <img
                            src={URL.createObjectURL(media.file)}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <video
                            src={URL.createObjectURL(media.file)}
                            className="w-full h-full object-cover"
                            muted
                          />
                        )}

                        {/* DELETE BUTTON */}
                        <button
                          onClick={() =>
                            setNewEventForm({
                              ...newEventForm,
                              mediaFiles: newEventForm.mediaFiles.filter((_, i) => i !== idx),
                            })
                          }
                          className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
  
          {/* SUBMIT BUTTON */}
          <button
            onClick={async () => {
              console.log("FILES TO UPLOAD:", newEventForm.mediaFiles);
              // 1️⃣ Upload files first
              const uploadedMedia = [];

              for (const media of newEventForm.mediaFiles) {
                if (!media.file) continue; // skip if file missing

                const uploaded = await uploadFile(media.file);
                if (uploaded) {
                  uploadedMedia.push({
                    type: media.type,
                    url: uploaded.url,
                    path: uploaded.path,
                    uploadedAt: Date.now(),
                  });
                }
              }

              // 2️⃣ Build event object to store in Firestore
              const newEventData = {
                type: newEventForm.incidentType,
                location: newEventForm.location,
                lat: userLocation.lat,
                lng: userLocation.lng,
                volunteersNeeded: newEventForm.volunteersNeeded,
                suppliesNeeded: newEventForm.suppliesNeeded,
                emergencyServiceStatus: newEventForm.emergencyServiceStatus,
                mediaFiles: uploadedMedia,
                color: "#DC2626",
                time: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                createdAt: serverTimestamp(),
              };

              // 3️⃣ Save to Firestore
              const docRef = await addDoc(collection(db, "createdEvents"), newEventData);

              // 4️⃣ Add Firestore ID
              const eventWithId = { ...newEventData, id: docRef.id };

              // 5️⃣ Save locally
              setCreatedEvents((prev) => [eventWithId, ...prev]);

              // 6️⃣ Navigate to detail
              setSelectedEvent(eventWithId);
              setCurrentScreen("eventDetail");
              // Request notification permission for nearby createdEvents
              if (Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                  if (permission === 'granted') {
                    LocalNotifications.schedule({
                      notifications: [
                        {
                          title: "Event Created",
                          body: "Your event has been created successfully!",
                          id: Date.now(),
                          schedule: { at: new Date(Date.now() + 1000) },
                          sound: null,
                          attachments: null,
                          actionTypeId: "",
                          extra: null
                        }
                      ]
                    });
                  }
                });
              }
              
              alert('Event created successfully!');
              // Clear the form after successful event creation
              setNewEventForm({
                type: "",
                time: "",
                location: "",
                emergencyServiceStatus: "",
                volunteersNeeded: "",
                suppliesNeeded: "",
                mediaFiles: []
              });

              setMediaFiles([]);

              const photoInput = document.getElementById("createEventPhotoInput");
              if (photoInput) photoInput.value = "";

              const videoInput = document.getElementById("createEventVideoInput");
              if (videoInput) videoInput.value = "";
            }}
            className="w-full bg-red-600 text-white rounded-xl p-4 text-lg font-semibold"
          >
            Create Event
          </button>
        </div>
      </div>
      <BottomNav currentScreen={currentScreen} setCurrentScreen={setCurrentScreen} />
  </>
    );
  }
  
  if (currentScreen === 'editEvent' && editingEvent) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Edit Event" onBack={() => {
          setEditingEvent(null);
          setCurrentScreen('eventDetail');
        }} />
        <div className="p-4 space-y-4 pb-24">
          <div className="bg-white rounded-2xl p-4 space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Incident Type</label>
              <select 
                className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                value={editingEvent.type}
                onChange={(e) => setEditingEvent({...editingEvent, type: e.target.value})}
              >
                <option value="Medical Emergency">Medical Emergency</option>
                <option value="Fire">Fire</option>
                <option value="Accident">Accident</option>
                <option value="Natural Disaster">Natural Disaster</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">Location</label>
              <input 
                type="text" 
                className="w-full px-4 py-3 border border-gray-300 rounded-lg" 
                value={editingEvent.location}
                onChange={(e) => setEditingEvent({...editingEvent, location: e.target.value})}
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">Number of Volunteers Required</label>
              <input 
                type="number" 
                min="1"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg" 
                value={editingEvent.volunteersNeeded}
                onChange={(e) => setEditingEvent({...editingEvent, volunteersNeeded: parseInt(e.target.value)})}
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">Emergency Supplies Needed</label>
              <textarea 
                className="w-full px-4 py-3 border border-gray-300 rounded-lg" 
                rows="3"
                value={editingEvent.suppliesNeeded}
                onChange={(e) => setEditingEvent({...editingEvent, suppliesNeeded: e.target.value})}
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">Emergency Service Status</label>
              <div className="space-y-2">
                {['Not Arrived', 'On Route', 'Arrived'].map(status => (
                  <label key={status} className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio"
                      name="serviceStatus"
                      value={status}
                      checked={editingEvent.emergencyServiceStatus === status}
                      onChange={(e) => setEditingEvent({...editingEvent, emergencyServiceStatus: e.target.value})}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">{status}</span>
                  </label>
                ))}
              </div>
            </div>
            
            <button 
              onClick={updateEvent}
              className="w-full bg-blue-500 text-white rounded-lg py-3 font-semibold hover:bg-blue-600"
            >
              Update Event
            </button>
          </div>
        </div>
        <BottomNav currentScreen={currentScreen} setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }
  
  if (currentScreen === 'createdEvents') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Active Events" onBack={() => setCurrentScreen('home')} />
        <div className="h-64">
          <MapContainer 
            center={[userLocation.lat, userLocation.lng]} 
            zoom={6} 
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[userLocation.lat, userLocation.lng]} icon={createCustomIcon('#3B82F6')}>
              <Popup>Your Location</Popup>
            </Marker>
	{[...createdEvents]
        	      .filter(event => {
                	const distance = parseFloat(calculateDistance(userLocation.lat, 	userLocation.lng, event.lat, event.lng));
                return distance <= 1;
              })
              .map(event => (
              <Marker
                key={event.id} 
                position={[event.lat, event.lng]} 
                icon={createCustomIcon(getEventColor(event.type))}
                eventHandlers={{
                  click: () => {
                    const full = createdEvents.find(ev => ev.id === event.id) || event;
                    setSelectedEvent(full);
                    setCurrentScreen('eventDetail');
                  }
                }}
              >
                <Popup>
                  <strong>{event.type}</strong><br />
                  {event.time}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
<div className="p-4 space-y-3 pb-24">
          <h3 className="font-bold text-lg">Active Events Within 1km</h3>
          {[...createdEvents]
            .filter(event => {
              const distance = parseFloat(calculateDistance(userLocation.lat, userLocation.lng, event.lat, event.lng));
              return distance <= 1;
            })
            .sort((a, b) => {
              const distA = parseFloat(calculateDistance(userLocation.lat, userLocation.lng, a.lat, a.lng));
              const distB = parseFloat(calculateDistance(userLocation.lat, userLocation.lng, b.lat, b.lng));
              return distA - distB;
            })
            .map(event => (<div
              key={event.id}
              onClick={() => { setSelectedEvent(event); setCurrentScreen('eventDetail'); }}
              onContextMenu={(e) => handleContextMenu(e, event)}
              className="rounded-2xl p-4 text-white cursor-pointer hover:opacity-90 transition-opacity"
              style={{ backgroundColor: getEventColor(event.type) }}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg">{event.type}</h3>
                <button className="bg-white bg-opacity-20 px-3 py-1 rounded-full text-xs">View Details</button>
              </div>
              <p className="text-sm opacity-90 mb-1">{event.time}</p>
              <p className="text-xs flex items-center gap-1 mt-1">
                <MapPin className="w-3 h-3" />
                {event.exactAddress ?? event.locationName ?? event.location ?? "Fetching address..."}
              </p>
              <p className="text-xs opacity-75 mt-1">
                {calculateDistance(userLocation.lat, userLocation.lng, event.lat, event.lng)} km away
              </p>
            </div>
          ))}
        </div>
        <BottomNav currentScreen={currentScreen} setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

  if (currentScreen === 'map') {
      return (
        <div className="min-h-screen bg-gray-50">
          <Header title="Nearby Resources" onBack={() => setCurrentScreen('home')}/>
          <div className="h-96">
            <MapContainer 
              center={[userLocation.lat, userLocation.lng]} 
              zoom={13} 
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Marker position={[userLocation.lat, userLocation.lng]} icon={createCustomIcon('#3B82F6')}>
                <Popup>Your Location</Popup>
              </Marker>
              {nearbyResources.map(resource => (
                <Marker 
                  key={resource.id} 
                  position={[resource.lat, resource.lng]} 
      icon={createCustomIcon(
        resource.type === 'healthcare' ? '#DC2626' :
        resource.type === 'service' && resource.name.includes('Police') ? '#2563EB' :
        resource.type === 'service' && resource.name.includes('Fire') ? '#F59E0B' :
        '#16A34A'
  )}
                >
                  <Popup>
                    <strong>{resource.name}</strong><br />
                    {resource.distance} km away<br />
                    Status: {resource.status}
                  </Popup>
                </Marker>
              ))}
              <Circle center={[userLocation.lat, userLocation.lng]} radius={2000} color="#3B82F6" fillOpacity={0.05} />
            </MapContainer>
          </div>
          <div className="p-4 space-y-3 pb-24">
            <h3 className="font-bold text-lg">Nearby Emergency Resources</h3>
            {nearbyResources.map(resource => (
              <div key={resource.id} className="bg-white rounded-xl p-4 flex justify-between items-center shadow-sm">
                <div className="flex-1">
      <div className = "flex items-center gap-2 mb-1">
         <div className = {`w-3 h-3 rounded-full ${
      resource.type === 'healthcare' ? 'bg-red-600' :
      resource.type === 'service' && resource.name.includes('Police') ? 'bg-blue-600' :
      resource.type === 'service' && resource.name.includes('Fire') ? 'bg-orange-600' :
        'bg-green-600'
  }`}></div>
                  <h4 className="font-semibold">{resource.name}</h4>
           </div>
                  <p className="text-sm text-gray-500">{resource.distance} km away</p>
                  {resource.status && (
                    <span className={`text-xs px-2 py-1 rounded-full mt-1 inline-block ${
                      resource.status === 'On-route' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {resource.status}
                    </span>
                  )}
                </div>
                <button 
      onClick={() => {
          setSelectedResource(resource);
          setCurrentScreen('navigation');
      }}
                  className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition-colors ml-3"
                >
                  <Navigation className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
          <BottomNav currentScreen="map" setCurrentScreen={setCurrentScreen} />
        </div>
      );
    }
  

  if (currentScreen === 'feedback') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Feedback & Community" onBack={() => setCurrentScreen('profile')} />
        <div className="p-4 pb-24">
          <div className="bg-white rounded-2xl p-6 mb-4">
            <h2 className="text-xl font-bold mb-4">Share Your Feedback</h2>
            <p className="text-sm text-gray-600 mb-6">Help us improve R.E.A.C.H by sharing your experience</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Your Name</label>
                <input type="text" className="w-full px-4 py-3 border border-gray-300 rounded-lg" placeholder="Enter your name" />
              </div>
              
              <div>
                <label className="block text-sm font-semibold mb-2">Email</label>
                <input type="email" className="w-full px-4 py-3 border border-gray-300 rounded-lg" placeholder="Enter your email" />
              </div>
              
              <div>
                <label className="block text-sm font-semibold mb-2">Feedback Type</label>
                <select className="w-full px-4 py-3 border border-gray-300 rounded-lg">
                  <option>Bug Report</option>
                  <option>Feature Request</option>
                  <option>General Feedback</option>
                  <option>Appreciation</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-semibold mb-2">Your Message</label>
                <textarea 
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg" 
                  rows="5" 
                  placeholder="Tell us what you think..."
                ></textarea>
              </div>
              
              <button className="w-full bg-blue-500 text-white rounded-lg py-3 font-semibold hover:bg-blue-600">
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
        <BottomNav currentScreen="profile" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

  if (currentScreen === 'notifications') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Notification Settings" onBack={() => setCurrentScreen('profile')} />
        <div className="p-4 pb-24">
          <div className="bg-white rounded-2xl p-6 mb-4">
            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-10 h-10 text-blue-500" />
              </div>
              <h2 className="text-xl font-bold mb-2">Enable Notifications</h2>
              <p className="text-sm text-gray-600">Stay informed about emergency alerts and updates</p>
            </div>
            
            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                <div className="text-green-600 text-xl">✓</div>
                <div>
                  <p className="font-medium text-green-900">Emergency Alerts</p>
                  <p className="text-xs text-green-700">Get notified about nearby emergencies</p>
                </div>
              </div>
              
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <div className="text-blue-600 text-xl">🔔</div>
                <div>
                  <p className="font-medium text-blue-900">Weather Warnings</p>
                  <p className="text-xs text-blue-700">Receive severe weather alerts</p>
                </div>
              </div>
              
              <div className="flex items-start gap-3 p-3 bg-purple-50 rounded-lg">
                <div className="text-purple-600 text-xl">📍</div>
                <div>
                  <p className="font-medium text-purple-900">Location Updates</p>
                  <p className="text-xs text-purple-700">Updates when help is nearby</p>
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => {
                if ('Notification' in window) {
                  Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                      alert('Notifications enabled successfully!');
                    } else {
                      alert('Notification permission denied. Please enable in browser settings.');
                    }
                  });
                }
              }}
              className="w-full bg-blue-500 text-white rounded-lg py-3 font-semibold hover:bg-blue-600 mb-3"
            >
              Enable Notifications
            </button>
            
            <p className="text-xs text-center text-gray-500">
              Current Status: {Notification.permission === 'granted' ? '✓ Enabled' : 
                              Notification.permission === 'denied' ? '✗ Denied' : '⚠ Not Set'}
            </p>
          </div>
        </div>
        <BottomNav currentScreen="profile" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

  if (currentScreen === 'cpr') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="CPR for Adults" onBack={() => setCurrentScreen('profile')} />
        <div className="p-4 space-y-6 pb-24">
          <div className="bg-white rounded-2xl p-6">
            <h2 className="font-bold text-xl mb-4">CPR Instructions</h2>
            <div className="space-y-4">
              {[
                'CHECK the scene for safety and use PPE',
                'CHECK for responsiveness and breathing',
                'CALL 9-1-1 and get equipment',
                'Place person on back on firm surface',
                'Deliver chest compressions at 100-120/min',
                'Open airway, pinch nose, give rescue breaths'
              ].map((text, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">{i + 1}</div>
                  <p className="text-gray-700 pt-1">{text}</p>
                </div>
              ))}
            </div>
          </div>
<div className="bg-white rounded-2xl p-6">
            <h3 className="font-semibold mb-3">Hand Position & Technique</h3>
            
            {/* Image 1: Rescue breathing */}
            <div className="mb-4">
              <div className="bg-blue-50 rounded-xl overflow-hidden">
                <img
                  src="/Rescue_breathing.png"
                  alt="CPR Hand Position"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 1: Hand Placement</p>
              <p className="text-xs text-gray-600 mt-1">Place the heel of one hand on the center of the chest (lower half of breastbone). Place your other hand on top and interlock fingers.</p>
            </div>

            {/* Image 2: Hand Position */}
            <div className="mb-4">
              <div className="bg-blue-50 rounded-xl overflow-hidden">
                <img
                  src="/Hand_positioning.png"
                  alt="CPR Hand Position"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 2: Body Position</p>
              <p className="text-xs text-gray-600 mt-1">Position shoulders directly over hands. Keep elbows locked and arms straight.</p>
            </div>

            {/* Image 3: Compression Technique */}
            <div className="mb-4">
              <div className="bg-blue-50 rounded-xl overflow-hidden">
                <img
                  src="/CPR.png"
                  alt="CPR Compression"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 3: Compression</p>
              <p className="text-xs text-gray-600 mt-1">Push hard and fast. Compress at least 2 inches deep at a rate of 100-120 compressions per minute.</p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4">
              <p className="text-sm font-semibold text-red-900">Key Points:</p>
              <ul className="text-xs text-red-800 mt-2 space-y-1">
                <li>• Allow chest to recoil completely between compressions</li>
                <li>• Minimize interruptions in compressions</li>
                <li>• Continue until help arrives or person shows signs of life</li>
              </ul>
            </div>
          </div>
        </div>
        <BottomNav currentScreen="profile" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }
if (currentScreen === 'choking') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Choking Relief" onBack={() => setCurrentScreen('profile')} />
        <div className="p-4 space-y-6 pb-24">
          <div className="bg-white rounded-2xl p-6">
            <h2 className="font-bold text-xl mb-4">Heimlich Maneuver Steps</h2>
            <div className="space-y-4">
              {[
                'Stand behind the person and wrap your arms around their waist',
                'Make a fist with one hand and place it above the navel',
                'Grasp your fist with the other hand',
                'Give quick, upward thrusts into the abdomen',
                'Repeat until the object is dislodged',
                'Call emergency services if unsuccessful'
              ].map((text, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 bg-orange-500 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">{i + 1}</div>
                  <p className="text-gray-700 pt-1">{text}</p>
                </div>
              ))}
            </div>
          </div>
<div className="bg-white rounded-2xl p-6">
            <h3 className="font-semibold mb-3">Heimlich Maneuver Technique</h3>
            
            {/* Image 1: Standing Position */}
            <div className="mb-4">
              <div className="bg-orange-50 rounded-xl overflow-hidden">
                <img
                  src="/Heimlich_positioning.png"
                  alt="Heimlich Standing Position"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 1: Positioning</p>
              <p className="text-xs text-gray-600 mt-1">Stand behind the person. Wrap your arms around their waist. Position yourself slightly to one side.</p>
            </div>

            {/* Image 2: Fist Placement */}
            <div className="mb-4">
              <div className="bg-orange-50 rounded-xl overflow-hidden">
                <img
                  src="/Heimlich_hand.png"
                  alt="Heimlich Fist Position"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 2: Hand Placement</p>
              <p className="text-xs text-gray-600 mt-1">Make a fist with one hand. Place it just above the person's navel, below the ribcage. Grasp your fist with your other hand.</p>
            </div>

            {/* Image 3: Thrust Motion */}
            <div className="mb-4">
              <div className="bg-orange-50 rounded-xl overflow-hidden">
                <img
                  src="/Abdominal_thrust.png"
                  alt="Heimlich Thrust"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 3: Abdominal Thrusts</p>
              <p className="text-xs text-gray-600 mt-1">Give quick, upward thrusts into the abdomen. Use enough force to dislodge the object. Repeat until object is expelled.</p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-4">
              <p className="text-sm font-semibold text-yellow-900">Important Notes:</p>
              <ul className="text-xs text-yellow-800 mt-2 space-y-1">
                <li>• For adults and children over 1 year old</li>
                <li>• For infants, use back blows and chest thrusts</li>
                <li>• If person becomes unconscious, begin CPR</li>
                <li>• Seek medical attention even if object is dislodged</li>
              </ul>
            </div>
          </div>
        </div>
        <BottomNav currentScreen="profile" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

  if (currentScreen === 'bleeding') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="Bleeding Control" onBack={() => setCurrentScreen('profile')} />
        <div className="p-4 space-y-6 pb-24">
          <div className="bg-white rounded-2xl p-6">
            <h2 className="font-bold text-xl mb-4">Severe Bleeding Control Steps</h2>
            <div className="space-y-4">
              {[
                'Ensure scene safety and use protective gloves if available',
                'Apply direct pressure to the wound with a clean cloth',
                'Maintain firm, continuous pressure for at least 10 minutes',
                'If blood soaks through, add more cloth without removing the first',
                'Elevate the injured area above the heart if possible',
                'Apply pressure to arterial pressure points if bleeding continues',
                'Call emergency services immediately for severe bleeding'
              ].map((text, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">{i + 1}</div>
                  <p className="text-gray-700 pt-1">{text}</p>
                </div>
              ))}
            </div>
          </div>
<div className="bg-white rounded-2xl p-6">
            <h3 className="font-semibold mb-3">Bleeding Control Techniques</h3>
            
            {/* Image 1: Direct Pressure with hand */}
            <div className="mb-4">
              <div className="bg-red-50 rounded-xl overflow-hidden">
                <img
                  src="/pressure_hands.png"
                  alt="Direct Pressure on Wound"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 1: Direct Pressure</p>
              <p className="text-xs text-gray-600 mt-1">Apply firm, direct pressure to the wound using a clean cloth or sterile gauze. Maintain continuous pressure for at least 10 minutes.</p>
            </div>

            {/* Image 2: Dressing and Elevation */}
            <div className="mb-4">
              <div className="bg-red-50 rounded-xl overflow-hidden">
                <img
                  src="/bleed_press.png"
                  alt="Elevate Injured Area"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 2: Elevation</p>
              <p className="text-xs text-gray-600 mt-1">If possible, elevate the injured area above the level of the heart to help slow bleeding.</p>
            </div>

            {/* Image 3: Pressure Points- use tourniquet */}
            <div className="mb-4">
              <div className="bg-red-50 rounded-xl overflow-hidden">
                <img
                  src="/Tourniquet.png"
                  alt="Arterial Pressure Points"
                  className="w-full h-48 object-cover"
                />
              </div>
              <p className="text-sm text-gray-700 mt-2 font-medium">Step 3: Pressure Points (if needed)</p>
              <p className="text-xs text-gray-600 mt-1">If bleeding continues, apply pressure to arterial pressure points between wound and heart. Common points: brachial artery (arm) and femoral artery (leg).</p>
            </div>

            <div className="bg-red-100 border border-red-300 rounded-lg p-3 mt-4">
              <p className="text-sm font-semibold text-red-900">⚠️ Critical Guidelines:</p>
              <ul className="text-xs text-red-800 mt-2 space-y-1">
                <li>• Never remove embedded objects - stabilize them</li>
                <li>• Add more cloth if blood soaks through, don't remove first layer</li>
                <li>• Call emergency services immediately for severe bleeding</li>
                <li>• Watch for signs of shock (pale, cold, rapid pulse)</li>
              </ul>
            </div>
          </div>          
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
            <h3 className="font-bold text-yellow-900 mb-2">⚠️ Warning Signs</h3>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>• Spurting or pulsating blood</li>
              <li>• Blood soaking through multiple layers</li>
              <li>• Signs of shock (pale, cold, rapid pulse)</li>
              <li>• Loss of consciousness</li>
            </ul>
          </div>
        </div>
        <BottomNav currentScreen="profile" setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }
  if (currentScreen === 'profile') {
    return (
      <div className="min-h-screen bg-gray-100">
        <Header title="" />
        <div className="p-4 pb-24">
          <div className="mb-6">
            <h3 className="font-bold text-lg mb-3 px-2">User</h3>
            <div className="bg-white rounded-2xl overflow-hidden">
              {[
                { label: 'Activity History', screen: 'activityHistory' },
                { label: 'Event Codes', screen: 'eventCodes' },
                { label: 'Feedback', screen: 'feedback' },
              ].map((item, i) => (
                <button key={i} onClick={() => item.screen && setCurrentScreen(item.screen)} className="w-full px-4 py-4 flex justify-between items-center border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors">
                  <span className="text-gray-700">{item.label}</span>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
          <div className="mb-6">
            <h3 className="font-bold text-lg mb-3 px-2">Settings</h3>
            <div className="bg-white rounded-2xl overflow-hidden">
              {[
                { label: 'Notification', screen: 'notifications' },
                { label: 'Account Management', screen: null },
                { label: 'Legal and Policies', screen: null }
              ].map((item, i) => (
                <button key={i} onClick={() => item.screen && setCurrentScreen(item.screen)} className="w-full px-4 py-4 flex justify-between items-center border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors">
                  <span className="text-gray-700">{item.label}</span>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
<div className="mb-6">
            <h3 className="font-bold text-lg mb-3 px-2">Emergency Procedures</h3>
            <div className="bg-white rounded-2xl overflow-hidden">
              {[
                { id: 'cpr', label: 'CPR for Adults', screen: 'cpr' },
                { id: 'choking', label: 'Choking Relief - Heimlich Maneuver', screen: 'choking' },
                { id: 'bleeding', label: 'Severe Bleeding Control', screen: 'bleeding' }
              ].map((procedure, i) => (
                <button 
                  key={i} 
                  onClick={() => setCurrentScreen(procedure.screen)} 
                  className="w-full px-4 py-4 flex justify-between items-center border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-gray-700">{procedure.label}</span>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        </div>
        <BottomNav currentScreen={currentScreen} setCurrentScreen={setCurrentScreen} />
      </div>
    );
  }

  return null;
};
const Header = ({ title, onBack, showBack = true }) => (
  <div className="bg-white px-4 py-3 border-b sticky top-0 z-10">
    <div className="flex items-center justify-between">
      {showBack && onBack ? (
        <button onClick={onBack} className="text-blue-500 flex items-center gap-1">
          <ChevronLeft className="w-5 h-5" />
          <span>Back</span>
        </button>
      ) : (
        <span className="text-sm">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      )}
      <span className="font-semibold">{title}</span>
      <div className="w-16"></div>
    </div>
  </div>
);

const BottomNav = ({ currentScreen, setCurrentScreen }) => (
  <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex justify-between items-center z-10">
    <button onClick={() => setCurrentScreen('home')} className={`flex flex-col items-center ${currentScreen === 'home' ? 'text-blue-500' : 'text-gray-400'}`}>
      <Home className="w-6 h-6" />
    </button>
    <button onClick={() => setCurrentScreen('createdEvents')} className={`flex flex-col items-center ${currentScreen === 'createdEvents' || currentScreen === 'eventDetail' ? 'text-blue-500' : 'text-gray-400'}`}>
      <AlertCircle className="w-6 h-6" />
    </button>
    <button onClick={() => setCurrentScreen('createEvent')} className={`flex flex-col items-center ${currentScreen === 'createEvent' ? 'text-blue-500' : 'text-gray-400'}`}>
      <PlusCircle className="w-6 h-6" />
    </button>
    <button onClick={() => setCurrentScreen('map')} className={`flex flex-col items-center ${currentScreen === 'map' || currentScreen === 'navigation' ? 'text-blue-500' : 'text-gray-400'}`}>
      <Menu className="w-6 h-6" />
    </button>
    <button onClick={() => setCurrentScreen('profile')} className={`flex flex-col items-center ${currentScreen === 'profile' || currentScreen === 'cpr' || currentScreen === 'choking' || currentScreen === 'bleeding' || currentScreen === 'activityHistory' || currentScreen === 'eventCodes' || currentScreen === 'feedback' || currentScreen === 'notifications' ? 'text-blue-500' : 'text-gray-400'}`}>
      <User className="w-6 h-6" />
    </button>
  </div>
);

{/* ================ AudioBubble component ================ */}
const AudioBubble = ({ url, isMine }) => {
  const audioRefLocal = React.useRef(null);
  const [isPlayingLocal, setIsPlayingLocal] = React.useState(false);
  const [durationLocal, setDurationLocal] = React.useState(null);

  React.useEffect(() => {
    const a = audioRefLocal.current;
    if (!a) return;
    const onLoaded = () => setDurationLocal(a.duration);
    const onEnded = () => setIsPlayingLocal(false);
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('ended', onEnded);
    };
  }, [url]);

  const togglePlayLocal = () => {
    const a = audioRefLocal.current;
    if (!a) return;
    if (isPlayingLocal) { a.pause(); setIsPlayingLocal(false); }
    else { a.play().catch(e => console.warn('play failed', e)); setIsPlayingLocal(true); }
  };

  const timeLabel = durationLocal ? `${Math.floor(durationLocal)}s` : '...';

  return (
    <div className={`p-2 rounded-lg inline-flex items-center gap-3 ${isMine ? 'bg-blue-500 text-white' : 'bg-gray-700 text-white'}`}>
      <button onClick={togglePlayLocal} className="w-9 h-9 rounded-full bg-white bg-opacity-20 flex items-center justify-center">
        {isPlayingLocal ? '⏸' : '▶'}
      </button>
      <div className="text-sm opacity-90">{timeLabel}</div>
      <audio ref={audioRefLocal} src={url} className="hidden" />
    </div>
  );
};

export default App;