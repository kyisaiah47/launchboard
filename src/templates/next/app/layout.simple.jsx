import Footer from '../components/Footer';
import './globals.css';
import './simple.css';

export const metadata = { title: 'LaunchBoard', description: 'Every scheduled job on this Mac: what is running, what failed, what ran today.' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-view="simple">
      <body>
        {children}
        <Footer />
      </body>
    </html>
  );
}
