import { storage } from "./firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export const uploadFile = async (file) => {
  if (!file) return;

  const fileRef = ref(storage, `uploads/${Date.now()}_${file.name}`);

  const snapshot = await uploadBytes(fileRef, file);
  const url = await getDownloadURL(snapshot.ref);

  return url;
};