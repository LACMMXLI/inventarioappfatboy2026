import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Package } from "lucide-react";
import { api } from "./api";
export function ProductPhoto({
  product,
}: {
  product: { id: string; photo?: string | null };
}) {
  const photo = useQuery({
    queryKey: ["photo", product.id, product.photo],
    queryFn: () =>
      api<{ url: string | null }>("/catalog/products/" + product.id + "/photo"),
    enabled: !!product.photo,
    staleTime: 300000,
  });
  return photo.data?.url ? (
    <img src={photo.data.url} alt="" loading="lazy" className="product-photo" />
  ) : (
    <Package />
  );
}
export function BarcodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null),
    [active, setActive] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!active) return;
    let cancelled = false,
      stream: MediaStream | undefined,
      timer: ReturnType<typeof setTimeout>;
    const Detector = (window as any).BarcodeDetector;
    async function start() {
      try {
        if (!Detector)
          throw new Error(
            "Este navegador no admite escaneo. Busca por nombre o escribe el código.",
          );
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current!.srcObject = stream;
        await video.current!.play();
        const detector = new Detector({
          formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
        });
        const scan = async () => {
          if (cancelled) return;
          try {
            const results = await detector.detect(video.current!);
            if (results[0]) {
              onCode(results[0].rawValue);
              setActive(false);
              return;
            }
          } catch {}
          timer = setTimeout(scan, 250);
        };
        scan();
      } catch (e: any) {
        setMessage(
          e.message || "No se pudo abrir la cámara. Usa la búsqueda manual.",
        );
        setActive(false);
      }
    }
    start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);
  return (
    <div className="scanner">
      <button
        className="button secondary"
        type="button"
        onClick={() => {
          setMessage("");
          setActive(!active);
        }}
      >
        <Camera size={17} />
        {active ? "Cerrar cámara" : "Escanear código"}
      </button>
      {active && <video ref={video} playsInline muted />}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
