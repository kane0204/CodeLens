import { useApp } from './state/AppState';
import { UploadView } from './components/UploadView';
import { Topbar } from './components/Topbar';
import { ConfirmReimportDialog, SourceDialog, Toasts } from './components/GlobalDialogs';
import { SettingsDialog } from './components/SettingsDialog';
import { OverviewView } from './views/OverviewView';
import { StructureView } from './views/StructureView';
import { LogicView } from './views/LogicView';
import { MetricsView } from './views/MetricsView';
import { SolidView } from './views/SolidView';
import { RisksView } from './views/RisksView';

function WorkspaceView() {
  const { route } = useApp();
  switch (route) {
    case 'structure':
      return <StructureView />;
    case 'logic':
      return <LogicView />;
    case 'metrics':
      return <MetricsView />;
    case 'solid':
      return <SolidView />;
    case 'risks':
      return <RisksView />;
    default:
      return <OverviewView />;
  }
}

export default function App() {
  const { importing, result } = useApp();
  const showUpload = importing || !result;

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded focus:border focus:border-line focus:bg-card focus:px-3 focus:py-2 focus:text-[12px] focus:text-primary"
      >
        跳到主内容
      </a>
      {showUpload ? (
        <main id="main" className="min-h-0 flex-1">
          <UploadView />
        </main>
      ) : (
        <>
          <Topbar />
          <main id="main" className="scroll-thin min-h-0 flex-1 overflow-auto p-3 lg:overflow-hidden">
            <div className="h-full min-h-[620px] lg:min-h-0">
              <WorkspaceView />
            </div>
          </main>
        </>
      )}
      <SettingsDialog />
      <SourceDialog />
      <ConfirmReimportDialog />
      <Toasts />
    </div>
  );
}
