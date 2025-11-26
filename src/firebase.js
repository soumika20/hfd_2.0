// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAWQIO_2SGUprCVggbunCLMXI2mgh5NDaE",
  authDomain: "hfd1-946b8.firebaseapp.com",
  projectId: "hfd1-946b8",
  storageBucket: "hfd1-946b8.firebasestorage.app",
  messagingSenderId: "4293306151",
  appId: "1:4293306151:web:ef2705baeb1dab54856b02",
  measurementId: "G-WTH3PB3JEX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);