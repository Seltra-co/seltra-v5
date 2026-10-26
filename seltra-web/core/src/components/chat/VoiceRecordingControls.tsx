import { ArrowUp, Mic2, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";

const WAVEFORM_HEIGHTS = [3, 5, 8, 4, 7, 10, 5, 8, 12, 6, 9, 4, 7, 11, 5, 8, 3];

export function VoiceRecordingControls({
  transcript,
  interimTranscript,
  paused,
  onCancel,
  onPause,
  onResume,
  onSend,
}: {
  transcript: string;
  interimTranscript: string;
  paused: boolean;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onSend: () => void;
}) {
  const visibleTranscript = [transcript, interimTranscript]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="flex min-h-20 w-full items-center gap-3 rounded-2xl border border-primary/25 bg-background px-3 py-2 shadow-sm"
      data-testid="voice-recording-controls"
      aria-label={paused ? "Voice recording paused" : "Voice recording"}
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel voice recording"
        title="Discard recording"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={19} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Mic2
            size={15}
            className={cn(
              "shrink-0",
              paused ? "text-muted-foreground" : "text-red-500",
            )}
          />
          <span className="text-xs font-medium text-muted-foreground">
            {paused ? "Recording paused" : "Listening"}
          </span>
          <div
            className="ml-auto flex h-5 items-center gap-0.5"
            aria-hidden="true"
            data-testid="voice-waveform"
          >
            {WAVEFORM_HEIGHTS.map((height, index) => (
              <span
                key={index}
                className={cn(
                  "w-0.5 rounded-full bg-primary/80",
                  !paused && "animate-pulse",
                )}
                style={{ height: `${height * (paused ? 0.55 : 1)}px` }}
              />
            ))}
          </div>
        </div>
        <p
          className="mt-1 line-clamp-2 min-h-5 text-sm text-foreground"
          aria-live="polite"
          data-testid="voice-transcript-preview"
        >
          {visibleTranscript || (
            <span className="text-muted-foreground">
              {paused
                ? "Pause here, then continue when ready."
                : "Speak your request…"}
            </span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={paused ? onResume : onPause}
        aria-label={paused ? "Continue recording" : "Pause recording"}
        title={paused ? "Continue recording" : "Pause recording"}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {paused ? <Play size={18} /> : <Pause size={18} />}
      </button>
      <button
        type="button"
        onClick={onSend}
        aria-label="Send voice transcript"
        title="Send"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <ArrowUp size={20} />
      </button>
    </div>
  );
}
