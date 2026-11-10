import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { AlertCircle, Clapperboard, Moon, Stethoscope, Eye, EyeOff, Lock, LogOut, Mail, Monitor, MonitorPlay, RotateCcw, ShieldCheck, Store, X } from 'lucide-react';
import { sbAuth } from './lib/supabase';
import { useFleetData, useNow } from './lib/data';
import { isOnline } from './lib/media';
import type { GroupMode } from './lib/types';
import Broadcast from './components/Broadcast';
import Screens from './components/Screens';
import Videos from './components/Videos';
import Maintenance from './components/Maintenance';
import { diagnose } from './lib/diagnostics';
import Splash from './components/Splash';
import KroustyLogo from './components/KroustyLogo';
import { Button, FeedbackProvider, IconButton, Input, cn, useFeedback } from './components/ui';

export type { AppScreen } from './lib/types';

type Tab = 'accueil' | 'appareils' | 'bibliotheque' | 'maintenance';

const SPLASH_MIN_MS = 3300;
const SPLASH_FADE_MS = 550;
const TAB_STORAGE_KEY = 'krousty.tab';

export default function App() {
  return (
    <FeedbackProvider>
      <Root />
    </FeedbackProvider>
  );
}

function Root() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [minSplashDone, setMinSplashDone] = useState(false);
  const [splashPhase, setSplashPhase] = useState<'visible' | 'leaving' | 'gone'>('visible');

  // Session utilisateur
  useEffect(() => {
    sbAuth.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data } = sbAuth.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Splash : durée minimale pour laisser l'animation se jouer, puis fondu.
  useEffect(() => {
    const t = setTimeout(() => setMinSplashDone(true), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (splashPhase === 'visible' && minSplashDone && !authLoading) setSplashPhase('leaving');
  }, [minSplashDone, authLoading, splashPhase]);

  useEffect(() => {
    if (splashPhase !== 'leaving') return;
    const t = setTimeout(() => setSplashPhase('gone'), SPLASH_FADE_MS);
    return () => clearTimeout(t);
  }, [splashPhase]);

  return (
    <>
      {!authLoading && (currentUser ? <Main key={currentUser.id} user={currentUser} /> : <Login onLogged={setCurrentUser} />)}
      {splashPhase !== 'gone' && <Splash leaving={splashPhase === 'leaving'} />}
    </>
  );
}

/* ================================ CONNEXION ================================ */

function Login({ onLogged }: { onLogged: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data, error } = await sbAuth.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Identifiants incorrects' : error.message);
    } else if (data.user) {
      onLogged(data.user);
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm overflow-hidden rounded-[32px] border border-sand bg-white shadow-lift animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="relative bg-brand-logo px-8 pb-9 pt-8">
          <KroustyLogo className="mx-auto w-full max-w-[230px]" />
          <Wave className="absolute inset-x-0 -bottom-px h-4 w-full" fill="#ffffff" />
        </div>

        <form onSubmit={handleLogin} className="space-y-4 px-7 pb-8 pt-5">
          <div>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              aria-label="Email"
              leading={<Mail className="h-4.5 w-4.5" />}
            />
          </div>

          <div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mot de passe"
                aria-label="Mot de passe"
                className="pr-12"
                leading={<Lock className="h-4.5 w-4.5" />}
              />
              <IconButton
                label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                size="sm"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => setShowPassword(v => !v)}
              >
                {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
              </IconButton>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 animate-in fade-in" role="alert">
              <AlertCircle className="h-4.5 w-4.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" size="lg" block loading={loading} className="mt-2">
            Connexion
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ============================== APPLICATION ============================== */

export function Main({ user }: { user: User }) {
  const { confirm } = useFeedback();
  const fleet = useFleetData(user);
  const now = useNow(15000);

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem(TAB_STORAGE_KEY);
      if (saved === 'accueil' || saved === 'appareils' || saved === 'bibliotheque' || saved === 'maintenance') return saved;
    } catch {
      /* stockage indisponible */
    }
    return 'appareils';
  });

  // État conservé entre les onglets (saisies du module de diffusion).
  const [attributionInputs, setAttributionInputs] = useState<Record<string, string>>({});
  const [groupModes, setGroupModes] = useState<Record<string, GroupMode>>({});
  const [playingVideoSrc, setPlayingVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {
      /* stockage indisponible */
    }
    window.scrollTo({ top: 0 });
  }, [activeTab]);

  const totalScreens = fleet.screens.length;
  // Pastille rouge sur l'onglet Maintenance quand un problème critique est détecté (hors test des vidéos).
  const criticalCount = fleet.isSuperAdmin
    ? diagnose({ screens: fleet.screens, configurations: fleet.configurations, groups: fleet.groups, videos: [], media: {}, now }).filter(i => i.severity === 'critical').length
    : 0;
  // Un compte non admin ne doit jamais rester sur l'onglet Maintenance.
  const tab: Tab = activeTab === 'maintenance' && !fleet.isSuperAdmin ? 'appareils' : activeTab;
  const onlineScreens = fleet.screens.filter(s => isOnline(s.last_ping, now) && s.power_state !== 'sleep').length;
  const sleepingScreens = fleet.screens.filter(s => isOnline(s.last_ping, now) && s.power_state === 'sleep').length;

  const handleLogout = async () => {
    const ok = await confirm({ title: 'Se déconnecter ?', confirmLabel: 'Déconnexion' });
    if (ok) await sbAuth.auth.signOut();
  };

  const hardRefresh = async () => {
    const ok = await confirm({
      title: "Réinitialiser l'application ?",
      confirmLabel: 'Réinitialiser',
    });
    if (!ok) return;
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] flex-col">
      <header className="relative z-10 flex-shrink-0 bg-brand-logo px-5 pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="relative mx-auto flex max-w-xl flex-col items-center">
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Se déconnecter"
            title="Se déconnecter"
            className="absolute right-0 top-1 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/15 text-white transition hover:bg-black/25 active:scale-95"
          >
            <LogOut className="h-4.5 w-4.5" />
          </button>

          <KroustyLogo className="w-[170px] md:w-[210px]" />

          <div className="mt-2 inline-flex items-center gap-3 rounded-full bg-black/15 px-3.5 py-1.5 text-sm font-bold tabular-nums text-white">
            <span className="inline-flex items-center gap-1.5" title="En ligne">
              <span className={cn('h-2 w-2 rounded-full', onlineScreens > 0 ? 'bg-emerald-300 pulse-online' : 'bg-white/50')} />
              {onlineScreens}
            </span>
            {sleepingScreens > 0 && (
              <span className="inline-flex items-center gap-1.5 text-white/85" title="En veille">
                <Moon className="h-3.5 w-3.5" />
                {sleepingScreens}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-white/75" title="Écrans">
              <Monitor className="h-4 w-4" />
              {totalScreens}
            </span>
            {fleet.isSuperAdmin && <ShieldCheck className="h-4 w-4 text-white/90" aria-label="Admin" />}
          </div>
        </div>

        <Wave className="pointer-events-none absolute inset-x-0 bottom-0 h-4 w-full translate-y-[99%]" />
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-36 pt-8 md:max-w-4xl xl:max-w-6xl">
        <div key={activeTab} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {tab === 'accueil' && (
            <Broadcast
              groups={fleet.groups}
              configurations={fleet.configurations}
              screens={fleet.screens}
              isSuperAdmin={fleet.isSuperAdmin}
              loading={fleet.loading}
              onSaved={fleet.refresh}
              attributionInputs={attributionInputs}
              setAttributionInputs={setAttributionInputs}
              groupModes={groupModes}
              setGroupModes={setGroupModes}
            />
          )}

          {tab === 'appareils' && (
            <Screens
              groups={fleet.groups}
              configurations={fleet.configurations}
              screens={fleet.screens}
              isSuperAdmin={fleet.isSuperAdmin}
              loading={fleet.loading}
              onChanged={fleet.refresh}
              now={now}
            />
          )}

          {tab === 'bibliotheque' && <Videos isSuperAdmin={fleet.isSuperAdmin} onPlayVideo={setPlayingVideoSrc} screens={fleet.screens} configurations={fleet.configurations} groups={fleet.groups} />}

          {tab === 'maintenance' && (
            <Maintenance groups={fleet.groups} configurations={fleet.configurations} screens={fleet.screens} onChanged={fleet.refresh} />
          )}
        </div>

        <footer className="pt-10 text-center">
          <button
            type="button"
            onClick={hardRefresh}
            aria-label="Réinitialiser l'application"
            title="Réinitialiser l'application"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted/50 transition hover:bg-sand hover:text-muted"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </footer>
      </main>

      <nav
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-around gap-1 rounded-full border border-line bg-white/90 p-1.5 shadow-lift backdrop-blur-xl"
        aria-label="Navigation principale"
      >
        <NavButton active={tab === 'accueil'} onClick={() => setActiveTab('accueil')} icon={<Store className="h-5 w-5" />} label="Accueil" />
        <NavButton active={tab === 'appareils'} onClick={() => setActiveTab('appareils')} icon={<MonitorPlay className="h-5 w-5" />} label="Écrans" />
        <NavButton active={tab === 'bibliotheque'} onClick={() => setActiveTab('bibliotheque')} icon={<Clapperboard className="h-5 w-5" />} label="Vidéos" />
        {fleet.isSuperAdmin && (
          <NavButton
            active={tab === 'maintenance'}
            onClick={() => setActiveTab('maintenance')}
            icon={<Stethoscope className="h-5 w-5" />}
            label="Maintenance"
            alert={criticalCount > 0}
          />
        )}
      </nav>

      {playingVideoSrc && <VideoPlayer src={playingVideoSrc} onClose={() => setPlayingVideoSrc(null)} />}
    </div>
  );
}

function NavButton({ active, onClick, icon, label, alert }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; alert?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-2 transition-all duration-200 active:scale-95',
        active ? 'bg-brand text-white shadow-brand' : 'text-muted hover:bg-sand hover:text-ink',
      )}
    >
      <span className="relative">
        {icon}
        {alert && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" aria-label="Problèmes critiques" />}
      </span>
      <span className="max-w-full truncate px-1 text-[11px] font-extrabold tracking-wide">{label}</span>
    </button>
  );
}

function VideoPlayer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/95 p-4 backdrop-blur-md animate-in fade-in duration-200" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 inline-flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20 active:scale-95"
      >
        <X className="h-4.5 w-4.5" />
        Fermer
      </button>
      <video className="max-h-[85dvh] w-full max-w-5xl rounded-2xl object-contain shadow-2xl outline-none" src={src} controls autoPlay playsInline />
    </div>
  );
}

function Wave({ className, fill }: { className?: string; fill?: string }) {
  return (
    <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className={className} aria-hidden>
      {fill ? (
        <path d="M0,120 L0,60 C300,0 900,120 1200,50 L1200,120 Z" fill={fill} />
      ) : (
        <>
          <polygon points="0,0 1200,0 1200,95 0,120" fill="#b74b1b" />
          <polygon points="0,0 1200,0 1200,75 0,105" fill="#f97933" />
        </>
      )}
    </svg>
  );
}
