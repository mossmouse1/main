import { describe, expect, it } from 'vitest';
import { isAlreadyUploaded } from './storageErrors';

describe('isAlreadyUploaded', () => {
  it('409 already exists는 성공으로 본다', () => {
    expect(isAlreadyUploaded({ statusCode: '409', message: 'The resource already exists' })).toBe(true);
    expect(isAlreadyUploaded({ status: 409, message: 'The resource already exists' })).toBe(true);
  });
  it('does not exist / bucket not found / 403 / 404 / 500은 실패', () => {
    expect(isAlreadyUploaded({ statusCode: '404', message: 'Object does not exist' })).toBe(false);
    expect(isAlreadyUploaded({ message: 'Bucket not found', status: 400 })).toBe(false);
    expect(isAlreadyUploaded({ statusCode: '403', message: 'new row violates row-level security policy' })).toBe(false);
    expect(isAlreadyUploaded({ status: 500, message: 'Internal error' })).toBe(false);
  });
  it('메시지만 비슷하고 상태 코드가 없거나 409가 아니면 실패', () => {
    expect(isAlreadyUploaded({ message: 'The resource already exists' })).toBe(false);
    expect(isAlreadyUploaded({ statusCode: '400', message: 'already exists' })).toBe(false);
  });
  it('409여도 다른 메시지거나 오류가 없으면 실패', () => {
    expect(isAlreadyUploaded({ statusCode: '409', message: 'conflict' })).toBe(false);
    expect(isAlreadyUploaded(null)).toBe(false);
  });
});
