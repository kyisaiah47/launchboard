import Footer from '../components/Footer';
import './globals.css';

export const metadata = { title: 'LaunchBoard', description: 'Every scheduled job on this Mac: what is running, what failed, what ran today.' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Footer />
      </body>
    </html>
  );
}
