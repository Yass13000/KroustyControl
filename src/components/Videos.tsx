import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudUpload, FileText, HardDrive, Image as ImageIcon, ChevronLeft, ChevronRight, ClipboardCopy, Copy, Film, FolderOpen, FolderPlus, Gauge, Link2, Loader2, MonitorPlay, Play, Plus, RefreshCw, Search, Trash2, Video, XCircle } from 'lucide-react';
import { sbClient } from '../lib/supabase';
import { errorMessage, must, useLibrary, useVideoAnalyses } from '../lib/data';
import { IMAGE_SECONDS, fileExtension, googleDriveThumbnail, isGoogleDrive, isImageUrl, parsePlaylist, transformStorageUrl } from '../lib/media';
import { imageThumbnail, isImageFile, prepareImage } from '../lib/image';
import { PDF_MAX_PAGES, isPdfFile, pdfPageCount, pdfToImages, type PdfFit } from '../lib/pdf';
import type { Album, AppScreen, Configuration, Group, VideoFile } from '../lib/types';
import { COMMON, libraryAccess, ownerLabel } from '../lib/library';
import { FORMAT_CODES, FORMAT_SHORT, SOURCE_LABEL, resolveFormat, usageFormats, type FormatSource } from '../lib/videoFormat';
import {
  DEFAULT_TARGET,
  analyzeFile,
  analyzeVideo,
  readCache,
  writeCache,
  assess,
  mbps,
  megabytes,
  recommendation,
  targetsByUrl,
  type Assessment,
  type VideoAnalysis,
} from '../lib/videoAnalysis';
import { formatDuration } from '../lib/diagnostics';
import { DropboxSetupError, connectUrl, connectWithCode, spaceUsage, uploadVideo, type SetupState } from '../lib/dropbox';
import { Button, EmptyState, IconButton, Input, Modal, PageTitle, Segmented, Select, Spinner, cn, useFeedback } from './ui';

interface VideosProps {
  isSuperAdmin: boolean;
  onPlayVideo: (fileUrl: string) => void;
  /** Écrans visibles par le compte : sert à indiquer où chaque vidéo est diffusée. */
  screens?: AppScreen[];
  /** Configurations : servent à connaître la taille des murs qui diffusent chaque vidéo. */
  configurations?: Configuration[];
  /** Restaurants du compte (tous pour l'admin) : chaque dossier appartient à l'un d'eux ou à la bibliothèque commune. */
  groups?: Group[];
}

/** Tente de capturer une image de la vidéo (échoue silencieusement si le CORS l'interdit). */
const generateThumbnail = (url: string, image = false): Promise<string> =>
  new Promise(resolve => {
    if (isGoogleDrive(url)) return resolve(googleDriveThumbnail(url));
    if (image || isImageUrl(url)) return resolve(imageThumbnail(url));

    const video = document.createElement('video');
    const done = (value: string) => {
      clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timeout = setTimeout(() => done(''), 4000);

    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) return done('');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        done('');
      }
    };
    video.onerror = () => done('');
    video.src = url;
  });

export default function Videos({ isSuperAdmin, onPlayVideo, screens = [], configurations = [], groups = [] }: VideosProps) {
  const { toast, confirm } = useFeedback();
  const library = useLibrary();
  const { loading, refresh } = library;

  // Chaque compte ne voit que les dossiers de ses restaurants (+ la bibliothèque commune) ; l'admin voit tout.
  const access = libraryAccess(isSuperAdmin, groups);
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const albums = library.albums.filter(
    a => access.canSee(a) && (ownerFilter === 'all' || (ownerFilter === COMMON ? !a.group_id : a.group_id === ownerFilter)),
  );
  const visibleAlbumIds = new Set(albums.map(a => a.id));
  const videos = library.videos.filter(v => visibleAlbumIds.has(v.album_id));
  const albumOf = (albumId: string | null | undefined) => library.albums.find(a => a.id === albumId);
  const showOwner = isSuperAdmin || groups.length > 1;

  // Format de mur de chaque vidéo (choisi, sinon déduit : mur de diffusion, nom, dimensions).
  const usageByFormat = useMemo(() => usageFormats(screens, configurations), [screens, configurations]);
  const [formatFilter, setFormatFilter] = useState<string>('all');

  const [albumSearchQuery, setAlbumSearchQuery] = useState('');
  const [libView, setLibView] = useState<'albums' | 'all' | 'check'>('albums');
  const [inspectId, setInspectId] = useState<string | null>(null);

  // Contrôle qualité : analyse légère de l'en-tête de chaque vidéo (mise en cache).
  const analyses = useVideoAnalyses(useMemo(() => videos.map(v => v.url), [videos]));
  const targets = useMemo(() => targetsByUrl(screens, configurations), [screens, configurations]);
  const assessmentOf = (url: string): Assessment | undefined => {
    const a = analyses.results[url];
    return a ? assess(a, targets.get(url) || DEFAULT_TARGET) : undefined;
  };
  const qualityOf = (url: string) => (analyses.pending.has(url) ? 'pending' : assessmentOf(url)?.verdict);
  const formatOf = (v: VideoFile) => resolveFormat(v, { usage: usageByFormat, analysis: analyses.results[v.url], albumName: albumOf(v.album_id)?.name });
  const matchFormat = (v: VideoFile) => formatFilter === 'all' || formatOf(v).format === formatFilter;
  const formatChips = (list: VideoFile[]) => (
    <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
      <Segmented
        size="sm"
        value={formatFilter}
        onChange={setFormatFilter}
        options={[
          { value: 'all', label: 'Tous formats' },
          ...FORMAT_CODES.map(f => {
            const n = list.filter(v => formatOf(v).format === f).length;
            return { value: f, label: n ? `${FORMAT_SHORT[f]} · ${n}` : FORMAT_SHORT[f] };
          }),
        ]}
      />
    </div>
  );

  /** Enregistre le format choisi à la main (vide = revenir à la déduction automatique). */
  const saveFormat = async (video: VideoFile, format: string) => {
    try {
      must(await sbClient.from('videos').update({ format: format || null }).eq('id', video.id));
      toast('Format enregistré');
      await refresh();
    } catch (err) {
      const msg = errorMessage(err);
      toast(msg.includes('format') ? 'Migration 20261111_albums_by_restaurant.sql manquante' : msg, 'error');
    }
  };
  const toOptimize = videos.filter(v => {
    const q = qualityOf(v.url);
    return q === 'heavy' || q === 'incompatible' || q === 'unknown';
  });

  /** url → écrans qui diffusent cette vidéo. */
  const usage = useMemo(() => {
    const map = new Map<string, string[]>();
    screens.forEach(s =>
      parsePlaylist(s.video_url).forEach(url => {
        const list = map.get(url) || [];
        if (!list.includes(s.id)) list.push(s.id);
        map.set(url, list);
      }),
    );
    return map;
  }, [screens]);
  const albumName = (albumId: string) => albums.find(a => a.id === albumId)?.name;
  // On mémorise l'id (et non l'objet) : plus de boucle de rechargement à l'ouverture d'un dossier.
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [showCreateAlbum, setShowCreateAlbum] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [newAlbumGroup, setNewAlbumGroup] = useState<string>('');
  const [addVideoAlbumId, setAddVideoAlbumId] = useState<string | null>(null);
  const [newVideoName, setNewVideoName] = useState('');
  const [newVideoUrl, setNewVideoUrl] = useState('');
  // Envoi direct d'un fichier vers Dropbox
  const [addMode, setAddMode] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [fileAnalysis, setFileAnalysis] = useState<VideoAnalysis | null>(null);
  // Image choisie : préparée (sens, taille, JPEG) avant l'envoi.
  const [fileIsImage, setFileIsImage] = useState(false);
  // PDF choisi : nombre de pages et cadrage ; chaque page devient une image à l'envoi.
  const [pdfPages, setPdfPages] = useState<number | null>(null);
  const [pdfFit, setPdfFit] = useState<PdfFit>('whole');
  const [pdfStep, setPdfStep] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [space, setSpace] = useState<{ used: number; allocated: number } | null>(null);
  const [uploadUnavailable, setUploadUnavailable] = useState<{ message: string; state: SetupState } | null>(null);
  const [connectCode, setConnectCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);

  const activeAlbum = albums.find(a => a.id === activeAlbumId) || null;
  const videosOf = (albumId: string) => videos.filter(v => v.album_id === albumId);
  const filteredAlbums = albums.filter(a => a.name.toLowerCase().includes(albumSearchQuery.toLowerCase()));

  /* ------------------------------ Actions ------------------------------ */

  // À l'ouverture de « Nouveau dossier » : restaurant du filtre actif, sinon le premier du gérant.
  useEffect(() => {
    if (!showCreateAlbum) return;
    if (ownerFilter !== 'all' && ownerFilter !== COMMON) setNewAlbumGroup(ownerFilter);
    else setNewAlbumGroup(isSuperAdmin ? '' : groups[0]?.id || '');
  }, [showCreateAlbum, ownerFilter, isSuperAdmin, groups]);

  /** Admin : rattache un dossier à un restaurant (ou à la bibliothèque commune). */
  const setAlbumOwner = async (album: Album, groupId: string) => {
    try {
      must(await sbClient.from('albums').update({ group_id: groupId || null }).eq('id', album.id));
      toast(groupId ? 'Dossier rattaché' : 'Dossier dans la bibliothèque commune');
      await refresh();
    } catch (err) {
      const msg = errorMessage(err);
      toast(msg.includes('group_id') ? 'Migration 20261111_albums_by_restaurant.sql manquante' : msg, 'error');
    }
  };

  const handleCreateAlbum = async () => {
    const name = newAlbumName.trim();
    if (!access.canCreate || !name) return;
    // Un gérant crée toujours dans un de ses restaurants ; l'admin peut aussi créer dans la bibliothèque commune.
    const groupId = newAlbumGroup || (isSuperAdmin ? '' : groups[0]?.id || '');
    if (!isSuperAdmin && !groupId) return;
    setBusy(true);
    try {
      must(await sbClient.from('albums').insert([{ name, group_id: groupId || null }]));
      toast('Dossier créé');
      setNewAlbumName('');
      setShowCreateAlbum(false);
      await refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAlbum = async (album: Album) => {
    if (!access.canManage(album)) return;
    const count = videosOf(album.id).length;
    const ok = await confirm({
      title: `Supprimer « ${album.name} » ?`,
      message: count > 0 ? `${count} vidéo${count > 1 ? 's' : ''}` : undefined,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      must(await sbClient.from('albums').delete().eq('id', album.id));
      toast('Dossier supprimé');
      if (activeAlbumId === album.id) setActiveAlbumId(null);
      await refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const closeAddVideo = () => {
    setPdfPages(null);
    setFileIsImage(false);
    abortRef.current?.abort();
    setAddVideoAlbumId(null);
    setNewVideoName('');
    setNewVideoUrl('');
    setFile(null);
    setFileAnalysis(null);
    setProgress(null);
  };

  // À l'ouverture : espace Dropbox disponible (et détection d'un envoi non configuré).
  const [setupCheck, setSetupCheck] = useState(0);
  useEffect(() => {
    if (!addVideoAlbumId) return;
    let cancelled = false;
    spaceUsage()
      .then(sp => !cancelled && (setSpace(sp), setUploadUnavailable(null)))
      .catch(err => {
        if (cancelled) return;
        if (err instanceof DropboxSetupError) {
          setUploadUnavailable({ message: err.message, state: err.state });
          // Dropbox à connecter : on reste sur « Fichier » pour proposer la connexion.
          if (err.state !== 'not_connected') setAddMode('link');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [addVideoAlbumId, setupCheck]);

  const openDropboxAuthorize = async () => {
    // Onglet ouvert tout de suite (sinon Safari le bloque comme pop-up), puis dirigé vers Dropbox.
    const tab = window.open('about:blank', '_blank');
    setConnectError(null);
    try {
      const url = await connectUrl();
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      setConnectError(errorMessage(err));
    }
  };

  const submitConnectCode = async () => {
    if (!connectCode.trim()) return;
    setConnecting(true);
    setConnectError(null);
    try {
      await connectWithCode(connectCode);
      setConnectCode('');
      toast('Dropbox connecté');
      setSetupCheck(n => n + 1);
    } catch (err) {
      setConnectError(errorMessage(err));
    } finally {
      setConnecting(false);
    }
  };

  const pickFile = async (f: File | null) => {
    setFile(f);
    setFileAnalysis(null);
    setFileIsImage(false);
    setPdfPages(null);
    if (!f) return;
    if (!newVideoName.trim()) setNewVideoName(f.name.replace(/\.[^.]+$/, ''));
    if (isPdfFile(f)) {
      try {
        setPdfPages(await pdfPageCount(f));
      } catch {
        setFile(null);
        toast('PDF illisible (protégé par mot de passe ?)', 'error');
      }
      return;
    }
    if (isImageFile(f)) {
      setFileIsImage(true);
      try {
        const img = await prepareImage(f);
        setFile(img.file);
        setFileAnalysis({ ok: true, width: img.width, height: img.height, size: img.file.size });
      } catch (err) {
        setFile(null);
        toast(errorMessage(err), 'error');
      }
      return;
    }
    setFileAnalysis(await analyzeFile(f));
  };

  /** Ajoute la vidéo à la bibliothèque (avec miniature si possible). */
  const insertVideo = async (name: string, url: string, size: string, thumbSource = url, analysis?: VideoAnalysis | null) => {
    const thumbnail = await generateThumbnail(thumbSource, isImageUrl(url));
    // Format de mur déduit dès l'ajout (nom de la vidéo ou du dossier, puis dimensions).
    const { format } = resolveFormat({ id: '', album_id: addVideoAlbumId || '', name, url }, { analysis: analysis || undefined, albumName: albumOf(addVideoAlbumId)?.name });
    const base = { album_id: addVideoAlbumId, name, url, size };
    let { error } = await sbClient.from('videos').insert([{ ...base, thumbnail: thumbnail || null, format }]);
    // Compatibilité : base sans colonne « format » ou « thumbnail » (migration non passée).
    if (error && error.message.includes('format')) ({ error } = await sbClient.from('videos').insert([{ ...base, thumbnail: thumbnail || null }]));
    if (error && error.message.includes('thumbnail')) ({ error } = await sbClient.from('videos').insert([base]));
    if (error) throw error;
  };

  /** PDF : chaque page est convertie en image puis envoyée, dans l'ordre. */
  const handleUploadPdf = async () => {
    if (!access.canManage(albumOf(addVideoAlbumId)) || !addVideoAlbumId || !file) return;
    const base = newVideoName.trim() || file.name.replace(/\.pdf$/i, '');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let sent = 0;
    try {
      setPdfStep('Conversion…');
      const pages = await pdfToImages(file, pdfFit, (n, total) => setPdfStep(`Conversion ${n}/${total}`));
      for (const [i, page] of pages.entries()) {
        if (controller.signal.aborted) throw new Error('Envoi annulé');
        setPdfStep(`Envoi page ${i + 1}/${pages.length}`);
        const url = await uploadVideo(page.file, p => setProgress((i + p) / pages.length), controller.signal);
        const localUrl = URL.createObjectURL(page.file);
        try {
          await insertVideo(pages.length > 1 ? `${base} – page ${i + 1}` : base, url, megabytes(page.file.size), localUrl, {
            ok: true,
            width: page.width,
            height: page.height,
          });
        } finally {
          URL.revokeObjectURL(localUrl);
        }
        sent++;
      }
      toast(sent > 1 ? `${sent} pages ajoutées` : 'Page ajoutée');
      closeAddVideo();
      await refresh();
    } catch (err) {
      toast(`${sent > 0 ? `${sent} page${sent > 1 ? 's' : ''} ajoutée${sent > 1 ? 's' : ''} · ` : ''}${errorMessage(err)}`, 'error');
      setProgress(null);
      if (sent > 0) await refresh();
    } finally {
      setPdfStep(null);
      abortRef.current = null;
      setBusy(false);
    }
  };

  const handleUploadFile = async () => {
    if (pdfPages !== null) return handleUploadPdf();
    if (!access.canManage(albumOf(addVideoAlbumId)) || !addVideoAlbumId || !file) return;
    const name = newVideoName.trim() || file.name;
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const localUrl = URL.createObjectURL(file);
    try {
      const url = await uploadVideo(file, setProgress, controller.signal);
      // L'analyse faite avant l'envoi est réutilisée : aucune requête de plus.
      if (fileAnalysis?.ok && !fileIsImage) writeCache({ ...readCache(), [url]: fileAnalysis });
      await insertVideo(name, url, megabytes(file.size), localUrl, fileAnalysis);
      toast(fileIsImage ? 'Image envoyée' : 'Vidéo envoyée');
      closeAddVideo();
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : errorMessage(err), 'error');
      setProgress(null);
    } finally {
      URL.revokeObjectURL(localUrl);
      abortRef.current = null;
      setBusy(false);
    }
  };

  const handleAddVideoLink = async () => {
    if (!access.canManage(albumOf(addVideoAlbumId)) || !addVideoAlbumId) return;
    const name = newVideoName.trim();
    const rawUrl = newVideoUrl.trim();
    if (!name || !rawUrl) return;

    setBusy(true);
    try {
      await insertVideo(name, transformStorageUrl(rawUrl), 'Lien cloud');
      toast('Vidéo ajoutée');
      closeAddVideo();
      await refresh();
    } catch (err) {
      toast(`Erreur d'enregistrement : ${errorMessage(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteVideo = async (video: VideoFile) => {
    if (!access.canManage(albumOf(video.album_id))) return;
    const ok = await confirm({ title: `Retirer « ${video.name} » ?`, confirmLabel: 'Retirer', danger: true });
    if (!ok) return;
    try {
      must(await sbClient.from('videos').delete().eq('id', video.id));
      toast('Vidéo retirée');
      await refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const copyVideoLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié');
    } catch {
      toast('Impossible de copier le lien', 'error');
    }
  };

  /* ------------------------------ Rendu ------------------------------ */

  return (
    <div className="space-y-5">
      <PageTitle
        title="Médias"
        actions={
          access.canCreate && (
            <IconButton label="Nouveau dossier" variant="secondary" onClick={() => setShowCreateAlbum(true)}>
              <FolderPlus className="h-5 w-5" />
            </IconButton>
          )
        }
      />

      <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
        <Segmented
          value={libView}
          onChange={setLibView}
          options={[
            { value: 'albums', label: 'Dossiers' },
            { value: 'all', label: 'Toutes' },
            { value: 'check', label: toOptimize.length ? `À optimiser · ${toOptimize.length}` : 'À optimiser' },
          ]}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <Input
            value={albumSearchQuery}
            onChange={e => setAlbumSearchQuery(e.target.value)}
            placeholder="Rechercher"
            leading={<Search className="h-4.5 w-4.5" />}
            aria-label="Rechercher"
          />
        </div>
        {showOwner && (
          <Select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} aria-label="Restaurant" className="sm:w-60">
            <option value="all">Tous les restaurants</option>
            <option value={COMMON}>Bibliothèque commune</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {libView === 'all' || libView === 'check' ? (
        loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (
          (() => {
            const q = albumSearchQuery.trim().toLowerCase();
            const base = libView === 'check' ? toOptimize : videos;
            const searched = base.filter(v => !q || v.name.toLowerCase().includes(q) || (albumName(v.album_id) || '').toLowerCase().includes(q));
            const list = searched.filter(matchFormat);
            const chips = formatChips(searched);
            if (list.length === 0 && searched.length > 0) {
              return (
                <div className="space-y-3">
                  {chips}
                  <EmptyState icon={<Film className="h-6 w-6" />} title="Aucune vidéo dans ce format" />
                </div>
              );
            }
            if (list.length === 0) {
              return libView === 'check' && !q ? (
                <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Toutes les vidéos sont légères" />
              ) : (
                <EmptyState icon={<Film className="h-6 w-6" />} title={q ? 'Aucun résultat' : 'Aucune vidéo'} />
              );
            }
            return (
              <div className="space-y-3">
              {chips}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {list.map(v => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    albumLabel={albumName(v.album_id) || 'Sans dossier'}
                    usedOn={usage.get(v.url) || []}
                    quality={qualityOf(v.url)}
                    format={formatOf(v)}
                    onInspect={() => setInspectId(v.id)}
                    canDelete={access.canManage(albumOf(v.album_id))}
                    onPlay={() => onPlayVideo(v.url)}
                    onCopy={() => copyVideoLink(v.url)}
                    onDelete={() => handleDeleteVideo(v)}
                  />
                ))}
              </div>
              </div>
            );
          })()
        )
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : albums.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-6 w-6" />}
          title="Aucun dossier"
        />
      ) : filteredAlbums.length === 0 ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title="Aucun résultat" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filteredAlbums.map(album => {
            const list = videosOf(album.id);
            return (
              <div key={album.id} className="card group flex items-center gap-2 p-3 pr-2 transition hover:border-brand/40 hover:shadow-lift">
                <button type="button" onClick={() => setActiveAlbumId(album.id)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                  <AlbumCover videos={list} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-extrabold uppercase tracking-wide text-ink transition group-hover:text-brand-800">{album.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {showOwner && `${ownerLabel(album, groups)} · `}
                      <span className="font-bold tabular-nums">{list.length}</span> média{list.length > 1 ? 's' : ''}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted transition group-hover:translate-x-0.5" />
                </button>
                {access.canManage(album) && (
                  <IconButton label={`Supprimer ${album.name}`} variant="danger" onClick={() => handleDeleteAlbum(album)}>
                    <Trash2 className="h-4.5 w-4.5" />
                  </IconButton>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ======================= VUE DOSSIER (plein écran) ======================= */}
      {activeAlbum && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-cream animate-in fade-in slide-in-from-right-4 duration-300">
          <div className="sticky top-0 z-10 border-b border-line bg-cream/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
            <div className="mx-auto flex max-w-4xl items-center gap-3">
              <IconButton label="Retour" variant="secondary" onClick={() => setActiveAlbumId(null)}>
                <ChevronLeft className="h-5 w-5" />
              </IconButton>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-extrabold uppercase tracking-wide text-ink">{activeAlbum.name}</h2>
                {showOwner && !isSuperAdmin && <p className="truncate text-xs text-muted">{ownerLabel(activeAlbum, groups)}</p>}
              </div>
              {isSuperAdmin && (
                <Select
                  value={activeAlbum.group_id || ''}
                  onChange={e => setAlbumOwner(activeAlbum, e.target.value)}
                  aria-label="Restaurant du dossier"
                  className="hidden w-48 sm:block [&_select]:h-10 [&_select]:text-sm"
                >
                  <option value="">Commune</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
              {access.canManage(activeAlbum) && (
                <IconButton label="Ajouter un média" variant="secondary" onClick={() => setAddVideoAlbumId(activeAlbum.id)}>
                  <Plus className="h-5 w-5" />
                </IconButton>
              )}
            </div>
          </div>

          <div className="mx-auto max-w-4xl px-4 pb-40 pt-5">
            {videosOf(activeAlbum.id).length > 0 && <div className="mb-4">{formatChips(videosOf(activeAlbum.id))}</div>}
            {videosOf(activeAlbum.id).filter(matchFormat).length === 0 ? (
              <EmptyState
                icon={<Video className="h-6 w-6" />}
                title="Dossier vide"
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {videosOf(activeAlbum.id).filter(matchFormat).map(v => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    usedOn={usage.get(v.url) || []}
                    quality={qualityOf(v.url)}
                    format={formatOf(v)}
                    onInspect={() => setInspectId(v.id)}
                    canDelete={access.canManage(albumOf(v.album_id))}
                    onPlay={() => onPlayVideo(v.url)}
                    onCopy={() => copyVideoLink(v.url)}
                    onDelete={() => handleDeleteVideo(v)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================= CONTRÔLE QUALITÉ ======================= */}
      {(() => {
        const v = videos.find(x => x.id === inspectId);
        const a = v ? analyses.results[v.url] : undefined;
        const target = v ? targets.get(v.url) || DEFAULT_TARGET : DEFAULT_TARGET;
        return (
          <Modal
            open={!!v}
            onClose={() => setInspectId(null)}
            title={v?.name}
            subtitle={v ? albumName(v.album_id) : undefined}
            z="z-[60]"
            footer={
              v && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={analyses.pending.has(v.url)} onClick={() => analyses.reanalyze(v.url)}>
                    Réanalyser
                  </Button>
                  {a?.ok && (
                    <Button
                      size="sm"
                      className="ml-auto"
                      icon={<ClipboardCopy className="h-4 w-4" />}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(recommendation(a, target).ffmpeg);
                          toast('Commande ffmpeg copiée');
                        } catch {
                          toast('Copie impossible', 'error');
                        }
                      }}
                    >
                      Commande ffmpeg
                    </Button>
                  )}
                </div>
              )
            }
          >
            {v && (
              <div className="space-y-4">
                {(() => {
                  const f = formatOf(v);
                  return (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink">Format de mur</p>
                        <p className="text-xs text-muted">{f.source ? SOURCE_LABEL[f.source] : 'inconnu'}</p>
                      </div>
                      {access.canManage(albumOf(v.album_id)) ? (
                        <Select value={v.format || ''} onChange={e => saveFormat(v, e.target.value)} aria-label="Format de mur" className="w-44 [&_select]:h-10 [&_select]:text-sm">
                          <option value="">{f.format && f.source !== 'saved' ? `Auto (${FORMAT_SHORT[f.format]})` : 'Auto'}</option>
                          {FORMAT_CODES.map(c => (
                            <option key={c} value={c}>
                              {FORMAT_SHORT[c]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-sm font-bold text-ink">{f.format ? FORMAT_SHORT[f.format] : '—'}</span>
                      )}
                    </div>
                  );
                })()}
                <QualitySheet analysis={a} pending={analyses.pending.has(v.url)} target={target} walls={targets.get(v.url)?.walls || []} />
              </div>
            )}
          </Modal>
        );
      })()}

      {/* ======================= MODALES ======================= */}
      <Modal
        open={showCreateAlbum && access.canCreate}
        onClose={() => {
          setShowCreateAlbum(false);
          setNewAlbumName('');
        }}
        size="sm"
        title="Nouveau dossier"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              block
              onClick={() => {
                setShowCreateAlbum(false);
                setNewAlbumName('');
              }}
            >
              Annuler
            </Button>
            <Button block loading={busy} disabled={!newAlbumName.trim()} onClick={handleCreateAlbum}>
              Créer
            </Button>
          </div>
        }
      >
        <form
          onSubmit={e => {
            e.preventDefault();
            handleCreateAlbum();
          }}
        >
          <div className="space-y-3">
            <Input id="album-name" value={newAlbumName} onChange={e => setNewAlbumName(e.target.value)} placeholder="Nom" aria-label="Nom" autoFocus />
            {(isSuperAdmin || groups.length > 1) && (
              <Select value={newAlbumGroup} onChange={e => setNewAlbumGroup(e.target.value)} aria-label="Restaurant">
                {isSuperAdmin ? <option value="">Bibliothèque commune</option> : <option value="" disabled>Choisir le restaurant</option>}
                {groups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={!!addVideoAlbumId && access.canManage(albumOf(addVideoAlbumId))}
        onClose={() => progress === null && closeAddVideo()}
        z="z-[60]"
        title="Nouvelle vidéo"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={closeAddVideo}>
              {progress !== null ? 'Arrêter' : 'Annuler'}
            </Button>
            {addMode === 'file' ? (
              <Button block loading={busy} disabled={!file || (fileAnalysis === null && pdfPages === null)} icon={<CloudUpload className="h-4.5 w-4.5" />} onClick={handleUploadFile}>
                {pdfStep ?? (progress !== null ? `${Math.round(progress * 100)} %` : pdfPages ? `Envoyer ${Math.min(pdfPages, PDF_MAX_PAGES)} page${pdfPages > 1 ? 's' : ''}` : 'Envoyer')}
              </Button>
            ) : (
              <Button block loading={busy} disabled={!newVideoName.trim() || !newVideoUrl.trim()} onClick={handleAddVideoLink}>
                {busy ? 'Ajout…' : 'Ajouter'}
              </Button>
            )}
          </div>
        }
      >
        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            if (addMode === 'file') handleUploadFile();
            else handleAddVideoLink();
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <Segmented
              size="sm"
              value={addMode}
              onChange={setAddMode}
              disabled={busy}
              options={[
                { value: 'file', label: 'Fichier', icon: <CloudUpload className="h-4 w-4" /> },
                { value: 'link', label: 'Lien', icon: <Link2 className="h-4 w-4" /> },
              ]}
            />
            {space && space.allocated > 0 && (
              <span className={cn('flex items-center gap-1.5 text-xs font-semibold tabular-nums', space.used / space.allocated > 0.9 ? 'text-red-600' : 'text-muted')} title="Espace Dropbox">
                <HardDrive className="h-3.5 w-3.5" />
                {megabytes(space.used)} / {megabytes(space.allocated)}
              </span>
            )}
          </div>

          <Input id="video-name" value={newVideoName} onChange={e => setNewVideoName(e.target.value)} placeholder="Nom" aria-label="Nom" disabled={busy} />

          {addMode === 'file' ? (
            uploadUnavailable?.state === 'not_connected' ? (
              <div className="space-y-3 rounded-2xl border border-line bg-cream/60 p-4">
                <p className="text-sm font-bold text-ink">Connecter Dropbox</p>
                <Button variant="secondary" block icon={<Link2 className="h-4 w-4" />} onClick={openDropboxAuthorize}>
                  1. Autoriser dans Dropbox
                </Button>
                <div className="flex gap-2">
                  <Input value={connectCode} onChange={e => setConnectCode(e.target.value)} placeholder="2. Coller le code" aria-label="Code Dropbox" className="h-11" />
                  <Button className="h-11" loading={connecting} disabled={!connectCode.trim()} onClick={submitConnectCode}>
                    OK
                  </Button>
                </div>
                {connectError && (
                  <p className="break-words rounded-xl bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700" role="alert">
                    {connectError}
                  </p>
                )}
              </div>
            ) : uploadUnavailable ? (
              <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">{uploadUnavailable.message}</p>
            ) : (
              <>
                <label
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition',
                    file ? 'border-brand/40 bg-brand-50/40' : 'border-line bg-cream/50 hover:border-brand/50',
                    busy && 'pointer-events-none opacity-70',
                  )}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) pickFile(f);
                  }}
                >
                  <CloudUpload className="h-7 w-7 text-brand" />
                  {file ? (
                    <>
                      <span className="max-w-full truncate text-sm font-bold text-ink">{file.name}</span>
                      <span className="text-xs text-muted">{megabytes(file.size)}</span>
                    </>
                  ) : (
                    <span className="text-sm font-bold text-ink">Vidéo, image ou PDF</span>
                  )}
                  <input type="file" accept="video/mp4,video/quicktime,video/*,image/jpeg,image/png,image/webp,application/pdf,.pdf" className="sr-only" disabled={busy} onChange={e => pickFile(e.target.files?.[0] || null)} />
                </label>

                {progress !== null && (
                  <div className="h-2 overflow-hidden rounded-full bg-sand" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${Math.max(3, progress * 100)}%` }} />
                  </div>
                )}

                {file && pdfPages !== null && !busy ? (
                  <div className="space-y-2">
                    <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-700">
                      <FileText className="h-4 w-4" />
                      {pdfPages} page{pdfPages > 1 ? 's' : ''} · une image de {IMAGE_SECONDS} s par page
                      {pdfPages > PDF_MAX_PAGES && ` · ${PDF_MAX_PAGES} premières`}
                    </p>
                    <Segmented
                      value={pdfFit}
                      onChange={setPdfFit}
                      options={[
                        { value: 'whole', label: 'Page entière' },
                        { value: 'fill', label: 'Remplir l’écran' },
                      ]}
                    />
                  </div>
                ) : file && progress === null && fileIsImage ? (
                  fileAnalysis && (
                    <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-700">
                      <ImageIcon className="h-4 w-4" />
                      {fileAnalysis.width} × {fileAnalysis.height} · {IMAGE_SECONDS} s par passage
                    </p>
                  )
                ) : (
                  file && progress === null && <AnalysisLine analysis={fileAnalysis} />
                )}
              </>
            )
          ) : (
            <>
              <Input
                id="video-url"
                type="url"
                inputMode="url"
                value={newVideoUrl}
                onChange={e => setNewVideoUrl(e.target.value)}
                placeholder="Lien Dropbox, Drive, mp4"
                aria-label="Lien"
                leading={<Link2 className="h-4.5 w-4.5" />}
              />
              <DraftQuality url={newVideoUrl} />
            </>
          )}
          <button type="submit" className="sr-only">
            Valider
          </button>
        </form>
      </Modal>
    </div>
  );
}

/* ================================ Sous-composants ================================ */

function VideoCard({
  video,
  albumLabel,
  usedOn,
  quality,
  format,
  onInspect,
  canDelete,
  onPlay,
  onCopy,
  onDelete,
}: {
  video: VideoFile;
  albumLabel?: string;
  usedOn: string[];
  quality?: Assessment['verdict'] | 'pending';
  format?: { format: string | null; source: FormatSource | null };
  onInspect: () => void;
  canDelete: boolean;
  onPlay: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card group overflow-hidden p-2">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink">
        <VideoThumb video={video} dead={quality === 'unknown'} />
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Lire ${video.name}`}
          className="absolute inset-0 bg-black/0 transition hover:bg-black/20"
        >
          {/* Petit badge dans le coin : ne recouvre plus les boutons copier / supprimer. */}
          <span className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 shadow-md transition group-hover:scale-110">
            <Play className="ml-0.5 h-3.5 w-3.5 fill-brand text-brand" />
          </span>
        </button>
        {usedOn.length > 0 && (
          <span
            className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white backdrop-blur"
            title={`Diffusée sur : ${usedOn.join(', ')}`}
          >
            <MonitorPlay className="h-3.5 w-3.5" />
            {usedOn.length}
          </span>
        )}
        {isImageUrl(video.url) ? (
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex h-7 items-center gap-1 rounded-full bg-black/45 px-2 text-[11px] font-bold text-white backdrop-blur">
            <ImageIcon className="h-3.5 w-3.5" />
            {IMAGE_SECONDS} s
          </span>
        ) : (
        <button
          type="button"
          onClick={onInspect}
          aria-label="Contrôle qualité"
          title="Contrôle qualité"
          className={cn(
            'absolute bottom-1.5 left-1.5 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-bold backdrop-blur transition hover:brightness-110',
            quality === 'light' && 'bg-black/45 text-emerald-300',
            quality === 'heavy' && 'bg-amber-500/95 text-white',
            (quality === 'incompatible' || quality === 'unknown') && 'bg-red-600/95 text-white',
            (!quality || quality === 'pending') && 'bg-black/45 text-white/80',
          )}
        >
          {quality === 'light' && <CheckCircle2 className="h-4 w-4" />}
          {quality === 'heavy' && <AlertTriangle className="h-4 w-4" />}
          {(quality === 'incompatible' || quality === 'unknown') && <XCircle className="h-4 w-4" />}
          {(!quality || quality === 'pending') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {quality === 'heavy' && 'À optimiser'}
          {quality === 'incompatible' && 'Incompatible'}
          {quality === 'unknown' && 'Illisible'}
        </button>
        )}
        <div className="absolute right-1.5 top-1.5 flex gap-1">
          <IconButton label="Copier le lien" size="sm" variant="onDark" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" />
          </IconButton>
          {canDelete && (
            <IconButton label={`Retirer ${video.name}`} size="sm" variant="onDark" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      </div>
      <div className="min-w-0 px-1 pt-2">
        <p className="truncate text-sm font-bold text-ink" title={video.name}>
          {video.name}
        </p>
        <div className="flex min-w-0 items-center gap-1.5">
          {format?.format && (
            <button
              type="button"
              onClick={onInspect}
              title={format.source ? `Format ${SOURCE_LABEL[format.source]}` : undefined}
              className={cn(
                'flex-shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold',
                format.source === 'saved' ? 'bg-ink text-white' : 'border border-dashed border-muted/50 text-muted',
              )}
            >
              {FORMAT_SHORT[format.format]}
            </button>
          )}
          {albumLabel && <p className="min-w-0 truncate text-xs text-muted">{albumLabel}</p>}
        </div>
      </div>
    </div>
  );
}

function VideoThumb({ video, className, dead }: { video: VideoFile; className?: string; dead?: boolean }) {
  // Lien mort connu : on ne tente pas de charger la vidéo (évite des erreurs réseau en boucle).
  const [failed, setFailed] = useState(!!dead);
  const cls = cn('h-full w-full object-cover', className);

  if (video.thumbnail && !failed) return <img src={video.thumbnail} alt="" loading="lazy" className={cls} onError={() => setFailed(true)} />;
  if (isImageUrl(video.url) && !failed) return <img src={video.url} alt="" loading="lazy" className={cls} onError={() => setFailed(true)} />;
  if (video.url && !isGoogleDrive(video.url) && !failed) {
    // #t=5 : image prise après les fondus d’ouverture (souvent noirs) ; preload="metadata" évite de télécharger tout le fichier.
    return <video src={`${video.url}#t=5`} muted playsInline preload="metadata" className={cn(cls, 'pointer-events-none')} onError={() => setFailed(true)} />;
  }
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-brand-100 to-cream text-brand">
      <Video className="h-6 w-6" />
      <span className="rounded bg-white/80 px-1.5 text-[10px] font-black tracking-wide text-brand-800">{fileExtension(video.name)}</span>
    </span>
  );
}

function AlbumCover({ videos }: { videos: VideoFile[] }) {
  const cover = videos.find(v => v.thumbnail) || videos[0];
  return (
    <span className="relative block h-14 w-20 flex-shrink-0">
      {videos.length > 1 && <span className="absolute inset-0 translate-x-1.5 translate-y-1 rotate-3 rounded-xl border border-sand bg-brand-800/15" />}
      {videos.length > 0 && <span className="absolute inset-0 -rotate-2 rounded-xl border border-sand bg-brand/10" />}
      <span className="absolute inset-0 overflow-hidden rounded-xl border border-line bg-cream shadow-sm">
        {/* Icône de fond : visible tant que l'aperçu n'est pas chargé (ou indisponible). */}
        <span className="absolute inset-0 flex items-center justify-center text-brand/30">
          <FolderOpen className="h-6 w-6" />
        </span>
        {cover ? (
          <span className="relative block h-full w-full">
            <VideoThumb video={cover} />
          </span>
        ) : (
          <span className="flex h-full w-full items-center justify-center text-brand/40">
            <FolderOpen className="h-6 w-6" />
          </span>
        )}
      </span>
    </span>
  );
}

const VERDICT_UI = {
  light: { tone: 'bg-emerald-50 text-emerald-700', icon: <CheckCircle2 className="h-5 w-5" />, label: 'Légère pour les écrans' },
  heavy: { tone: 'bg-amber-50 text-amber-700', icon: <AlertTriangle className="h-5 w-5" />, label: 'À optimiser' },
  incompatible: { tone: 'bg-red-50 text-red-700', icon: <XCircle className="h-5 w-5" />, label: 'Incompatible' },
  unknown: { tone: 'bg-red-50 text-red-700', icon: <XCircle className="h-5 w-5" />, label: 'Illisible' },
} as const;

function QualitySheet({
  analysis: a,
  pending,
  target,
  walls,
}: {
  analysis?: VideoAnalysis;
  pending: boolean;
  target: { width: number; height: number };
  walls: string[];
}) {
  if (!a || pending) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
        Analyse de l’en-tête…
      </div>
    );
  }
  const s = assess(a, target);
  const ui = VERDICT_UI[s.verdict];
  const reco = a.ok ? recommendation(a, target) : null;
  const rows: [string, string][] = a.ok
    ? [
        ['Résolution', a.width && a.height ? `${a.width}×${a.height}` : '—'],
        ['Images/s', a.fps ? `${Math.round(a.fps * 10) / 10}` : '—'],
        ['Codec', `${(a.codec || '—').toUpperCase()}${a.profile ? ` · ${a.profile}` : ''}`],
        ['Débit', a.bitrate ? mbps(a.bitrate) : '—'],
        ['Durée', a.duration ? formatDuration(a.duration) : '—'],
        ['Taille', a.size ? megabytes(a.size) : '—'],
        ['Son', a.hasAudio ? 'Oui' : 'Non'],
        ['Utile', `${target.width}×${target.height}`],
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className={cn('flex items-start gap-3 rounded-2xl p-3.5', ui.tone)}>
        {ui.icon}
        <div className="min-w-0">
          <p className="font-bold">{ui.label}</p>
          {s.reasons.map(r => (
            <p key={r} className="text-sm opacity-90">
              {r}
            </p>
          ))}
        </div>
      </div>

      {rows.length > 0 && (
        <dl className="grid grid-cols-2 gap-2">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-cream/70 px-3.5 py-2.5">
              <dt className="text-xs font-semibold text-muted">{k}</dt>
              <dd className="truncate text-[15px] font-bold tabular-nums text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {walls.length > 0 && (
        <p className="flex items-start gap-2 px-1 text-sm text-muted">
          <MonitorPlay className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand" />
          {walls.join(', ')}
        </p>
      )}

      {reco && s.verdict !== 'light' && (
        <div className="rounded-2xl border border-line p-3.5">
          <p className="flex items-center gap-2 text-sm font-bold text-ink">
            <Gauge className="h-4 w-4 text-brand" /> Export conseillé
          </p>
          <p className="mt-1 text-sm text-muted">{reco.summary}</p>
        </div>
      )}
    </div>
  );
}

/** Résultat compact d'une analyse (fichier ou lien). */
function AnalysisLine({ analysis }: { analysis: VideoAnalysis | null }) {
  if (!analysis) {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Contrôle de la vidéo…
      </p>
    );
  }
  const s = assess(analysis, DEFAULT_TARGET);
  const ui = VERDICT_UI[s.verdict];
  return (
    <div className={cn('rounded-2xl p-3 text-sm', ui.tone)}>
      <p className="flex items-center gap-2 font-bold">
        {ui.icon}
        {ui.label}
      </p>
      {analysis.ok && (
        <p className="mt-0.5 opacity-90">
          {analysis.width}×{analysis.height} · {analysis.fps ? `${Math.round(analysis.fps)} i/s` : '? i/s'} · {(analysis.codec || '').toUpperCase()}
          {analysis.bitrate ? ` · ${mbps(analysis.bitrate)}` : ''}
        </p>
      )}
      {s.reasons.map(r => (
        <p key={r} className="opacity-90">
          {r}
        </p>
      ))}
    </div>
  );
}

/** Analyse du lien pendant la saisie, avant même d'ajouter la vidéo. */
function DraftQuality({ url }: { url: string }) {
  const [state, setState] = useState<{ url: string; analysis?: VideoAnalysis } | null>(null);

  useEffect(() => {
    const clean = url.trim();
    if (!/^https?:\/\//.test(clean)) {
      setState(null);
      return;
    }
    const direct = transformStorageUrl(clean);
    setState({ url: direct });
    let cancelled = false;
    const t = setTimeout(async () => {
      const analysis = await analyzeVideo(direct);
      if (!cancelled) setState({ url: direct, analysis });
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [url]);

  if (!state) return null;
  return <AnalysisLine analysis={state.analysis ?? null} />;
}
