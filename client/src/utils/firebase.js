
import { initializeApp } from "firebase/app";
import {getAuth, GoogleAuthProvider} from "firebase/auth"
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_APIKEY,
  authDomain: "interviewai-b2860.firebaseapp.com",
  projectId: "interviewai-b2860",
  storageBucket: "interviewai-b2860.firebasestorage.app",
  messagingSenderId: "481698597145",
  appId: "1:481698597145:web:1f49575629709d3c195d88"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const provider = new GoogleAuthProvider()

export {auth , provider}
