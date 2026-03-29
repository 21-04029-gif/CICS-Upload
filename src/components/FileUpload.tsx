import { CheckCircle, File as FileIcon, Loader2, Upload, XCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "../utils";
import { storage } from "../firebase";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

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

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
      setError(null);
    }
  }, []);

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

  const handleUpload = async () => {
    console.log("Starting upload process...", { selectedFile, description, destination });
    if (!selectedFile) {
      setError("Please select a file first.");
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("File size exceeds 10MB limit.");
      return;
    }
    if (!description.trim()) {
      setError("Please provide a description.");
      return;
    }

    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      const storagePath = `uploads/${destination}/${uid}/${Date.now()}_${selectedFile.name}`;
      console.log("Storage path:", storagePath);
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, selectedFile);

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setProgress(progress);
          console.log(`Upload progress: ${progress}%`);
        },
        (error) => {
          console.error("Firebase Storage Upload error:", error);
          let message = "Upload failed. Please try again.";
          
          if (!window.navigator.onLine) {
            message = "Network error: Please check your internet connection.";
          } else if (error.code === 'storage/unauthorized') {
            message = "Permission denied: You don't have access to upload files.";
          } else if (error.code === 'storage/retry-limit-exceeded') {
            message = "Upload timed out. Please try again with a better connection.";
          } else if (error.code === 'storage/canceled') {
            message = "Upload was canceled.";
          } else if (error.message.includes('network')) {
            message = "Network error during upload. Please check your connection.";
          } else {
            message = `Upload failed: ${error.message}`;
          }
          
          setError(message);
          setUploading(false);
        },
        async () => {
          console.log("Upload successful, getting download URL...");
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          console.log("Download URL obtained:", downloadURL);
          
          onUploadComplete({
            name: selectedFile.name,
            url: downloadURL,
            size: selectedFile.size,
            type: selectedFile.type,
            destination: destination,
            description: description.trim()
          });
          
          setProgress(100);
          setUploading(false);
          setSelectedFile(null);
          setDescription("");
          console.log("Upload process complete.");
        }
      );
    } catch (err: any) {
      console.error("Catch block upload error:", err);
      setError(err.message || "Upload failed. Please try again.");
      setUploading(false);
    }
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedFile(null);
              }}
              className="mt-2 text-[10px] font-bold text-rose-600 uppercase hover:text-rose-700 transition-colors"
            >
              Change Selection
            </button>
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
          disabled={uploading || !selectedFile || !description.trim()}
          className={cn(
            "w-full py-3 rounded-xl font-medium text-white transition-all flex items-center justify-center gap-2 shadow-sm",
            "bg-zinc-900 hover:bg-zinc-800",
            (uploading || !selectedFile || !description.trim()) && "opacity-50 cursor-not-allowed"
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4" />
              Confirm Upload
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
          <XCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );
}
