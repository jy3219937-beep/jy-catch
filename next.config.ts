import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MediaPipe wasm은 CDN에서 로드하므로 별도 설정 불필요.
  // 카메라(getUserMedia)는 https 또는 localhost에서만 동작함에 유의.
};

export default nextConfig;
