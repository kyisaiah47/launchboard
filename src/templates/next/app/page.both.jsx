import ConsoleBoard from '../components/ConsoleBoard';
import SimpleBoard from '../components/SimpleBoard';
import PageViews from '../components/site-view/PageViews';
import ViewControls from '../components/site-view/ViewControls';

export default function Home() {
  return <PageViews consoleView={<ConsoleBoard viewToggle={<ViewControls />} />} simpleView={<SimpleBoard viewToggle={<ViewControls />} />} />;
}
