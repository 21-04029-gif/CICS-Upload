import { GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReCAPTCHA from "react-google-recaptcha";
import { auth } from "../firebase";
import { cn } from "../utils";

interface AuthProps {
  user: any;
  loading: boolean;
  onLoginStart?: () => void;
  recaptchaEnabled?: boolean;
  recaptchaSiteKey?: string;
}

export function Auth({ user, loading, onLoginStart, recaptchaEnabled = false, recaptchaSiteKey = "" }: AuthProps) {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [isConfirmLogoutOpen, setIsConfirmLogoutOpen] = useState(false);
  const recaptchaRef = useRef<ReCAPTCHA | null>(null);

  const login = async () => {
    onLoginStart?.();

    if (recaptchaEnabled && !captchaToken) {
      setCaptchaError("Please complete the reCAPTCHA verification before signing in.");
      return;
    }

    setCaptchaError(null);

    if (recaptchaEnabled && captchaToken) {
      try {
        const verifyResponse = await fetch("/api/verify-recaptcha", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: captchaToken }),
        });

        const verifyData = await verifyResponse.json().catch(() => ({}));
        if (!verifyResponse.ok || !verifyData?.success) {
          if (verifyData?.code === "recaptcha_not_configured") {
            // Keep login usable if backend secret is not set yet; frontend token is still required.
            console.warn("reCAPTCHA backend verification not configured. Proceeding with frontend validation only.");
          } else {
            setCaptchaError("reCAPTCHA verification failed. Please try again.");
            recaptchaRef.current?.reset();
            setCaptchaToken(null);
            return;
          }
        }
      } catch (error) {
        console.error("reCAPTCHA verification request failed:", error);
        setCaptchaError("Unable to verify reCAPTCHA. Please try again.");
        recaptchaRef.current?.reset();
        setCaptchaToken(null);
        return;
      }
    }

    const provider = new GoogleAuthProvider();
    // Force account selection dialog to appear
    provider.setCustomParameters({ 
      prompt: 'select_account'
    });
    try {
      await signInWithPopup(auth, provider);
      setCaptchaToken(null);
      recaptchaRef.current?.reset();
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setIsConfirmLogoutOpen(false);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const renderLogoutConfirmModal = () => {
    if (!isConfirmLogoutOpen) return null;

    const modal = (
      <div
        className="p-4"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483647,
          display: "grid",
          placeItems: "center",
        }}
      >
        <button
          type="button"
          aria-label="Close logout confirmation"
          onClick={() => setIsConfirmLogoutOpen(false)}
          className="bg-zinc-900/45 backdrop-blur-sm"
          style={{ position: "fixed", inset: 0 }}
        />
        <div className="relative mx-auto w-full max-w-sm rounded-2xl bg-white border border-zinc-200 shadow-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-zinc-900">Confirm Sign Out</h3>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Are you sure you want to sign out of your account?
          </p>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setIsConfirmLogoutOpen(false)}
              className="px-4 py-2 rounded-xl bg-zinc-50 text-zinc-900 text-xs font-bold hover:bg-zinc-100 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={logout}
              className="px-4 py-2 rounded-xl bg-zinc-900 text-white text-xs font-bold hover:bg-black transition-all"
            >
              Yes, Sign out
            </button>
          </div>
        </div>
      </div>
    );

    return createPortal(modal, document.body);
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
      <>
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
              onClick={() => setIsConfirmLogoutOpen(true)}
              className="text-xs text-zinc-500 hover:text-red-600 flex items-center gap-1 transition-colors"
            >
              <LogOut className="w-3 h-3" />
              Sign out
            </button>
          </div>
        </div>

        {renderLogoutConfirmModal()}
      </>
    );
  }

  return (
    <div className="w-full space-y-3">
      <button
        onClick={login}
        disabled={recaptchaEnabled && !captchaToken}
        className={cn(
          "flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-all active:scale-95 shadow-sm",
          recaptchaEnabled && !captchaToken && "opacity-60 cursor-not-allowed"
        )}
      >
        <LogIn className="w-4 h-4" />
        Sign in with Google
      </button>

      {recaptchaEnabled && recaptchaSiteKey && (
        <div className="flex justify-center lg:justify-start">
          <ReCAPTCHA
            ref={recaptchaRef}
            sitekey={recaptchaSiteKey}
            onChange={(token) => {
              setCaptchaToken(token);
              setCaptchaError(null);
            }}
            onExpired={() => setCaptchaToken(null)}
            onErrored={() => {
              setCaptchaToken(null);
              setCaptchaError("reCAPTCHA failed to load. Please refresh and try again.");
            }}
          />
        </div>
      )}

      {recaptchaEnabled && !recaptchaSiteKey && (
        <p className="text-xs text-amber-600">reCAPTCHA is not configured. Add VITE_RECAPTCHA_SITE_KEY in your environment.</p>
      )}

      {captchaError && <p className="text-xs text-rose-600">{captchaError}</p>}
    </div>
  );
}
