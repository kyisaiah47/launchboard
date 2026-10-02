import ConsoleBoard from '../components/ConsoleBoard';
import SimpleBoard from '../components/SimpleBoard';
import PageViews from '../components/site-view/PageViews';

export default function Home() {
  return <PageViews consoleView={<ConsoleBoard />} simpleView={<SimpleBoard />} />;
}
