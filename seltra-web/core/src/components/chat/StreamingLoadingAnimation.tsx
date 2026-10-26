import { ThinkingOrb } from "thinking-orbs";
import { useCallback, useEffect, useRef, useState } from "react";

interface StreamingLoadingAnimationProps {
  variant: "initial" | "streaming";
}

/**
 * A delightful loading animation for chat streaming.
 * - "initial" variant: Shown when waiting for the first response (no content yet)
 * - "streaming" variant: Shown inline when content is being streamed
 */
export function StreamingLoadingAnimation({
  variant,
}: StreamingLoadingAnimationProps) {
  if (variant === "initial") {
    return <InitialLoadingAnimation />;
  }
  return <StreamingIndicator />;
}

const INITIAL_VERBS = [
  "thinking",
  "pondering",
  "reasoning",
  "mulling",
  "noodling",
  "contemplating",
  "daydreaming",
  "meditating",
  "ruminating",
  "wondering",
  "imagining",
  "brainstorming",
];

const STREAMING_VERBS = [
  "brewing",
  "conjuring",
  "cooking",
  "crafting",
  "weaving",
  "assembling",
  "forging",
  "composing",
  "sculpting",
  "distilling",
  "sketching",
  "mixing",
  "painting",
  "stitching",
  "wiring",
  "molding",
  "tuning",
  "polishing",
  "building",
  "shaping",
  "spinning",
  "tinkering",
  "whittling",
  "arranging",
  "rendering",
  "summoning",
  "channeling",
  "unspooling",
  "manifesting",
  "crystallizing",
];

const SCRAMBLE_CHARS = "abcdefghijklmnopqrstuvwxyz";
const SCRAMBLE_SPEED_MS = 30;
const REVEAL_STAGGER_MS = 60;

function useRotatingVerb(verbs: string[]) {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * verbs.length),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % verbs.length);
    }, 5000);
    return () => clearInterval(id);
  }, [verbs]);
  return verbs[index];
}

export function useScrambleText(text: string) {
  const [display, setDisplay] = useState(text + "...");
  const rafRef = useRef<number>(0);
  const prevTextRef = useRef(text);

  const scramble = useCallback((target: string) => {
    const len = Math.max(target.length, prevTextRef.current.length);
    const startTime = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const revealed = Math.floor(elapsed / REVEAL_STAGGER_MS);
      let result = "";
      for (let i = 0; i < len; i++) {
        if (i < revealed) {
          result += i < target.length ? target[i] : "";
        } else {
          const scrambleCycle = Math.floor(elapsed / SCRAMBLE_SPEED_MS + i);
          result += SCRAMBLE_CHARS[scrambleCycle % SCRAMBLE_CHARS.length];
        }
      }

      if (revealed >= len) {
        setDisplay(target + "...");
        prevTextRef.current = target;
        return;
      }

      setDisplay(result + "...");
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (text !== prevTextRef.current) {
      scramble(text);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [text, scramble]);

  return display;
}

function ScrambleVerb({ verb }: { verb: string }) {
  const display = useScrambleText(verb);
  return (
    <span
      className="inline-block text-sm text-muted-foreground"
      aria-hidden="true"
    >
      {display}
    </span>
  );
}

/**
 * A snappy wave animation with monochrome glowing orbs and a rotating verb.
 * Uses spring-like timing for a crisp, bouncy feel.
 */
function InitialLoadingAnimation() {
  const verb = useRotatingVerb(INITIAL_VERBS);

  return (
    <div className="flex items-center gap-3 p-2">
      <ThinkingOrb
        state="searching"
        size={20}
        className="shrink-0"
        aria-label="Waiting for a response"
      />
      <ScrambleVerb verb={verb} />
    </div>
  );
}

/** Compact working orb shown alongside the existing live status wording. */
function StreamingIndicator() {
  const verb = useRotatingVerb(STREAMING_VERBS);

  return (
    <div className="mt-3 ml-1 flex items-center gap-2.5">
      <ThinkingOrb
        state="working"
        size={20}
        className="shrink-0"
        aria-label="Building response"
      />
      <ScrambleVerb verb={verb} />
    </div>
  );
}
