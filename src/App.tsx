import React, { useState, useEffect, useRef } from 'react';
import { sbClient } from './lib/supabase';
import Broadcast from './components/Broadcast';
import Screens from './components/Screens';
import Videos from './components/Videos';

interface Screen {
  id: string;
  group_id: string | null;
  last_ping: string | null;
  pos_x: number;
  pos_y: number;
  video_url: string | null;
  audio_url: string | null; 
}

interface Group {
  id: string;
  name: string;
  format: string;
  image_url: string | null; 
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'accueil' | 'appareils' | 'bibliotheque'>('appareils');
  const [availableScreens, setAvailableScreens] = useState<Screen[]>([]);
  const [availableGroups, setAvailableGroups] = useState<Group[]>([]);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  // Shared state for URLs and Modes to avoid loss when toggling tabs
  const [attributionInputs, setAttributionInputs] = useState<Record<string, string>>({});
  const [groupModes, setGroupModes] = useState<Record<string, 'global' | 'per-screen'>>({});

  // Fullscreen video playback state
  const [playingFile, setPlayingFile] = useState<any | null>(null);
  const [playingVideoSrc, setPlayingVideoSrc] = useState<string>('');
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const downloadCancelRef = useRef<boolean>(false);

  const now = new Date().getTime();

  // Stats calculation
  const totalScreens = availableScreens.length;
  const onlineScreens = availableScreens.filter(s => {
    if (!s.last_ping) return false;
    return (now - new Date(s.last_ping).getTime()) / 1000 < 45;
  }).length;

  const unassignedCount = availableScreens.filter(s => !s.group_id).length;

  // Realtime subscription setup
  useEffect(() => {
    let screensChannel: any;
    let groupsChannel: any;

    const initData = async () => {
      const { data: g } = await sbClient.from('groups').select('*');
      const { data: s } = await sbClient.from('screens_config').select('*');
      
      setAvailableGroups(g || []);
      setAvailableScreens(s || []);

      if (g) {
        const folders: Record<string, boolean> = {};
        g.forEach(group => {
          folders[group.name] = false;
        });
        setOpenFolders(folders);
      }
    };

    initData();

    // Setup real-time listeners
    screensChannel = sbClient.channel('screens_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screens_config' }, (payload) => {
        const { eventType, new: n, old: o } = payload;
        if (eventType === 'DELETE') {
          setAvailableScreens(prev => prev.filter(s => s.id !== o.id));
        } else if (eventType === 'INSERT') {
          setAvailableScreens(prev => [...prev, n as Screen]);
        } else {
          setAvailableScreens(prev => {
            const idx = prev.findIndex(s => s.id === n.id);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = n as Screen;
              return updated;
            }
            return prev;
          });
        }
      })
      .subscribe();

    groupsChannel = sbClient.channel('groups_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, (payload) => {
        const { eventType, new: n, old: o } = payload;
        if (eventType === 'DELETE') {
          setAvailableGroups(prev => prev.filter(g => g.id !== o.id));
        } else if (eventType === 'INSERT') {
          setAvailableGroups(prev => [...prev, n as Group]);
          setOpenFolders(prev => ({ ...prev, [(n as Group).name]: false }));
        } else {
          setAvailableGroups(prev => {
            const idx = prev.findIndex(g => g.id === n.id);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = n as Group;
              return updated;
            }
            return prev;
          });
        }
      })
      .subscribe();

    return () => {
      if (screensChannel) sbClient.removeChannel(screensChannel);
      if (groupsChannel) sbClient.removeChannel(groupsChannel);
    };
  }, []);

  const handlePlayVideo = (megaUrl: string) => {
    setPlayingFile(true);
    setPlayingVideoSrc(megaUrl);
    setPlaybackLoading(false);
  };

  const handleCloseVideo = () => {
    downloadCancelRef.current = true;
    if (playingVideoSrc && playingVideoSrc.startsWith('blob:')) {
      URL.revokeObjectURL(playingVideoSrc);
    }
    setPlayingFile(null);
    setPlayingVideoSrc('');
    setPlaybackLoading(false);
  };

  const hardRefresh = () => {
    if ('caches' in window) {
      caches.keys().then(keys => {
        Promise.all(keys.map(key => caches.delete(key))).then(() => {
          (window as Window).location.reload();
        });
      });
    } else {
      (window as Window).location.reload();
    }
  };

  return (
    /* CORRECTIF DE STRUCTURE : Passage en flex flex-col pour maîtriser parfaitement l'étirement du fond crème */
    <div className="min-h-screen bg-[#faf6f0] text-[#b74b1b] antialiased pb-20 relative flex flex-col">
      
      {/* Header Bandeau Full-Width */}
      <header className="w-full bg-[#ff751f] pt-4.5 pb-5 px-6 flex-shrink-0 relative">
        <div className="max-w-xl mx-auto flex flex-col items-center relative z-10">
          <img src="/logo.png" className="h-16 md:h-20 object-contain" alt="Krousty Control" />
          <p id="globalStatus" className="text-[10px] font-black text-white/90 mt-1.5 flex items-center gap-1.5 uppercase tracking-widest">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 pulse-green"></span>
            {onlineScreens} connecté(s) • {totalScreens} au total
          </p>
        </div>

        {/* Transition géométrique oblique assortie au logo (Double biseau orange et rouille) */}
        <div className="absolute bottom-0 left-0 w-full overflow-hidden leading-[0] translate-y-[99%] z-10 pointer-events-none">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="relative block w-full h-[16px]">
            {/* Polygone Rouille (Arrière-plan) */}
            <polygon points="0,0 1200,0 1200,95 0,120" fill="#b74b1b" />
            {/* Polygone Orange (Premier plan) */}
            <polygon points="0,0 1200,0 1200,75 0,105" fill="#ff751f" />
          </svg>
        </div>
      </header>

      {/* CORRECTIF NETTOYAGE : pb-24 unique ici, ce qui élimine tout l'espace mort inutile en fin de page */}
      <main className="flex-1 max-w-xl w-full mx-auto px-4 pt-6 pb-24 space-y-6">

        {/* Content Render based on active Route */}
        <div className="transition-all duration-300 ease-in-out">
          {activeTab === 'accueil' && (
            <Broadcast
              availableScreens={availableScreens}
              availableGroups={availableGroups}
              sbClient={sbClient}
              attributionInputs={attributionInputs}
              setAttributionInputs={setAttributionInputs}
              groupModes={groupModes}
              setGroupModes={setGroupModes}
            />
          )}

          {activeTab === 'appareils' && (
            <Screens
              availableScreens={availableScreens}
              availableGroups={availableGroups}
              sbClient={sbClient}
              openFolders={openFolders}
              setOpenFolders={setOpenFolders}
            />
          )}

          {activeTab === 'bibliotheque' && (
            <Videos onPlayVideo={handlePlayVideo} />
          )}
        </div>

        {/* Footer Nettoyé de ses paddings doublons */}
        <footer className="pt-6 opacity-30 text-center">
          <button
            onClick={hardRefresh}
            className="w-full text-center text-[10px] font-bold text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-widest"
          >
            Réinitialiser l'application
          </button>
        </footer>
      </main>

      {/* Navigation Capsule flottante premium */}
      <nav className="fixed bottom-5 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-white/90 backdrop-blur-2xl border border-[#e3dad0] flex justify-around items-center py-2.5 px-3 z-40 shadow-2xl rounded-full shadow-[#b74b1b]/10">
        <button
          onClick={() => setActiveTab('accueil')}
          className={`flex flex-col items-center gap-1 transition-all py-1.5 px-4 rounded-full ${
            activeTab === 'accueil' 
              ? 'text-[#ff751f] font-extrabold bg-[#ff751f]/10 border border-[#ff751f]/20 shadow-lg shadow-[#ff751f]/5' 
              : 'text-[#7c6258] hover:text-[#ff751f]'
          }`}
        >
          <svg className="w-4.5 h-4.5" viewBox="0 0 236 176" fill="currentColor">
            <g transform="translate(0.000000,176.000000) scale(0.100000,-0.100000)" stroke="none">
              <path d="M122 1638 c-16 -16 -16 -110 0 -126 17 -17 2119 -17 2136 0 16 16 16 110 0 126 -17 17 -2119 17 -2136 0z"/>
              <path d="M383 1423 l-173 -3 0 -625 0 -625 -65 0 -65 0 0 -70 0 -70 1105 0 1106 0 -3 68 -3 67 -62 3 -63 3 0 629 0 630 -802 -2 c-442 -1 -881 -4 -975 -5z m787 -938 l0 -305 -215 0 -215 0 0 305 0 305 215 0 215 0 0 -305z m460 0 l0 -305 -205 0 -205 0 0 305 0 305 205 0 205 0 0 -305z"/>
              <path d="M1090 540 c0 -29 4 -40 15 -40 11 0 15 11 15 40 0 29 -4 40 -15 40 -11 0 -15 -11 -15 -40z"/>
              <path d="M1270 540 c0 -29 4 -40 15 -40 11 0 15 11 15 40 0 29 -4 40 -15 40 -11 0 -15 -11 -15 -40z"/>
            </g>
          </svg>
          <span className="text-[9px] font-extrabold tracking-wider uppercase">Accueil</span>
        </button>
        
        <button
          onClick={() => setActiveTab('appareils')}
          className={`flex flex-col items-center gap-1 transition-all py-1.5 px-4 rounded-full ${
            activeTab === 'appareils' 
              ? 'text-[#ff751f] font-extrabold bg-[#ff751f]/10 border border-[#ff751f]/20 shadow-lg shadow-[#ff751f]/5' 
              : 'text-[#7c6258] hover:text-[#ff751f]'
          }`}
        >
          <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none">
            <path d="M21 3H3C1.9 3 1 3.9 1 5V17C1 18.1 1.9 19 3 19H8V21H16V19H21C22.1 19 22.99 18.1 22.99 17L23 5C23 3.9 22.1 3 21 3ZM21 17H3V5H21V17Z" fill="currentColor"></path>
          </svg>
          <span className="text-[9px] font-extrabold tracking-wider uppercase">Écrans</span>
        </button>
        
        <button
          onClick={() => setActiveTab('bibliotheque')}
          className={`flex flex-col items-center gap-1 transition-all py-1.5 px-4 rounded-full ${
            activeTab === 'bibliotheque' 
              ? 'text-[#ff751f] font-extrabold bg-[#ff751f]/10 border border-[#ff751f]/20 shadow-lg shadow-[#ff751f]/5' 
              : 'text-[#7c6258] hover:text-[#ff751f]'
          }`}
        >
          <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none">
            <path d="M22 16V4C22 2.9 21.1 2 20 2H8C6.9 2 6 2.9 6 4V16C6 17.1 6.9 18 8 18H20C21.1 18 22 17.1 22 16ZM11 12L13.03 14.71L16 11L20 16H8L11 12ZM3 6C2.44772 6 2 6.44772 2 7V20C2 21.1 2.9 22 4 22H17C17.5523 22 18 21.5523 18 21V21C18 20.4477 17.5523 20 17 20H4V7C4 6.44772 3.55228 6 3 6V6Z" fill="currentColor"></path>
          </svg>
          <span className="text-[9px] font-extrabold tracking-wider uppercase">Vidéos</span>
        </button>
      </nav>

      {/* Lecteur Vidéo Plein Écran Modal */}
      {playingFile && (
        <div id="videoFullscreenModal" className="fixed inset-0 bg-black/95 backdrop-blur-md z-50 flex flex-col items-center justify-center p-4">
          <button
            onClick={handleCloseVideo}
            className="absolute top-6 right-6 z-50 bg-white/5 hover:bg-white/10 text-white px-5 py-2.5 rounded-full border border-white/10 backdrop-blur-md transition-all text-xs font-extrabold tracking-widest active:scale-95"
          >
            ✕ RETOUR
          </button>
          {playingVideoSrc && (
            <video
              id="fullVideoElement"
              className="w-full h-full max-w-5xl max-h-[85vh] rounded-2xl shadow-2xl object-contain outline-none"
              src={playingVideoSrc}
              controls
              autoPlay
              playsInline
            />
          )}
        </div>
      )}
    </div>
  );
}