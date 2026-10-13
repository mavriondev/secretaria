import { type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import Dados from '@/pages/dados';
import Avaliacoes from '@/pages/avaliacoes';
import NotFound from '@/pages/not-found';
import Platform from '@/pages/platform';
import Users from '@/pages/users';
import { ChangePassword, Login } from '@/pages/login';
import { ME_KEY, useMe, type Me } from '@/lib/auth-client';
import {
  Redirect,
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

// A request answered with 401 means the session ended (expired, password reset, user disabled): go back to the login screen.
const sessionEnded = (error: unknown) => {
  if ((error as { status?: number } | null)?.status === 401 && queryClient.getQueryData(ME_KEY)) queryClient.setQueryData(ME_KEY, null);
};
const queryClient: QueryClient = new QueryClient({ queryCache: new QueryCache({ onError: sessionEnded }), mutationCache: new MutationCache({ onError: sessionEnded }) });

function Admin() {
  const [loc] = useLocation();
  return (
    <Shell><RoutedErrorBoundary>
      {loc === '/admin/conferencia' ? <Conference /> : loc === '/admin/logs' ? <Logs /> : loc === '/admin/avaliacoes' ? <Avaliacoes /> : loc === '/admin/dados' ? <Dados /> : loc === '/admin/conhecimento' ? <Knowledge /> : loc === '/admin/usuarios' ? <Users /> : <AdminSettings />}
    </RoutedErrorBoundary></Shell>
  );
}

function Router({ me }: { me: Me }) {
  // Each profile gets its own set of routes; anything else sends the person back to where they belong.
  if (me.papel === 'dono') {
    return (
      <Switch>
        <Route path="/plataforma"><Shell><RoutedErrorBoundary><Platform /></RoutedErrorBoundary></Shell></Route>
        <Route><Redirect to="/plataforma" /></Route>
      </Switch>
    );
  }
  if (me.papel === 'gestor') {
    return (
      <Switch>
        <Route path="/usuario"><RoutedErrorBoundary><User /></RoutedErrorBoundary></Route>
        <Route><Redirect to="/usuario" /></Route>
      </Switch>
    );
  }
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/usuario"><RoutedErrorBoundary><User /></RoutedErrorBoundary></Route>
      <Route path="/admin" component={Admin} />
      <Route path="/admin/usuarios" component={Admin} />
      <Route path="/admin/conferencia" component={Admin} />
      <Route path="/admin/logs" component={Admin} />
      <Route path="/admin/conhecimento" component={Admin} />
      <Route path="/admin/dados" component={Admin} />
      <Route path="/admin/avaliacoes" component={Admin} />
      <Route path="/conferencia"><Redirect to="/admin/conferencia" /></Route>
      <Route path="/logs"><Redirect to="/admin/logs" /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function Gate() {
  const me = useMe();
  if (me.isLoading) return <div className="min-h-[100dvh] grid place-items-center text-sm text-muted-foreground">Carregando…</div>;
  if (me.isError) return <div className="min-h-[100dvh] grid place-items-center text-sm">Não foi possível conectar ao servidor. <button className="underline ml-1" onClick={() => me.refetch()}>Tentar novamente</button></div>;
  if (!me.data) return <Login />;
  if (me.data.trocarSenha) return <ChangePassword me={me.data} />;
  return <Router me={me.data} />;
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
          <Gate />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
