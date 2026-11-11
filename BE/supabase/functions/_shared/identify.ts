// 사진 종 추천의 순수 로직(프롬프트, 응답 검증, 오류 매핑). Edge Function과 테스트가 함께 씁니다.

export interface TaxonLite {
  id: string;
  korean_name: string;
  scientific_name: string;
  category: string;
}
export interface Candidate {
  taxonId: string;
  koreanName: string;
  confidence: number;
}
export interface IdentifyResult {
  candidates: Candidate[];
  noMatch: boolean;
}

export const MAX_BASE64_CHARS = 1_500_000;
export const DEFAULT_MODEL = 'gpt-5.4-mini';
export const MAX_CANDIDATES = 3;

export function buildInstruction(taxa: TaxonLite[]): string {
  return [
    '공원에서 찍은 사진이다. 아래 목록에 있는 종 중에서만 가장 가능성 높은 순서로 최대 3개를 고르고 각각 0~1 확신도를 줘.',
    '사진에 목록의 생물이 없거나 알아볼 수 없으면 noMatch를 true로 해.',
    '',
    ...taxa.map((t) => `${t.id}: ${t.korean_name} / ${t.scientific_name}`),
  ].join('\n');
}

/** Responses API 요청 본문(구조화 출력, taxonId는 목록의 id로 제한) */
export function buildRequest(model: string, taxa: TaxonLite[], imageBase64: string, mime: string) {
  return {
    model,
    store: false,
    reasoning: { effort: 'low' },
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: buildInstruction(taxa) },
          { type: 'input_image', image_url: `data:${mime};base64,${imageBase64}`, detail: 'high' },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'species_candidates',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['candidates', 'noMatch'],
          properties: {
            noMatch: { type: 'boolean' },
            candidates: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['taxonId', 'confidence'],
                properties: {
                  taxonId: { type: 'string', enum: taxa.map((t) => t.id) },
                  confidence: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  };
}

/** OpenAI 응답에서 출력 글을 꺼냅니다. 거절·미완료면 null. */
function outputText(res: any): string | null {
  if (res?.status && res.status !== 'completed') return null;
  for (const item of res?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content ?? []) if (c?.type === 'output_text' && typeof c.text === 'string') return c.text;
  }
  return null;
}

/** 응답을 검증합니다: 목록에 없는 종·중복은 버리고, 확신도는 0~1로 맞춰 최대 3개만. 형식이 틀리면 null. */
export function parseResult(res: unknown, taxa: TaxonLite[]): IdentifyResult | null {
  const text = outputText(res);
  if (!text) return null;
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.candidates)) return null;
  const byId = new Map(taxa.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const c of data.candidates) {
    const t = typeof c?.taxonId === 'string' ? byId.get(c.taxonId) : undefined;
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    const conf = Number(c.confidence);
    candidates.push({ taxonId: t.id, koreanName: t.korean_name, confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0 });
    if (candidates.length === MAX_CANDIDATES) break;
  }
  return { candidates, noMatch: data.noMatch === true || candidates.length === 0 };
}

/** consume_identify_quota 오류 → HTTP 상태와 일반 메시지 */
export function mapQuotaError(message: string): { status: number; error: string } {
  if (/consent_required/.test(message)) return { status: 403, error: 'consent_required' };
  if (/rate_limited|daily_limit|global_limit/.test(message)) return { status: 429, error: (message.match(/rate_limited|daily_limit|global_limit/) as RegExpMatchArray)[0] };
  if (/not_authenticated/.test(message)) return { status: 401, error: 'unauthorized' };
  return { status: 500, error: 'server_error' };
}

/** 입력 검증. 문제가 있으면 상태와 오류 이름을 돌려줍니다. */
export function checkInput(body: any): { status: number; error: string } | null {
  if (!body || typeof body.imageBase64 !== 'string' || body.mime !== 'image/jpeg') return { status: 400, error: 'bad_request' };
  if (body.imageBase64.length > MAX_BASE64_CHARS) return { status: 413, error: 'too_large' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.imageBase64.slice(0, 1000))) return { status: 400, error: 'bad_request' };
  return null;
}
