// The footer every view shares.
export default function Footer({ children }) {
  return (
    <footer className="lb-foot">
      <p>LaunchBoard. Read-only: it never loads, unloads or starts a job. MIT, Compound Labs.</p>
      {children}
    </footer>
  );
}
