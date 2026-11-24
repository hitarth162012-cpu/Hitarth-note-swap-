import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: Array<{
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'users_public', '__connection_probe__'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration — Firestore client appears offline.');
    }
  }
}

export async function syncUserToFirestore(params: {
  fbUser: FirebaseUser;
  displayName: string;
  authProvider: 'google' | 'firebase_email';
  role?: 'student' | 'admin';
  avatar?: string;
}): Promise<void> {
  const { fbUser, displayName, authProvider, role = 'student', avatar = 'grad' } = params;
  // Security rules require email_verified == true for Firestore writes
  if (!fbUser.emailVerified || !fbUser.email) return;

  const cleanName = displayName.trim().slice(0, 64) || fbUser.email.split('@')[0];
  const privatePath = `users/${fbUser.uid}`;
  const publicPath = `users_public/${fbUser.uid}`;

  try {
    const privateRef = doc(db, 'users', fbUser.uid);
    const existingPrivate = await getDoc(privateRef);
    if (existingPrivate.exists()) {
      await updateDoc(privateRef, {
        displayName: cleanName,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(privateRef, {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: cleanName,
        authProvider,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const publicRef = doc(db, 'users_public', fbUser.uid);
    const existingPublic = await getDoc(publicRef);
    if (existingPublic.exists()) {
      await updateDoc(publicRef, {
        displayName: cleanName,
        avatar,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(publicRef, {
        uid: fbUser.uid,
        displayName: cleanName,
        avatar,
        role,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    // Non-blocking sync warning; backend SQLite + Firebase Admin already verified auth
    console.warn('Firestore profile sync skipped:', (error as Error).message, privatePath, publicPath);
  }
}

export {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
};
