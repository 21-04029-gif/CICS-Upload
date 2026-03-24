import { CreditCard, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "../utils";

interface PaymentProps {
  uid: string;
  onPaymentComplete: (payment: { amount: number; purpose: string; transactionId: string }) => void;
}

const PAYMENT_PURPOSES = [
  { id: 'lab_fee', label: 'Laboratory Fee', amount: 500 },
  { id: 'certification', label: 'Certification Fee', amount: 200 },
  { id: 'graduation', label: 'Graduation Fee', amount: 1500 },
  { id: 'other', label: 'Other Fees', amount: 100 },
];

export function Payment({ uid, onPaymentComplete }: PaymentProps) {
  const [selectedPurpose, setSelectedPurpose] = useState(PAYMENT_PURPOSES[0]);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePayment = async () => {
    setProcessing(true);
    setError(null);

    // Simulate payment processing
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      
      const transactionId = `TXN_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      
      onPaymentComplete({
        amount: selectedPurpose.amount,
        purpose: selectedPurpose.id,
        transactionId,
      });
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Payment error:", err);
      setError("Payment failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="space-y-4">
        <label className="text-sm font-medium text-zinc-900">Select Payment Purpose</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PAYMENT_PURPOSES.map((purpose) => (
            <button
              key={purpose.id}
              onClick={() => setSelectedPurpose(purpose)}
              className={cn(
                "flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left group",
                selectedPurpose.id === purpose.id
                  ? "border-zinc-900 bg-zinc-50"
                  : "border-zinc-100 hover:border-zinc-200"
              )}
            >
              <span className="text-sm font-semibold text-zinc-900">{purpose.label}</span>
              <span className="text-xs text-zinc-500 mt-1">Amount: ₱{purpose.amount.toLocaleString()}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-zinc-50 border border-zinc-100 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-white border border-zinc-200">
              <CreditCard className="w-5 h-5 text-zinc-600" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-zinc-900">Total Amount</span>
              <span className="text-xs text-zinc-500">Secure payment processing</span>
            </div>
          </div>
          <span className="text-xl font-bold text-zinc-900">₱{selectedPurpose.amount.toLocaleString()}</span>
        </div>

        <button
          onClick={handlePayment}
          disabled={processing || success}
          className={cn(
            "w-full py-3 rounded-xl font-medium text-white transition-all flex items-center justify-center gap-2 shadow-sm",
            success ? "bg-emerald-600" : "bg-zinc-900 hover:bg-zinc-800",
            processing && "opacity-70 cursor-not-allowed"
          )}
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : success ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Payment Successful
            </>
          ) : (
            <>
              <CreditCard className="w-4 h-4" />
              Pay Now
            </>
          )}
        </button>

        {error && (
          <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
