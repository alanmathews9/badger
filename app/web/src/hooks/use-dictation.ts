import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function ctor(): (new () => Recognition) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type Dictation = ReturnType<typeof useDictation>;

export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<Recognition | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");

  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const clearWatchdog = () => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  };

  const stop = useCallback(() => {
    clearWatchdog();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setStarting(false);
  }, []);

  const cancel = useCallback(() => {
    clearWatchdog();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
    setStarting(false);
    setError(null);
    onTextRef.current(baseRef.current.trimEnd());
  }, []);

  useEffect(
    () => () => {
      clearWatchdog();
      recognitionRef.current?.abort();
    },
    [],
  );

  const start = useCallback(async (current: string) => {
    const Ctor = ctor();
    if (!Ctor || recognitionRef.current) return;

    setError(null);
    setStarting(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
      const ask = navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
      });
      const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
      await Promise.race([ask, timeout]);
    } catch (err) {
      setStarting(false);
      const { name, message = "" } = err as { name?: string; message?: string };
      setError(
        /policy/i.test(message)
          ? "Dictation is blocked by this page's permissions policy."
          : name === "NotAllowedError"
          ? "Microphone blocked. Allow it in the address bar, then try again."
          : name === "NotFoundError"
          ? "No microphone found."
          : "The microphone is unavailable on this page.",
      );
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    baseRef.current = current.trim() ? current.replace(/\s*$/, " ") : "";
    finalRef.current = "";

    recognition.onstart = () => {
      clearWatchdog();
      setStarting(false);
      setListening(true);
    };

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalRef.current += result[0].transcript;
        else interim += result[0].transcript;
      }
      onTextRef.current((baseRef.current + finalRef.current + interim).trimStart());
    };

    recognition.onerror = (event) => {
      clearWatchdog();
      recognitionRef.current = null;
      setListening(false);
      setStarting(false);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone blocked. Allow it in the address bar, then try again.");
      } else if (event.error === "network") {
        setError("Speech recognition needs a network connection.");
      } else if (event.error === "audio-capture") {
        setError("No microphone found.");
      }
    };

    recognition.onend = () => {
      clearWatchdog();
      recognitionRef.current = null;
      setListening(false);
      setStarting(false);
    };

    try {
      recognition.start();
    } catch {
      setStarting(false);
      setError("Dictation could not start.");
      return;
    }
    recognitionRef.current = recognition;

    watchdogRef.current = setTimeout(() => {
      if (!recognitionRef.current) return;
      recognitionRef.current.abort();
      recognitionRef.current = null;
      setStarting(false);
      setListening(false);
      setError("Dictation did not start. Check that this browser can reach the speech service.");
    }, 5000);
  }, []);

  const toggle = useCallback(
    (current: string) => {
      if (recognitionRef.current) stop();
      else void start(current);
    },
    [start, stop],
  );

  return {
    supported: ctor() != null,
    listening,
    starting,
    error,
    toggle,
    stop,
    cancel,
  };
}
