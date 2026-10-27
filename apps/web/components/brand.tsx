import { Icon } from './icon';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark"><Icon name="building" size={22} /></span>
      <span className="brand-text">
        <span className="brand-name">LaporanProyek</span>
        <span className="brand-sub">Ruang kerja konstruksi</span>
      </span>
    </span>
  );
}
