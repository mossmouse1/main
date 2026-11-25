import { useEffect, useState } from 'react';
import { getFamilyBackend } from '../backend';
import { IdentifyError, type IdentifyResult } from '../backend/types';
import { BACKEND_MODE } from '../config';
import { isHeic, makeIdentifyCopy } from '../lib/photo';
import { syncFamilyConsent } from './sync';
import type { DraftPhoto } from './types';

type Identification = { result: IdentifyResult } | { error: string };
const requests = new Map<string, Promise<Identification>>();

async function identify(photo: DraftPhoto): Promise<Identification> {
  try {
    if (!navigator.onLine) throw new IdentifyError('network');
    const source = isHeic(photo.original) && photo.display ? photo.display : photo.original;
    const blob = await makeIdentifyCopy(source) ??
      (photo.display && source !== photo.display ? await makeIdentifyCopy(photo.display) : null);
    if (!blob) throw new IdentifyError('invalid_image');
    const backend = await getFamilyBackend();
    if (!(await syncFamilyConsent(backend))) throw new IdentifyError('consent_required');
    return { result: await backend.identifySpecies(blob) };
  } catch (error) {
    return { error: error instanceof IdentifyError ? error.code : 'failed' };
  }
}

/** 촬영과 확인 화면이 같은 사진의 요청 및 결과를 공유합니다. */
export function usePhotoIdentification(photo?: DraftPhoto) {
  const photoId = photo?.id;
  const [outcome, setOutcome] = useState<{ request: Promise<Identification>; value: Identification }>();
  const [retryCount, setRetryCount] = useState(0);
  useEffect(() => {
    if (!photoId || !photo || BACKEND_MODE !== 'supabase') return;
    let request = requests.get(photoId);
    if (!request) {
      request = identify(photo);
      requests.set(photoId, request);
    }
    let active = true;
    void request.then((value) => { if (active) setOutcome({ request, value }); });
    return () => { active = false; };
  }, [photo, photoId, retryCount]);

  const current = photoId ? requests.get(photoId) : undefined;
  const value = outcome && outcome.request === current ? outcome.value : undefined;
  return {
    pending: BACKEND_MODE === 'supabase' && !!photoId && !value,
    result: value && 'result' in value ? value.result : undefined,
    error: value && 'error' in value ? value.error : undefined,
    retry: () => {
      if (photoId && value && 'error' in value) {
        requests.delete(photoId);
        setRetryCount((count) => count + 1);
      }
    },
  };
}
