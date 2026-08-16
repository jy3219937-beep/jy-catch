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
  // 소프트웨어 줌 배율 (하드웨어 줌 되면 1). 인식·표시 공통.
  const zoomRef = useRef(1);
  // 소프트웨어 줌 시 원본을 크롭해 그리는 임시 캔버스
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

      // 줌인: 손이 화면에 크게 잡히도록. 하드웨어 줌 우선, 미지원 시 소프트웨어 크롭.
      const TARGET_ZOOM = 1.6;
      const track = stream.getVideoTracks()[0];
      let hwZoomed = false;
      try {
        const caps = track.getCapabilities?.() as
          | (MediaTrackCapabilities & { zoom?: { min: number; max: number; step: number } })
          | undefined;
        if (caps?.zoom) {
          const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min, TARGET_ZOOM));
          await track.applyConstraints({
            advanced: [{ zoom: z } as unknown as MediaTrackConstraintSet],
          });
          hwZoomed = true;
        }
      } catch {
        /* 하드웨어 줌 실패 → 소프트웨어 폴백 */
      }
      // 하드웨어 줌이 됐으면 소프트웨어 배율은 1(원본 그대로), 아니면 TARGET_ZOOM으로 크롭.
      zoomRef.current = hwZoomed ? 1 : TARGET_ZOOM;

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
      | {
          recognizeForVideo: (
            v: HTMLVideoElement | HTMLCanvasElement,
            t: number
          ) => RecognizeResult;
        }
      | null;
    if (!recognizer || !video || video.readyState < 2) return handsRef.current;

    const now = video.currentTime;
    if (now === lastVideoTimeRef.current) return handsRef.current;
    lastVideoTimeRef.current = now;

    // 소프트웨어 줌: 원본의 중앙 (1/zoom) 영역을 크롭해 확대한 캔버스를 인식 소스로 사용.
    // 이러면 랜드마크가 확대된 영역 기준으로 정규화되어 나와 표시도 자동으로 맞음.
    const zoom = zoomRef.current;
    let source: HTMLVideoElement | HTMLCanvasElement = video;
    if (zoom > 1.001) {
      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;
      let cc = cropCanvasRef.current;
      if (!cc) {
        cc = document.createElement("canvas");
        cropCanvasRef.current = cc;
      }
      if (cc.width !== vw || cc.height !== vh) {
        cc.width = vw;
        cc.height = vh;
      }
      const ctx = cc.getContext("2d");
      if (ctx) {
        const sw = vw / zoom;
        const sh = vh / zoom;
        const sx = (vw - sw) / 2;
        const sy = (vh - sh) / 2;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, vw, vh);
        source = cc;
      }
    }

    const result = recognizer.recognizeForVideo(source, performance.now());
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

  return { videoRef, ready, loading, error, start, stop, detect, handsRef, zoomRef };
}

type RecognizeResult = {
  landmarks: { x: number; y: number }[][];
  gestures?: { categoryName: string; score: number }[][];
};

// 비디오를 대상 영역(W×H)에 그린다. cover 방식 + 소프트웨어 줌(zoom>1) 중앙 크롭.
// 손 인식이 동일한 중앙 크롭을 쓰므로, 표시도 이 함수로 그려야 손 골격과 영상이 일치한다.
// (거울 반전은 호출 측에서 ctx.translate/scale로 처리)
export function drawZoomedVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  W: number,
  H: number,
  zoom: number
) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  // 소프트웨어 줌: 원본 중앙 1/zoom 영역만 소스로 사용
  const zw = vw / zoom;
  const zh = vh / zoom;
  const zx = (vw - zw) / 2;
  const zy = (vh - zh) / 2;
  // cover: 크롭된 소스 영역 안에서 대상(W×H) 비율에 맞는 실제 소스 사각형 계산
  const scale = Math.max(W / zw, H / zh);
  const srcW = W / scale;
  const srcH = H / scale;
  const srcX = zx + (zw - srcW) / 2;
  const srcY = zy + (zh - srcH) / 2;
  ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, W, H);
}
