import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { auth } from "../firebase";
import { cn } from "../utils";

interface AuthProps {
  user: any;
  loading: boolean;
  onLoginStart?: () => void;
}

export function Auth({ user, loading, onLoginStart }: AuthProps) {
  const login = async () => {
    onLoginStart?.();
    const provider = new GoogleAuthProvider();
    // Force account selection dialog to appear
    provider.setCustomParameters({ 
      prompt: 'select_account'
    });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-500 animate-pulse">
        <div className="w-8 h-8 rounded-full bg-zinc-200" />
        <div className="w-24 h-4 rounded bg-zinc-200" />
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-3 px-4 py-2">
        {user.photoURL ? (
          <img
            src={user.photoURL}
            alt={user.displayName || "User"}
            className="w-8 h-8 rounded-full border border-zinc-200"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center border border-zinc-200">
            <UserIcon className="w-4 h-4 text-zinc-500" />
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-sm font-medium text-zinc-900 truncate max-w-[120px]">
            {user.displayName || user.email}
          </span>
          <button
            onClick={logout}
            className="text-xs text-zinc-500 hover:text-red-600 flex items-center gap-1 transition-colors"
          >
            <LogOut className="w-3 h-3" />
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={login}
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-all active:scale-95 shadow-sm"
      )}
    >
      <LogIn className="w-4 h-4" />
      Sign in with Google
    </button>
  );
}
