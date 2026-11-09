/**
 * 카메라·위치·저장소는 이 파일에서만 부릅니다.
 * 나중에 앱(웹뷰)으로 감쌀 때 이 파일만 네이티브 브리지로 바꾸면 됩니다.
 */
import type { MediaSource, ObserverFix } from './data/types';

/**
 * 사진을 고릅니다. 사용자 탭 안에서 바로 불러야 합니다(브라우저가 사용자 동작으로 인정해야 열림).
 * 취소하면 [] — cancel 이벤트가 없는 브라우저에서는 끝나지 않을 수 있으니, 부르는 쪽은 결과가 올 때만 처리합니다.
 */
export function pickPhotos(source: MediaSource, max: number): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (source === 'camera') input.setAttribute('capture', 'environment');
    else if (max > 1) input.multiple = true;
    input.style.display = 'none';
    // iOS 일부 버전은 문서에 붙은 input만 열어 줍니다.
    document.body.appendChild(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files.slice(0, max));
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}

export type Facing = 'environment' | 'user';

/**
 * 촬영 화면 미리보기용 카메라. 쓸 수 없으면(HTTPS 아님, 권한 거부, 카메라 없음, 일부 웹뷰) null이고,
 * 그때 촬영 화면은 pickPhotos('camera')로 휴대폰 카메라 앱을 엽니다(PRD F05 기본 방식).
 */
export async function openCameraStream(facing: Facing): Promise<MediaStream | null> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 4096 }, height: { ideal: 3072 } },
    });
  } catch {
    return null;
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** 기기가 광학·디지털 확대를 직접 지원하면 그 범위(없으면 null → 화면에서 잘라 확대) */
export function hardwareZoomRange(stream: MediaStream): { min: number; max: number } | null {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: { min: number; max: number } }) | undefined;
  return caps?.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null;
}

export async function setHardwareZoom(stream: MediaStream, zoom: number): Promise<boolean> {
  const track = stream.getVideoTracks()[0];
  try {
    await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** 미리보기 한 장을 JPEG 파일로. cropZoom > 1이면 가운데를 잘라 확대합니다. */
export async function captureFrame(video: HTMLVideoElement, cropZoom = 1): Promise<File | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const w = Math.round(vw / cropZoom);
  const h = Math.round(vh / cropZoom);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')?.drawImage(video, (vw - w) / 2, (vh - h) / 2, w, h, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) return null;
  const now = Date.now();
  return new File([blob], `camera-${now}.jpg`, { type: 'image/jpeg', lastModified: now });
}

const toFix = (p: GeolocationPosition): ObserverFix => ({
  lat: p.coords.latitude,
  lng: p.coords.longitude,
  accuracy: Math.round(p.coords.accuracy),
  at: new Date(p.timestamp).toISOString(),
});

/** 기록할 때 한 번 읽습니다. 권한이 없거나 실패하면 null */
export function getPosition(timeoutMs = 10000): Promise<ObserverFix | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toFix(p)),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}

/** 지도 화면이 열려 있는 동안만 위치를 따라갑니다. 돌려주는 함수로 멈춥니다. */
export function watchPosition(onFix: (fix: ObserverFix) => void, onDenied: () => void): () => void {
  if (!('geolocation' in navigator)) {
    onDenied();
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onFix(toFix(p)),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) onDenied();
    },
    { enableHighAccuracy: true, maximumAge: 10000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export type PermissionResult = 'granted' | 'denied' | 'prompt' | 'unknown';

export async function locationPermission(): Promise<PermissionResult> {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** 브라우저가 저장소를 함부로 비우지 않게 요청합니다(지원하는 곳만). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export const isOnline = () => navigator.onLine;
