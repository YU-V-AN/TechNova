import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCBQ2Ke0Omwjjg2-SspoYRxgyLbI1sGslE",
  authDomain: "kabadiwala-connect.firebaseapp.com",
  databaseURL: "https://kabadiwala-connect-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kabadiwala-connect",
  storageBucket: "kabadiwala-connect.firebasestorage.app",
  messagingSenderId: "926766533300",
  appId: "1:926766533300:web:9c9815ce38afd13dbce5e1",
  measurementId: "G-YP7CT5CE3J"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);