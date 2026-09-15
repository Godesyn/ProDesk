import { useState } from "react";
import { useParams } from "wouter";
import { useTRPC } from "@shared/lib/trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";
import { CheckCircle, Star } from "lucide-react";

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="p-1 transition-transform active:scale-95"
        >
          <Star
            className={`w-8 h-8 transition-colors ${
              star <= (hovered || value)
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function NpsSelector({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1 flex-wrap">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={`w-9 h-9 rounded-md text-sm font-medium border transition-colors active:scale-95 ${
              value === i
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-border hover:border-primary"
            }`}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Not likely at all</span>
        <span>Extremely likely</span>
      </div>
    </div>
  );
}

export default function SurveyPage() {
  const trpc = useTRPC();
  const { token } = useParams<{ token: string }>();

  const { data: survey, isLoading, error } = useQuery({
    ...trpc.payments.surveys.getByToken.queryOptions({ token: token ?? "" }),
    enabled: !!token,
  });

  const submitMutation = useMutation({
    ...trpc.payments.surveys.submit.mutationOptions(),
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (err) => {
      toast.error(sanitizeError(err, "Failed to submit. Please try again."));
    },
  });

  const [npsScore, setNpsScore] = useState<number | null>(null);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [wouldRefer, setWouldRefer] = useState<boolean | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading survey…</div>
      </div>
    );
  }

  if (error || !survey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-sm px-4">
          <h2 className="text-xl font-semibold">Survey not found</h2>
          <p className="text-muted-foreground text-sm">This survey link may have expired or already been completed.</p>
        </div>
      </div>
    );
  }

  if (survey.completedAt || submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-sm px-4">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h2 className="text-2xl font-semibold">Thank you!</h2>
          <p className="text-muted-foreground">Your feedback has been received. We really appreciate you taking the time.</p>
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    if (npsScore === null) { toast.error("Please rate how likely you are to recommend us."); return; }
    if (rating === 0) { toast.error("Please give us a star rating."); return; }
    submitMutation.mutate({
      token: token ?? "",
      npsScore,
      rating,
      feedback: feedback || undefined,
      wouldRefer: wouldRefer ?? undefined,
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-lg space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">How did we do?</h1>
          <p className="text-muted-foreground text-sm">Your feedback helps us improve. It only takes 30 seconds.</p>
        </div>

        {/* NPS */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <p className="font-medium mb-1">How likely are you to recommend us to a friend or colleague?</p>
            <p className="text-xs text-muted-foreground mb-3">0 = Not at all likely, 10 = Extremely likely</p>
            <NpsSelector value={npsScore} onChange={setNpsScore} />
          </div>
        </div>

        {/* Star rating */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <p className="font-medium mb-3">Overall, how would you rate your experience?</p>
            <StarRating value={rating} onChange={setRating} />
          </div>
        </div>

        {/* Feedback */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div>
            <p className="font-medium mb-2">Any additional comments? <span className="text-muted-foreground font-normal">(optional)</span></p>
            <Textarea
              placeholder="Tell us what went well, or what we could improve…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              maxLength={2000}
            />
          </div>
        </div>

        {/* Would refer */}
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="font-medium mb-3">Would you refer us to someone you know?</p>
          <div className="flex gap-3">
            {[
              { label: "Yes, definitely", value: true },
              { label: "No, not right now", value: false },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => setWouldRefer(opt.value)}
                className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${
                  wouldRefer === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:border-primary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? "Submitting…" : "Submit feedback"}
        </Button>
      </div>
    </div>
  );
}
