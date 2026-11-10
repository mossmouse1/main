import { ID_STATUS_LABEL, type IdStatus } from '../data/types';
import { Icon } from './Icon';

/** 색만으로 구분하지 않게 아이콘과 글자를 같이 씁니다. */
export function SyncBadge({ sync }: { sync: 'pending' | 'sent' }) {
  return sync === 'sent' ? (
    <span className="badge badge--ok">
      <Icon name="check" size={16} /> 전송됨
    </span>
  ) : (
    <span className="badge badge--wait">
      <Icon name="clock" size={16} /> 대기 중
    </span>
  );
}

export function IdStatusBadge({ status }: { status: IdStatus }) {
  const icon = status === 'reviewed' ? 'shield' : status === 'unidentified' ? 'question' : status === 'undeterminable' ? 'close' : 'flag';
  return (
    <span className={`badge badge--id-${status}`}>
      <Icon name={icon} size={16} /> {ID_STATUS_LABEL[status]}
    </span>
  );
}
