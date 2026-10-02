import { STATE } from '../lib/words';

export default function Pill({ state, children }) {
  return (
    <span className="pill" data-s={state}>
      <i aria-hidden="true" />
      {children ?? STATE[state] ?? state}
    </span>
  );
}
