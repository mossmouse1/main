import type { IsoSpec } from '../lib/iso';

export type Category = 'waterbird' | 'townbird' | 'tree' | 'other';

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface Zone {
  id: string;
  name: string;
  /** 지도 위에 쓰는 쉬운 이름(없으면 name) */
  mapLabel?: string;
  places: string;
  mapBasis: string;
  lookFor: string;
  leave: string;
  description: string;
  /** [lat, lng] */
  center: [number, number];
  geometry: Geometry;
  placeholder?: boolean;
}

export interface Facility {
  name: string;
  lat: number;
  lng: number;
  kind?: 'water' | 'place' | 'peak' | 'island';
  placeholder?: boolean;
}

export interface Photo {
  src: string;
  credit: string;
  license: string;
  sourceUrl?: string;
}

export interface Biotope {
  code: string;
  name: string;
  year: number;
  source: string;
  geometry: Geometry;
  placeholder?: boolean;
}

export interface Taxon {
  id: string;
  koreanName: string;
  scientificName: string;
  category: Category;
  confusableIds: string[];
  confusableStatus: 'confirmed' | 'draft';
  clue: { zoneIds: string[]; where: string; looks: string[] };
  /** 1~12월 공개 기록 수. 자료 연결 전에는 null */
  monthCounts: number[] | null;
  recordCount?: number;
  photo: Photo | null;
  photos?: Photo[];
  /** 지도 핀: 공개 기록이 가장 많이 모인 곳(없으면 단서 구역 중심) */
  pin?: { lat: number; lng: number; basis: 'records' | 'clue-zone'; records: number } | null;
  /**
   * 지도 관찰 지점 [lat, lng, 공개 기록 수]. 기록 좌표를 가장 가까운 산책로 위로 옮긴 자리입니다.
   * 기록 수 0 = 정밀 기록이 없어 단서 구역 산책로에 둔 ‘찾아볼 곳’(scripts/build-sightings.mjs).
   */
  sightings?: [number, number, number][];
  /** 정원 식재수처럼 심은 것일 가능성이 큰 종 */
  cultivated: boolean;
  /** 후보·검색용으로만 쓰는 종(세트에 들지 않음) */
  minor: boolean;
  /** 공원 주변 공개 기록 목록에서 온 종(‘목록에 없어요’ 검색용) */
  catalog?: boolean;
}

export interface SeasonSet {
  id: string;
  season: string;
  label: string;
  startsOn: string;
  endsOn: string;
  draft?: boolean;
  todaySix: string[];
  dex: string[];
  recordCounts: Record<string, number>;
  recordCountsBasis: string;
}

export interface Content {
  version: number;
  updatedAt: string;
  park: { name: string; bounds: Bounds; biotopeQueryBounds: Bounds };
  /**
   * image: 위에서 본 지도(생물 위치 고르기·검토용). focus: 처음 화면 가운데(호수 중심) [lat, lng].
   * iso: 지도 홈의 쿼터뷰 블록 지도와 좌표 변환 값(scripts/build-iso.mjs).
   */
  map: { image: string; width: number; height: number; placeholder?: boolean; attribution?: string; focus?: [number, number]; rev?: string; iso?: IsoSpec };
  monthCounts: { basis: string; source: string; fetchedAt?: string };
  placeholders: string[];
  zones: Zone[];
  facilities: Facility[];
  biotopes: Biotope[];
  taxa: Taxon[];
  seasonSets: SeasonSet[];
}

export const CATEGORY_LABEL: Record<Category, string> = {
  waterbird: '물새',
  townbird: '숲·동네 새',
  tree: '나무·열매',
  other: '다른 생물',
};
