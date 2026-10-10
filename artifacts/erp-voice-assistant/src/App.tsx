import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Shell } from '@/components/shell';
import Home from '@/pages/home';
import User from '@/pages/user';
import AdminSettings from '@/pages/admin-settings';
import Conference from '@/pages/conference';
import Logs from '@/pages/logs';
import Knowledge from '@/pages/knowledge';
import NotFound from '@/pages/not-found';
import {
  Redirect,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Admin() {
  const [loc] = useLocation();
  return (
    <Shell><RoutedErrorBoundary>
      {loc === '/admin/conferencia' ? <Conference /> : loc === '/admin/logs' ? <Logs /> : loc === '/admin/conhecimento' ? <Knowledge /> : <AdminSettings />}
    </RoutedErrorBoundary></Shell>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/usuario"><RoutedErrorBoundary><User /></RoutedErrorBoundary></Route>
      <Route path="/admin" component={Admin} />
      <Route path="/admin/conferencia" component={Admin} />
      <Route path="/admin/logs" component={Admin} />
      <Route path="/admin/conhecimento" component={Admin} />
      <Route path="/conferencia"><Redirect to="/admin/conferencia" /></Route>
      <Route path="/logs"><Redirect to="/admin/logs" /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
