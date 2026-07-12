"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// 신청 링크(/join) QR 코드. 브라우저 접속 origin 기준으로 URL 생성.
export default function QRPanel({ size = 120 }: { size?: number }) {
  const [dataUrl, setDataUrl] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    const joinUrl = `${window.location.origin}/join`;
    setUrl(joinUrl);
    QRCode.toDataURL(joinUrl, {
      width: size * 2,
      margin: 1,
      color: { dark: "#0a0a14", light: "#ffffff" },
    })
      .then(setDataUrl)
      .catch(() => {});
  }, [size]);

  return (
    <div style={{ textAlign: "center" }}>
      {dataUrl && (
        <img
          src={dataUrl}
          alt="신청 QR"
          width={size}
          height={size}
          style={{ borderRadius: 8, display: "block", margin: "0 auto" }}
        />
      )}
      <div style={{ fontSize: 11, color: "#889", marginTop: 6 }}>
        폰으로 QR 찍어 신청
      </div>
      {url && (
        <div style={{ fontSize: 10, color: "#556", marginTop: 2 }}>{url}</div>
      )}
    </div>
  );
}
