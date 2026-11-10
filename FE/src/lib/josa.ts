/** 한글 마지막 글자의 받침으로 조사를 고릅니다(받침 없거나 ㄹ이면 ‘로’). 한글이 아니면 ‘(으)로’. */
export function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}(으)로`;
  const jong = code % 28;
  return `${word}${jong === 0 || jong === 8 ? '로' : '으로'}`;
}

/** 받침이 있으면 ‘을’, 없으면 ‘를’ */
export function withEul(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}을(를)`;
  return `${word}${code % 28 === 0 ? '를' : '을'}`;
}
