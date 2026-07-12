"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// hand-gesture 데모에서 검증된 MediaPipe GestureRecognizer 로직을
// 게임용 React 훅으로 재구성한 것.
// - 손 위치(정규화 0~1, 이미 좌우반전/거울 처리됨)
// - 현재 제스처(Open_Palm, Closed_Fist, Thumb_Up ...)
// - 21개 랜드마크 (거울 좌표)
// - "집기(pinch)" 이벤트: Open_Palm → Closed_Fist 전환 순간

export type HandLandmark = { x: number; y: number };

export type TrackedHand = {
  detected: boolean;
  gesture: string;
  // 손바닥 중심(랜드마크 9), 거울 반전된 정규화 좌표 0~1
  palm: { x: number; y: number };
  landmarks: HandLandmark[];
  // 이번 프레임에 "집기(펼침→주먹)" 전환이 일어났는지
  justPinched: boolean;
};

const EMPTY_HAND: TrackedHand = {
  detected: false,
  gesture: "None",
  palm: { x: 0.5, y: 0.5 },
  landmarks: [],
  justPinched: false,
};

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";

export function useHandTracking() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recognizerRef = useRef<unknown>(null);
  const rafRef = useRef<number>(0);
  const lastVideoTimeRef = useRef(-1);
  // 손별 이전 제스처 (집기 전환 감지용)
  const prevGestureRef = useRef<string[]>(["None", "None"]);
  // 최신 손 상태 (렌더 루프에서 ref로 읽음 — setState 남발 방지)
  const handsRef = useRef<TrackedHand[]>([EMPTY_HAND, EMPTY_HAND]);

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const start = useCallback(async () => {
    if (recognizerRef.current) return;
    setLoading(true);
    setError("");
    try {
      const { FilesetResolver, GestureRecognizer } = await import(
        "@mediapipe/tasks-vision"
      );
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
      recognizerRef.current = recognizer;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
      });
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await new Promise<void>((resolve) => {
          video.onloadeddata = () => {
            video.play();
            resolve();
          };
        });
      }
      setReady(true);
    } catch (e) {
      console.error("hand tracking init failed", e);
      setError("카메라/모델 초기화 실패 — 카메라 권한을 확인해주세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    recognizerRef.current = null;
    handsRef.current = [EMPTY_HAND, EMPTY_HAND];
    setReady(false);
  }, []);

  // 매 프레임 손 인식을 수행하고 handsRef를 갱신. 게임 루프에서 호출.
  const detect = useCallback(() => {
    const video = videoRef.current;
    const recognizer = recognizerRef.current as
      | { recognizeForVideo: (v: HTMLVideoElement, t: number) => RecognizeResult }
      | null;
    if (!recognizer || !video || video.readyState < 2) return handsRef.current;

    const now = video.currentTime;
    if (now === lastVideoTimeRef.current) return handsRef.current;
    lastVideoTimeRef.current = now;

    const result = recognizer.recognizeForVideo(video, performance.now());
    const numDetected = result.landmarks?.length ?? 0;
    const next: TrackedHand[] = [];

    for (let hi = 0; hi < 2; hi++) {
      if (hi < numDetected) {
        const lms = result.landmarks[hi];
        const palm = lms[9];
        let gesture = "None";
        if (result.gestures?.[hi]?.length) {
          const top = result.gestures[hi][0];
          if (top.score > 0.5) gesture = top.categoryName;
        }

        const prev = prevGestureRef.current[hi];
        // 집기 전환: 펼친 손(Open_Palm/None) → 주먹(Closed_Fist)
        const justPinched =
          gesture === "Closed_Fist" && prev !== "Closed_Fist";
        prevGestureRef.current[hi] = gesture;

        next.push({
          detected: true,
          gesture,
          palm: { x: 1 - palm.x, y: palm.y }, // 거울 반전
          landmarks: lms.map((lm) => ({ x: 1 - lm.x, y: lm.y })),
          justPinched,
        });
      } else {
        prevGestureRef.current[hi] = "None";
        next.push(EMPTY_HAND);
      }
    }

    handsRef.current = next;
    return next;
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { videoRef, ready, loading, error, start, stop, detect, handsRef };
}

type RecognizeResult = {
  landmarks: { x: number; y: number }[][];
  gestures?: { categoryName: string; score: number }[][];
};
