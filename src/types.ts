export type UserRole = 'student' | 'deans_office' | 'student_org' | 'admin';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  createdAt: number;
}

export type FileStatus = 'pending_review' | 'approved' | 'revision_required' | 'rejected';

export interface FileUpload {
  id: string;
  uid: string;
  studentEmail?: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  category: 'Thesis' | 'Clearance' | 'Other';
  destination: 'Deans_Office' | 'Student_Org' | 'Both';
  status: FileStatus;
  paymentId?: string;
  reviewNotes?: string;
  description: string;
  createdAt: number;
}

export interface PaymentTransaction {
  id: string;
  uid: string;
  studentEmail?: string;
  studentName?: string;
  fileId?: string;
  liabilityId?: string;
  destination: 'Deans_Office' | 'Student_Org' | 'Both';
  amount: number;
  currency: string;
  purpose: string;
  status: 'Pending' | 'Paid' | 'Failed';
  paymentSessionId: string;
  createdAt: number;
}

export interface Liability {
  id: string;
  studentUid: string;
  studentEmail: string;
  studentName?: string;
  description: string;
  amount: number;
  source: 'Deans_Office' | 'Student_Org' | 'Both';
  status: 'Pending' | 'Paid';
  taggingType: 'Preset' | 'FreeText';
  createdAt: number;
}
