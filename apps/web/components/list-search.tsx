import { Icon } from './icon';

/** Server-side search: plain GET form, so results stay linkable and work without JavaScript. */
export function ListSearch({
  action,
  label,
  value,
}: {
  action: string;
  label: string;
  value: string;
}) {
  return (
    <form className="list-search" role="search" action={action}>
      <label htmlFor="search" className="sr-only">
        {label}
      </label>
      <Icon name="search" size={16} aria-hidden="true" />
      <input
        id="search"
        name="search"
        type="search"
        className="field"
        placeholder={label}
        defaultValue={value}
      />
      <button type="submit" className="btn btn-secondary">
        Cari
      </button>
    </form>
  );
}
