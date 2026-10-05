import Footer from '../components/Footer';
import SiteViewProvider from '../components/site-view/SiteViewProvider';
import './globals.css';
import './simple.css';

export const metadata = { title: 'LaunchBoard', description: 'Every scheduled job on this Mac: what is running, what failed, what ran today.' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <SiteViewProvider>
          {children}
          <Footer />
        </SiteViewProvider>
      </body>
    </html>
  );
}
