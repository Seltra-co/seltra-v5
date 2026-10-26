import { useCallback, useEffect, useRef, useState } from "react";
import { isWebRuntimeEnabled } from "@/web/client/capabilities";
import { systemClock, uuidIdSource } from "@/state_machines/clock";
import {
  useControllerSnapshot,
  useManagerLifecycle,
} from "@/state_machines/react";
import { createBrowserVoiceCommandRunner } from "@/voice_to_text/commands";
import {
  isVoiceRecording,
  isVoiceTranscribing,
  VoiceToTextController,
} from "@/voice_to_text/controller";

interface UseVoiceToTextOptions {
  enabled: boolean;
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceToText({
  enabled,
  onTranscription,
  onError,
}: UseVoiceToTextOptions) {
  type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
  type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
  type SpeechRecognizer = {
    lang: string;
    interimResults: boolean;
    continuous?: boolean;
    onresult: ((event: SpeechEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  };
  const webRecognition = useRef<SpeechRecognizer | null>(null);
  const [isWebRecording, setIsWebRecording] = useState(false);
  const [isWebPaused, setIsWebPaused] = useState(false);
  const [webTranscript, setWebTranscript] = useState("");
  const [webInterimTranscript, setWebInterimTranscript] = useState("");
  const webTranscriptRef = useRef("");
  const webSessionActiveRef = useRef(false);
  const webPausedRef = useRef(false);
  const webEndWaiter = useRef<(() => void) | null>(null);
  const [{ controller, runner }] = useState(() => {
    const commandRunner = createBrowserVoiceCommandRunner({
      clock: systemClock,
      idSource: uuidIdSource,
      callbacks: { onTranscription, onError },
    });
    return {
      runner: commandRunner,
      controller: new VoiceToTextController({
        idSource: uuidIdSource,
        runner: commandRunner,
      }),
    };
  });

  useManagerLifecycle(controller);
  useEffect(() => {
    runner.updateCallbacks({ onTranscription, onError });
  }, [runner, onTranscription, onError]);

  const state = useControllerSnapshot(controller);
  const startBrowserRecognition = useCallback(() => {
    const speechWindow = window as Window & {
      SpeechRecognition?: new () => SpeechRecognizer;
      webkitSpeechRecognition?: new () => SpeechRecognizer;
    };
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      webSessionActiveRef.current = false;
      setIsWebRecording(false);
      onError?.(
        "Voice input is not supported by this browser. Try Chrome or Edge.",
      );
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      const finalTranscripts: string[] = [];
      const interimTranscripts: string[] = [];
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const transcript = result[0]?.transcript.trim();
        if (!transcript) continue;
        if (result.isFinal) {
          finalTranscripts.push(transcript);
        } else {
          interimTranscripts.push(transcript);
        }
      }
      if (finalTranscripts.length) {
        webTranscriptRef.current = [
          webTranscriptRef.current,
          ...finalTranscripts,
        ]
          .filter(Boolean)
          .join(" ");
        setWebTranscript(webTranscriptRef.current);
      }
      setWebInterimTranscript(interimTranscripts.join(" "));
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        onError?.(`Voice input failed: ${event.error}`);
      }
    };
    recognition.onend = () => {
      webRecognition.current = null;
      setIsWebRecording(webSessionActiveRef.current);
      webEndWaiter.current?.();
      webEndWaiter.current = null;
    };
    webRecognition.current = recognition;
    setIsWebRecording(true);
    setIsWebPaused(false);
    webPausedRef.current = false;
    try {
      recognition.start();
    } catch (error) {
      webRecognition.current = null;
      webSessionActiveRef.current = false;
      setIsWebRecording(false);
      onError?.(
        error instanceof Error ? error.message : "Could not start voice input.",
      );
    }
  }, [onError]);

  const finishRecording = useCallback(async () => {
    if (!isWebRuntimeEnabled()) return "";
    webSessionActiveRef.current = false;
    webPausedRef.current = false;
    const recognition = webRecognition.current;
    if (recognition) {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 1_500);
        webEndWaiter.current = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        try {
          recognition.stop();
        } catch {
          window.clearTimeout(timeout);
          resolve();
        }
      });
    }
    const transcript = webTranscriptRef.current.trim();
    webTranscriptRef.current = "";
    setWebTranscript("");
    setWebInterimTranscript("");
    setIsWebRecording(false);
    setIsWebPaused(false);
    return transcript;
  }, []);

  const cancelRecording = useCallback(() => {
    if (!isWebRuntimeEnabled()) return;
    webSessionActiveRef.current = false;
    webPausedRef.current = false;
    webRecognition.current?.abort();
    webRecognition.current = null;
    webTranscriptRef.current = "";
    setWebTranscript("");
    setWebInterimTranscript("");
    setIsWebRecording(false);
    setIsWebPaused(false);
  }, []);

  const pauseRecording = useCallback(() => {
    if (!isWebRuntimeEnabled()) return;
    webPausedRef.current = true;
    setIsWebPaused(true);
    webRecognition.current?.stop();
    setIsWebRecording(true);
  }, []);

  const resumeRecording = useCallback(() => {
    if (!isWebRuntimeEnabled() || !webSessionActiveRef.current) return;
    webPausedRef.current = false;
    startBrowserRecognition();
  }, [startBrowserRecognition]);

  const toggleRecording = useCallback(() => {
    if (isWebRuntimeEnabled()) {
      if (webSessionActiveRef.current) {
        void finishRecording().then((transcript) => {
          if (transcript) onTranscription(transcript);
        });
        return;
      }
      webTranscriptRef.current = "";
      setWebTranscript("");
      setWebInterimTranscript("");
      webSessionActiveRef.current = true;
      startBrowserRecognition();
      return;
    }
    if (enabled || isVoiceRecording(controller.getSnapshot())) {
      controller.toggle();
    }
  }, [
    controller,
    enabled,
    finishRecording,
    onTranscription,
    startBrowserRecognition,
  ]);

  useEffect(
    () => () => {
      webRecognition.current?.stop();
      webRecognition.current = null;
      webSessionActiveRef.current = false;
    },
    [],
  );

  return {
    isRecording: isWebRuntimeEnabled()
      ? isWebRecording
      : isVoiceRecording(state),
    isPaused: isWebRuntimeEnabled() && isWebPaused,
    transcript: webTranscript,
    interimTranscript: webInterimTranscript,
    isTranscribing: !isWebRuntimeEnabled() && isVoiceTranscribing(state),
    toggleRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    finishRecording,
  };
}
