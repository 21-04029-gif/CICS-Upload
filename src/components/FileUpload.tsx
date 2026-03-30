import { CheckCircle, Loader2, Upload, XCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "../utils";
import { storage } from "../firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { motion, AnimatePresence } from "framer-motion";

interface FileUploadProps {
  uid: string;
  onUploadComplete: (file: { name: string; url: string; size: number; type: string; destination: 'deans_office' | 'student_org'; description: string }) => void;
}

export function FileUpload({ uid, onUploadComplete }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState<'deans_office' | 'student_org'>('deans_office');
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showFilePreview, setShowFilePreview] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{
    name: string;
    url: string;
    size: number;
    type: string;
    destination: 'deans_office' | 'student_org';
  } | null>(null);

  const previewUrl = useMemo(() => {
    if (!selectedFile) return "";
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const startAutoUpload = useCallback((file: File, targetDestination: 'deans_office' | 'student_org') => {
    setUploading(true);
    setProgress(0);
    setError(null);
    setPendingUpload(null);

    const storagePath = `uploads/${targetDestination}/${uid}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const nextProgress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setProgress(nextProgress);
      },
      (uploadError) => {
        let message = "Upload failed. Please try again.";

        if (!window.navigator.onLine) {
          message = "Network error: Please check your internet connection.";
        } else if (uploadError?.code === "storage/unauthorized") {
          message = "Permission denied: You don't have access to upload files.";
        } else if (uploadError?.code === "storage/retry-limit-exceeded") {
          message = "Upload timed out. Please try again with a better connection.";
        } else if (uploadError?.code === "storage/canceled") {
          message = "Upload was canceled.";
        } else if (String(uploadError?.message || "").includes("network")) {
          message = "Network error during upload. Please check your connection.";
        }

        setError(message);
        setUploading(false);
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        setPendingUpload({
          name: file.name,
          url: downloadURL,
          size: file.size,
          type: file.type,
          destination: targetDestination,
        });
        setProgress(100);
        setUploading(false);
      }
    );
  }, [uid]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setSelectedFile(file);
      setError(null);
      startAutoUpload(file, destination);
    }
  }, [destination, startAutoUpload]);

  const onDropRejected = useCallback((fileRejections: any) => {
    const rejection = fileRejections[0];
    if (rejection) {
      const errorCode = rejection.errors[0]?.code;
      if (errorCode === 'file-invalid-type') {
        setError("File type not supported. Please upload PDF, DOCX, JPG, or PNG.");
      } else if (errorCode === 'file-too-large') {
        setError("File size exceeds 10MB limit.");
      } else {
        setError(rejection.errors[0]?.message || "Invalid file selection.");
      }
    }
  }, []);

  const isImageFile = (file: File) => {
    return file.type.startsWith('image/');
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please select a file first.");
      return;
    }
    if (!pendingUpload) {
      setError("Please wait for the file upload to finish.");
      return;
    }
    if (!description.trim()) {
      setError("Please provide a description.");
      return;
    }

    onUploadComplete({
      name: pendingUpload.name,
      url: pendingUpload.url,
      size: pendingUpload.size,
      type: pendingUpload.type,
      destination: pendingUpload.destination,
      description: description.trim()
    });

    setSelectedFile(null);
    setPendingUpload(null);
    setDescription("");
    setProgress(0);
    setError(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    maxFiles: 1,
    multiple: false,
    disabled: uploading,
    maxSize: 10 * 1024 * 1024,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    }
  } as any);

  return (
    <div className="w-full space-y-6">
      <div className="space-y-4">
        <label className="text-sm font-medium text-zinc-900">Select Destination</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setDestination('deans_office')}
            className={cn(
              "flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left group",
              destination === 'deans_office' ? "border-zinc-900 bg-zinc-50" : "border-zinc-100 hover:border-zinc-200"
            )}
          >
            <span className="text-sm font-semibold text-zinc-900">Dean's Office</span>
            <span className="text-xs text-zinc-500 mt-1">Official Documents</span>
          </button>
          <button
            type="button"
            onClick={() => setDestination('student_org')}
            className={cn(
              "flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left group",
              destination === 'student_org' ? "border-zinc-900 bg-zinc-50" : "border-zinc-100 hover:border-zinc-200"
            )}
          >
            <span className="text-sm font-semibold text-zinc-900">Student Org</span>
            <span className="text-xs text-zinc-500 mt-1">Events & Organizations</span>
          </button>
        </div>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-10 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 group",
          isDragActive ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:border-zinc-300",
          uploading && "pointer-events-none opacity-60"
        )}
      >
        <input {...getInputProps()} />
        
        <div className="p-4 rounded-full bg-zinc-50 border border-zinc-100 group-hover:bg-zinc-100 transition-colors">
          {uploading ? (
            <Loader2 className="w-8 h-8 text-zinc-600 animate-spin" />
          ) : (
            <Upload className="w-8 h-8 text-zinc-600" />
          )}
        </div>

        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-zinc-900">
            {selectedFile ? selectedFile.name : (isDragActive ? "Drop the file here" : "Click or drag file to upload")}
          </p>
          <p className="text-xs text-zinc-500">
            Support for PDF, DOCX, JPG, PNG (Max 10MB)
          </p>
          {selectedFile && !uploading && (
            <div className="flex flex-col gap-2 mt-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFilePreview(true);
                }}
                className="text-[10px] font-bold text-blue-600 uppercase hover:text-blue-700 transition-colors"
              >
                Preview File
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFile(null);
                  setPendingUpload(null);
                  setProgress(0);
                  setError(null);
                }}
                className="text-[10px] font-bold text-rose-600 uppercase hover:text-rose-700 transition-colors"
              >
                Change Selection
              </button>
            </div>
          )}
        </div>

        {uploading && (
          <div className="absolute inset-x-0 bottom-0 p-4 bg-white/90 backdrop-blur-sm rounded-b-2xl border-t border-zinc-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Uploading...</span>
              <span className="text-xs font-bold text-zinc-900">{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-zinc-900 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 p-6 rounded-2xl bg-zinc-50 border border-zinc-100">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-900">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this file for?"
            className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 transition-all min-h-[100px] resize-none"
            required
          />
        </div>

        <button
          onClick={handleUpload}
          disabled={uploading || !selectedFile || !pendingUpload || !description.trim()}
          className={cn(
            "w-full py-3 rounded-xl font-medium text-white transition-all flex items-center justify-center gap-2 shadow-sm",
            "bg-zinc-900 hover:bg-zinc-800",
            (uploading || !selectedFile || !pendingUpload || !description.trim()) && "opacity-50 cursor-not-allowed"
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading...
            </>
          ) : !pendingUpload && selectedFile ? (
            <>
              <Loader2 className="w-4 h-4" />
              Waiting for upload...
            </>
          ) : selectedFile && pendingUpload && !description.trim() ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Confirm Upload
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Confirm Upload
            </>
          )}
        </button>

        {selectedFile && pendingUpload && !uploading && (
          <p className="text-xs text-zinc-500">
            File uploaded in background. Add a description, then click Confirm Upload.
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
          <XCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* File Preview Modal */}
      <AnimatePresence>
        {showFilePreview && selectedFile && (
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
                  <p className="text-sm text-zinc-500 truncate max-w-[70vw]">{selectedFile.name}</p>
                </div>
                <button
                  onClick={() => setShowFilePreview(false)}
                  className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
                  aria-label="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="w-full h-[70vh] bg-zinc-50 rounded-2xl border border-zinc-200 overflow-hidden">
                {isImageFile(selectedFile) ? (
                  <img
                    src={previewUrl}
                    alt={selectedFile.name}
                    className="w-full h-full object-contain bg-white"
                  />
                ) : (
                  <iframe
                    src={previewUrl}
                    title={selectedFile.name}
                    className="w-full h-full"
                  />
                )}
              </div>

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => setShowFilePreview(false)}
                  className="px-4 py-2 bg-zinc-900 text-white rounded-xl text-sm font-semibold hover:bg-zinc-800 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
