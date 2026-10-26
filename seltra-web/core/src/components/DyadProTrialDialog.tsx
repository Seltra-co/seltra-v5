import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Check, Zap, Wand2, Cpu } from "lucide-react";
import { ipc } from "@/ipc/types";

interface DyadProTrialDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Attributes checkout/learn-more traffic to the surface that opened the dialog. */
  utmCampaign?: string;
}

export function DyadProTrialDialog({
  isOpen,
  onClose,
  utmCampaign = "setup-dialog-v2",
}: DyadProTrialDialogProps) {
  const utmParams = `utm_source=seltra-app&utm_medium=app&utm_campaign=${encodeURIComponent(utmCampaign)}`;

  const handleStartTrial = () => {
    ipc.system.openExternalUrl(
      `https://seltra.example/account/redirect-to-checkout?trialCode=7PRO30&${utmParams}`,
    );
    onClose();
  };

  const handleLearnMore = () => {
    ipc.system.openExternalUrl(`https://seltra.example/pro?${utmParams}`);
  };

  const features = [
    {
      icon: Zap,
      title: "50 AI Credits",
      description: "Start building right away",
    },
    {
      icon: Cpu,
      title: "Agent Mode",
      description: "Automatically debug errors with AI",
    },
    {
      icon: Wand2,
      title: "Pro Features",
      description: "AI themes, visual editing & more",
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md overflow-hidden border-0 p-0 shadow-2xl">
        {/* Header */}
        <div className="relative bg-muted/50 px-6 pt-6">
          {/* Subtle accent line */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-500" />

          {/* Title */}
          <div className="text-center">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Unlock Seltra Pro
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Start your free 7-day trial today
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {/* Features */}
          <div className="space-y-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="flex items-center gap-4 rounded-xl border border-border/50 bg-muted/30 p-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/10 to-emerald-500/10 ring-1 ring-emerald-500/20">
                  <feature.icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{feature.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
                <Check className="h-5 w-5 shrink-0 text-green-600 dark:text-green-500" />
              </div>
            ))}
          </div>

          {/* CTA Buttons */}
          <div className="mt-6 space-y-3">
            <Button
              onClick={handleStartTrial}
              className="w-full bg-emerald-600 py-5 text-base font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all hover:bg-emerald-500 hover:shadow-xl hover:shadow-emerald-500/40 active:scale-[0.98]"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Start Free Trial
            </Button>
            <Button
              variant="ghost"
              onClick={handleLearnMore}
              className="w-full text-muted-foreground hover:text-foreground"
            >
              Learn more about Pro
            </Button>
          </div>

          {/* Fine print */}
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Cancel anytime. Free trial for first-time customers only.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
