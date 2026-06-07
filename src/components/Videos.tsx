import React, { useState, useEffect, useRef } from 'react';
import { sbClient } from '../lib/supabase';

interface VideoFile {
  id: string;
  album_id: string;
  name: string;
  url: string;
  size: string;
  thumbnail?: string;
}

interface SupabaseAlbum {
  id: string;
  name: string;
}

interface B2ScannedVideo {
  name: string;
  size: number;
}

interface VideosProps {
  onPlayVideo: (fileUrl: string) => void;
}

export default function Videos({ onPlayVideo }: VideosProps) {
  const [albums, setAlbums] = useState<SupabaseAlbum[]>([]);
  const [albumVideos, setAlbumVideos] = useState<Record<string, VideoFile[]>>({});
  const [b2Videos, setB2Videos] = useState<B2ScannedVideo[]>([]);
  const [b2DownloadToken, setB2DownloadToken] = useState('');

  // UI states
  const [loading, setLoading] = useState(false);
  const [scanningB2, setScanningB2] = useState(false);
  const [uploadingToB2, setUploadingToB2] = useState(false);
  const [albumSearchQuery, setAlbumSearchQuery] = useState('');
  
  // Navigation state
  const [activeAlbumForView, setActiveAlbumForView] = useState<SupabaseAlbum | null>(null);
  
  // FAB states
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');

  // Add Video Modal
  const [showAddVideoModal, setShowAddVideoModal] = useState(false);
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [b2SearchQuery, setB2SearchQuery] = useState('');
  const [generatingLinkFileId, setGeneratingLinkFileId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==========================================
  // 🔐 CONFIGURATION BUCKET PRIVÉ KROUSTYCONTROL
  // ==========================================
  const B2_KEY_ID = "00382696474bd910000000001"; 
  const B2_APPLICATION_KEY = "K003CXTldNwALY4kB2nrOSptF/Gleuo";
  const B2_BUCKET_ID = "a872d62946a4a7149bed0911";
  const B2_BUCKET_NAME = "KroustyControl"; 

  const formatBytes = (bytes: number, decimals = 1) => {
    if (!bytes) return '0 Ko';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Octets', 'Ko', 'Mo', 'Go', 'To'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const getFileExtension = (filename: string) => {
    return filename.split('.').pop()?.toUpperCase() || 'VID';
  };

  const authorizeB2 = async () => {
    const credentials = btoa(`${B2_KEY_ID}:${B2_APPLICATION_KEY}`);
    const targetUrl = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account";
    const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${credentials}` }
    });
    if (!res.ok) throw new Error("Échec d'authentification Backblaze B2");
    return res.json();
  };

  const fetchSupabaseData = async () => {
    const { data: rawAlbums } = await sbClient.from('albums').select('*').order('created_at', { ascending: true });
    const { data: rawVideos } = await sbClient.from('videos').select('*').order('created_at', { ascending: true });
    
    const albumsList = rawAlbums || [];
    setAlbums(albumsList);

    const videosMap: Record<string, VideoFile[]> = {};
    albumsList.forEach((a: SupabaseAlbum) => {
      videosMap[a.id] = [];
    });

    if (rawVideos) {
      rawVideos.forEach((v: VideoFile) => {
        if (videosMap[v.album_id]) {
          videosMap[v.album_id].push(v);
        }
      });
    }

    setAlbumVideos(videosMap);

    if (activeAlbumForView) {
      const refreshed = albumsList.find((a: SupabaseAlbum) => a.id === activeAlbumForView.id);
      if (refreshed) {
        setActiveAlbumForView(refreshed);
      } else {
        setActiveAlbumForView(null);
      }
    }
  };

  const scanB2Account = async (silent = false) => {
    if (!silent) setScanningB2(true);
    try {
      const auth = await authorizeB2();
      
      const tokenUrl = `${auth.apiUrl}/b2api/v2/b2_get_download_authorization`;
      const tokenRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(tokenUrl)}`, {
        method: 'POST',
        headers: { 'Authorization': auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: B2_BUCKET_ID, fileNamePrefix: "", validDurationInSeconds: 7200 })
      });

      const listUrl = `${auth.apiUrl}/b2api/v2/b2_list_file_names`;
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(listUrl)}`, {
        method: 'POST',
        headers: { 'Authorization': auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: B2_BUCKET_ID, maxFileCount: 1000 })
      });

      if (!tokenRes.ok || !res.ok) throw new Error("Impossible de récupérer les autorisations ou fichiers");
      
      const tokenData = await tokenRes.json();
      setB2DownloadToken(tokenData.authorizationToken);
      
      const data = await res.json();
      
      const scanned: B2ScannedVideo[] = (data.files || [])
        .filter((f: any) => f.fileName.match(/\.(mp4|mkv|mov|avi|webm)$/i))
        .map((f: any) => ({
          name: f.fileName,
          size: f.contentLength || 0
        }));

      setB2Videos(scanned);
    } catch (err) {
      console.error("Erreur scan B2:", err);
    } finally {
      if (!silent) setScanningB2(false);
    }
  };

  const getAuthenticatedUrl = (url: string) => {
    if (!url) return '';
    if (url.includes("backblazeb2.com") && b2DownloadToken) {
      return `${url}?Authorization=${b2DownloadToken}`;
    }
    return url;
  };

  const getBrowserFriendlyUrl = (url: string) => {
    return getAuthenticatedUrl(url);
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchSupabaseData();
      setLoading(false);
      scanB2Account(true);
    };
    
    init();

    const { data: { subscription } } = sbClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        fetchSupabaseData();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleCreateAlbum = async () => {
    const name = newAlbumName.trim();
    if (!name) return;
    setLoading(true);
    await sbClient.from('albums').insert([{ name }]);
    setNewAlbumName('');
    setShowCreateAlbum(false);
    await fetchSupabaseData();
    setLoading(false);
  };

  const handleDeleteAlbum = async (albumId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Supprimer l'album "${name}" et toutes ses vidéos ?`)) {
      setLoading(true);
      await sbClient.from('albums').delete().eq('id', albumId);
      await fetchSupabaseData();
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingToB2(true);
    try {
      const auth = await authorizeB2();

      const uploadUrlTarget = `${auth.apiUrl}/b2api/v2/b2_get_upload_url`;
      const urlRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(uploadUrlTarget)}`, {
        method: 'POST',
        headers: { 'Authorization': auth.authorizationToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucketId: B2_BUCKET_ID })
      });
      if (!urlRes.ok) throw new Error("Impossible de générer l'URL d'upload");
      const uploadTarget = await urlRes.json();

      const arrayBuffer = await file.arrayBuffer();
      const uploadRes = await fetch(uploadTarget.uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': uploadTarget.authorizationToken,
          'X-Bz-File-Name': encodeURIComponent(file.name),
          'Content-Type': file.type || 'video/mp4',
          'X-Bz-Content-Sha1': 'do_not_verify'
        },
        body: arrayBuffer
      });

      if (!uploadRes.ok) throw new Error("Échec du téléversement");

      alert(`Vidéo "${file.name}" envoyée avec succès sur Backblaze B2 !`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      scanB2Account(true);
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion avec Backblaze B2 lors du téléversement.");
    } finally {
      setUploadingToB2(false);
    }
  };

  const openAssignVideoModal = (albumId: string) => {
    setActiveAlbumId(albumId);
    setB2SearchQuery('');
    setShowAddVideoModal(true);
    scanB2Account(true);
  };

  const generateThumbnailFromUrl = (url: string): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = url;
      video.crossOrigin = 'anonymous';
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      
      video.onloadeddata = () => {
        video.currentTime = 1;
      };
      
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 180;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            resolve(dataUrl);
          } else {
            resolve('');
          }
        } catch (e) {
          resolve('');
        }
      };
      
      video.onerror = () => {
        resolve('');
      };
    });
  };

  const handleAssignVideo = async (scannedFile: B2ScannedVideo) => {
    if (!activeAlbumId) return;
    setGeneratingLinkFileId(scannedFile.name);
    try {
      const auth = await authorizeB2();
      
      const shareLink = `${auth.downloadUrl}/file/${B2_BUCKET_NAME}/${scannedFile.name}`;
      const fileSizeFormatted = formatBytes(scannedFile.size);

      const thumbnailDataUrl = await generateThumbnailFromUrl(getBrowserFriendlyUrl(shareLink));

      const { error } = await sbClient.from('videos').insert([{
        album_id: activeAlbumId,
        name: scannedFile.name,
        url: shareLink, 
        size: fileSizeFormatted,
        thumbnail: thumbnailDataUrl
      }]);

      if (error && error.message.includes('column "thumbnail" of relation "videos" does not exist')) {
        await sbClient.from('videos').insert([{
          album_id: activeAlbumId,
          name: scannedFile.name,
          url: shareLink,
          size: fileSizeFormatted
        }]);
      }

      setShowAddVideoModal(false);
      setActiveAlbumId(null);
      await fetchSupabaseData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la liaison du fichier.");
    } finally {
      setGeneratingLinkFileId(null);
    }
  };

  const handleDeleteVideo = async (videoId: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Retirer la vidéo "${name}" de cet album ?`)) {
      await sbClient.from('videos').delete().eq('id', videoId);
      await fetchSupabaseData();
    }
  };

  const copyVideoLink = async (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      alert("Lien copié !");
    } catch (e) {
      alert("Impossible de copier le lien.");
    }
  };

  const filteredB2Videos = b2Videos.filter(v => {
    const matchesSearch = v.name.toLowerCase().includes(b2SearchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (activeAlbumId) {
      const assignedVideos = albumVideos[activeAlbumId] || [];
      const isAlreadyAssigned = assignedVideos.some(av => av.name === v.name);
      if (isAlreadyAssigned) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4 page-content relative">
      {!activeAlbumForView ? (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              value={albumSearchQuery}
              onChange={(e) => setAlbumSearchQuery(e.target.value)}
              placeholder="Rechercher un dossier..."
              className="glass-input w-full rounded-2xl p-4 text-xs placeholder-[#e3dad0]/60 outline-none font-semibold shadow-inner focus:ring-1 focus:ring-[#ff751f]/10"
            />
          </div>

          {loading ? (
            <div className="glass-card p-12 text-center rounded-3xl bg-white/40 border border-[#e3dad0]">
              <div className="w-6 h-6 border-2 border-[#e3dad0] border-t-[#ff751f] rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-xs text-[#7c6258] font-medium">Chargement...</p>
            </div>
          ) : albums.length === 0 ? (
            <div className="glass-card p-12 text-center rounded-3xl bg-white/40 border border-[#e3dad0]">
              <p className="text-xs text-[#7c6258] font-medium">Aucun dossier créé.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {albums
                .filter(a => a.name.toLowerCase().includes(albumSearchQuery.toLowerCase()))
                .map(album => {
                  const videosList = albumVideos[album.id] || [];
                  const videosCount = videosList.length;
                  const firstVideo = videosList[0];

                  return (
                    <div 
                      key={album.id}
                      onClick={() => setActiveAlbumForView(album)}
                      className="glass-card p-4 bg-white/40 hover:bg-white border border-[#f2ede4] rounded-2xl shadow-xl flex justify-between items-center cursor-pointer select-none transition-all duration-300 group"
                    >
                      <div className="flex items-center gap-4">
                        
                        {/* REPARATION ET DESIGN : Miniatures et empilement dynamique au lieu de l'émoji brut */}
                        <div className="relative w-16 h-12 flex-shrink-0">
                          {videosCount > 1 && (
                            <div className="absolute inset-0 bg-[#b74b1b]/15 rounded-xl translate-x-1.5 translate-y-1 rotate-3 shadow-sm border border-[#f2ede4]"></div>
                          )}
                          {videosCount > 0 && (
                            <div className="absolute inset-0 bg-[#ff751f]/10 rounded-xl translate-x-0.5 translate-y-0.5 -rotate-2 shadow-sm border border-[#f2ede4]"></div>
                          )}
                          
                          <div className="absolute inset-0 rounded-xl overflow-hidden bg-gradient-to-br from-white to-[#faf6f0] border border-[#e3dad0] flex items-center justify-center shadow-md group-hover:border-[#ff751f]/40 transition-colors">
                            {firstVideo?.thumbnail ? (
                              <img 
                                src={firstVideo.thumbnail} 
                                className="w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-300" 
                                alt="" 
                              />
                            ) : firstVideo ? (
                              <div className="w-full h-full bg-gradient-to-tr from-[#b74b1b]/20 to-[#ff751f]/20 flex items-center justify-center text-[#ff751f]">
                                <svg className="w-5 h-5 drop-shadow-sm" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              </div>
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-white to-[#faf6f0] flex items-center justify-center text-[#ff751f]/30">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <h3 className="text-xs font-black text-[#b74b1b] group-hover:text-[#ff751f] transition-colors uppercase tracking-wider">{album.name}</h3>
                          <p className="text-[10px] text-[#ff751f] font-bold mt-0.5">{videosCount} vidéo(s)</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={(e) => handleDeleteAlbum(album.id, album.name, e)}
                          className="btn-action text-[#7c6258] hover:text-red-400 p-2 text-xs font-bold transition-colors"
                        >
                          ✕
                        </button>
                        <svg className="w-4 h-4 text-[#7c6258] group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </>
      ) : (
        <div className="fixed inset-0 bg-[#faf6f0] z-40 overflow-y-auto px-5 py-6 pb-20 flex flex-col space-y-6">
          <div className="flex justify-between items-center border-b border-[#e3dad0] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[#b74b1b] uppercase tracking-wider flex items-center gap-2">
                <span>📁</span> {activeAlbumForView.name}
              </h2>
              <p className="text-[10px] text-[#ff751f] font-semibold mt-0.5">
                {(albumVideos[activeAlbumForView.id] || []).length} vidéo(s) dans l'album
              </p>
            </div>
            <button
              onClick={() => setActiveAlbumForView(null)}
              className="bg-white hover:bg-[#faf6f0] border border-[#e3dad0] text-[#b74b1b] px-4 py-2 rounded-full text-xs font-bold transition-all active:scale-95 shadow-md"
            >
              ✕ RETOUR
            </button>
          </div>

          <div className="flex-1">
            {!(albumVideos[activeAlbumForView.id] || []).length ? (
              <div className="glass-card p-12 text-center rounded-3xl bg-white/40 border border-[#e3dad0]">
                <p className="text-xs text-[#7c6258] font-medium italic">Cet album est vide.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3.5">
                {(albumVideos[activeAlbumForView.id] || []).map(v => (
                  <div 
                    key={v.id} 
                    onClick={() => onPlayVideo(getBrowserFriendlyUrl(v.url))} 
                    className="bg-white/70 border border-[#e3dad0] p-2.5 rounded-2xl flex flex-col justify-between cursor-pointer hover:bg-white hover:border-[#ff751f]/40 transition-all duration-300 relative group overflow-hidden shadow-sm hover:shadow-md"
                  >
                    <div className="rounded-xl overflow-hidden bg-[#faf6f0]/50 aspect-video relative shadow-inner flex items-center justify-center">
                      {v.thumbnail ? (
                        <img
                          src={v.thumbnail}
                          className="w-full h-full object-cover shadow-inner scale-105 group-hover:scale-110 transition-transform duration-500"
                          alt={v.name}
                        />
                      ) : v.url && b2DownloadToken ? ( 
                        <video
                          src={getBrowserFriendlyUrl(v.url)}
                          className="w-full h-full object-cover pointer-events-none scale-105 group-hover:scale-110 transition-transform duration-500"
                          muted
                          playsInline
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#ff751f]/10 via-[#faf6f0] to-[#b74b1b]/5 flex flex-col items-center justify-center p-3">
                          <div className="p-2 bg-[#ff751f]/10 rounded-full border border-[#ff751f]/20 text-[#ff751f] mb-1 group-hover:scale-105 transition-transform duration-300">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                            </svg>
                          </div>
                          <span className="text-[7px] font-black tracking-widest text-[#b74b1b] uppercase bg-white/80 px-1 py-0.5 rounded border border-[#e3dad0]">
                            {getFileExtension(v.name)}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/5 flex items-center justify-center group-hover:bg-black/15 transition-colors duration-300 z-10">
                        <div className="w-20 h-20 rounded-full bg-white/95 border border-[#e3dad0] shadow-2xl flex items-center justify-center transform group-hover:scale-105 transition-transform duration-300 shadow-[#b74b1b]/10">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-r from-[#ff751f] to-[#b74b1b] flex items-center justify-center shadow-lg">
                            <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => copyVideoLink(e, getAuthenticatedUrl(v.url))}
                        className="absolute top-2 right-2 bg-white/90 p-2 rounded-lg border border-[#e3dad0] shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-[#faf6f0] z-20"
                      >
                        <svg className="w-3 h-3 text-[#ff751f]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                        </svg>
                      </button>
                    </div>
                    <div className="px-1 pt-2 flex justify-between items-start gap-1">
                      <div className="overflow-hidden flex-1">
                        <p className="font-bold text-[11px] text-[#b74b1b] group-hover:text-[#ff751f] transition-colors truncate">{v.name}</p>
                        <p className="text-[9px] text-[#7c6258] font-bold mt-0.5">{v.size}</p>
                      </div>
                      <button
                        onClick={(e) => handleDeleteVideo(v.id, v.name, e)}
                        className="text-[#7c6258] hover:text-red-500 p-1 text-[10px] font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              onClick={() => openAssignVideoModal(activeAlbumForView.id)}
              className="w-full bg-white/80 hover:bg-white border border-dashed border-[#e3dad0] hover:border-[#ff751f]/50 text-[#b74b1b] text-xs font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-1.5 active:scale-99 shadow-sm"
            >
              <span>＋ Associer une Vidéo Backblaze</span>
            </button>
          </div>
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* FAB Menu */}
      <div className="fixed bottom-36 right-5 z-40 flex flex-col items-end">
        {showFabMenu && (
          <div className="bg-white/95 border border-[#e3dad0] p-2.5 rounded-2xl shadow-2xl flex flex-col gap-1.5 mb-3 backdrop-blur-md min-w-[160px] animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              onClick={() => {
                setShowFabMenu(false);
                setShowCreateAlbum(true);
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#faf6f0] text-xs font-bold text-[#b74b1b] transition-colors flex items-center gap-2"
            >
              <span>📁</span> Nouveau Dossier
            </button>
            <button
              onClick={() => {
                setShowFabMenu(false);
                fileInputRef.current?.click();
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#faf6f0] text-xs font-bold text-[#b74b1b] transition-colors flex items-center gap-2"
            >
              <span>🎥</span> Envoyer sur Backblaze
            </button>
          </div>
        )}

        <button
          onClick={() => setShowFabMenu(prev => !prev)}
          className={`w-14 h-14 rounded-full bg-gradient-to-r from-[#ff751f] to-[#b74b1b] border border-[#ff751f]/20 text-white flex items-center justify-center shadow-2xl hover:shadow-[#ff751f]/20 active:scale-95 transition-all cursor-pointer btn-glow ${
            showFabMenu ? 'rotate-45 bg-gradient-to-r from-[#b74b1b] to-[#ff751f] border-[#b74b1b]/20' : ''
          }`}
        >
          <svg className="w-6 h-6 transition-transform duration-200" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      {/* Create Album Modal */}
      {showCreateAlbum && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white border border-[#f2ede4] w-full max-w-sm rounded-3xl p-6 space-y-4 shadow-2xl">
            <div>
              <h3 className="text-sm font-bold text-[#b74b1b]">Créer un dossier</h3>
              <p className="text-[11px] text-[#7c6258] mt-1">Nom du dossier :</p>
            </div>
            <input
              type="text"
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder="Ex: Entrées, Desserts..."
              className="w-full bg-[#faf6f0]/60 border border-[#e3dad0] rounded-2xl p-3.5 text-xs text-[#b74b1b] placeholder-[#e3dad0] outline-none focus:border-[#ff751f]/50 transition-all font-semibold shadow-inner"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setShowCreateAlbum(false);
                  setNewAlbumName('');
                }}
                className="w-1/2 bg-[#faf6f0] text-[#7c6258] text-xs font-bold py-3.5 rounded-2xl transition-colors active:scale-95 hover:bg-[#e3dad0]/40"
              >
                Annuler
              </button>
              <button
                onClick={handleCreateAlbum}
                className="w-1/2 bg-[#ff751f] hover:bg-[#b74b1b] text-white text-xs font-bold py-3.5 rounded-2xl shadow-md transition-colors active:scale-95"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Video Modal */}
      {showAddVideoModal && activeAlbumId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white border border-[#f2ede4] w-full max-w-md rounded-3xl p-6 space-y-4 shadow-2xl">
            <div>
              <h3 className="text-sm font-bold text-[#b74b1b]">Associer une vidéo Backblaze</h3>
              <p className="text-[11px] text-[#7c6258] mt-1">
                Choisissez une vidéo :
              </p>
            </div>
            
            <input
              type="text"
              value={b2SearchQuery}
              onChange={(e) => setB2SearchQuery(e.target.value)}
              placeholder="Rechercher..."
              className="w-full bg-[#faf6f0]/60 border border-[#e3dad0] rounded-xl p-3 text-xs text-[#b74b1b] placeholder-[#e3dad0]/60 outline-none focus:border-[#ff751f]/50 transition-all font-semibold shadow-inner"
            />

            <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
              {filteredB2Videos.length === 0 ? (
                <p className="text-xs text-center text-[#7c6258] py-6 italic">Aucune vidéo.</p>
              ) : (
                filteredB2Videos.map(v => {
                  const isGenerating = generatingLinkFileId === v.name;
                  return (
                    <div
                      key={v.name}
                      className="w-full bg-[#faf6f0]/60 p-3 rounded-2xl border border-[#e3dad0] flex justify-between items-center text-xs"
                    >
                      <div className="overflow-hidden flex-1 pr-2">
                        <p className="font-bold text-[#b74b1b] truncate">{v.name}</p>
                        <p className="text-[9px] text-[#7c6258] font-bold mt-0.5">{formatBytes(v.size)}</p>
                      </div>
                      <button
                        onClick={() => handleAssignVideo(v)}
                        disabled={generatingLinkFileId !== null}
                        className="px-3 py-1.5 bg-[#ff751f] hover:bg-[#b74b1b] text-white rounded-lg font-bold text-[10px] transition-all flex items-center gap-1 active:scale-95"
                      >
                        {isGenerating ? (
                          <>
                            <div className="w-2.5 h-2.5 border border-white/20 border-t-white rounded-full animate-spin"></div>
                            Lien...
                          </>
                        ) : (
                          "Ajouter"
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setShowAddVideoModal(false);
                setActiveAlbumId(null);
              }}
              className="w-full bg-[#faf6f0] text-[#7c6258] text-xs font-bold py-3.5 rounded-2xl transition-colors active:scale-95 hover:bg-[#e3dad0]/40"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Uploading Overlay */}
      {uploadingToB2 && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col items-center justify-center p-4 backdrop-blur-md">
          <div className="w-10 h-10 border-4 border-[#ff751f]/20 border-t-[#ff751f] rounded-full animate-spin mb-4"></div>
          <p className="text-white text-sm font-bold tracking-wide">Envoi en cours vers Backblaze B2...</p>
          <p className="text-slate-400 text-[10px] mt-1.5">Ne quittez pas la page.</p>
        </div>
      )}
    </div>
  );
}