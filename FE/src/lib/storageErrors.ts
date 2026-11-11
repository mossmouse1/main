export interface StorageErrorLike {
  message?: string;
  status?: number | string;
  statusCode?: number | string;
}

/**
 * Supabase Storage가 같은 경로에 다시 올릴 때 주는 오류(HTTP 409 · "The resource already exists")만 true.
 * 그 밖의 오류(does not exist, bucket not found, 403 …)는 모두 실패로 봐서 사진을 지우지 않고 다시 시도합니다.
 */
export function isAlreadyUploaded(err: StorageErrorLike | null | undefined): boolean {
  if (!err) return false;
  const is409 = String(err.status) === '409' || String(err.statusCode) === '409';
  return is409 && /already exists/i.test(err.message ?? '');
}
