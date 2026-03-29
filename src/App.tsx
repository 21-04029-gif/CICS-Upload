import { onAuthStateChanged, User } from "firebase/auth";
import { addDoc, collection, onSnapshot, orderBy, query, where, doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";
import { 
  LayoutDashboard, 
  Upload, 
  CreditCard, 
  History, 
  FileText, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ChevronRight,
  Plus,
  ShieldCheck,
  Users,
  FileSearch,
  Receipt,
  RotateCcw,
  X,
  Menu,
  Trash2,
  Search,
  Inbox,
  Building2,
  Eye,
  ExternalLink,
  Moon,
  Sun,
  History as HistoryIcon
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import React, { useEffect, useState, Component, useRef } from "react";
import { Auth } from "./components/Auth";
import { FileUpload } from "./components/FileUpload";
import { auth, db, storage } from "./firebase";
import { FileUpload as FileUploadType, PaymentTransaction, UserRole, FileStatus, UserProfile, Liability } from "./types";
import { cn } from "./utils";

class ErrorBoundary extends Component<any, any> {
  state: any;
  props: any;
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Firestore Error: ${parsedError.error} during ${parsedError.operationType} on ${parsedError.path}`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6">
          <div className="max-w-md w-full bg-white rounded-2xl border border-zinc-200 p-8 shadow-xl text-center space-y-6">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-zinc-900">Application Error</h2>
              <p className="text-zinc-500 text-sm">{errorMessage}</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

type Tab = 'dashboard' | 'upload' | 'payment' | 'history' | 'review' | 'transactions' | 'students';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem("themeMode");
    if (savedTheme === "dark") return true;
    if (savedTheme === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = sessionStorage.getItem('activeTab');
    return (saved as Tab) || 'dashboard';
  });

  useEffect(() => {
    localStorage.setItem("themeMode", isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    sessionStorage.setItem('activeTab', activeTab);
  }, [activeTab]);
  const [uploads, setUploads] = useState<FileUploadType[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [role, setRole] = useState<UserRole | null>(null);
  const [allUploads, setAllUploads] = useState<FileUploadType[]>([]);
  const [allPayments, setAllPayments] = useState<PaymentTransaction[]>([]);
  const [allStudents, setAllStudents] = useState<UserProfile[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [selectedStudentForLiability, setSelectedStudentForLiability] = useState<UserProfile | null>(null);
  const [selectedStudentForPreview, setSelectedStudentForPreview] = useState<UserProfile | null>(null);
  const [selectedStudentUids, setSelectedStudentUids] = useState<string[]>([]);
  const [isBulkLiabilityModalOpen, setIsBulkLiabilityModalOpen] = useState(false);
  const [liabilityDesc, setLiabilityDesc] = useState("");
  const [liabilityType, setLiabilityType] = useState<string>("other");
  const [liabilityAmount, setLiabilityAmount] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [rejectionFileId, setRejectionFileId] = useState<string | null>(null);
  const [rejectionComment, setRejectionComment] = useState("");
  const [previewFile, setPreviewFile] = useState<FileUploadType | null>(null);
  const [studentSearchTerm, setStudentSearchTerm] = useState("");
  const [paymentResult, setPaymentResult] = useState<{ success: boolean; message: string } | null>(null);
  const paymentProcessedRef = useRef<string | null>(null);

  const getTimeGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  const formatNameFirstLetter = (name?: string | null) => {
    if (!name) return "User";
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  };

  const isImageFile = (file: FileUploadType) => {
    const value = `${file.fileType || ""} ${file.fileName || ""} ${file.fileUrl || ""}`.toLowerCase();
    return value.includes("image/") || /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/.test(value);
  };

  const getHistoryUploads = () => {
    if (role === 'student') return uploads;
    if (role === 'admin') return allUploads;
    return allUploads.filter(u => u.destination === role || u.destination === 'both');
  };

  const getStudentNumber = (email?: string | null) => {
    if (!email) return 'N/A';
    return email.split('@')[0] || 'N/A';
  };

  const getStudentLastName = (email?: string | null) => {
    if (!email) return 'N/A';
    const student = allStudents.find((s) => s.email?.toLowerCase() === email.toLowerCase());
    const fullName = student?.displayName?.trim();
    if (!fullName) return 'N/A';
    const parts = fullName.split(/\s+/);
    return parts[parts.length - 1] || 'N/A';
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const email = u.email || "";
        const isAllowedDomain = email.endsWith("@g.batstate-u.edu.ph");
        const isAdminEmail = email === "andybarreda423@gmail.com";
        const isTemporaryDeansEmail = email === "andybarreda0731@gmail.com";

        if (!isAllowedDomain && !isAdminEmail && !isTemporaryDeansEmail) {
          setAuthError("Access denied. Please use your institutional (@g.batstate-u.edu.ph) Student Email account.");
          await auth.signOut();
          setUser(null);
          setRole(null);
          setLoading(false);
          return;
        }

        // Determine role based on email pattern
        let assignedRole: UserRole = 'student';
        
        if (isAdminEmail) {
          assignedRole = 'admin';
        } else if (email === 'cics.alangilan@g.batstate-u.edu.ph' || isTemporaryDeansEmail) {
          assignedRole = 'deans_office';
        } else if ([
          'iintessalangilan@g.batstate-u.edu.ph',
          'cicsscalangilan@g.batstate-u.edu.ph',
          'jpcsalangilan@g.batstate-u.edu.ph',
          'accessalangilan@g.batstate-u.edu.ph'
        ].includes(email)) {
          assignedRole = 'student_org';
        } else if (isAllowedDomain) {
          // Any other school email is automatically a student
          assignedRole = 'student';
        }

        setAuthError(null);
        setUser(u);
        // Fetch or initialize user role
        const userDoc = await getDoc(doc(db, "users", u.uid));
        if (userDoc.exists()) {
          const existingData = userDoc.data();
          // If the role derived from email is different from stored role, update it (except for admin overrides)
          if (existingData.role !== assignedRole && existingData.role !== 'admin') {
            try {
              await updateDoc(doc(db, "users", u.uid), { role: assignedRole });
              setRole(assignedRole);
            } catch (error) {
              handleFirestoreError(error, OperationType.UPDATE, `users/${u.uid}`);
            }
          } else {
            setRole(existingData.role as UserRole);
          }
        } else {
          try {
            await setDoc(doc(db, "users", u.uid), {
              uid: u.uid,
              email: u.email,
              displayName: u.displayName,
              role: assignedRole,
              createdAt: Date.now()
            });
            setRole(assignedRole);
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, `users/${u.uid}`);
          }
        }
      } else {
        setUser(null);
        setRole(null);
        setActiveTab('dashboard');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !role) return;

    // Student specific queries
    if (role === 'student') {
      const uploadsQuery = query(
        collection(db, "uploads"),
        where("uid", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      const paymentsQuery = query(
        collection(db, "payments"),
        where("uid", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      const studentLiabilitiesQuery = query(
        collection(db, "liabilities"),
        where("studentUid", "==", user.uid),
        orderBy("createdAt", "desc")
      );

      const unsubUploads = onSnapshot(uploadsQuery, (snapshot) => {
        console.log("Student Uploads fetched:", snapshot.docs.length);
        setUploads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileUploadType)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "uploads"));

      const unsubPayments = onSnapshot(paymentsQuery, (snapshot) => {
        console.log("Student Payments fetched:", snapshot.docs.length);
        setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PaymentTransaction)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "payments"));

      const unsubStudentLiabilities = onSnapshot(studentLiabilitiesQuery, (snapshot) => {
        console.log("Student Liabilities fetched:", snapshot.docs.length);
        setLiabilities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Liability)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "liabilities"));

      return () => { 
        unsubUploads(); 
        unsubPayments(); 
        unsubStudentLiabilities();
      };
    }

    // Dean's Office queries (uploads and payments destined for Dean's Office)
    if (role === 'deans_office') {
      const deansUploadsQuery = query(
        collection(db, "uploads"),
        where("destination", "in", ["deans_office", "both"]),
        orderBy("createdAt", "desc")
      );
      const deansPaymentsQuery = query(
        collection(db, "payments"),
        where("destination", "in", ["deans_office", "both"]),
        orderBy("createdAt", "desc")
      );
      const unsubAllUploads = onSnapshot(deansUploadsQuery, (snapshot) => {
        setAllUploads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileUploadType)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "uploads"));
      const unsubAllPayments = onSnapshot(deansPaymentsQuery, (snapshot) => {
        setAllPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PaymentTransaction)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "payments"));
      return () => { unsubAllUploads(); unsubAllPayments(); };
    }

    // Student Org queries (uploads and payments destined for Student Org)
    if (role === 'student_org') {
      const orgUploadsQuery = query(
        collection(db, "uploads"),
        where("destination", "in", ["student_org", "both"]),
        orderBy("createdAt", "desc")
      );
      const orgPaymentsQuery = query(
        collection(db, "payments"),
        where("destination", "in", ["student_org", "both"]),
        orderBy("createdAt", "desc")
      );
      const unsubAllUploads = onSnapshot(orgUploadsQuery, (snapshot) => {
        setAllUploads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileUploadType)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "uploads"));
      const unsubAllPayments = onSnapshot(orgPaymentsQuery, (snapshot) => {
        setAllPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PaymentTransaction)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "payments"));
      return () => { unsubAllUploads(); unsubAllPayments(); };
    }

    // Admin queries (all uploads and all payments)
    if (role === 'admin') {
      const allUploadsQuery = query(collection(db, "uploads"), orderBy("createdAt", "desc"));
      const allPaymentsQuery = query(collection(db, "payments"), orderBy("createdAt", "desc"));
      const unsubAllUploads = onSnapshot(allUploadsQuery, (snapshot) => {
        setAllUploads(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileUploadType)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "uploads"));
      const unsubAllPayments = onSnapshot(allPaymentsQuery, (snapshot) => {
        setAllPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PaymentTransaction)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "payments"));
      return () => { unsubAllUploads(); unsubAllPayments(); };
    }
  }, [user, role]);

  useEffect(() => {
    if (!user || !role) return;

    if (role === 'deans_office' || role === 'student_org' || role === 'admin') {
      const studentsQuery = query(collection(db, "users"), where("role", "==", "student"));
      const unsubStudents = onSnapshot(studentsQuery, (snapshot) => {
        const students = snapshot.docs
          .map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile))
          .filter(s => s.email?.endsWith("@g.batstate-u.edu.ph"));
        // Filter unique by email
        const uniqueStudents = students.reduce((acc: UserProfile[], current) => {
          if (!current.email) return acc.concat([current]);
          const exists = acc.find(item => item.email === current.email);
          if (!exists) {
            return acc.concat([current]);
          } else {
            return acc;
          }
        }, []);
        setAllStudents(uniqueStudents);
      }, (error) => handleFirestoreError(error, OperationType.GET, "users"));
      
      const liabilitiesQuery = role === 'admin'
        ? query(collection(db, "liabilities"), orderBy("createdAt", "desc"))
        : query(
            collection(db, "liabilities"),
            where("destination", "in", [role, "both"]),
            orderBy("createdAt", "desc")
          );
      const unsubLiabilities = onSnapshot(liabilitiesQuery, (snapshot) => {
        setLiabilities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Liability)));
      }, (error) => handleFirestoreError(error, OperationType.GET, "liabilities"));
      
      return () => { unsubStudents(); unsubLiabilities(); };
    }

    if (role === 'student') {
      // Handled in the first useEffect
      return;
    }
  }, [user, role]);

  const handleUploadComplete = async (file: { name: string; url: string; size: number; type: string; destination: 'deans_office' | 'student_org'; description: string }) => {
    console.log("handleUploadComplete triggered with file:", file);
    if (!user) {
      console.error("No user found in handleUploadComplete");
      return;
    }
    try {
      console.log("Adding document to Firestore 'uploads' collection...");
      const docRef = await addDoc(collection(db, "uploads"), {
        uid: user.uid,
        studentEmail: user.email,
        fileName: file.name,
        fileUrl: file.url,
        fileType: file.type,
        fileSize: file.size,
        category: 'assignment',
        destination: file.destination,
        description: file.description,
        status: 'pending_review',
        createdAt: Date.now(),
      });
      console.log("Document added successfully with ID:", docRef.id);
      setActiveTab('dashboard');
    } catch (error) {
      console.error("Error in handleUploadComplete:", error);
      handleFirestoreError(error, OperationType.CREATE, "uploads");
    }
  };

  const initiateLiabilityPayment = async (liability: Liability) => {
    try {
      // Determine payment destination based on tagging type
      const paymentDestination = (liability.taggingType === 'Preset' || (liability.taggingType as unknown as string) === 'preset') ? 'both' : 'deans_office';
      
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          liabilityId: liability.id,
          fileName: liability.description,
          amount: liability.amount,
          uid: user?.uid,
          studentEmail: user?.email,
          studentName: user?.displayName,
          destination: paymentDestination,
          taggingType: liability.taggingType,
          origin: window.location.origin
        }),
      });
      const data = await response.json();
      if (data.id && data.url) {
        // Store session ID and liability ID before redirecting to PayMongo
        sessionStorage.setItem('paymentSessionId', data.id);
        sessionStorage.setItem('liabilityIdForPayment', liability.id || '');
        // Use replace to avoid the user going back to the app page with the Pay button
        window.location.replace(data.url);
      } else {
        setPaymentResult({ success: false, message: data.error || "Failed to initiate payment. Please try again." });
      }
    } catch (error) {
      console.error("Liability payment initiation failed:", error);
      setPaymentResult({ success: false, message: "Could not connect to payment server. Please check your connection." });
    }
  };

  const [isAddingLiability, setIsAddingLiability] = useState(false);

  const MEMBERSHIP_FEES: Record<string, number> = {
    "INTESS Membership Fee": 100,
    "JPCS Membership Fee": 150,
    "ACCES Membership Fee": 100,
    "CICS Membership Fee": 100,
  };

  const addLiability = async (student: UserProfile | null, description: string, amount: number) => {
    if (!role || !student || isAddingLiability) return;
    
    // Check if Firestore is initialized
    if (!db) {
      setPaymentResult({ success: false, message: "Database not initialized. Please contact administrator." });
      return;
    }
    
    setIsAddingLiability(true);
    try {
      const isMembershipFee = description in MEMBERSHIP_FEES;
      const currentSource = isMembershipFee ? 'both' : (role === 'admin' ? 'deans_office' : role);
      const taggingType = isMembershipFee ? 'preset' : 'freeText';
      
      // Check for existing liability with same description for this student
      const existingLiability = liabilities.find(l => 
        l.studentEmail === student.email && 
        l.description.toLowerCase() === description.toLowerCase() &&
        l.status !== 'paid'
      );

      if (existingLiability) {
        // If it exists and from a different source, update to 'both'
        if (existingLiability.source !== currentSource && existingLiability.source !== 'both') {
          await updateDoc(doc(db, "liabilities", existingLiability.id), {
            source: 'both',
            destination: 'both'
          });
          console.log("Updated existing liability source to 'both'");
          setPaymentResult({ success: true, message: "Liability source updated to both Dean's Office and Student Org." });
        } else {
          console.log("Liability already exists, skipping creation");
          setPaymentResult({ success: false, message: "This liability already exists for this student." });
        }
      } else {
        // Create new liability
        await addDoc(collection(db, "liabilities"), {
          studentUid: student.uid,
          studentEmail: student.email,
          studentName: student.displayName,
          description,
          amount,
          source: currentSource,
          destination: currentSource,
          taggingType,
          status: 'unpaid',
          createdAt: Date.now()
        });
        setPaymentResult({ success: true, message: `Liability added for ${student.displayName}` });
      }
      
      setSelectedStudentForLiability(null);
      setLiabilityDesc("");
      setLiabilityType("other");
      setLiabilityAmount("");
    } catch (error: any) {
      console.error("Error adding liability:", error);
      setPaymentResult({ success: false, message: `Failed to add liability: ${error.message}` });
      handleFirestoreError(error, OperationType.CREATE, "liabilities");
    } finally {
      setIsAddingLiability(false);
    }
  };

  const updateFileStatus = async (fileId: string, status: FileStatus, notes?: string) => {
    try {
      await updateDoc(doc(db, "uploads", fileId), { 
        status,
        updatedAt: Date.now(),
        ...(notes && { reviewNotes: notes })
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `uploads/${fileId}`);
    }
  };

  const deleteLiability = async (liabilityId: string) => {
    try {
      await deleteDoc(doc(db, "liabilities", liabilityId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `liabilities/${liabilityId}`);
    }
  };

  const deletePendingTransactions = async () => {
    if (role !== 'admin' && role !== 'deans_office' && role !== 'student_org') return;
    const pendingTransactions = allPayments.filter(p => p.status === 'pending');
    if (pendingTransactions.length === 0) return;
    
    try {
      const deletePromises = pendingTransactions.map(p => deleteDoc(doc(db, "payments", p.id)));
      await Promise.all(deletePromises);
      console.log(`Deleted ${pendingTransactions.length} pending transactions.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "payments/pending");
    }
  };

  const clearAllTransactions = async () => {
    if (role !== 'admin') return;
    if (allPayments.length === 0) return;
    if (!confirm(`Are you sure you want to delete all ${allPayments.length} transactions?`)) return;

    try {
      await Promise.all(allPayments.map((p) => deleteDoc(doc(db, "payments", p.id))));
      setPaymentResult({ success: true, message: `Deleted ${allPayments.length} transactions.` });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "payments/all");
    }
  };

  const clearAllUploadedDocuments = async () => {
    if (role !== 'admin') return;
    if (allUploads.length === 0) return;
    if (!confirm(`Are you sure you want to delete all ${allUploads.length} uploaded documents?`)) return;

    try {
      for (const file of allUploads) {
        await deleteDoc(doc(db, "uploads", file.id));
        if (file.fileUrl && file.fileUrl.includes("firebasestorage.googleapis.com")) {
          try {
            const fileRef = ref(storage, file.fileUrl);
            await deleteObject(fileRef);
          } catch (storageErr) {
            console.warn("Could not delete file from storage:", storageErr);
          }
        }
      }
      setPaymentResult({ success: true, message: `Deleted ${allUploads.length} uploaded documents.` });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "uploads/all");
    }
  };

  const toggleStudentSelection = (uid: string) => {
    setSelectedStudentUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const toggleSelectAllFilteredStudents = (filteredStudents: UserProfile[]) => {
    const filteredIds = filteredStudents.map((s) => s.uid);
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedStudentUids.includes(id));

    if (allSelected) {
      setSelectedStudentUids((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedStudentUids((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const addLiabilityToSelectedStudents = async (description: string, amount: number) => {
    if (!role || isAddingLiability) return;
    if (!db) {
      setPaymentResult({ success: false, message: "Database not initialized. Please contact administrator." });
      return;
    }

    const selectedStudents = allStudents.filter((s) => selectedStudentUids.includes(s.uid));
    if (selectedStudents.length === 0) {
      setPaymentResult({ success: false, message: "No students selected." });
      return;
    }

    setIsAddingLiability(true);
    try {
      const isMembershipFee = description in MEMBERSHIP_FEES;
      const currentSource = isMembershipFee ? 'both' : (role === 'admin' ? 'deans_office' : role);
      const taggingType = isMembershipFee ? 'preset' : 'freeText';

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const student of selectedStudents) {
        const existingLiability = liabilities.find(l =>
          l.studentEmail === student.email &&
          l.description.toLowerCase() === description.toLowerCase() &&
          l.status !== 'paid'
        );

        if (existingLiability) {
          if (existingLiability.source !== currentSource && existingLiability.source !== 'both') {
            await updateDoc(doc(db, "liabilities", existingLiability.id), {
              source: 'both',
              destination: 'both'
            });
            updatedCount++;
          } else {
            skippedCount++;
          }
        } else {
          await addDoc(collection(db, "liabilities"), {
            studentUid: student.uid,
            studentEmail: student.email,
            studentName: student.displayName,
            description,
            amount,
            source: currentSource,
            destination: currentSource,
            taggingType,
            status: 'unpaid',
            createdAt: Date.now()
          });
          createdCount++;
        }
      }

      const affected = createdCount + updatedCount;
      setPaymentResult({
        success: true,
        message: `Applied liability to ${affected} students (${createdCount} new, ${updatedCount} updated, ${skippedCount} skipped).`
      });

      setSelectedStudentUids([]);
      setIsBulkLiabilityModalOpen(false);
      setLiabilityDesc("");
      setLiabilityType("other");
      setLiabilityAmount("");
    } catch (error: any) {
      console.error("Error adding liability to selected students:", error);
      setPaymentResult({ success: false, message: `Failed bulk liability assignment: ${error.message}` });
      handleFirestoreError(error, OperationType.CREATE, "liabilities/bulk");
    } finally {
      setIsAddingLiability(false);
    }
  };

  const markLiabilityAsPaid = async (liabilityId: string) => {
    try {
      await updateDoc(doc(db, "liabilities", liabilityId), { 
        status: 'paid',
        updatedAt: Date.now()
      });
      
      // Also find and update the associated transaction to 'completed'
      const associatedPayment = allPayments.find(p => p.liabilityId === liabilityId && p.status !== 'completed');
      if (associatedPayment) {
        await updateDoc(doc(db, "payments", associatedPayment.id), {
          status: 'completed',
          updatedAt: Date.now()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `liabilities/${liabilityId}`);
    }
  };

  const clearAllPendingValidationLiabilities = async () => {
    if (role !== 'admin' && role !== 'deans_office' && role !== 'student_org') return;
    const pendingValidationLiabilities = liabilities.filter(l => l.status === 'pending_validation' && (role === 'admin' || l.source === role || l.source === 'both'));
    if (pendingValidationLiabilities.length === 0) return;

    if (!confirm(`Are you sure you want to validate and clear ${pendingValidationLiabilities.length} liabilities awaiting validation?`)) return;

    try {
      for (const liability of pendingValidationLiabilities) {
        await updateDoc(doc(db, "liabilities", liability.id), { 
          status: 'paid',
          updatedAt: Date.now()
        });

        // Also update associated transactions
        const associatedPayment = allPayments.find(p => p.liabilityId === liability.id && p.status === 'pending');
        if (associatedPayment) {
          await updateDoc(doc(db, "payments", associatedPayment.id), {
            status: 'completed',
            updatedAt: Date.now()
          });
        }
      }
      console.log(`Cleared ${pendingValidationLiabilities.length} liabilities awaiting validation.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, "liabilities/bulk_validate");
    }
  };

  const changeRole = async (newRole: UserRole) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "users", user.uid), { role: newRole });
      setRole(newRole);
      setActiveTab('dashboard');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  useEffect(() => {
    const type = window.location.pathname;

    // Only proceed if we're on the success or cancel page
    if (type === '/payment-success' || type === '/payment-cancel') {
      const isCancellation = type === '/payment-cancel';
      
      // If user is not yet loaded, wait for the next effect run
      if (!user) return;

      // Get session ID from sessionStorage or URL params
      let sessionId = sessionStorage.getItem('paymentSessionId');
      if (!sessionId) {
        const params = new URLSearchParams(window.location.search);
        sessionId = params.get('session_id');
      }

      // If we've already started processing this session, don't do it again
      if (!sessionId || paymentProcessedRef.current === sessionId) return;

      const verifyPayment = async (retryCount = 0) => {
        try {
          paymentProcessedRef.current = sessionId!;
          console.log(`Initiating payment verification for session: ${sessionId}. Cancellation: ${isCancellation}`);
          
          setPaymentResult(null);

          const queryParams = new URLSearchParams({
            session_id: sessionId!
          });
          
          if (isCancellation) {
            queryParams.append('force_status', 'cancelled');
          }

          const response = await fetch(`/api/verify-payment?${queryParams.toString()}`);
          const data = await response.json();
          console.log("Payment verification response:", data);
          
          if (data.success || data.status === "completed") {
            // Update local liability status immediately so student UI flips to pending
            const liabilityIdFromSession = sessionStorage.getItem('liabilityIdForPayment');
            if (liabilityIdFromSession) {
              // Force-fetch the fresh liability from Firestore to bypass listener cache
              try {
                const liabilityRef = doc(db, "liabilities", liabilityIdFromSession);
                const freshDoc = await getDoc(liabilityRef);
                if (freshDoc.exists()) {
                  const freshData = freshDoc.data();
                  console.log(`Fresh liability data from Firestore:`, freshData);
                  // Update local state with fresh data
                  setLiabilities(prev => prev.map(l => 
                    l.id === liabilityIdFromSession 
                      ? { ...l, ...freshData, id: liabilityIdFromSession } 
                      : l
                  ));
                } else {
                  // Fallback: just set status to pending
                  setLiabilities(prev => prev.map(l => l.id === liabilityIdFromSession ? { ...l, status: 'pending' } : l));
                }
              } catch (error) {
                console.warn("Could not fetch fresh liability, using optimistic update:", error);
                setLiabilities(prev => prev.map(l => l.id === liabilityIdFromSession ? { ...l, status: 'pending' } : l));
              }
            }

            // Update local payment status immediately in case listener hasn't synced yet
            if (sessionId) {
              setPayments(prev => prev.map(p => p.paymentSessionId === sessionId ? { ...p, status: 'completed' } : p));
            }

            if (liabilityIdFromSession) {
              let statusConfirmed = false;
              let confirmationRetries = 0;
              const maxConfirmationRetries = 10; // Wait max 5 seconds (500ms * 10)
              
              while (!statusConfirmed && confirmationRetries < maxConfirmationRetries) {
                await new Promise(resolve => setTimeout(resolve, 500));
                const updatedLiability = liabilities.find(l => l.id === liabilityIdFromSession);
                if (updatedLiability && (updatedLiability.status === 'pending' || updatedLiability.status === 'pending_validation')) {
                  statusConfirmed = true;
                  console.log(`Liability status confirmed as '${updatedLiability.status}'`);
                } else {
                  confirmationRetries++;
                  console.log(`Waiting for liability status update... (${confirmationRetries}/${maxConfirmationRetries})`);
                }
              }
              
              if (!statusConfirmed) {
                console.warn(`Liability status not updated after retries, but payment was successful. Proceeding with current UI.`);
              }
            }
            
            setPaymentResult({ success: true, message: "Payment successful! Your liability has been settled." });
            sessionStorage.removeItem('paymentSessionId');
            sessionStorage.removeItem('liabilityIdForPayment');
            setActiveTab('payment');
            window.history.replaceState({}, '', '/');
          } else if (data.status === "cancelled") {
            setPaymentResult({ success: false, message: "Payment was cancelled. You can try again whenever you're ready." });
            sessionStorage.removeItem('paymentSessionId');
            setActiveTab('payment');
            window.history.replaceState({}, '', '/');
          } else if (data.status === "failed") {
            setPaymentResult({ success: false, message: "Your payment was rejected or failed. Please try again or use a different payment method." });
            sessionStorage.removeItem('paymentSessionId');
            setActiveTab('payment');
            window.history.replaceState({}, '', '/');
          } else if (data.status === "open" && retryCount < 8 && !isCancellation) {
            // Paymongo might take a few seconds to update status, retry more times
            console.log(`Payment still open, retrying... (${retryCount + 1}/8)`);
            setTimeout(() => verifyPayment(retryCount + 1), 3000);
          } else {
            const statusLabel = data.status === "cancelled" ? "Cancelled" : (data.status === "failed" ? "Failed" : data.status);
            const errorMsg = data.error || `Payment status: ${statusLabel}. If you have already paid, please wait a few minutes for it to reflect.`;
            setPaymentResult({ success: false, message: errorMsg });
            setActiveTab('payment');
            window.history.replaceState({}, '', '/');
          }
        } catch (error) {
          console.error("Payment verification failed:", error);
          setPaymentResult({ success: false, message: "There was an error verifying your payment. Please check your internet connection or contact support." });
          window.history.replaceState({}, '', '/');
        }
      };
      
      verifyPayment();
    }
  }, [user]);

  // Auto-dismiss payment results
  useEffect(() => {
    if (paymentResult) {
      const timer = setTimeout(() => {
        setPaymentResult(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [paymentResult]);

  const NavItem = ({ id, icon: Icon, label, roles }: { id: Tab; icon: any; label: string; roles?: UserRole[] }) => {
    if (roles && role && !roles.includes(role)) return null;
    return (
      <button
        onClick={() => {
          setActiveTab(id);
          setIsMobileMenuOpen(false);
        }}
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl transition-all w-full text-left font-medium",
          activeTab === id 
            ? "bg-zinc-900 text-white shadow-md shadow-zinc-200" 
            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        )}
      >
        <Icon className="w-5 h-5" />
        <span className="text-sm">{label}</span>
      </button>
    );
  };

  return (
    <ErrorBoundary>
      <div className={cn(
        "theme-cics min-h-screen bg-[#F8F9FA] flex flex-col md:flex-row font-sans text-zinc-900 overflow-x-hidden",
        isDarkMode && "dark"
      )}>
      <button
        type="button"
        onClick={() => setIsDarkMode((prev) => !prev)}
        aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
        title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
        className="global-theme-toggle fixed right-4 bottom-4 md:top-5 md:right-5 md:bottom-auto z-[60] inline-flex items-center justify-center w-11 h-11 rounded-full border transition-all"
      >
        {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>

      {/* Sidebar - Only show when logged in */}
      {user && (
        <>
          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-zinc-200 sticky top-0 z-50">
            <div className="flex items-center gap-2">
              <img
                src="/cics-logo.jpg"
                alt="CICS Logo"
                className="w-8 h-8 rounded-lg object-cover"
              />
              <h1 className="text-sm font-bold tracking-tight">CICS Portal</h1>
            </div>
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Sidebar Overlay */}
          <AnimatePresence>
            {isMobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
              />
            )}
          </AnimatePresence>

          {/* Sidebar */}
          <aside className={cn(
            "fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-zinc-200 p-6 flex flex-col gap-8 transition-transform duration-300 ease-in-out md:relative md:translate-x-0 md:z-0",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}>
            <div className="hidden md:flex items-center gap-3 px-2">
              <img
                src="/cics-logo.jpg"
                alt="CICS Logo"
                className="w-10 h-10 rounded-xl object-cover"
              />
              <div className="flex flex-col">
                <h1 className="text-lg font-bold tracking-tight">CICS Portal</h1>
                <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">College of Informatics and Computing Sciences</span>
              </div>
            </div>

            <nav className="flex-1 space-y-2 overflow-y-auto">
            <NavItem id="dashboard" icon={LayoutDashboard} label="Dashboard" />
            
            {/* Student Tabs */}
            <NavItem id="upload" icon={Upload} label="Upload Files" roles={['student']} />
            <NavItem id="payment" icon={CreditCard} label="Payment" roles={['student']} />
            <NavItem id="history" icon={History} label="File Status" roles={['student']} />

            {/* Dean's Office Tabs */}
            <NavItem id="review" icon={FileSearch} label="Review Files" roles={['deans_office']} />
            <NavItem id="students" icon={Users} label="Students" roles={['deans_office', 'student_org']} />
            <NavItem id="transactions" icon={Receipt} label="Transaction History" roles={['deans_office']} />
            <NavItem id="history" icon={FileText} label="Files Uploaded" roles={['deans_office']} />

            {/* Student Org Tabs */}
            <NavItem id="review" icon={FileSearch} label="Review Files" roles={['student_org']} />
            <NavItem id="transactions" icon={Receipt} label="Transaction History" roles={['student_org']} />
            <NavItem id="history" icon={FileText} label="Files Uploaded" roles={['student_org']} />

            {/* Admin Tabs */}
            <NavItem id="students" icon={Users} label="Students" roles={['admin']} />
            <NavItem id="transactions" icon={Receipt} label="Transaction History" roles={['admin']} />
            <NavItem id="history" icon={FileText} label="Files Uploaded" roles={['admin']} />
          </nav>

          {/* Demo Role Switcher - Only for Super Admin */}
          {user?.email === "andybarreda423@gmail.com" && (
            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-3">
              <p className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider px-1">Demo: Switch Role</p>
              <div className="flex flex-col gap-1">
                {(['student', 'deans_office', 'student_org', 'admin'] as UserRole[]).map(r => (
                  <button
                    key={r}
                    onClick={() => changeRole(r)}
                    className={cn(
                      "text-xs px-3 py-2 rounded-lg text-left transition-colors",
                      role === r ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-200"
                    )}
                  >
                    {r.replace('_', ' ').toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-auto pt-6 border-t border-zinc-100">
            <Auth user={user} loading={loading} onLoginStart={() => setAuthError(null)} />
          </div>
        </aside>
        </>
      )}

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-12 overflow-y-auto w-full">
        {!user && !loading ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6 px-4">
            <div className="w-24 h-24 bg-white rounded-3xl border border-zinc-200 flex items-center justify-center mb-4 p-2 shadow-sm">
              <img
                src="/cics-logo.jpg"
                alt="CICS Logo"
                className="w-full h-full rounded-2xl object-cover"
              />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Welcome to CICS Portal</h2>
              <p className="text-zinc-500 text-sm leading-relaxed">
                Please sign in with your institutional Google account (Student Email) to access file uploads, payments, and departmental services.
              </p>
            </div>
            {authError && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-3 text-rose-600 text-sm animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p>{authError}</p>
              </div>
            )}
            <Auth user={user} loading={loading} onLoginStart={() => setAuthError(null)} />
          </div>
        ) : (
          <div className="w-full max-w-7xl mx-auto space-y-10">
            <AnimatePresence>
        {paymentResult && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4"
          >
            <div className={cn(
              "p-4 rounded-2xl shadow-2xl border flex items-center gap-4",
              paymentResult.success 
                ? "bg-emerald-600 border-emerald-500 text-white" 
                : "bg-rose-600 border-rose-500 text-white"
            )}>
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                {paymentResult.success ? <CheckCircle2 className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm">{paymentResult.success ? "Success" : "Payment Issue"}</p>
                <p className="text-xs opacity-90">{paymentResult.message}</p>
              </div>
              <button 
                onClick={() => setPaymentResult(null)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
              {activeTab === 'dashboard' && (
                <motion.div
                  key="dashboard"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-10 pb-12"
                >
                  <header className="dashboard-hero relative rounded-[40px] text-white overflow-hidden shadow-2xl">
                    <div className="dashboard-hero-orb" />
                    <div className="dashboard-hero-orb-secondary" />

                    <div className="relative z-10 flex flex-col gap-8 p-8 md:p-10 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-4xl space-y-5">
                        <div className="dashboard-hero-kicker inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest">
                          <LayoutDashboard className="w-3 h-3" />
                          <span>System Overview</span>
                        </div>
                        <div className="space-y-3">
                          <h1 className="dashboard-hero-title text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[0.98]">
                            {(role === 'deans_office' || role === 'student_org') ? (
                              getTimeGreeting()
                            ) : (
                              <>
                                {getTimeGreeting()}, <span className="dashboard-hero-name">{role === 'student' ? formatNameFirstLetter(user?.displayName?.split(' ')[0]) : (user?.displayName?.split(' ')[0] || 'User')}</span>
                              </>
                            )}
                          </h1>
                          <p className="dashboard-hero-subtitle text-sm md:text-[clamp(0.86rem,1.05vw,1.08rem)] font-medium leading-tight max-w-none md:whitespace-nowrap">
                            {role === 'student'
                              ? "Upload requirements, settle liabilities, and track payment progress in one place."
                              : role === 'deans_office'
                              ? "Review submissions, manage liabilities, and verify student transactions with end-to-end control."
                              : role === 'student_org'
                              ? "Monitor student submissions, apply liabilities, and validate related payments efficiently."
                              : "Oversee submissions, transactions, liabilities, and user workflows across the entire CICS portal."}
                          </p>
                        </div>
                      </div>

                      <div className="dashboard-clock-panel rounded-3xl px-4 py-3.5 text-right w-full max-w-[290px] lg:w-[290px] shrink-0">
                        <div className="dashboard-clock-label flex items-center justify-end gap-2 text-[10px] uppercase tracking-widest">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Real-Time Clock</span>
                        </div>
                        <p className="dashboard-clock-time text-2xl md:text-[2rem] font-bold tracking-tight leading-tight">
                          {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </p>
                        <p className="dashboard-clock-date text-xs md:text-sm font-medium">
                          {currentTime.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                  </header>

                  {role === 'student' && (
                    <div className="space-y-10">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <motion.div 
                          whileHover={{ y: -5 }}
                          className="student-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl hover:border-zinc-900/10 transition-all group"
                        >
                          <div className="flex items-center justify-between mb-6">
                            <div className="p-3 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                              <FileText className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Submissions</p>
                              <p className="text-3xl font-bold text-zinc-900">{uploads.length}</p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-zinc-900 transition-all duration-1000" 
                                style={{ width: `${uploads.length > 0 ? (uploads.filter(u => u.status === 'approved').length / uploads.length) * 100 : 0}%` }} 
                              />
                            </div>
                            <p className="text-[10px] text-zinc-500 font-medium">
                              {uploads.filter(u => u.status === 'approved').length} of {uploads.length} files approved
                            </p>
                          </div>
                        </motion.div>

                        <motion.div 
                          whileHover={{ y: -5 }}
                          className="student-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl hover:border-zinc-900/10 transition-all group"
                        >
                          <div className="flex items-center justify-between mb-6">
                            <div className={cn(
                              "p-3 rounded-2xl transition-all duration-500",
                              liabilities.filter(l => l.status === 'unpaid' || l.status === 'pending').length > 0 
                                ? (liabilities.some(l => l.status === 'pending') ? "bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white" : "bg-rose-50 text-rose-600 group-hover:bg-rose-600 group-hover:text-white")
                                : "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white"
                            )}>
                              {liabilities.filter(l => l.status === 'unpaid' || l.status === 'pending').length > 0 ? <AlertCircle className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Liabilities</p>
                              <p className={cn(
                                "text-3xl font-bold",
                                liabilities.filter(l => l.status === 'unpaid' || l.status === 'pending').length > 0 
                                  ? (liabilities.some(l => l.status === 'pending') ? "text-amber-600" : "text-rose-600") 
                                  : "text-emerald-600"
                              )}>
                                {liabilities.filter(l => l.status === 'unpaid' || l.status === 'pending').length > 0 ? (liabilities.every(l => l.status === 'pending') ? "Pending" : "Due") : "Clear"}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                              <div 
                                className={cn(
                                  "h-full transition-all duration-1000",
                                  liabilities.filter(l => l.status === 'pending' || l.status === 'pending_validation').length > 0 
                                    ? (liabilities.some(l => l.status === 'pending_validation') ? "bg-amber-600" : "bg-rose-600") 
                                    : "bg-emerald-600"
                                )}
                                style={{ width: `${liabilities.filter(l => l.status === 'unpaid' || l.status === 'pending').length > 0 ? 100 : 0}%` }} 
                              />
                            </div>
                            <p className="text-[10px] text-zinc-500 font-medium">
                              {liabilities.filter(l => l.status === 'unpaid' || l.status === 'pending').length} outstanding liabilities
                            </p>
                          </div>
                        </motion.div>

                        <motion.div 
                          whileHover={{ y: -5 }}
                          className="student-stat-card student-reviewing-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl hover:border-zinc-900/10 transition-all group"
                        >
                          <div className="flex items-center justify-between mb-6">
                            <div className="student-reviewing-icon p-3 bg-amber-50 rounded-2xl group-hover:bg-amber-500 group-hover:text-white transition-all duration-500">
                              <Clock className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Reviewing</p>
                              <p className="text-3xl font-bold text-zinc-900">{uploads.filter(u => u.status === 'pending_review').length}</p>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="student-reviewing-track w-full h-1.5 bg-amber-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-amber-500 transition-all duration-1000" 
                                style={{ width: `${uploads.length > 0 ? (uploads.filter(u => u.status === 'pending_review').length / uploads.length) * 100 : 0}%` }} 
                              />
                            </div>
                            <p className="student-reviewing-label text-[10px] text-amber-600 font-medium">
                              Awaiting Verification
                            </p>
                          </div>
                        </motion.div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                        <div className="lg:col-span-2 space-y-6">
                          <div className="flex items-center justify-between px-2">
                            <h3 className="text-lg font-bold text-zinc-900">Quick Actions</h3>
                          </div>
                          <div className="grid grid-cols-1 gap-4">
                            <button 
                              onClick={() => setActiveTab('upload')}
                              className="group p-6 bg-white rounded-3xl border border-zinc-200 hover:border-zinc-900 hover:shadow-lg transition-all text-left flex items-center gap-6"
                            >
                              <div className="p-4 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                                <Upload className="w-6 h-6" />
                              </div>
                              <div className="space-y-1">
                                <p className="font-bold text-zinc-900">Submit Documents</p>
                                <p className="text-xs text-zinc-500">Upload your thesis or assignments</p>
                              </div>
                              <ChevronRight className="w-5 h-5 ml-auto text-zinc-300 group-hover:text-zinc-900 group-hover:translate-x-1 transition-all" />
                            </button>
                            <button 
                              onClick={() => setActiveTab('payment')}
                              className="group p-6 bg-white rounded-3xl border border-zinc-200 hover:border-zinc-900 hover:shadow-lg transition-all text-left flex items-center gap-6"
                            >
                              <div className="p-4 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                                <CreditCard className="w-6 h-6" />
                              </div>
                              <div className="space-y-1">
                                <p className="font-bold text-zinc-900">Settle Liabilities</p>
                                <p className="text-xs text-zinc-500">Pay your student organization fees</p>
                              </div>
                              <ChevronRight className="w-5 h-5 ml-auto text-zinc-300 group-hover:text-zinc-900 group-hover:translate-x-1 transition-all" />
                            </button>
                          </div>
                        </div>

                        <div className="lg:col-span-3 p-8 rounded-[32px] bg-white border border-zinc-200 shadow-sm space-y-8">
                          <div className="flex items-center justify-between">
                            <div className="space-y-1">
                              <h3 className="text-lg font-bold text-zinc-900">Recent Activity</h3>
                              <p className="text-xs text-zinc-500 font-medium">Your latest document submissions</p>
                            </div>
                            <button 
                              onClick={() => setActiveTab('history')} 
                              className="px-4 py-2 rounded-xl bg-zinc-50 text-[10px] font-bold text-zinc-500 hover:bg-zinc-900 hover:text-white uppercase tracking-widest transition-all"
                            >
                              View History
                            </button>
                          </div>
                          <div className="space-y-4">
                            {uploads.slice(0, 4).map((upload) => (
                              <div key={upload.id} className="group flex items-center gap-4 p-4 rounded-2xl hover:bg-zinc-50 transition-all border border-transparent hover:border-zinc-100">
                                <div className="p-3 bg-zinc-100 rounded-xl group-hover:bg-white transition-colors">
                                  <FileText className="w-5 h-5 text-zinc-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-zinc-900 truncate">{upload.fileName}</p>
                                  <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">{new Date(upload.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                </div>
                                <div className={cn(
                                  "px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border",
                                  upload.status === 'approved' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                  upload.status === 'rejected' ? "bg-rose-50 text-rose-600 border-rose-100" :
                                  "bg-amber-50 text-amber-600 border-amber-100"
                                )}>
                                  {upload.status.replace('_', ' ')}
                                </div>
                              </div>
                            ))}
                            {uploads.length === 0 && (
                              <div className="py-12 text-center space-y-3">
                                <div className="w-12 h-12 bg-zinc-50 rounded-full flex items-center justify-center mx-auto">
                                  <Inbox className="w-6 h-6 text-zinc-300" />
                                </div>
                                <p className="text-sm text-zinc-400 italic">No recent activity found.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {(role === 'deans_office' || role === 'student_org') && (
                    <div className="space-y-10">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <motion.div 
                          whileHover={{ y: -5 }}
                          className="dashboard-stat-card dashboard-stat-card-review p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl transition-all group"
                        >
                          <div className="flex items-center justify-between mb-6">
                            <div className="dashboard-stat-review-icon p-3 bg-amber-50 rounded-2xl group-hover:bg-amber-500 group-hover:text-white transition-all duration-500">
                              <FileSearch className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Pending Review</p>
                              <p className="text-3xl font-bold text-zinc-900">
                                {allUploads.filter(u => u.destination === role && u.status === 'pending_review').length}
                              </p>
                            </div>
                          </div>
                          <p className="dashboard-stat-review-label text-[10px] text-zinc-500 font-medium">Documents awaiting verification</p>
                        </motion.div>

                        <motion.div 
                          whileHover={{ y: -5 }}
                          className="dashboard-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl transition-all group"
                        >
                          <div className="flex items-center justify-between mb-6">
                            <div className="p-3 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                              <CheckCircle2 className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total Approved</p>
                              <p className="text-3xl font-bold text-zinc-900">
                                {allUploads.filter(u => u.destination === role && u.status === 'approved').length}
                              </p>
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium">Successfully processed files</p>
                        </motion.div>

                        <motion.div 
                          whileHover={{ y: -5 }}
                          className="dashboard-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl transition-all group"
                        >
                          <div className="flex items-center justify-between mb-6">
                            <div className="p-3 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                              <Receipt className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Revenue</p>
                              <p className="text-3xl font-bold text-zinc-900">
                                ₱{allPayments.filter(p => p.destination === role).reduce((acc, p) => acc + p.amount, 0).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium">Total collections to date</p>
                        </motion.div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                        <div className="lg:col-span-2 space-y-6">
                          <h3 className="text-lg font-bold text-zinc-900 px-2">Quick Actions</h3>
                          <div className="grid grid-cols-1 gap-4">
                            <button 
                              onClick={() => setActiveTab('review')}
                              className="group p-6 bg-white rounded-3xl border border-zinc-200 hover:border-zinc-900 hover:shadow-lg transition-all text-left flex items-center gap-6"
                            >
                              <div className="p-4 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                                <FileSearch className="w-6 h-6" />
                              </div>
                              <div className="space-y-1">
                                <p className="font-bold text-zinc-900">Review Submissions</p>
                                <p className="text-xs text-zinc-500">Verify student documents</p>
                              </div>
                              <ChevronRight className="w-5 h-5 ml-auto text-zinc-300 group-hover:text-zinc-900 group-hover:translate-x-1 transition-all" />
                            </button>
                            <button 
                              onClick={() => setActiveTab('students')}
                              className="group p-6 bg-white rounded-3xl border border-zinc-200 hover:border-zinc-900 hover:shadow-lg transition-all text-left flex items-center gap-6"
                            >
                              <div className="p-4 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                                <Users className="w-6 h-6" />
                              </div>
                              <div className="space-y-1">
                                <p className="font-bold text-zinc-900">Manage Students</p>
                                <p className="text-xs text-zinc-500">Update student liabilities</p>
                              </div>
                              <ChevronRight className="w-5 h-5 ml-auto text-zinc-300 group-hover:text-zinc-900 group-hover:translate-x-1 transition-all" />
                            </button>
                          </div>
                        </div>

                        <div className="lg:col-span-3 p-8 rounded-[32px] bg-white border border-zinc-200 shadow-sm space-y-8">
                          <div className="flex items-center justify-between">
                            <div className="space-y-1">
                              <h3 className="text-lg font-bold text-zinc-900">Recent Submissions</h3>
                              <p className="text-xs text-zinc-500 font-medium">Latest files from students</p>
                            </div>
                            <button onClick={() => setActiveTab('review')} className="px-4 py-2 rounded-xl bg-zinc-50 text-[10px] font-bold text-zinc-500 hover:bg-zinc-900 hover:text-white uppercase tracking-widest transition-all">Review All</button>
                          </div>
                          <div className="space-y-4">
                            {allUploads.filter(u => u.destination === role).slice(0, 4).map((upload) => (
                              <div key={upload.id} className="group flex items-center gap-4 p-4 rounded-2xl hover:bg-zinc-50 transition-all border border-transparent hover:border-zinc-100">
                                <div className="p-3 bg-zinc-100 rounded-xl group-hover:bg-white transition-colors">
                                  <FileText className="w-5 h-5 text-zinc-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-zinc-900 truncate">{upload.fileName}</p>
                                  <div className="flex items-center gap-2">
                                    <p className="text-[10px] text-zinc-400 font-medium">{upload.studentEmail}</p>
                                    <span className="text-[10px] text-zinc-300">•</span>
                                    <p className="text-[10px] text-zinc-400 font-medium">{new Date(upload.createdAt).toLocaleDateString()}</p>
                                  </div>
                                </div>
                                <div className={cn(
                                  "px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border",
                                  upload.status === 'approved' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                  upload.status === 'rejected' ? "bg-rose-50 text-rose-600 border-rose-100" :
                                  "bg-amber-50 text-amber-600 border-amber-100"
                                )}>
                                  {upload.status.replace('_', ' ')}
                                </div>
                              </div>
                            ))}
                            {allUploads.filter(u => u.destination === role).length === 0 && (
                              <div className="py-12 text-center space-y-3">
                                <div className="w-12 h-12 bg-zinc-50 rounded-full flex items-center justify-center mx-auto">
                                  <Inbox className="w-6 h-6 text-zinc-300" />
                                </div>
                                <p className="text-sm text-zinc-400 italic">No recent submissions.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {role === 'admin' && (
                    <div className="space-y-10">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        <motion.div whileHover={{ y: -5 }} className="dashboard-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl transition-all group">
                          <div className="flex items-center justify-between mb-6">
                            <div className="p-3 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                              <Building2 className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Dean's Office</p>
                              <p className="text-3xl font-bold text-zinc-900">{allUploads.filter(u => u.destination === 'deans_office').length}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium">Total submissions</p>
                        </motion.div>

                        <motion.div whileHover={{ y: -5 }} className="dashboard-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl transition-all group">
                          <div className="flex items-center justify-between mb-6">
                            <div className="p-3 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                              <Users className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Student Org</p>
                              <p className="text-3xl font-bold text-zinc-900">{allUploads.filter(u => u.destination === 'student_org').length}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium">Total submissions</p>
                        </motion.div>

                        <motion.div whileHover={{ y: -5 }} className="dashboard-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl transition-all group">
                          <div className="flex items-center justify-between mb-6">
                            <div className="p-3 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                              <Receipt className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Revenue</p>
                              <p className="text-3xl font-bold text-zinc-900">₱{allPayments.reduce((acc, p) => acc + p.amount, 0).toLocaleString()}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium">Total collections</p>
                        </motion.div>

                        <motion.div whileHover={{ y: -5 }} className="dashboard-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm hover:shadow-xl transition-all group">
                          <div className="flex items-center justify-between mb-6">
                            <div className="p-3 bg-zinc-50 rounded-2xl group-hover:bg-zinc-900 group-hover:text-white transition-all duration-500">
                              <CheckCircle2 className="w-6 h-6" />
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total Approved</p>
                              <p className="text-3xl font-bold text-zinc-900">{allUploads.filter(u => u.status === 'approved').length}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-500 font-medium">Successfully processed files</p>
                        </motion.div>
                      </div>

                      <div className="p-10 rounded-[40px] bg-zinc-50 border border-zinc-100 space-y-10">
                        <div className="flex items-center justify-between px-2">
                          <div className="space-y-1">
                            <h3 className="text-xl font-bold text-zinc-900">System Performance</h3>
                            <p className="text-sm text-zinc-500 font-medium">Real-time metrics across all departments</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                          <div className="dashboard-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm space-y-4">
                            <div className="flex items-center gap-3 text-zinc-400 mb-2">
                              <Users className="w-4 h-4" />
                              <p className="text-[10px] font-bold uppercase tracking-widest">User Base</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-4xl font-bold text-zinc-900">{allStudents.length}</p>
                              <p className="text-xs text-zinc-500">Registered students</p>
                            </div>
                          </div>
                          <div className="dashboard-stat-card p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm space-y-4">
                            <div className="flex items-center gap-3 text-zinc-400 mb-2">
                              <Receipt className="w-4 h-4" />
                              <p className="text-[10px] font-bold uppercase tracking-widest">Volume</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-4xl font-bold text-zinc-900">{allPayments.length}</p>
                              <p className="text-xs text-zinc-500">Total transactions</p>
                            </div>
                          </div>
                          <div className="dashboard-stat-card dashboard-stat-card-review p-8 bg-white rounded-3xl border border-zinc-200 shadow-sm space-y-4">
                            <div className="flex items-center gap-3 text-zinc-400 mb-2">
                              <FileSearch className="w-4 h-4" />
                              <p className="text-[10px] font-bold uppercase tracking-widest">Backlog</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-4xl font-bold text-zinc-900">{allUploads.filter(u => u.status === 'pending_review').length}</p>
                              <p className="dashboard-stat-review-label text-xs text-zinc-500">Pending reviews</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

                  {activeTab === 'upload' && role === 'student' && (
                    <motion.div key="upload" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                      <header className="space-y-2">
                        <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium uppercase tracking-wider">
                          <Upload className="w-4 h-4" />
                          <span>File Submission</span>
                        </div>
                        <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Upload Documents</h2>
                        <p className="text-zinc-500 text-sm">Submit your assignments or thesis documents. Note: Payment is only required for Student Org submissions.</p>
                      </header>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 p-10 bg-white rounded-[40px] border border-zinc-200 shadow-sm space-y-8">
                          <div className="space-y-2">
                            <h3 className="text-lg font-bold text-zinc-900">Drop Zone</h3>
                            <p className="text-xs text-zinc-400 font-medium">Supported formats: PDF, DOCX, JPG, PNG (Max 10MB)</p>
                          </div>
                          <FileUpload uid={user!.uid} onUploadComplete={handleUploadComplete} />
                        </div>

                        <div className="space-y-6 flex flex-col">
                          <div className="flex-1 p-8 bg-zinc-900 text-white rounded-[32px] shadow-xl space-y-6">
                            <h4 className="font-bold text-sm flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4 text-emerald-400" /> Upload Guidelines
                            </h4>
                            <ul className="space-y-4">
                              <li className="flex gap-3">
                                <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-[10px] font-bold">1</div>
                                <p className="text-xs text-zinc-400 leading-relaxed">Ensure your file name is clear and descriptive (e.g., Thesis_Draft_V1.pdf).</p>
                              </li>
                              <li className="flex gap-3">
                                <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-[10px] font-bold">2</div>
                                <p className="text-xs text-zinc-400 leading-relaxed">Select the correct destination (Dean's Office or Student Org) during upload.</p>
                              </li>
                              <li className="flex gap-3">
                                <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-[10px] font-bold">3</div>
                                <p className="text-xs text-zinc-400 leading-relaxed">Wait for the progress bar to complete before navigating away.</p>
                              </li>
                            </ul>
                          </div>

                          <div className="p-8 bg-white rounded-[32px] border border-zinc-200 shadow-sm space-y-4">
                            <h4 className="font-bold text-sm">Need Help?</h4>
                            <p className="text-xs text-zinc-500 leading-relaxed">
                              If you encounter any issues during the upload process, please contact the IT support desk or your department representative.
                            </p>
                            <button className="w-full py-3 bg-zinc-50 text-zinc-900 rounded-xl text-xs font-bold hover:bg-zinc-100 transition-all">
                              Contact Support
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

              {activeTab === 'payment' && role === 'student' && (
                <motion.div key="payment" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-10">
                  <header className="space-y-2">
                    <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium uppercase tracking-wider">
                      <CreditCard className="w-4 h-4" />
                      <span>PAYMENT</span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Payments & Liabilities</h2>
                    <p className="text-zinc-500 text-sm font-medium">Settle your student organization fees and track your transaction history.</p>
                  </header>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-10">
                      {/* Pending Liabilities */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between px-2">
                          <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                            <AlertCircle className="w-5 h-5 text-amber-500" /> Outstanding Liabilities
                          </h3>
                        </div>
                        <div className="grid gap-4">
                          {liabilities.filter(l => l.status === 'unpaid' || l.status === 'pending' || l.status === 'pending_validation').length === 0 ? (
                            <div className="p-16 bg-white rounded-[40px] border border-dashed border-zinc-200 text-center space-y-4 shadow-sm">
                              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
                                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                              </div>
                              <div className="space-y-1">
                                <p className="text-zinc-900 font-bold text-lg">You're all caught up!</p>
                                <p className="text-zinc-400 text-sm">No outstanding liabilities found for your account.</p>
                              </div>
                            </div>
                          ) : (
                            liabilities.filter(l => l.status === 'unpaid' || l.status === 'pending' || l.status === 'pending_validation').map(l => (
                              <motion.div 
                                key={l.id} 
                                whileHover={{ scale: 1.01 }}
                                className="group p-8 bg-white rounded-[32px] border border-zinc-200 shadow-sm hover:shadow-xl hover:border-zinc-900/10 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-6"
                              >
                                <div className="space-y-3">
                                  <div className="flex items-center gap-3">
                                    <div className={cn(
                                      "p-2 rounded-xl",
                                      l.source === 'student_org' ? "bg-blue-50 text-blue-600" : "bg-rose-50 text-rose-600"
                                    )}>
                                      <Building2 className="w-5 h-5" />
                                    </div>
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-zinc-900 text-lg">{l.description}</h3>
                                        {(l.status === 'pending' || l.status === 'pending_validation' || payments.some(p => p.liabilityId === l.id && p.status === 'completed')) && (
                                          <span className="px-2 py-0.5 rounded-lg text-[8px] font-bold uppercase tracking-widest bg-amber-50 text-amber-600 border border-amber-100">
                                            Pending
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                                        {l.source === 'student_org' ? "Student Organization" : "Dean's Office"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3 text-zinc-500">
                                    <p className="text-sm font-medium">Issued: {new Date(l.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between sm:justify-end gap-6 pt-4 sm:pt-0 border-t sm:border-t-0 border-zinc-50">
                                  <div className="text-right">
                                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Amount</p>
                                    <p className="text-2xl font-bold text-zinc-900">₱{l.amount.toLocaleString()}</p>
                                  </div>
                                  {(l.status === 'pending' || l.status === 'pending_validation' || payments.some(p => p.liabilityId === l.id && p.status === 'completed')) ? (
                                    <div className="px-6 py-4 bg-amber-50 text-amber-600 rounded-2xl text-xs font-bold border border-amber-100 flex items-center gap-2">
                                      <Clock className="w-4 h-4" /> Pending
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => initiateLiabilityPayment(l)}
                                      className="px-8 py-4 bg-zinc-900 text-white rounded-2xl text-sm font-bold hover:bg-black hover:shadow-lg active:scale-95 transition-all"
                                    >
                                      Pay Now
                                    </button>
                                  )}
                                </div>
                              </motion.div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Payment History */}
                      <div className="space-y-6">
                        <div className="flex items-center justify-between px-2">
                          <h3 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
                            <History className="w-5 h-5 text-zinc-400" /> Payment History
                          </h3>
                        </div>
                        <div className="bg-white rounded-[40px] border border-zinc-200 overflow-hidden shadow-sm">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-zinc-50/50 border-b border-zinc-100">
                                  <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Date</th>
                                  <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Purpose</th>
                                  <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Amount</th>
                                  <th className="px-8 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-50">
                                {payments.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="px-8 py-16 text-center">
                                      <div className="space-y-2">
                                        <Inbox className="w-8 h-8 text-zinc-200 mx-auto" />
                                        <p className="text-sm text-zinc-400 italic">No payment history found.</p>
                                      </div>
                                    </td>
                                  </tr>
                                ) : (
                                  payments.sort((a, b) => b.createdAt - a.createdAt).map(p => (
                                    <tr key={p.id} className="hover:bg-zinc-50/30 transition-colors">
                                      <td className="px-8 py-5 text-sm text-zinc-500 font-medium">{new Date(p.createdAt).toLocaleDateString()}</td>
                                      <td className="px-8 py-5 font-bold text-zinc-900 text-sm">{p.purpose}</td>
                                      <td className="px-8 py-5 text-right font-bold text-zinc-900 text-sm">₱{p.amount.toLocaleString()}</td>
                                      <td className="px-8 py-5 text-center">
                                        <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-emerald-100">
                                          {p.status}
                                        </span>
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="p-10 bg-zinc-900 text-white rounded-[40px] shadow-2xl space-y-8 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full -mr-24 -mt-24 blur-3xl" />
                        <div className="space-y-2 relative">
                          <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">Total Liabilities</p>
                          <h3 className="text-5xl font-bold tracking-tight">
                            ₱{liabilities.filter(l => l.status === 'pending' || l.status === 'pending_validation').reduce((acc, l) => acc + l.amount, 0).toLocaleString()}
                          </h3>
                        </div>
                        <div className="pt-8 border-t border-white/10 space-y-4 relative">
                          <div className="flex justify-between items-center">
                            <span className="text-zinc-400 text-sm">Dean's Office</span>
                            <span className="font-bold text-lg">₱{liabilities.filter(l => (l.status === 'pending' || l.status === 'pending_validation') && l.source === 'deans_office').reduce((acc, l) => acc + l.amount, 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-zinc-400 text-sm">Student Org</span>
                            <span className="font-bold text-lg">₱{liabilities.filter(l => (l.status === 'pending' || l.status === 'pending_validation') && l.source === 'student_org').reduce((acc, l) => acc + l.amount, 0).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-8 bg-white rounded-[32px] border border-zinc-200 shadow-sm space-y-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-emerald-50 rounded-xl">
                            <ShieldCheck className="w-5 h-5 text-emerald-500" />
                          </div>
                          <h4 className="font-bold text-zinc-900">Secure Payments</h4>
                        </div>
                        <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                          All payments are processed securely via PayMongo. We support GCash, Maya, and major Credit/Debit cards.
                        </p>
                        <div className="grid grid-cols-3 gap-2 pt-2">
                          <div className="px-2 py-3 bg-zinc-50 rounded-xl border border-zinc-100 text-[9px] font-bold text-zinc-500 text-center uppercase tracking-tighter">GCASH</div>
                          <div className="px-2 py-3 bg-zinc-50 rounded-xl border border-zinc-100 text-[9px] font-bold text-zinc-500 text-center uppercase tracking-tighter">MAYA</div>
                          <div className="px-2 py-3 bg-zinc-50 rounded-xl border border-zinc-100 text-[9px] font-bold text-zinc-500 text-center uppercase tracking-tighter">CARDS</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {(activeTab === 'review' && (role === 'deans_office' || role === 'student_org')) && (
                <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-10">
                  <header className="space-y-2">
                    <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium uppercase tracking-wider">
                      <FileSearch className="w-4 h-4" />
                      <span>Review Center</span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
                      {role === 'deans_office' ? "Dean's Office Review" : "Student Org Review"}
                    </h2>
                    <p className="text-zinc-500 text-sm font-medium">Verify and manage student document submissions for your department.</p>
                  </header>

                  <div className="space-y-6">
                    {/* Desktop Table View */}
                    <div className="hidden md:block bg-white rounded-[40px] border border-zinc-200 overflow-hidden shadow-sm">
                      <table className="w-full table-fixed text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-50/50 border-b border-zinc-100">
                            <th className="w-[27%] px-4 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">File Details</th>
                            <th className="w-[21%] px-4 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Student</th>
                            <th className="w-[12%] px-4 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Upload Date</th>
                            <th className="w-[16%] px-4 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Description</th>
                            <th className="w-[10%] px-4 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Status</th>
                            <th className="w-[14%] px-4 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {(() => {
                            const reviewFiles = allUploads.filter(u => {
                              const isCorrectDestination = u.destination === role;
                              const isReviewable = u.status === 'pending_review';
                              return isCorrectDestination && isReviewable;
                            });

                            if (reviewFiles.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={6} className="px-4 py-20 text-center">
                                    <div className="space-y-3">
                                      <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto">
                                        <Inbox className="w-8 h-8 text-zinc-200" />
                                      </div>
                                      <p className="text-zinc-400 text-sm italic">No files pending review.</p>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            return reviewFiles.map(u => (
                              <tr key={u.id} className="hover:bg-zinc-50/30 transition-colors">
                                <td className="px-4 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 bg-zinc-100 rounded-xl">
                                      <FileText className="w-5 h-5 text-zinc-600" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <span className="text-sm font-bold text-zinc-900 truncate block">{u.fileName}</span>
                                      <div className="mt-1 flex items-center gap-1">
                                        <button
                                          onClick={() => setPreviewFile(u)}
                                          className="p-1.5 hover:bg-zinc-100 rounded-lg transition-colors text-zinc-500 hover:text-zinc-900"
                                          title="Preview File"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                        </button>
                                        <a href={u.fileUrl} target="_blank" className="p-1.5 hover:bg-zinc-100 rounded-lg transition-colors text-zinc-500 hover:text-zinc-900" title="Open in new tab">
                                          <ExternalLink className="w-3.5 h-3.5" />
                                        </a>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex flex-col">
                                    <span className="text-sm font-medium text-zinc-600 truncate">{getStudentNumber(u.studentEmail)}</span>
                                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Student Name: {getStudentLastName(u.studentEmail)}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <span className="text-sm text-zinc-500">{new Date(u.createdAt).toLocaleDateString()}</span>
                                </td>
                                <td className="px-4 py-4">
                                  <p className="text-xs text-zinc-500 truncate leading-relaxed" title={u.description}>{u.description}</p>
                                </td>
                                <td className="px-4 py-4">
                                  <span className="inline-flex whitespace-nowrap px-2.5 py-1 rounded-xl text-[9px] font-bold uppercase tracking-wide bg-blue-50 text-blue-600 border border-blue-100">
                                    Pending
                                  </span>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                    <button
                                      onClick={() => updateFileStatus(u.id, 'approved')}
                                      className="px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wide transition-all bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white border border-emerald-100"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => setRejectionFileId(u.id)}
                                      className="px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wide transition-all bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white border border-rose-100"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-4">
                      {(() => {
                        const reviewFiles = allUploads.filter(u => {
                          const isCorrectDestination = u.destination === role;
                          const isReviewable = u.status === 'pending_review';
                          return isCorrectDestination && isReviewable;
                        });

                        if (reviewFiles.length === 0) {
                          return (
                            <div className="p-16 bg-white rounded-[40px] border border-dashed border-zinc-200 text-center space-y-4 shadow-sm">
                              <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto">
                                <Inbox className="w-8 h-8 text-zinc-200" />
                              </div>
                              <p className="text-zinc-400 text-sm italic">No files pending review.</p>
                            </div>
                          );
                        }

                        return reviewFiles.map(u => (
                          <motion.div 
                            key={u.id} 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-8 bg-white rounded-[32px] border border-zinc-200 shadow-sm space-y-6"
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-zinc-100 rounded-xl">
                                  <FileText className="w-5 h-5 text-zinc-600" />
                                </div>
                                <div className="space-y-0.5">
                                  <h3 className="font-bold text-zinc-900">{u.fileName}</h3>
                                  <div className="flex items-center gap-2">
                                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{getStudentNumber(u.studentEmail)}</p>
                                    <span className="text-[10px] text-zinc-300">•</span>
                                    <p className="text-[10px] font-medium text-zinc-400">{new Date(u.createdAt).toLocaleDateString()}</p>
                                  </div>
                                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Student Name: {getStudentLastName(u.studentEmail)}</p>
                                </div>
                              </div>
                              <span className="px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 border border-blue-100">
                                Pending
                              </span>
                            </div>
                            <div className="p-4 bg-zinc-50 rounded-2xl">
                              <p className="text-xs text-zinc-500 italic leading-relaxed">"{u.description}"</p>
                            </div>
                            <div className="grid grid-cols-1 gap-3 pt-2">
                              <button
                                onClick={() => setPreviewFile(u)}
                                className="w-full py-4 bg-zinc-100 text-zinc-900 rounded-2xl text-xs font-bold text-center flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all"
                              >
                                <Eye className="w-4 h-4" /> Preview Document
                              </button>
                              <a href={u.fileUrl} target="_blank" className="w-full py-4 bg-zinc-50 text-zinc-700 rounded-2xl text-xs font-bold text-center flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all">
                                <ExternalLink className="w-4 h-4" /> Open in New Tab
                              </a>
                              <div className="grid grid-cols-2 gap-3">
                                <button
                                  onClick={() => updateFileStatus(u.id, 'approved')}
                                  className="py-4 rounded-2xl text-xs font-bold transition-all bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 active:scale-95"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => setRejectionFileId(u.id)}
                                  className="py-4 bg-rose-600 text-white rounded-2xl text-xs font-bold shadow-lg shadow-rose-600/20 active:scale-95 transition-all"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        ));
                      })()}
                    </div>
                  </div>

                  {/* Rejection Comment Modal */}
                  <AnimatePresence>
                    {previewFile && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.98 }}
                          className="bg-white rounded-3xl p-4 md:p-6 w-full max-w-5xl shadow-2xl space-y-4 border border-zinc-100"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <h3 className="text-xl font-bold text-zinc-900">File Preview</h3>
                              <p className="text-sm text-zinc-500 truncate max-w-[70vw]">{previewFile.fileName}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <a
                                href={previewFile.fileUrl}
                                target="_blank"
                                className="px-3 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold hover:bg-zinc-200 transition-all flex items-center gap-2"
                              >
                                <ExternalLink className="w-4 h-4" /> Open
                              </a>
                              <button
                                onClick={() => setPreviewFile(null)}
                                className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
                                aria-label="Close preview"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                          </div>

                          <div className="w-full h-[70vh] bg-zinc-50 rounded-2xl border border-zinc-200 overflow-hidden">
                            {isImageFile(previewFile) ? (
                              <img
                                src={previewFile.fileUrl}
                                alt={previewFile.fileName}
                                className="w-full h-full object-contain bg-white"
                              />
                            ) : (
                              <iframe
                                src={previewFile.fileUrl}
                                title={previewFile.fileName}
                                className="w-full h-full"
                              />
                            )}
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {rejectionFileId && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9, y: 20 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9, y: 20 }}
                          className="bg-white rounded-[40px] p-10 max-w-md w-full shadow-2xl space-y-8 border border-zinc-100"
                        >
                          <div className="space-y-3">
                            <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center">
                              <AlertCircle className="w-6 h-6 text-rose-500" />
                            </div>
                            <div className="space-y-1">
                              <h3 className="text-2xl font-bold text-zinc-900">Reject Submission</h3>
                              <p className="text-zinc-500 text-sm leading-relaxed">Please provide a clear reason for rejecting this document. This will be shared with the student.</p>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest ml-1">Rejection Reason</label>
                              <textarea
                                value={rejectionComment}
                                onChange={(e) => setRejectionComment(e.target.value)}
                                placeholder="e.g. Incomplete documents, blurred scan, or incorrect format..."
                                className="w-full px-6 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all min-h-[140px] resize-none font-medium"
                              />
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-3 pt-2">
                            <button
                              onClick={() => {
                                setRejectionFileId(null);
                                setRejectionComment("");
                              }}
                              className="flex-1 px-8 py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold hover:bg-zinc-200 transition-all order-2 sm:order-1"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                if (!rejectionComment.trim()) return;
                                updateFileStatus(rejectionFileId, 'rejected', rejectionComment);
                                setRejectionFileId(null);
                                setRejectionComment("");
                              }}
                              disabled={!rejectionComment.trim()}
                              className="flex-1 px-8 py-4 bg-rose-600 text-white rounded-2xl font-bold hover:bg-rose-700 shadow-lg shadow-rose-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed order-1 sm:order-2 active:scale-95"
                            >
                              Confirm Reject
                            </button>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              {activeTab === 'students' && (role === 'deans_office' || role === 'student_org' || role === 'admin') && (
                <motion.div
                  key="students"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn(
                    "space-y-8",
                    (role === 'deans_office' || role === 'student_org') && "students-directory-panel"
                  )}
                >
                  <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium uppercase tracking-wider">
                        <Users className="w-4 h-4" />
                        <span>Student Directory</span>
                      </div>
                      <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Manage Students</h2>
                      <p className="text-zinc-500 text-sm">Monitor student liabilities and manage account statuses.</p>
                    </div>
                    <div className="relative w-full md:w-80">
                      <Search className="students-search-icon absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={studentSearchTerm}
                        onChange={(e) => setStudentSearchTerm(e.target.value)}
                        className="students-search-input w-full pl-12 pr-16 py-3 bg-white border border-zinc-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all shadow-sm"
                      />
                      {studentSearchTerm && (
                        <button
                          onClick={() => setStudentSearchTerm("")}
                          className="students-search-clear absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-all"
                          aria-label="Clear student search"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </header>

                  {(role === 'deans_office' || role === 'student_org') && (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => toggleSelectAllFilteredStudents(allStudents.filter(s =>
                          (s.displayName || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
                          (s.email || '').toLowerCase().includes(studentSearchTerm.toLowerCase())
                        ))}
                        className="students-select-all-btn px-4 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold hover:bg-zinc-200 transition-all"
                      >
                        Select All Filtered
                      </button>
                      <button
                        onClick={() => setIsBulkLiabilityModalOpen(true)}
                        disabled={selectedStudentUids.length === 0}
                        className="students-bulk-liability-btn px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold hover:bg-zinc-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Apply Liability to Selected ({selectedStudentUids.length})
                      </button>
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Desktop Table View */}
                    <div className="students-directory-table-shell hidden md:block bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
                      <table className="students-directory-table w-full text-left text-sm min-w-[800px]">
                        <thead className="students-directory-table-head bg-zinc-50/50 border-b border-zinc-100">
                          <tr>
                            {(role === 'deans_office' || role === 'student_org') && (
                              <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                                <input
                                  type="checkbox"
                                  checked={allStudents.filter(s =>
                                    (s.displayName || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
                                    (s.email || '').toLowerCase().includes(studentSearchTerm.toLowerCase())
                                  ).length > 0 && allStudents.filter(s =>
                                    (s.displayName || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
                                    (s.email || '').toLowerCase().includes(studentSearchTerm.toLowerCase())
                                  ).every(s => selectedStudentUids.includes(s.uid))}
                                  onChange={() => toggleSelectAllFilteredStudents(allStudents.filter(s =>
                                    (s.displayName || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
                                    (s.email || '').toLowerCase().includes(studentSearchTerm.toLowerCase())
                                  ))}
                                  className="w-4 h-4"
                                />
                              </th>
                            )}
                            <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Student Name</th>
                            <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Email Address</th>
                            <th className="px-6 py-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {allStudents
                            .filter(s => 
                              (s.displayName || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
                              (s.email || '').toLowerCase().includes(studentSearchTerm.toLowerCase())
                            )
                            .map(student => {
                            return (
                              <React.Fragment key={student.uid}>
                                <tr className="students-directory-row hover:bg-zinc-50/30 transition-colors">
                                  {(role === 'deans_office' || role === 'student_org') && (
                                    <td className="px-6 py-5">
                                      <input
                                        type="checkbox"
                                        checked={selectedStudentUids.includes(student.uid)}
                                        onChange={() => toggleStudentSelection(student.uid)}
                                        className="w-4 h-4"
                                      />
                                    </td>
                                  )}
                                  <td className="px-6 py-5">
                                    <button
                                      onClick={() => setSelectedStudentForPreview(student)}
                                      className="font-bold text-zinc-900 hover:text-zinc-600 hover:underline transition-colors text-left"
                                    >
                                      {student.displayName || 'Unnamed Student'}
                                    </button>
                                  </td>
                                  <td className="px-6 py-5 text-zinc-500">{student.email}</td>
                                  <td className="px-6 py-5 text-right">
                                    <button
                                      onClick={() => setSelectedStudentForLiability(student)}
                                      className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold hover:bg-zinc-800 transition-all shadow-sm"
                                    >
                                      <Plus className="w-3.5 h-3.5" /> Add Liability
                                    </button>
                                  </td>
                                </tr>
                              </React.Fragment>
                            );
                          })}
                          {allStudents.length === 0 && (
                            <tr>
                              <td colSpan={(role === 'deans_office' || role === 'student_org') ? 4 : 3} className="px-6 py-16 text-center">
                                <p className="text-sm text-zinc-500 italic">No students found in the directory.</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="students-directory-mobile md:hidden space-y-4">
                      {allStudents
                        .filter(s => 
                          (s.displayName || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
                          (s.email || '').toLowerCase().includes(studentSearchTerm.toLowerCase())
                        ).length === 0 ? (
                        <div className="p-8 bg-white rounded-2xl border border-zinc-200 text-center text-zinc-500 italic">No students found.</div>
                      ) : (
                        allStudents
                          .filter(s => 
                            (s.displayName || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
                            (s.email || '').toLowerCase().includes(studentSearchTerm.toLowerCase())
                          )
                          .map(student => {
                          const studentLiabilities = liabilities.filter(l => l.studentEmail === student.email && (l.status === 'pending' || l.status === 'pending_validation'));
                          return (
                            <div key={student.uid} className="students-directory-mobile-card p-6 bg-white rounded-2xl border border-zinc-200 shadow-sm space-y-4">
                              {(role === 'deans_office' || role === 'student_org') && (
                                <div className="flex justify-end">
                                  <input
                                    type="checkbox"
                                    checked={selectedStudentUids.includes(student.uid)}
                                    onChange={() => toggleStudentSelection(student.uid)}
                                    className="w-4 h-4"
                                  />
                                </div>
                              )}
                              <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                  <h3 className="font-bold text-zinc-900">{student.displayName || 'Unnamed Student'}</h3>
                                  <p className="text-xs text-zinc-500">{student.email}</p>
                                </div>
                                <span className={cn(
                                  "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                                  studentLiabilities.length > 0 
                                    ? (studentLiabilities.every(l => l.status === 'pending_validation') ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600")
                                    : "bg-emerald-50 text-emerald-600"
                                )}>
                                  {studentLiabilities.length} {studentLiabilities.every(l => l.status === 'pending_validation') ? "Pending" : "Due"}
                                </span>
                              </div>
                              


                              <button
                                onClick={() => setSelectedStudentForLiability(student)}
                                className="w-full px-4 py-3 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
                              >
                                <Plus className="w-4 h-4" /> Add Liability
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Add Liability Modal */}
                  <AnimatePresence>
                    {(selectedStudentForLiability || isBulkLiabilityModalOpen) && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6"
                        >
                          <div className="space-y-2">
                            <h3 className="text-xl font-bold">Add Liability</h3>
                            <p className="text-zinc-500 text-sm">
                              {isBulkLiabilityModalOpen
                                ? <>Applying liability to: <span className="font-bold text-zinc-900">{selectedStudentUids.length} selected students</span></>
                                : <>Tagging liability for: <span className="font-bold text-zinc-900">{selectedStudentForLiability?.displayName}</span></>
                              }
                            </p>
                          </div>

                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase text-zinc-400 tracking-wider">Liability Type</label>
                                <select
                                  value={liabilityType}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setLiabilityType(val);
                                    if (val !== "other") {
                                      setLiabilityDesc(val);
                                      setLiabilityAmount(MEMBERSHIP_FEES[val].toString());
                                    } else {
                                      setLiabilityDesc("");
                                      setLiabilityAmount("");
                                    }
                                  }}
                                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all"
                                >
                                  <option value="other">Others</option>
                                  {Object.keys(MEMBERSHIP_FEES).map(fee => (
                                    <option key={fee} value={fee}>{fee}</option>
                                  ))}
                                </select>
                            </div>

                            {liabilityType === "other" && (
                              <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-zinc-400 tracking-wider">Description</label>
                                <input
                                  type="text"
                                  value={liabilityDesc}
                                  onChange={(e) => setLiabilityDesc(e.target.value)}
                                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all"/>
                              </div>
                            )}

                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase text-zinc-400 tracking-wider">Amount (PHP)</label>
                              <input
                                type="number"
                                value={liabilityAmount}
                                onChange={(e) => setLiabilityAmount(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all"
                              />
                            </div>
                          </div>

                          <div className="flex gap-3 pt-2">
                            <button
                              onClick={() => {
                                setSelectedStudentForLiability(null);
                                setIsBulkLiabilityModalOpen(false);
                              }}
                              className="flex-1 px-6 py-3 bg-zinc-100 text-zinc-600 rounded-xl text-sm font-bold hover:bg-zinc-200 transition-all"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                if (isBulkLiabilityModalOpen) {
                                  addLiabilityToSelectedStudents(liabilityDesc, parseFloat(liabilityAmount));
                                } else {
                                  addLiability(selectedStudentForLiability, liabilityDesc, parseFloat(liabilityAmount));
                                }
                              }}
                              disabled={!liabilityDesc || !liabilityAmount || isAddingLiability}
                              className="flex-1 px-6 py-3 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {isAddingLiability ? (
                                <>
                                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                  Adding...
                                </>
                              ) : (
                                "Add Liability"
                              )}
                            </button>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>

                  {selectedStudentForPreview && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                      <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 24 }}
                        className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl space-y-4"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="text-xl font-bold">Student Preview</h3>
                            <p className="text-sm text-zinc-500">Quick summary of student and liabilities</p>
                          </div>
                          <button
                            onClick={() => setSelectedStudentForPreview(null)}
                            className="text-zinc-400 hover:text-zinc-700"
                            aria-label="Close preview"
                          >
                            ✕
                          </button>
                        </div>

                        <div className="space-y-2">
                          <p><span className="font-semibold">Name:</span> {selectedStudentForPreview.displayName || 'Unnamed Student'}</p>
                          <p><span className="font-semibold">Email:</span> {selectedStudentForPreview.email}</p>
                          <p className="font-semibold">Liabilities:</p>
                          <div className="space-y-2 max-h-56 overflow-y-auto border border-zinc-100 rounded-xl p-3">
                            {liabilities.filter(l => l.studentEmail === selectedStudentForPreview.email && l.status !== 'paid' && (role === 'admin' || l.destination === role || l.destination === 'both')).length === 0 ? (
                              <p className="text-zinc-500 text-sm">No liabilities found for this student.</p>
                            ) : (
                              liabilities.filter(l => l.studentEmail === selectedStudentForPreview.email && l.status !== 'paid' && (role === 'admin' || l.destination === role || l.destination === 'both')).map((l) => (
                                <div key={l.id} className="rounded-lg bg-zinc-50 border border-zinc-100 p-2 flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{l.description}</p>
                                    <p className="text-xs text-zinc-500">Amount: ₱{l.amount.toLocaleString()}</p>
                                    <p className="text-xs text-zinc-500">Status: {l.status}</p>
                                  </div>
                                  <button
                                    onClick={() => deleteLiability(l.id!)}
                                    className="text-rose-600 hover:text-rose-800 text-xs font-bold px-2 py-1 border border-rose-200 rounded-lg"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            )}
                          </div>

                          <button
                            onClick={() => setSelectedStudentForPreview(null)}
                            className="w-full px-4 py-2 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all"
                          >
                            Close
                          </button>
                        </div>
                      </motion.div>
                    </div>
                  )}

                </motion.div>
              )}

              {activeTab === 'transactions' && (role === 'deans_office' || role === 'student_org') && (
                <motion.div key="pending-approvals" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                  <header className="space-y-2">
                    <div className="flex items-center gap-2 text-amber-600 text-sm font-medium uppercase tracking-wider">
                      <Clock className="w-4 h-4" />
                      <span>Pending Approvals</span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
                      Payment Verification
                    </h2>
                    <p className="text-zinc-500 text-sm">Review and approve student payments for liabilities.</p>
                  </header>

                  {liabilities.filter(l => l.status === 'pending' && (role === 'admin' || l.destination === role || l.destination === 'both')).length === 0 ? (
                    <div className="p-16 bg-white rounded-[40px] border border-dashed border-zinc-200 text-center space-y-4 shadow-sm">
                      <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-zinc-900 font-bold text-lg">All caught up!</p>
                        <p className="text-zinc-400 text-sm">No pending payment approvals at this time.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {liabilities.filter(l => l.status === 'pending' && (role === 'admin' || l.destination === role || l.destination === 'both')).map(liability => {
                        const payment = allPayments.find(p => p.liabilityId === liability.id && p.status === 'pending');
                        return (
                          <motion.div
                            key={liability.id}
                            whileHover={{ scale: 1.01 }}
                            className="group p-8 bg-white rounded-[32px] border border-amber-100 shadow-sm hover:shadow-xl hover:border-amber-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-gradient-to-r from-amber-50/50 to-transparent"
                          >
                            <div className="space-y-3 flex-1">
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-amber-100 text-amber-600">
                                  <Building2 className="w-5 h-5" />
                                </div>
                                <div className="space-y-0.5">
                                  <h3 className="font-bold text-zinc-900 text-lg">{liability.description}</h3>
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                                    {liability.studentName} ({liability.studentEmail})
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-4 text-sm">
                                <p className="text-zinc-500">Amount: <span className="font-bold text-zinc-900">₱{liability.amount.toLocaleString()}</span></p>
                                {payment && (
                                  <p className="text-zinc-500">Paid: <span className="font-bold text-emerald-600">{new Date(payment.createdAt).toLocaleDateString()}</span></p>
                                )}
                                {liability.destination === 'both' && (
                                  <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-widest border border-blue-100">
                                    Dropdown
                                  </span>
                                )}
                                {liability.destination === 'deans_office' && role === 'deans_office' && (
                                  <span className="px-2 py-1 rounded-lg bg-rose-50 text-rose-600 text-[10px] font-bold uppercase tracking-widest border border-rose-100">
                                    Free Text
                                  </span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={async () => {
                                try {
                                  await updateDoc(doc(db, "liabilities", liability.id), {
                                    status: "paid"
                                  });
                                  if (payment) {
                                    const paymentRef = collection(db, "payments");
                                    const q = query(paymentRef, where("paymentSessionId", "==", payment.paymentSessionId));
                                    const snapshot = await getDocs(q);
                                    snapshot.forEach(async (docSnapshot) => {
                                      await updateDoc(doc(db, "payments", docSnapshot.id), {
                                        status: "completed",
                                        approvedAt: Date.now(),
                                        approvedBy: user?.email
                                      });
                                    });
                                  }
                                  setPaymentResult({ success: true, message: `Liability approved for ${liability.studentName}` });
                                } catch (error) {
                                  console.error("Error approving liability:", error);
                                  setPaymentResult({ success: false, message: "Failed to approve liability" });
                                }
                              }}
                              className="px-8 py-4 bg-emerald-600 text-white rounded-2xl text-sm font-bold hover:bg-emerald-700 hover:shadow-lg active:scale-95 transition-all whitespace-nowrap"
                            >
                              ✓ Approve Payment
                            </button>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'transactions' && (role === 'student' || role === 'student_org' || role === 'deans_office' || role === 'admin') && (
                <motion.div key="transactions" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                  <header className="space-y-2">
                    <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium uppercase tracking-wider">
                      <Receipt className="w-4 h-4" />
                      <span>Financial Records</span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
                      {role === 'student' ? 'My Transactions' : 'Transaction History'}
                    </h2>
                    <div className="flex items-center justify-between">
                      <p className="text-zinc-500 text-sm">View and track all student payments and revenue.</p>
                      <div className="flex items-center gap-3">
                        {(role === 'admin' || role === 'deans_office' || role === 'student_org') && allPayments.some(p => p.status === 'pending') && (
                          <button
                            onClick={deletePendingTransactions}
                            className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all flex items-center gap-2"
                            title="Delete all abandoned/pending payment records"
                          >
                            <Trash2 className="w-3 h-3" />
                            Clear Pending Records
                          </button>
                        )}
                        {role === 'admin' && (
                          <button
                            onClick={clearAllTransactions}
                            className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-black transition-all flex items-center gap-2"
                            title="Delete all transaction records"
                          >
                            <Trash2 className="w-3 h-3" />
                            Clear All Transactions
                          </button>
                        )}
                        {(role === 'admin' || role === 'deans_office' || role === 'student_org') && liabilities.some(l => l.status === 'pending_validation' && (role === 'admin' || l.source === role || l.source === 'both')) && (
                          <button
                            onClick={clearAllPendingValidationLiabilities}
                            className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-2"
                            title="Validate and clear all liabilities awaiting validation"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Validate All Pending
                          </button>
                        )}
                      </div>
                    </div>
                  </header>

                  <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-zinc-100 bg-zinc-50/50">
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Transaction ID</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Student Details</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Date & Time</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Status</th>
                            <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {(role === 'student' 
                            ? payments 
                            : role === 'admin' 
                              ? allPayments 
                              : allPayments.filter(p => p.destination === role || p.destination === 'both')
                          ).map(p => {
                            const associatedLiability = liabilities.find(l => l.id === p.liabilityId);
                            const isLiabilityAwaitingValidation = associatedLiability && associatedLiability.status === 'pending_validation';
                            
                            return (
                              <tr key={p.id} className="hover:bg-zinc-50/30 transition-colors">
                                <td className="px-6 py-5">
                                  <span className="text-xs font-mono text-zinc-400 bg-zinc-100 px-2 py-1 rounded">#{p.paymentSessionId?.slice(-8).toUpperCase() || p.id.slice(-8).toUpperCase()}</span>
                                </td>
                                <td className="px-6 py-5">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-bold text-zinc-900">{p.studentName || 'Unknown'}</span>
                                    <span className="text-xs text-zinc-500">{p.studentEmail}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-5">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-sm text-zinc-900">{new Date(p.createdAt).toLocaleDateString()}</span>
                                    <span className="text-[10px] text-zinc-400 font-medium">{new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-5">
                                  <div className="flex items-center gap-3">
                                    <span className={cn(
                                      "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                      p.status === 'completed' ? "bg-emerald-50 text-emerald-600" :
                                      p.status === 'pending' ? "bg-amber-50 text-amber-600" :
                                      "bg-rose-50 text-rose-600"
                                    )}>
                                      {p.status === 'completed' ? 'Validated' : (p.status === 'pending' ? 'Pending' : (p.status || 'Failed'))}
                                    </span>
                                    
                                    {/* Staff validation button for completed payments awaiting verification */}
                                    {p.status === 'completed' && isLiabilityAwaitingValidation && role !== 'student' && (
                                      <button
                                        onClick={() => markLiabilityAsPaid(p.liabilityId!)}
                                        className="px-2 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest bg-zinc-900 text-white hover:bg-zinc-800 transition-all shadow-sm"
                                        title="Validate and clear the associated liability"
                                      >
                                        Validate Payment
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-5 text-right">
                                  <span className="text-sm font-bold text-zinc-900">₱{p.amount.toLocaleString()}</span>
                                </td>
                              </tr>
                            );
                          })}
                          {(role === 'student' 
                            ? payments 
                            : role === 'admin' 
                              ? allPayments 
                              : allPayments.filter(p => p.destination === role || p.destination === 'both')
                          ).length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-6 py-16 text-center">
                                <p className="text-sm text-zinc-500 italic">No transactions recorded yet.</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="md:hidden divide-y divide-zinc-100">
                      {(role === 'student' 
                        ? payments 
                        : role === 'admin' 
                          ? allPayments 
                          : allPayments.filter(p => p.destination === role || p.destination === 'both')
                      ).map(p => {
                        const associatedLiability = liabilities.find(l => l.id === p.liabilityId);
                        const isLiabilityAwaitingValidation = associatedLiability && associatedLiability.status === 'pending_validation';
                        
                        return (
                          <div key={p.id} className="p-6 space-y-4">
                            <div className="flex justify-between items-start">
                              <div className="space-y-1">
                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Transaction ID</p>
                                <p className="font-mono text-xs text-zinc-900">#{p.paymentSessionId?.slice(-8).toUpperCase() || p.id.slice(-8).toUpperCase()}</p>
                              </div>
                              <p className="text-lg font-bold text-zinc-900">₱{p.amount.toLocaleString()}</p>
                            </div>
                            <div className="flex justify-between items-end pt-2 border-t border-zinc-50">
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Student</p>
                                  <p className="text-xs font-bold text-zinc-900">{p.studentName || 'Unknown'}</p>
                                  <p className="text-[10px] text-zinc-500">{p.studentEmail || 'N/A'}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                                    p.status === 'completed' ? "bg-emerald-50 text-emerald-600" :
                                    p.status === 'pending' ? "bg-amber-50 text-amber-600" :
                                    "bg-rose-50 text-rose-600"
                                  )}>
                                    {p.status === 'completed' ? 'Validated' : (p.status === 'pending' ? 'Pending' : (p.status || 'Failed'))}
                                  </span>
                                  {p.status === 'completed' && isLiabilityAwaitingValidation && role !== 'student' && (
                                    <button
                                      onClick={() => markLiabilityAsPaid(p.liabilityId!)}
                                      className="px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-widest bg-zinc-900 text-white"
                                      title="Validate and clear the associated liability"
                                    >
                                      Validate Payment
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="text-right space-y-1">
                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Date</p>
                                <p className="text-xs text-zinc-600">{new Date(p.createdAt).toLocaleDateString()}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {(role === 'student' 
                        ? payments 
                        : role === 'admin' 
                          ? allPayments 
                          : allPayments.filter(p => p.destination === role || p.destination === 'both')
                      ).length === 0 && (
                        <div className="p-12 text-center">
                          <p className="text-sm text-zinc-500 italic">No transactions found.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'history' && (role === 'student' || role === 'student_org' || role === 'deans_office' || role === 'admin') && (
                <motion.div key="history" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
                  <header className="space-y-2">
                    <div className="flex items-center gap-2 text-zinc-500 text-sm font-medium uppercase tracking-wider">
                      <HistoryIcon className="w-4 h-4" />
                      <span>Activity Log</span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-zinc-900">
                      {role === 'student' ? 'File Status' : role === 'admin' ? 'Files Uploaded' : 'Received Files'}
                    </h2>
                    <div className="flex items-center justify-between">
                      <p className="text-zinc-500 text-sm">Track the status and history of document submissions.</p>
                      {role === 'admin' && (
                        <button
                          onClick={clearAllUploadedDocuments}
                          className="px-4 py-2 bg-zinc-800 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-black transition-all flex items-center gap-2"
                          title="Delete all uploaded documents"
                        >
                          <Trash2 className="w-3 h-3" />
                          Clear All Uploads
                        </button>
                      )}
                    </div>
                  </header>

                  <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-100 bg-zinc-50/50">
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Document Details</th>
                              {role !== 'student' && <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Student</th>}
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Upload Date</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Destination</th>
                              <th className="px-6 py-5 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {getHistoryUploads().map(u => (
                            <React.Fragment key={u.id}>
                              <tr className="hover:bg-zinc-50/30 transition-colors group">
                                <td className="px-6 py-5">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 bg-zinc-100 rounded-lg">
                                      <FileText className="w-4 h-4 text-zinc-600" />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <span className="text-sm font-bold text-zinc-900 truncate max-w-[200px]">{u.fileName}</span>
                                      <span className="text-[10px] text-zinc-400 font-medium truncate max-w-[200px]">{u.description || 'No description provided'}</span>
                                    </div>
                                  </div>
                                </td>
                                  {role !== 'student' && (
                                    <td className="px-6 py-5">
                                      <span className="text-sm text-zinc-600 font-medium">{u.studentEmail || 'N/A'}</span>
                                    </td>
                                  )}
                                  <td className="px-6 py-5">
                                    <span className="text-sm text-zinc-500">{new Date(u.createdAt).toLocaleDateString()}</span>
                                  </td>
                                  <td className="px-6 py-5">
                                    <span className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest">
                                      {u.destination?.replace('_', ' ') || 'Dean\'s Office'}
                                    </span>
                                  </td>
                                <td className="px-6 py-5">
                                  <span className={cn(
                                    "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                    u.status === 'approved' ? "bg-emerald-50 text-emerald-600" :
                                    u.status === 'rejected' ? "bg-rose-50 text-rose-600" :
                                    u.status === 'pending_review' ? "bg-amber-50 text-amber-600" :
                                    "bg-zinc-100 text-zinc-500"
                                  )}>
                                    {u.status.replace('_', ' ')}
                                  </span>
                                </td>
                              </tr>
                            </React.Fragment>
                          ))}
                          {getHistoryUploads().length === 0 && (
                            <tr>
                              <td colSpan={role === 'student' ? 4 : 5} className="px-6 py-16 text-center">
                                <p className="text-sm text-zinc-500 italic">No submission history found.</p>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="md:hidden divide-y divide-zinc-100">
                      {getHistoryUploads().map(u => (
                        <div key={u.id} className="p-6 space-y-4">
                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <h3 className="text-sm font-bold text-zinc-900">{u.fileName}</h3>
                              {role !== 'student' && <p className="text-xs text-zinc-500">{u.studentEmail || 'N/A'}</p>}
                            </div>
                            <span className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              u.status === 'approved' ? "bg-emerald-50 text-emerald-600" :
                              u.status === 'rejected' ? "bg-rose-50 text-rose-600" :
                              u.status === 'pending_review' ? "bg-amber-50 text-amber-600" :
                              "bg-zinc-100 text-zinc-500"
                            )}>
                              {u.status.replace('_', ' ')}
                            </span>
                          </div>
                          
                            <div className="p-4 bg-zinc-50 rounded-2xl space-y-3">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Upload Date</span>
                                <span className="text-xs font-medium text-zinc-600">{new Date(u.createdAt).toLocaleDateString()}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Destination</span>
                                <span className="text-xs font-medium text-zinc-600">{u.destination?.replace('_', ' ') || 'Dean\'s Office'}</span>
                              </div>
                              <p className="text-xs text-zinc-500 leading-relaxed italic">"{u.description || 'No description'}"</p>
                            </div>

                          {u.reviewNotes && (
                            <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl">
                              <p className="text-[10px] font-bold text-rose-500 uppercase tracking-wider mb-1">Comment</p>
                              <p className="text-xs text-rose-700">{u.reviewNotes}</p>
                            </div>
                          )}
                        </div>
                      ))}
                      {getHistoryUploads().length === 0 && (
                        <div className="p-12 text-center">
                          <p className="text-sm text-zinc-500 italic">No files found.</p>
                        </div>
                      )}
                    </div>
                  </div>

                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
    </ErrorBoundary>
  );
}
